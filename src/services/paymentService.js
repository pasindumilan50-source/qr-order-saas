import { supabase, getAppBaseUrl } from '../supabase/config';

// -----------------------------------------------------------------------------
// Card payment (PayHere Checkout API)
// -----------------------------------------------------------------------------
//
// Flow:
//   1. Ask our payhere-checkout Edge Function for a signed checkout payload
//      (it verifies we own the order, marks payment_status = 'pending', and
//      generates the hash server-side — never in this file).
//   2. Build a real <form> and submit() it — this is a full-page redirect to
//      PayHere's hosted checkout, exactly as PayHere's own integration docs
//      describe. There is no JSON response to "wait for" here; the browser
//      navigates away.
//   3. The customer completes payment on PayHere's page, then PayHere
//      redirects them back to returnUrl. The ACTUAL payment status is never
//      read from that redirect — OrderStatusPage keeps listening to the
//      order in Supabase in realtime, which only changes once our
//      payhere-notify Edge Function has verified PayHere's server callback.
//
export async function payOrderWithCard(orderId) {
  const returnUrl = `${getAppBaseUrl()}/order/${orderId}`;
  const cancelUrl = `${getAppBaseUrl()}/order/${orderId}`;
  const notifyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payhere-notify`;

  const { data, error } = await supabase.functions.invoke('payhere-checkout', {
    body: { orderId, returnUrl, cancelUrl, notifyUrl },
  });

  if (error) {
    // supabase-js puts a non-2xx response body on error.context in some
    // versions; fall back to a generic message either way.
    let message = 'Could not start payment. Please try again.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — use the generic message
    }
    throw new Error(message);
  }

  if (!data || !data.action || !data.hash) {
    throw new Error('Could not start payment. Please try again.');
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = data.action;

  const fields = {
    merchant_id: data.merchant_id,
    return_url: data.return_url,
    cancel_url: data.cancel_url,
    notify_url: data.notify_url,
    order_id: data.order_id,
    items: data.items,
    currency: data.currency,
    amount: data.amount,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    city: data.city,
    country: data.country,
    hash: data.hash,
  };

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value ?? '';
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
