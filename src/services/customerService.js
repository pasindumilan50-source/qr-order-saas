import { supabase } from '../supabase/config';

function toCustomer(row) {
  return {
    id: row.id,
    customerId: row.id,
    restaurantId: row.restaurant_id,
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    orderCount: row.order_count || 0,
    totalSpent: Number(row.total_spent || 0),
    createdAt: row.created_at,
    lastOrderAt: row.last_order_at,
  };
}

export function listenCustomers(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('last_order_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toCustomer));
  }

  fetchAll();

  const channel = supabase
    .channel(`customers-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function searchCustomersOnce(restaurantId, searchTerm) {
  const { data, error } = await supabase.from('customers').select('*').eq('restaurant_id', restaurantId).limit(500);
  if (error) throw error;
  const all = (data || []).map(toCustomer);
  if (!searchTerm) return all;
  const term = searchTerm.toLowerCase();
  return all.filter(
    (c) => c.name?.toLowerCase().includes(term) || c.phone?.includes(term) || c.email?.toLowerCase().includes(term)
  );
}

export async function updateCustomerNote(customerId, restaurantId, fields) {
  const patch = {};
  if ('name' in fields) patch.name = fields.name;
  if ('phone' in fields) patch.phone = fields.phone;
  if ('email' in fields) patch.email = fields.email;
  const { error } = await supabase.from('customers').update(patch).eq('id', customerId).eq('restaurant_id', restaurantId);
  if (error) throw error;
}
