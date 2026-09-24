import { supabase } from '../supabase/config';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BUCKET = 'menu-images';

function validateImage(file) {
  if (!file) throw new Error('No file selected.');
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Please upload a JPEG, PNG, WEBP, or GIF image.');
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('Image must be smaller than 5MB.');
  }
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadToBucket(restaurantId, subfolder, file) {
  validateImage(file);
  const path = `${restaurantId}/${subfolder}/${Date.now()}_${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadMenuImage(restaurantId, file) {
  return uploadToBucket(restaurantId, 'menu', file);
}

export async function uploadRestaurantLogo(restaurantId, file) {
  return uploadToBucket(restaurantId, 'logo', file);
}

export async function uploadHeroImage(restaurantId, file) {
  return uploadToBucket(restaurantId, 'hero', file);
}

export async function uploadPromoImage(restaurantId, file) {
  return uploadToBucket(restaurantId, 'promo', file);
}
