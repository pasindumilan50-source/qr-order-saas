// supabase/functions/payhere-notify/index.ts
//
// PayHere Checkout API — server-to-server payment notification endpoint.
//
// This is the ONLY place in the whole system that is allowed to mark a card
// payment 'paid'. The customer's browser never does this directly — it only
// ever redirects to PayHere and later polls the order via Supabase realtime.
//
// Reference: https://support.payhere.lk/api-&-mobile-sdk/checkout-api
// (fields, md5sig formula, and status codes below are taken directly from
// that page — do not "simplify" the hash formula, it must match exactly).
//
// Deploy:   supabase functions deploy payhere-notify --no-verify-jwt
//   (--no-verify-jwt is required: PayHere calls this anonymously, it does
//    not send a Supabase auth header)
//
// Secrets required (function-scoped, set via `supabase secrets set`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   PAYHERE_MERCHANT_ID        (e.g. 1238097)
//   PAYHERE_MERCHANT_SECRET    (the Merchant Secret for whichever domain
//                                generated the checkout hash — see note at
//                                bottom of this file about multiple domains)
//
// This endpoint deliberately does NOT use callerClient/getCallerProfile from
// _shared/clients.ts — PayHere is not a logged-in Supabase user. Trust here
// comes entirely from the md5sig check below, not from any auth header.

import { createHash } from 'node:crypto';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { serviceRoleClient } from '../_shared/clients.ts';

const PAYHERE_MERCHANT_ID = Deno.env.get('PAYHERE_MERCHANT_ID') ?? '';
const PAYHERE_MERCHANT_SECRET = Deno.env.get('PAYHERE_MERCHANT_SECRET') ?? '';

// PayHere status codes (see Checkout API docs).
const STATUS_SUCCESS = '2';
const STATUS_PENDING = '0';
const STATUS_CANCELLED = '-1';
const STATUS_FAILED = '-2';
const STATUS_CHARGEDBACK = '-3';

function md5Upper(input: string): string {
  // Web Crypto's crypto.subtle.digest does NOT support MD5 (only SHA-*).
  // PayHere's hash/md5sig formulas require plain MD5, so we use Node's
  // crypto module here (Supabase Edge Functions support the `node:` runtime
  // compat specifier for this).
  return createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if (!PAYHERE_MERCHANT_SECRET || !PAYHERE_MERCHANT_ID) {
    console.error('payhere-notify: PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET not configured.');
    // Still 200 — PayHere doesn't retry based on our internal misconfig
    // messaging, but we must not leak config state either. Log server-side
    // and bail.
    return jsonResponse({ error: 'Server not configured.' }, 500);
  }

  let form: URLSearchParams;
  try {
    const bodyText = await req.text();
    // PayHere sends application/x-www-form-urlencoded, per official docs.
    form = new URLSearchParams(bodyText);
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const merchantId = form.get('merchant_id') ?? '';
  const orderId = form.get('order_id') ?? '';
  const paymentId = form.get('payment_id') ?? '';
  const payhereAmount = form.get('payhere_amount') ?? '';
  const payhereCurrency = form.get('payhere_currency') ?? '';
  const statusCode = form.get('status_code') ?? '';
  const md5sig = form.get('md5sig') ?? '';
  const method = form.get('method') ?? null;
  const statusMessage = form.get('status_message') ?? null;

  if (!orderId || !paymentId || !payhereAmount || !payhereCurrency || !statusCode || !md5sig) {
    console.error('payhere-notify: missing required fields', { orderId, paymentId, statusCode });
    return jsonResponse({ error: 'Missing required fields.' }, 400);
  }

  if (merchantId !== PAYHERE_MERCHANT_ID) {
    console.error('payhere-notify: merchant_id mismatch', { received: merchantId });
    return jsonResponse({ error: 'Merchant mismatch.' }, 400);
  }

  // ---------------------------------------------------------------------
  // 1) Verify the signature. This is the ONLY thing that lets us trust this
  //    request actually came from PayHere and was not forged/tampered with.
  //    Formula (official docs):
  //      md5sig = upper(md5( merchant_id + order_id + payhere_amount +
  //                           payhere_currency + status_code +
  //                           upper(md5(merchant_secret)) ))
  // ---------------------------------------------------------------------
  const hashedSecret = md5Upper(PAYHERE_MERCHANT_SECRET);
  const expectedSig = md5Upper(
    merchantId + orderId + payhereAmount + payhereCurrency + statusCode + hashedSecret
  );

  if (expectedSig !== md5sig) {
    console.error('payhere-notify: md5sig verification FAILED', { orderId, paymentId });
    return jsonResponse({ error: 'Signature verification failed.' }, 400);
  }

  const supabase = serviceRoleClient();

  // ---------------------------------------------------------------------
  // 2) Find the order and verify the amount actually matches what we
  //    expect. Never trust the notification's amount blindly — always
  //    cross-check against our own stored order total.
  // ---------------------------------------------------------------------
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, total, payment_status')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error('payhere-notify: order not found', { orderId, orderError });
    return jsonResponse({ error: 'Order not found.' }, 404);
  }

  const expectedAmount = Number(order.total).toFixed(2);
  const receivedAmount = Number(payhereAmount).toFixed(2);

  if (expectedAmount !== receivedAmount || payhereCurrency !== 'LKR') {
    console.error('payhere-notify: amount/currency mismatch', {
      orderId,
      expectedAmount,
      receivedAmount,
      payhereCurrency,
    });
    return jsonResponse({ error: 'Amount/currency mismatch.' }, 400);
  }

  // ---------------------------------------------------------------------
  // 3) Idempotency guard. Insert the transaction row FIRST — the unique
  //    constraint on (provider, payment_id) means a duplicate notification
  //    (PayHere may resend) fails this insert harmlessly, and we stop here
  //    without re-running any business logic a second time.
  // ---------------------------------------------------------------------
  const { error: txnError } = await supabase.from('payment_transactions').insert({
    order_id: orderId,
    provider: 'payhere',
    payment_id: paymentId,
    status_code: statusCode,
    amount: Number(payhereAmount),
    currency: payhereCurrency,
    raw_payload: {
      merchant_id: merchantId,
      order_id: orderId,
      payment_id: paymentId,
      payhere_amount: payhereAmount,
      payhere_currency: payhereCurrency,
      status_code: statusCode,
      method,
      status_message: statusMessage,
    },
  });

  if (txnError) {
    if (txnError.code === '23505') {
      // Unique violation — we've already processed this exact PayHere
      // payment_id before. Acknowledge success so PayHere stops retrying,
      // but do nothing further.
      console.log('payhere-notify: duplicate notification ignored', { orderId, paymentId });
      return jsonResponse({ ok: true, duplicate: true });
    }
    console.error('payhere-notify: failed to record transaction', txnError);
    return jsonResponse({ error: 'Could not record transaction.' }, 500);
  }

  // ---------------------------------------------------------------------
  // 4) Apply the outcome via the service-role-only RPCs from
  //    0016_payment_gateway.sql. These RPCs re-check payment_status = 'paid'
  //    internally too, so this stays safe even if called twice.
  // ---------------------------------------------------------------------
  if (statusCode === STATUS_SUCCESS) {
    const { error: rpcError } = await supabase.rpc('confirm_card_payment_and_complete', {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_provider: 'payhere',
    });
    if (rpcError) {
      console.error('payhere-notify: confirm_card_payment_and_complete failed', rpcError);
      return jsonResponse({ error: 'Could not update order.' }, 500);
    }
    console.log('payhere-notify: payment confirmed', { orderId, paymentId });
  } else if (statusCode === STATUS_CANCELLED) {
    await supabase.rpc('mark_card_payment_failed', { p_order_id: orderId, p_status: 'cancelled' });
    console.log('payhere-notify: payment cancelled', { orderId, paymentId });
  } else if (statusCode === STATUS_FAILED || statusCode === STATUS_CHARGEDBACK) {
    await supabase.rpc('mark_card_payment_failed', { p_order_id: orderId, p_status: 'failed' });
    console.log('payhere-notify: payment failed/chargedback', { orderId, paymentId, statusCode });
  } else if (statusCode === STATUS_PENDING) {
    // Leave payment_status as 'pending' — nothing to do, this is an
    // intermediate notification some payment methods send.
    console.log('payhere-notify: payment still pending', { orderId, paymentId });
  } else {
    console.error('payhere-notify: unrecognized status_code', { orderId, statusCode });
  }

  return jsonResponse({ ok: true });
});

// ---------------------------------------------------------------------------
// Note on multiple domains (localhost vs. your eventual production domain):
// PAYHERE_MERCHANT_SECRET here must be the SAME secret the frontend used to
// generate the checkout `hash` for that request, because both the frontend
// hash and this notification's md5sig are derived from it. While you are
// only testing from one domain at a time, keep this secret set to that
// domain's secret. Before going live, update PAYHERE_MERCHANT_SECRET to your
// production domain's secret, and update the frontend to use the matching
// value for hash generation.
// ---------------------------------------------------------------------------
