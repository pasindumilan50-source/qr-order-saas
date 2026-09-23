// A small, fixed vocabulary of highlight badges a menu item can carry.
// Kept here as the single source of truth for label/emoji/color so the
// admin editor and the customer-facing menu never drift out of sync.
export const BADGE_CATALOG = [
  { id: 'fast_moving', label: 'Fast Moving', emoji: '🔥', color: '#4F46E5' },
  { id: 'popular', label: 'Popular', emoji: '⭐', color: '#0F172A' },
  { id: 'new', label: 'New', emoji: '✨', color: '#4338CA' },
  { id: 'chef_special', label: "Chef's Special", emoji: '👨‍🍳', color: '#1E293B' },
  { id: 'spicy', label: 'Spicy', emoji: '🌶️', color: '#4F46E5' },
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🌿', color: '#0F172A' },
  { id: 'offer', label: 'Offer', emoji: '🏷️', color: '#4338CA' },
];

export const BADGE_BY_ID = Object.fromEntries(BADGE_CATALOG.map((b) => [b.id, b]));
