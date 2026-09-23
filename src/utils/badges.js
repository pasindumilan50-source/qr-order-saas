// A small, fixed vocabulary of highlight badges a menu item can carry.
// Kept here as the single source of truth for label/emoji/color so the
// admin editor and the customer-facing menu never drift out of sync.
export const BADGE_CATALOG = [
  { id: 'fast_moving', label: 'Fast Moving', emoji: '🔥', color: '#E8462D' },
  { id: 'popular', label: 'Popular', emoji: '⭐', color: '#E8A93D' },
  { id: 'new', label: 'New', emoji: '✨', color: '#2FA88C' },
  { id: 'chef_special', label: "Chef's Special", emoji: '👨‍🍳', color: '#6C5CE7' },
  { id: 'spicy', label: 'Spicy', emoji: '🌶️', color: '#D64545' },
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🌿', color: '#4CAF6D' },
  { id: 'offer', label: 'Offer', emoji: '🏷️', color: '#D6398A' },
];

export const BADGE_BY_ID = Object.fromEntries(BADGE_CATALOG.map((b) => [b.id, b]));
