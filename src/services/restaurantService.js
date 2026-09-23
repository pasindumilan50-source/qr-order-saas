import { supabase } from '../supabase/config';

// Maps a `restaurants` row (snake_case, is_active boolean) to the shape the
// rest of the app already expects (camelCase, status string) so page
// components did not need to change during the Supabase migration.
function toRestaurant(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurantId: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo_url || '',
    address: row.address || '',
    phone: row.phone || '',
    email: row.email || '',
    ownerId: row.owner_id,
    status: row.is_active ? 'active' : 'disabled',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRestaurant(payload) {
  const { data, error } = await supabase.functions.invoke('create-restaurant', {
    body: {
      name: payload.name,
      address: payload.address,
      phone: payload.phone,
      email: payload.email,
      ownerName: payload.ownerName,
      ownerEmail: payload.ownerEmail,
      ownerPassword: payload.ownerPassword,
    },
  });
  if (error) throw new Error(await extractFunctionError(error));
  return { restaurantId: data.restaurant?.id, ...data };
}

export async function getRestaurant(restaurantId) {
  const { data, error } = await supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
  if (error) throw error;
  return toRestaurant(data);
}

export async function getRestaurantBySlug(slug) {
  const { data, error } = await supabase.from('restaurants').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return toRestaurant(data);
}

export function listenRestaurants(onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase.from('restaurants').select('*').order('created_at', { ascending: false });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toRestaurant));
  }

  fetchAll();

  const channel = supabase
    .channel('restaurants-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, () => fetchAll())
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function listRestaurantsOnce() {
  const { data, error } = await supabase.from('restaurants').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toRestaurant);
}

export async function setRestaurantStatus(restaurantId, status) {
  const { error } = await supabase.rpc('set_restaurant_status', {
    p_restaurant_id: restaurantId,
    p_is_active: status === 'active',
  });
  if (error) throw error;
}

export async function updateRestaurantProfile(restaurantId, fields) {
  const { error } = await supabase.rpc('update_restaurant_profile', {
    p_restaurant_id: restaurantId,
    p_name: 'name' in fields ? fields.name : null,
    p_slug: 'slug' in fields ? fields.slug : null,
    p_address: 'address' in fields ? fields.address : null,
    p_phone: 'phone' in fields ? fields.phone : null,
    p_email: 'email' in fields ? fields.email : null,
    p_logo_url: 'logo' in fields ? fields.logo : null,
  });
  if (error) throw error;
}

async function extractFunctionError(error) {
  try {
    const body = await error.context?.json?.();
    return body?.error || error.message || 'Request failed.';
  } catch {
    return error.message || 'Request failed.';
  }
}
