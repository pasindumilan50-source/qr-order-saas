import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams, useParams, useNavigate, Outlet, useOutletContext } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../supabase/config';
import { useAuth } from '../../context/AuthContext';
import { CartProvider, useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';
import { createOrder } from '../../services/orderService';
import { listenMenuItems } from '../../services/menuService';
import { FoodSheet } from './menuComponents';
import InvalidQRPage from './InvalidQRPage';
import { buildTheme } from '../../utils/theme';

export default function CustomerLayout() {
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
          heroLabel: restaurantRow.hero_label || '',
          heroHeading: restaurantRow.hero_heading || '',
          heroDescription: restaurantRow.hero_description || '',
          heroButtonText: restaurantRow.hero_button_text || '',
          heroFontFamily: restaurantRow.hero_font_family || '',
          heroFontSize: restaurantRow.hero_font_size || '',
          heroFontWeight: restaurantRow.hero_font_weight || '',
          themeBg: restaurantRow.theme_bg || '',
          themeAccent: restaurantRow.theme_accent || '',
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

    // Keep watching both the restaurant row (so hero/text edits the admin
    // saves show up live, same as the existing table-disabled watch below)
    // and the specific table row: if staff disable this table mid-session
    // (or the whole restaurant), the customer should find out immediately
    // rather than being able to keep ordering.
    const tableChannel = table
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

    const restaurantChannel = restaurant
      ? supabase
          .channel(`restaurant-watch-${restaurant.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurant.id}` },
            (payload) => {
              setRestaurant((prev) =>
                prev
                  ? {
                      ...prev,
                      name: payload.new.name,
                      logo: payload.new.logo_url || '',
                      status: payload.new.is_active ? 'active' : 'disabled',
                      heroLabel: payload.new.hero_label || '',
                      heroHeading: payload.new.hero_heading || '',
                      heroDescription: payload.new.hero_description || '',
                      heroButtonText: payload.new.hero_button_text || '',
                      heroFontFamily: payload.new.hero_font_family || '',
                      heroFontSize: payload.new.hero_font_size || '',
                      heroFontWeight: payload.new.hero_font_weight || '',
                      themeBg: payload.new.theme_bg || '',
                      themeAccent: payload.new.theme_accent || '',
                    }
                  : prev
              );
              if (payload.new.is_active === false) setPhase('restaurant-disabled');
            }
          )
          .subscribe()
      : null;

    return () => {
      cancelled = true;
      if (tableChannel) supabase.removeChannel(tableChannel);
      if (restaurantChannel) supabase.removeChannel(restaurantChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, restaurantSlug, restaurantIdParam, tableNumber, table?.id, restaurant?.id]);

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
      <CustomerShell restaurant={restaurant} restaurantId={restaurant.id} table={table} isGuest={isGuest} authError={authError} />
    </CartProvider>
  );
}

// Everything that must survive navigating between the Home and Menu pages
// without remounting: the live menu-items subscription, the cart drawer,
// the food-details sheet, and the place-order flow. Home and Menu each read
// this via useOutletContext() and only render what's specific to them.
function CustomerShell({ restaurant, restaurantId, table, isGuest, authError }) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cartBump, setCartBump] = useState(false);
  const prevItemCount = useRef(0);
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  // Give the cart button a little bump whenever an item is added, from
  // either page.
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
      navigate(`/order/${result.orderId}`, { state: { justPlaced: true } });
    } catch (err) {
      toast.error(err.message || 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  // Restaurant-specific theme: CSS variables scoped to this page only.
  // No saved theme -> null -> the stylesheet's default look is untouched.
  const themeVars = useMemo(
    () => buildTheme({ bg: restaurant.themeBg, accent: restaurant.themeAccent })?.vars,
    [restaurant.themeBg, restaurant.themeAccent]
  );

  // Keep the area behind the page (overscroll / wide screens) on-theme too.
  useEffect(() => {
    if (!themeVars) return undefined;
    const prev = document.body.style.background;
    document.body.style.background = themeVars['--color-bg'];
    return () => {
      document.body.style.background = prev;
    };
  }, [themeVars]);

  const context = {
    restaurant,
    restaurantId,
    table,
    isGuest,
    authError,
    menuItems,
    menuLoading,
    setCartOpen,
    setDetailItem,
  };

  return (
    <div className="customer-page" style={themeVars || undefined}>
      <Outlet context={context} />

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

export function useCustomerContext() {
  return useOutletContext();
}
