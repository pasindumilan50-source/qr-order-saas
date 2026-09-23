import { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../supabase/config';
import { useAuth } from '../../context/AuthContext';
import { CartProvider, useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';
import { createOrder } from '../../services/orderService';
import { listenMenuItems } from '../../services/menuService';
import { BADGE_BY_ID } from '../../utils/badges';
import InvalidQRPage from './InvalidQRPage';

export default function CustomerMenuPage() {
  // Supports both the canonical slug-based QR route (/r/:restaurantSlug/table/:tableNumber)
  // and the legacy query-param route (/menu?restaurant=<id>&table=<number>) kept for
  // backward compatibility with any QR codes already printed before this migration.
  const { restaurantSlug, tableNumber: routeTableNumber } = useParams();
  const [searchParams] = useSearchParams();
  const restaurantIdParam = searchParams.get('restaurant');
  const tableNumber = routeTableNumber || searchParams.get('table');

  const { user, isGuest, loginAsGuest, loading: authLoading, authError } = useAuth();
  const [phase, setPhase] = useState('validating'); // validating | invalid | restaurant-disabled | table-disabled | ready
  const [restaurant, setRestaurant] = useState(null);
  const [table, setTable] = useState(null);

  // Step 1: ensure we have an authenticated (anonymous) session before touching the database.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!authLoading && !user) {
      loginAsGuest();
    }
  }, [authLoading, user, loginAsGuest]);

  // Step 2: validate restaurant + table once we have a session.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (authLoading || !user) return;
    if ((!restaurantSlug && !restaurantIdParam) || !tableNumber) {
      setPhase('invalid');
      return;
    }

    let cancelled = false;

    async function validate() {
      try {
        const restaurantQuery = supabase.from('restaurants').select('*');
        const { data: restaurantRow, error: restaurantError } = restaurantSlug
          ? await restaurantQuery.eq('slug', restaurantSlug).maybeSingle()
          : await restaurantQuery.eq('id', restaurantIdParam).maybeSingle();

        if (cancelled) return;
        if (restaurantError || !restaurantRow) {
          setPhase('invalid');
          return;
        }
        const restaurantData = {
          id: restaurantRow.id,
          name: restaurantRow.name,
          logo: restaurantRow.logo_url || '',
          status: restaurantRow.is_active ? 'active' : 'disabled',
        };
        setRestaurant(restaurantData);

        if (restaurantData.status !== 'active') {
          setPhase('restaurant-disabled');
          return;
        }

        const { data: tableRow, error: tableError } = await supabase
          .from('tables')
          .select('*')
          .eq('restaurant_id', restaurantData.id)
          .eq('table_number', tableNumber)
          .maybeSingle();

        if (cancelled) return;
        if (tableError || !tableRow) {
          setPhase('invalid');
          return;
        }
        const tableData = { id: tableRow.id, tableNumber: tableRow.table_number, status: tableRow.status };
        setTable(tableData);

        if (tableData.status === 'inactive') {
          setPhase('table-disabled');
          return;
        }

        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    }

    validate();

    // Keep watching the specific table row live: if staff disable this table
    // mid-session (or the whole restaurant), the customer should find out
    // immediately rather than being able to keep ordering.
    const channel = table
      ? supabase
          .channel(`table-watch-${table.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'tables', filter: `id=eq.${table.id}` },
            (payload) => {
              if (payload.new.status === 'inactive') setPhase('table-disabled');
            }
          )
          .subscribe()
      : null;

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, restaurantSlug, restaurantIdParam, tableNumber, table?.id]);

  if (!isSupabaseConfigured) {
    return (
      <div className="full-page-message">
        <h1>Configuration missing</h1>
        <p>This restaurant's ordering system is temporarily unavailable. Please tell staff.</p>
      </div>
    );
  }

  if (phase === 'validating' || authLoading) {
    return <Loading fullPage label="Loading menu…" />;
  }

  if (phase === 'invalid') {
    return <InvalidQRPage reason="This QR code isn't valid. Please ask staff for a new one." />;
  }

  if (phase === 'restaurant-disabled') {
    return <InvalidQRPage reason={`${restaurant?.name || 'This restaurant'} isn't accepting orders right now.`} />;
  }

  if (phase === 'table-disabled') {
    return <InvalidQRPage reason={`Table ${tableNumber} isn't available right now. Please ask staff for help.`} />;
  }

  return (
    <CartProvider restaurantId={restaurant.id} tableId={table.id}>
      <MenuContent restaurant={restaurant} restaurantId={restaurant.id} table={table} isGuest={isGuest} authError={authError} />
    </CartProvider>
  );
}

// A category name is always real restaurant data (from menu_items.category).
// This only picks a decorative emoji to go with that real name — it never
// invents, renames, or hides a category. Unrecognised names safely fall
// back to a generic plate icon.
function categoryEmoji(name) {
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

function MenuContent({ restaurant, restaurantId, table, isGuest, authError }) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideSoldOut, setHideSoldOut] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [placing, setPlacing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cartBump, setCartBump] = useState(false);
  const prevItemCount = useRef(cart.itemCount);

  // Lets the header's profile icon / info panel offer a real "track your
  // order" link — set once an order is actually placed this session, never
  // fabricated.
  const lastOrderKey = `qr-last-order:${restaurantId}`;
  const [lastOrderId, setLastOrderId] = useState(() => {
    try {
      return sessionStorage.getItem(lastOrderKey) || null;
    } catch {
      return null;
    }
  });

  // QR-scan opening moment: only on the first visit to this table this
  // session, so repeat customers (re-opening the tab, adding more items)
  // aren't slowed down by the same animation every time.
  const introKey = `qr-intro-seen:${restaurantId}:${table.id}`;
  const [showIntro] = useState(() => {
    try {
      return !sessionStorage.getItem(introKey);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!showIntro) return;
    try {
      sessionStorage.setItem(introKey, '1');
    } catch {
      /* sessionStorage unavailable — intro will just replay next visit */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Give the cart button a little bump whenever an item is added, so it
  // doesn't just silently update its label.
  useEffect(() => {
    if (cart.itemCount > prevItemCount.current) {
      setCartBump(true);
      const t = setTimeout(() => setCartBump(false), 320);
      prevItemCount.current = cart.itemCount;
      return () => clearTimeout(t);
    }
    prevItemCount.current = cart.itemCount;
  }, [cart.itemCount]);

  useEffect(() => {
    const unsub = listenMenuItems(
      restaurantId,
      (items) => {
        setMenuItems(items);
        setMenuLoading(false);
      },
      () => {
        toast.error('Could not load the menu. Pull to refresh.');
        setMenuLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  // The ONLY source of truth for categories is the restaurant's own menu
  // items — never hard-coded. A category appears the moment an item in the
  // admin dashboard is tagged with it, and disappears the moment no item
  // carries it any more (the live Supabase subscription above keeps this
  // in sync automatically, no redeploy needed).
  const categories = useMemo(() => {
    const set = new Set(menuItems.map((i) => i.category || 'Uncategorized'));
    return ['All', ...Array.from(set)];
  }, [menuItems]);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menuItems.filter((i) => {
      if (activeCategory !== 'All' && (i.category || 'Uncategorized') !== activeCategory) return false;
      if (hideSoldOut && (i.available === false || i.soldOut)) return false;
      if (q && !`${i.name} ${i.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menuItems, activeCategory, searchQuery, hideSoldOut]);

  // "Complete menu" is grouped by category, same real category names as
  // above — this just buckets the already-filtered list for section
  // headings, it doesn't add or invent anything.
  const groupedMenu = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const cat = item.category || 'Uncategorized';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(item);
    });
    return Array.from(groups.entries());
  }, [visibleItems]);

  // Popular Dishes carousel — only items the restaurant itself tagged as
  // fast_moving / popular / chef_special, and only while actually
  // available. No badge data -> no carousel (handled by the .length check
  // where this is rendered).
  const popularItems = useMemo(
    () =>
      menuItems.filter(
        (i) =>
          i.available !== false &&
          !i.soldOut &&
          i.badges?.some((b) => b === 'popular' || b === 'fast_moving' || b === 'chef_special')
      ),
    [menuItems]
  );

  // Hero food image: a real photo from the restaurant's own menu (prefers
  // a badged item, falls back to any available item with an image). If
  // nothing has an image yet, the hero simply renders without one rather
  // than showing a placeholder photo.
  const heroItem = useMemo(() => {
    const withImage = menuItems.filter((i) => i.imageUrl && i.available !== false && !i.soldOut);
    if (withImage.length === 0) return null;
    return withImage.find((i) => i.badges?.some((b) => b === 'popular' || b === 'fast_moving')) || withImage[0];
  }, [menuItems]);

  const scrollToMenu = () => {
    document.getElementById('menu-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) return;
    setPlacing(true);
    try {
      const result = await createOrder({
        restaurantId,
        tableId: table.id,
        items: cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, notes: i.notes })),
        orderNotes: cart.orderNotes,
        customerName,
        customerPhone,
      });
      cart.clearCart();
      try {
        sessionStorage.setItem(lastOrderKey, result.orderId);
      } catch {
        /* sessionStorage unavailable — "track order" link just won't show */
      }
      setLastOrderId(result.orderId);
      navigate(`/order/${result.orderId}`, { state: { justPlaced: true } });
    } catch (err) {
      toast.error(err.message || 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="customer-page">
      {showIntro && (
        <div className="qr-intro" aria-hidden="true">
          {restaurant.logo ? (
            <img src={restaurant.logo} alt="" className="qr-intro-logo" />
          ) : (
            <div className="qr-intro-logo qr-intro-logo-fallback">{restaurant.name?.[0] || '🍽️'}</div>
          )}
          <div className="qr-intro-name">{restaurant.name}</div>
          <div className="qr-intro-welcome">Welcome to {restaurant.name}</div>
          <div className="qr-intro-table">Table {table.tableNumber}</div>
        </div>
      )}

      <header className="customer-header">
        <button className="header-icon-btn" aria-label="Menu" onClick={() => setInfoPanelOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>

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

        <div className="header-icon-group">
          <button className="header-icon-btn" aria-label="Restaurant info" onClick={() => setInfoPanelOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" /><path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          <button className="header-icon-btn header-cart-btn" aria-label="View cart" onClick={() => setCartOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9.5" cy="20.5" r="1.3" fill="currentColor" /><circle cx="17.5" cy="20.5" r="1.3" fill="currentColor" /></svg>
            {cart.itemCount > 0 && <span className="header-cart-badge">{cart.itemCount}</span>}
          </button>
        </div>
      </header>

      <div className="customer-search-row">
        <div className="customer-search-bar">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input
            type="text"
            placeholder="Search for dishes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search the menu"
          />
        </div>
        <button
          className={`customer-filter-btn ${hideSoldOut ? 'active' : ''}`}
          aria-label="Hide sold out items"
          aria-pressed={hideSoldOut}
          onClick={() => setHideSoldOut((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>

      {!menuLoading && heroItem && (
        <section className="customer-hero">
          <div className="customer-hero-text">
            <span className="customer-hero-eyebrow">{restaurant.name}</span>
            <h2>Good Food.<br />Great Moments.</h2>
            <p>Fresh flavours, made to order — browse the menu and send your order straight to the kitchen.</p>
            <button className="customer-hero-cta" onClick={scrollToMenu}>
              View Menu
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="customer-hero-media">
            <img src={heroItem.imageUrl} alt={heroItem.name} />
          </div>
        </section>
      )}

      {menuLoading ? (
        <Loading label="Loading menu items…" />
      ) : (
        <>
          <div className="category-icons">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`category-icon ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                <span className="category-icon-circle" aria-hidden="true">{categoryEmoji(cat)}</span>
                <span className="category-icon-label">{cat}</span>
              </button>
            ))}
          </div>

          {popularItems.length > 0 && (
            <section className="popular-section">
              <div className="popular-section-head">
                <h2>Popular Dishes</h2>
                <button className="popular-view-all" onClick={scrollToMenu}>
                  View All <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="popular-scroll">
                {popularItems.map((item) => (
                  <PopularCard key={item.id} item={item} onOpenDetails={setDetailItem} />
                ))}
              </div>
            </section>
          )}

          <section id="menu-section" className="complete-menu">
            {groupedMenu.length === 0 ? (
              <EmptyState
                icon="🍽️"
                title="No items found"
                description={
                  searchQuery
                    ? `Nothing matches "${searchQuery}".`
                    : "This restaurant hasn't added menu items in this category."
                }
              />
            ) : (
              groupedMenu.map(([category, items]) => (
                <div className="menu-category-block" key={category}>
                  <h3 className="menu-category-heading">{category}</h3>
                  <div className="menu-grid">
                    {items.map((item) => (
                      <MenuItemCard key={item.id} item={item} onOpenDetails={setDetailItem} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {cart.itemCount > 0 && (
        <button className={`cart-fab ${cartBump ? 'bump' : ''}`} onClick={() => setCartOpen(true)}>
          <span>
            {cart.itemCount} item{cart.itemCount > 1 ? 's' : ''} · {formatLKR(cart.subtotal)}
          </span>
          <span className="cart-fab-cta">
            View Cart <span aria-hidden="true">→</span>
          </span>
        </button>
      )}

      <nav className="bottom-nav">
        <button className="bottom-nav-item" onClick={scrollToTop}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Home</span>
        </button>
        <button className="bottom-nav-item" onClick={scrollToMenu}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 4v16M6 4h11a3 3 0 0 1 0 6H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Menu</span>
        </button>
        <button className="bottom-nav-order" onClick={() => setCartOpen(true)} aria-label="View order">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button className="bottom-nav-item" onClick={() => setInfoPanelOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></svg>
          <span>More</span>
        </button>
      </nav>

      {infoPanelOpen && (
        <div className="food-sheet-overlay" onClick={() => setInfoPanelOpen(false)}>
          <div className="food-sheet info-panel" onClick={(e) => e.stopPropagation()}>
            <div className="food-sheet-handle" />
            <h2>{restaurant.name}</h2>
            <p className="food-sheet-desc">Table {table.tableNumber} · dine-in</p>
            <p className="food-sheet-desc">
              Browse the menu, add what you'd like, and send your order straight to the kitchen — no need to flag
              down a waiter.
            </p>
            {lastOrderId && (
              <button className="food-sheet-cta" onClick={() => navigate(`/order/${lastOrderId}`)}>
                Track your last order
              </button>
            )}
          </div>
        </div>
      )}

      {detailItem && <FoodSheet item={detailItem} onClose={() => setDetailItem(null)} />}

      {cartOpen && (
        <div className="cart-drawer-overlay" onClick={() => setCartOpen(false)}>
          <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cart-drawer-header">
              <h2>Your order</h2>
              <button className="btn btn-ghost" onClick={() => setCartOpen(false)}>
                ✕
              </button>
            </div>

            {cart.items.length === 0 ? (
              <EmptyState icon="🛒" title="Your cart is empty" />
            ) : (
              <>
                <div className="cart-items">
                  {cart.items.map((item) => (
                    <div key={`${item.menuItemId}-${item.notes}`} className="cart-item">
                      <div className="cart-item-info">
                        <strong>{item.name}</strong>
                        {item.notes && <span className="cart-item-notes">{item.notes}</span>}
                        <span>{formatLKR(item.price)}</span>
                      </div>
                      <div className="qty-controls">
                        <button onClick={() => cart.updateQuantity(item.menuItemId, item.notes, item.quantity - 1)}>
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button onClick={() => cart.updateQuantity(item.menuItemId, item.notes, item.quantity + 1)}>
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <label className="order-notes-label">
                  Order notes (e.g. less spicy, no onions)
                  <textarea
                    value={cart.orderNotes}
                    onChange={(e) => cart.setOrderNotes(e.target.value)}
                    maxLength={500}
                    rows={2}
                  />
                </label>

                <label>
                  Your name (optional)
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={100} />
                </label>
                <label>
                  Phone (optional)
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} maxLength={30} />
                </label>

                <div className="cart-total-row">
                  <span>Subtotal</span>
                  <strong>{formatLKR(cart.subtotal)}</strong>
                </div>

                {!isGuest && (
                  <p style={{ color: authError ? '#dc2626' : '#6b7280', fontSize: '0.9rem' }}>
                    {authError ? `Could not start your session: ${authError}` : 'Setting up your session…'}
                  </p>
                )}

                <button className="btn btn-primary btn-block" onClick={handlePlaceOrder} disabled={placing || !isGuest}>
                  {placing ? 'Placing order…' : 'Place order'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Horizontal "Popular Dishes" carousel card — image + real badge (if any) +
// name + description + price + circular add button. No rating is shown:
// the schema has no rating/review data to show.
function PopularCard({ item, onOpenDetails }) {
  const cart = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const badgeId = item.badges?.find((b) => b === 'popular' || b === 'fast_moving' || b === 'chef_special');
  const badge = badgeId ? BADGE_BY_ID[badgeId] : null;

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

function BadgePills({ badges }) {
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

function MenuItemCard({ item, onOpenDetails }) {
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
function FoodSheet({ item, onClose }) {
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
