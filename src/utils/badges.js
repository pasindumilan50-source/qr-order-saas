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
  { id: 'best_seller', label: 'Best Seller', emoji: '🏆', color: '#4F46E5' },
  { id: 'recommended', label: 'Recommended', emoji: '👍', color: '#0F172A' },
];

// Home-page featured carousels, in display order. Each maps 1:1 onto a
// badge id already in BADGE_CATALOG above — the restaurant picks which
// items appear in which carousel using the exact same "Highlight badges"
// picker it already uses in the admin Menu page. No separate "featured
// items" admin UI needed.
export const FEATURED_SECTIONS = [
  { badgeId: 'popular', heading: 'Popular Items' },
  { badgeId: 'fast_moving', heading: 'Fast Moving' },
  { badgeId: 'chef_special', heading: "Chef's Choice" },
  { badgeId: 'best_seller', heading: 'Best Sellers' },
  { badgeId: 'recommended', heading: 'Recommended' },
];

export const BADGE_BY_ID = Object.fromEntries(BADGE_CATALOG.map((b) => [b.id, b]));
