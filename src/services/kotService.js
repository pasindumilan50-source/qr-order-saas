import { supabase } from '../supabase/config';

// Statuses a client of this service may filter on. Mirrors the controlled
// set defined in 0012_kot_print_queue.sql (kot_print_jobs_status_check).
export const KOT_JOB_STATUSES = ['queued', 'printing', 'printed', 'failed', 'cancelled'];

function toKotJob(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    orderId: row.order_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    queuedAt: row.queued_at,
    claimedAt: row.claimed_at || null,
    printedAt: row.printed_at || null,
    failedAt: row.failed_at || null,
    snapshot: row.kot_snapshot || null,
  };
}

// One-off fetch of KOT print jobs for a restaurant. `statusFilter` accepts
// any single status from KOT_JOB_STATUSES, an array of statuses, or 'all'.
export async function getKotPrintJobs(restaurantId, { statusFilter = 'all', orderIds } = {}) {
  let query = supabase.from('kot_print_jobs').select('*').eq('restaurant_id', restaurantId);

  if (Array.isArray(statusFilter)) {
    query = query.in('status', statusFilter);
  } else if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  if (orderIds && orderIds.length > 0) {
    query = query.in('order_id', orderIds);
  }

  query = query.order('queued_at', { ascending: false }).limit(500);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toKotJob);
}

// Live view of a restaurant's KOT print queue — used to drive a simple
// Queued/Printing/Printed/Failed status indicator. Re-fetches on any change
// rather than trying to hand-patch Realtime payloads, matching the pattern
// already used by listenOrdersForAdmin/listenKitchenOrders.
export function listenKotPrintJobs(restaurantId, { statusFilter = 'all' } = {}, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    try {
      const jobs = await getKotPrintJobs(restaurantId, { statusFilter });
      if (!cancelled) onData(jobs);
    } catch (err) {
      if (!cancelled) onError?.(err);
    }
  }

  fetchAll();

  const channel = supabase
    .channel(`kot-print-jobs-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'kot_print_jobs', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}
