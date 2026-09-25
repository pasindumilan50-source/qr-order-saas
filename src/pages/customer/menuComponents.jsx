import { useState } from 'react';
import { useCart } from '../../context/CartContext';
import { formatLKR } from '../../utils/formatters';
import { BADGE_BY_ID } from '../../utils/badges';
import ARButton from '../../components/ar/ARButton';

// A category name is always real restaurant data (from menu_items.category).
// This only picks a decorative emoji to go with that real name — it never
// invents, renames, or hides a category. Unrecognised names safely fall
// back to a generic plate icon.
export function categoryEmoji(name) {
  const n = (name || '').toLowerCase();
  if (n === 'all') return '🍽️';
  if (n.includes('rice')) return '🍚';
  if (n.includes('biryani')) return '🍛';
  if (n.includes('curry')) return '🍛';
  if (n.includes('kottu')) return '🥘';
  if (n.includes('noodle')) return '🍜';
  if (n.includes('pasta')) return '🍝';
  if (n.includes('soup')) return '🍲';
  if (n.includes('salad')) return '🥗';
  if (n.includes('starter') || n.includes('appetizer') || n.includes('snack')) return '🥗';
  if (n.includes('seafood') || n.includes('fish') || n.includes('prawn') || n.includes('crab')) return '🐟';
  if (n.includes('chicken')) return '🍗';
  if (n.includes('beef') || n.includes('meat') || n.includes('mutton') || n.includes('pork')) return '🥩';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('burger')) return '🍔';
  if (n.includes('bread') || n.includes('bakery') || n.includes('roti') || n.includes('naan')) return '🥖';
  if (n.includes('dessert') || n.includes('sweet') || n.includes('cake') || n.includes('ice cream')) return '🍰';
  if (n.includes('drink') || n.includes('beverage') || n.includes('juice') || n.includes('tea') || n.includes('coffee')) return '🥤';
  if (n.includes('breakfast')) return '🍳';
  if (n.includes('offer') || n.includes('discount') || n.includes('deal') || n.includes('combo')) return '🏷️';
  return '🍽️';
}

// Shared header for both the Home and Menu pages: logo/name/table on the
// left/center, cart on the right. `onBack`, when passed (Menu page), swaps
// in a back arrow instead of the usual left spacer.
export function CustomerHeader({ restaurant, table, cartCount, onCartClick, onBack }) {
  return (
    <header className="customer-header">
      {onBack ? (
        <button className="header-icon-btn" aria-label="Back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ) : (
        <div className="header-icon-spacer" aria-hidden="true" />
      )}

      <div className="customer-header-brand">
        {restaurant.logo ? (
          <img src={restaurant.logo} alt="" className="restaurant-logo" />
        ) : (
          <div className="restaurant-logo restaurant-logo-fallback" aria-hidden="true">
            {restaurant.name?.[0] || '🍽️'}
          </div>
        )}
        <h1>{restaurant.name}</h1>
        <span className="customer-header-table">Table {table.tableNumber}</span>
      </div>

      <button className="header-icon-btn header-cart-btn" aria-label="View cart" onClick={onCartClick}>
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9.5" cy="20.5" r="1.3" fill="currentColor" /><circle cx="17.5" cy="20.5" r="1.3" fill="currentColor" /></svg>
        {cartCount > 0 && <span className="header-cart-badge">{cartCount}</span>}
      </button>
    </header>
  );
}

export function BadgePills({ badges }) {
  if (!badges?.length) return null;
  // Cap at 2 on the item card so it never crowds the price/add button.
  return (
    <div className="menu-card-badges">
      {badges.slice(0, 2).map((id) => {
        const b = BADGE_BY_ID[id];
        if (!b) return null;
        return (
          <span key={id} className="menu-badge" style={{ '--badge-color': b.color }}>
            {b.emoji} {b.label}
          </span>
        );
      })}
    </div>
  );
}

// Horizontal carousel card, used on the Home page's featured sections
// (Popular Items / Fast Moving / Chef's Choice / Best Sellers /
// Recommended). badgeId is the specific badge this section is for — an
// item might carry several badges, but the card only shows the one
// relevant to the section it's currently displayed in.
export function FeaturedCard({ item, badgeId, onOpenDetails }) {
  const cart = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const badge = BADGE_BY_ID[badgeId];

  const handleAdd = (e) => {
    e.stopPropagation();
    cart.addItem(item, 1, '');
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 400);
  };

  return (
    <div className="popular-card" onClick={() => onOpenDetails?.(item)} role="button" tabIndex={0}>
      <div className="popular-card-media">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} />
        ) : (
          <div className="menu-card-image-fallback" aria-hidden="true">
            🍽️
          </div>
        )}
        {badge && (
          <span className="popular-card-badge" style={{ '--badge-color': badge.color }}>
            {badge.emoji} {badge.label}
          </span>
        )}
      </div>
      <div className="popular-card-body">
        <strong>{item.name}</strong>
        {item.description && <p>{item.description}</p>}
        <div className="popular-card-footer">
          <span>{formatLKR(item.price)}</span>
          <button
            className={`popular-card-add ${justAdded ? 'just-added' : ''}`}
            aria-label={`Add ${item.name}`}
            onClick={handleAdd}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export function MenuItemCard({ item, onOpenDetails }) {
  const cart = useCart();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const unavailable = item.available === false || item.soldOut === true;

  const handleAdd = () => {
    cart.addItem(item, 1, notes);
    setNotes('');
    setShowNotes(false);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 420);
  };

  return (
    <div className={`menu-card ${unavailable ? 'menu-card-unavailable' : ''}`}>
      <div className="menu-card-media" onClick={() => onOpenDetails?.(item)} role="button" tabIndex={0}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className={`menu-card-image ${unavailable ? 'is-sold-out-img' : ''}`} />
        ) : (
          <div className="menu-card-image-fallback" aria-hidden="true">
            🍽️
          </div>
        )}
        <BadgePills badges={item.badges} />
        {unavailable && (
          <div className="sold-out-stamp">
            <span>SOLD OUT</span>
          </div>
        )}
      </div>
      <div className="menu-card-body">
        <h3 onClick={() => onOpenDetails?.(item)} role="button" tabIndex={0}>{item.name}</h3>
        {item.description && <p>{item.description}</p>}
        <div className="menu-card-footer">
          <span className="menu-card-price">{formatLKR(item.price)}</span>
          {unavailable ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : (
            <button
              className={`menu-card-add-btn ${justAdded ? 'just-added' : ''}`}
              onClick={() => setShowNotes((s) => !s)}
              aria-label={`Add ${item.name}`}
            >
              +
            </button>
          )}
        </div>
        {showNotes && !unavailable && (
          <div className="menu-card-notes">
            <input
              placeholder="Special instructions (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
            />
            <button className="btn btn-small btn-primary" onClick={handleAdd}>
              Add to cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Bottom sheet opened by tapping a menu card's image or name — the fuller
// "food details" view, separate from the card's own quick-add (+) flow.
export function FoodSheet({ item, onClose }) {
  const cart = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const unavailable = item.available === false || item.soldOut === true;

  const handleAdd = () => {
    if (unavailable || added) return;
    cart.addItem(item, qty, '');
    setAdded(true);
    setTimeout(onClose, 450);
  };

  return (
    <div className="food-sheet-overlay" onClick={onClose}>
      <div className="food-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="food-sheet-handle" />
        <div className="food-sheet-media">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} />
          ) : (
            <div className="menu-card-image-fallback" aria-hidden="true">
              🍽️
            </div>
          )}
        </div>
        <ARButton item={item} />
        <h2>{item.name}</h2>
        {item.description && <p className="food-sheet-desc">{item.description}</p>}
        <div className="food-sheet-row">
          <span className="food-sheet-price">{formatLKR(item.price)}</span>
          {!unavailable && (
            <div className="food-sheet-qty">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                −
              </button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">
                +
              </button>
            </div>
          )}
        </div>
        <button className={`food-sheet-cta ${added ? 'just-added' : ''}`} onClick={handleAdd} disabled={unavailable}>
          {unavailable ? 'Sold out' : added ? 'Added to cart' : 'Add to cart'}
        </button>
      </div>
    </div>
  );
}
