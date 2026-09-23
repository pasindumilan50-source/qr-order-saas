// supabase/functions/payhere-checkout/index.ts
//
// Called by the CUSTOMER's browser (authenticated guest session) right
// before redirecting to PayHere Checkout. Returns everything the frontend
// needs to build the PayHere checkout POST form — including the `hash`.
//
// The hash is generated HERE, server-side, never in the browser, because
// generating it client-side would require shipping PAYHERE_MERCHANT_SECRET
// into the frontend bundle (PayHere's own docs explicitly warn against
// this: "the hash parameter should not be generated in client-side since
// it will expose your merchant_secret").
//
// This function does NOT mark anything paid — it only reads the order (to
// verify ownership + compute the amount) and flips payment_status to
// 'pending' via the existing customer-safe RPC. The actual 'paid' state is
// only ever set by payhere-notify after PayHere's verified server callback.
//
// Deploy: supabase functions deploy payhere-checkout
// (no --no-verify-jwt here — the customer's own Supabase session IS required)
//
// Secrets required (same as payhere-notify):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET

import { createHash } from 'node:crypto';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { callerClient } from '../_shared/clients.ts';

const PAYHERE_MERCHANT_ID = Deno.env.get('PAYHERE_MERCHANT_ID') ?? '';
const PAYHERE_MERCHANT_SECRET = Deno.env.get('PAYHERE_MERCHANT_SECRET') ?? '';

function md5Upper(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
}

// Best-effort split of a free-text name into first/last, since PayHere
// wants both. Falls back to generic values when the customer left the name
// field blank at order time.
function splitName(fullName: string | null): { firstName: string; lastName: string } {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: 'Guest', lastName: 'Customer' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Customer' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if (!PAYHERE_MERCHANT_SECRET || !PAYHERE_MERCHANT_ID) {
    console.error('payhere-checkout: PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET not configured.');
    return jsonResponse({ error: 'Server not configured.' }, 500);
  }

  let body: { orderId?: string; returnUrl?: string; cancelUrl?: string; notifyUrl?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const orderId = body.orderId;
  if (!orderId) {
    return jsonResponse({ error: 'orderId is required.' }, 400);
  }

  // A client scoped to the caller's own JWT — every query below is subject
  // to RLS exactly as if the customer had queried directly. This is how we
  // verify "does this order actually belong to this guest session" without
  // trusting anything the request body claims.
  const supabase = callerClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonResponse({ error: 'Authentication required.' }, 401);
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, total, customer_uid, customer_name, customer_phone, status, payment_status')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    return jsonResponse({ error: 'Order not found.' }, 404);
  }

  if (order.customer_uid !== user.id) {
    return jsonResponse({ error: 'You may not pay for this order.' }, 403);
  }

  if (order.status !== 'ready') {
    return jsonResponse({ error: `This order is not ready for payment yet (status: ${order.status}).` }, 400);
  }

  if (order.payment_status === 'paid') {
    return jsonResponse({ error: 'This order has already been paid.' }, 400);
  }

  // Mark payment_method/payment_status = card/pending via the existing
  // customer-safe RPC (0016_payment_gateway.sql). This call runs with the
  // caller's own JWT, so its internal customer_uid check is meaningful.
  const { error: rpcError } = await supabase.rpc('mark_order_payment_pending', {
    p_order_id: orderId,
    p_payment_method: 'card',
  });
  if (rpcError) {
    console.error('payhere-checkout: mark_order_payment_pending failed', rpcError);
    return jsonResponse({ error: rpcError.message || 'Could not start payment.' }, 400);
  }

  const amount = Number(order.total).toFixed(2);
  const currency = 'LKR';
  const { firstName, lastName } = splitName(order.customer_name);
  // PayHere requires a syntactically valid email even though this is a
  // dine-in QR order flow with no real customer email on file. This
  // placeholder is never used to contact the customer — it only satisfies
  // PayHere's form validation.
  const email = 'guest-order@qr-order-saas.app';
  const phone = (order.customer_phone || '').trim() || '0770000000';

  const hashedSecret = md5Upper(PAYHERE_MERCHANT_SECRET);
  const hash = md5Upper(PAYHERE_MERCHANT_ID + orderId + amount + currency + hashedSecret);

  return jsonResponse({
    action: 'https://sandbox.payhere.lk/pay/checkout', // TODO: switch to https://www.payhere.lk/pay/checkout for production
    merchant_id: PAYHERE_MERCHANT_ID,
    return_url: body.returnUrl || '',
    cancel_url: body.cancelUrl || '',
    notify_url: body.notifyUrl || '',
    order_id: orderId,
    items: `Order ${orderId.slice(0, 8).toUpperCase()}`,
    currency,
    amount,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    address: '-',
    city: '-',
    country: 'Sri Lanka',
    hash,
  });
});
