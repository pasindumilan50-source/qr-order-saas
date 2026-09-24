import { supabase } from '../supabase/config';

function toHeroSlide(row) {
  return { id: row.id, restaurantId: row.restaurant_id, imageUrl: row.image_url, sortOrder: row.sort_order };
}

function toPromotion(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    imageUrl: row.image_url || '',
    text: row.promo_text,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Hero slides
// ---------------------------------------------------------------------------
export function listenHeroSlides(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('restaurant_hero_slides')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toHeroSlide));
  }

  fetchAll();

  const channel = supabase
    .channel(`hero-slides-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'restaurant_hero_slides', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function addHeroSlide(restaurantId, imageUrl, nextSortOrder) {
  const { error } = await supabase
    .from('restaurant_hero_slides')
    .insert({ restaurant_id: restaurantId, image_url: imageUrl, sort_order: nextSortOrder });
  if (error) throw error;
}

export async function deleteHeroSlide(slideId) {
  const { error } = await supabase.from('restaurant_hero_slides').delete().eq('id', slideId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------
export function listenPromotions(restaurantId, onData, onError) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from('restaurant_promotions')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true });
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    onData((data || []).map(toPromotion));
  }

  fetchAll();

  const channel = supabase
    .channel(`promotions-${restaurantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'restaurant_promotions', filter: `restaurant_id=eq.${restaurantId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function addPromotion(restaurantId, { imageUrl, text }, nextSortOrder) {
  const { error } = await supabase
    .from('restaurant_promotions')
    .insert({ restaurant_id: restaurantId, image_url: imageUrl || null, promo_text: text, sort_order: nextSortOrder });
  if (error) throw error;
}

export async function updatePromotion(promotionId, patch) {
  const dbPatch = {};
  if ('imageUrl' in patch) dbPatch.image_url = patch.imageUrl || null;
  if ('text' in patch) dbPatch.promo_text = patch.text;
  if ('isActive' in patch) dbPatch.is_active = patch.isActive;
  const { error } = await supabase.from('restaurant_promotions').update(dbPatch).eq('id', promotionId);
  if (error) throw error;
}

export async function deletePromotion(promotionId) {
  const { error } = await supabase.from('restaurant_promotions').delete().eq('id', promotionId);
  if (error) throw error;
}
