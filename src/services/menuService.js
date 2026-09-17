import { supabase } from '../supabase/config';

function toMenuItem(row) {
  return {
    id: row.id,
    menuItemId: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    imageUrl: row.image_url || '',
    category: row.category || 'Uncategorized',
    available: row.available !== false,
    soldOut: !!row.sold_out,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listenMenuItems(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toMenuItem));
  }

  fetchAll();

  const channel = supabase
    .channel(`menu-items-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_items', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function listMenuItemsOnce(restaurantId) {
  const { data, error } = await supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId);
  if (error) throw error;
  return (data || []).map(toMenuItem);
}

export async function createMenuItem(restaurantId, data) {
  if (!data.name || !String(data.name).trim()) throw new Error('Item name is required.');
  const price = Number(data.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('A valid price is required.');

  const { data: row, error } = await supabase
    .from('menu_items')
    .insert({
      restaurant_id: restaurantId,
      name: String(data.name).trim(),
      description: data.description || '',
      price,
      image_url: data.imageUrl || '',
      category: data.category || 'Uncategorized',
      available: data.available !== false,
      sold_out: !!data.soldOut,
    })
    .select()
    .single();

  if (error) throw error;
  return row.id;
}

export async function updateMenuItem(menuItemId, data) {
  const patch = {};
  if ('name' in data) patch.name = data.name;
  if ('description' in data) patch.description = data.description;
  if ('imageUrl' in data) patch.image_url = data.imageUrl;
  if ('category' in data) patch.category = data.category;
  if ('available' in data) patch.available = data.available;
  if ('soldOut' in data) patch.sold_out = data.soldOut;
  if ('price' in data) {
    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('A valid price is required.');
    patch.price = price;
  }
  const { error } = await supabase.from('menu_items').update(patch).eq('id', menuItemId);
  if (error) throw error;
}

export async function deleteMenuItem(menuItemId) {
  const { error } = await supabase.from('menu_items').delete().eq('id', menuItemId);
  if (error) throw error;
}

export async function toggleSoldOut(menuItemId, soldOut) {
  const { error } = await supabase.from('menu_items').update({ sold_out: soldOut }).eq('id', menuItemId);
  if (error) throw error;
}

export async function toggleAvailable(menuItemId, available) {
  const { error } = await supabase.from('menu_items').update({ available }).eq('id', menuItemId);
  if (error) throw error;
}
