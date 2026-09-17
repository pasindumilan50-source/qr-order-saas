import { supabase, getAppBaseUrl } from '../supabase/config';

function toTable(row) {
  return {
    id: row.id,
    tableId: row.id,
    restaurantId: row.restaurant_id,
    tableNumber: row.table_number,
    status: row.status,
    qrUrl: resolveQrUrl(row.qr_url),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// `tables.qr_url` stores either:
//  - a relative path like "/r/{slug}/table/{number}" (all rows created or
//    renamed after this fix), resolved against the CURRENT application base
//    URL every time it's read — so QR codes always reflect whatever
//    environment they're actually being viewed/printed from, and never go
//    stale if the origin they were created under changes; or
//  - a full absolute URL (rows created before this fix, e.g. baked with
//    "http://localhost:5173/..."). Those are left exactly as stored so
//    already-generated QR codes keep resolving to the same place they
//    always did, instead of being silently rewritten.
export function resolveQrUrl(qrPathOrUrl) {
  if (!qrPathOrUrl) return '';
  if (/^https?:\/\//i.test(qrPathOrUrl)) {
    return qrPathOrUrl;
  }
  return `${getAppBaseUrl()}${qrPathOrUrl}`;
}

export async function buildQrPath(restaurantId, tableNumber) {
  const { data } = await supabase.from('restaurants').select('slug').eq('id', restaurantId).maybeSingle();
  if (data?.slug) {
    return `/r/${encodeURIComponent(data.slug)}/table/${encodeURIComponent(tableNumber)}`;
  }
  // Fallback for restaurants without a slug yet (shouldn't normally happen —
  // create_restaurant() always assigns one — but keeps table creation from
  // ever failing outright).
  return `/menu?restaurant=${encodeURIComponent(restaurantId)}&table=${encodeURIComponent(tableNumber)}`;
}

export function listenTables(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('tables')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('table_number', { ascending: true });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toTable));
  }

  fetchAll();

  const channel = supabase
    .channel(`tables-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tables', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function listTablesOnce(restaurantId) {
  const { data, error } = await supabase.from('tables').select('*').eq('restaurant_id', restaurantId);
  if (error) throw error;
  return (data || []).map(toTable);
}

export async function createTable(restaurantId, tableNumber) {
  const trimmed = String(tableNumber).trim();
  if (!trimmed) throw new Error('Table number is required.');

  const qrPath = await buildQrPath(restaurantId, trimmed);
  const { data: row, error } = await supabase
    .from('tables')
    .insert({
      restaurant_id: restaurantId,
      table_number: trimmed,
      status: 'active',
      qr_url: qrPath,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`Table ${trimmed} already exists.`);
    throw error;
  }
  return row.id;
}

export async function updateTableNumber(tableId, restaurantId, newTableNumber) {
  const trimmed = String(newTableNumber).trim();
  if (!trimmed) throw new Error('Table number is required.');

  const qrPath = await buildQrPath(restaurantId, trimmed);
  const { error } = await supabase
    .from('tables')
    .update({ table_number: trimmed, qr_url: qrPath })
    .eq('id', tableId);

  if (error) {
    if (error.code === '23505') throw new Error(`Table ${trimmed} already exists.`);
    throw error;
  }
}

export async function setTableStatus(tableId, status) {
  const { error } = await supabase.from('tables').update({ status }).eq('id', tableId);
  if (error) throw error;
}

export async function deleteTable(tableId) {
  const { error } = await supabase.from('tables').delete().eq('id', tableId);
  if (error) throw error;
}
