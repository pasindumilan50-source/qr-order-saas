import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../../supabase/config';
import { useAuth } from '../../context/AuthContext';
import { CartProvider, useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';
import { createOrder } from '../../services/orderService';
import { listenMenuItems } from '../../services/menuService';
import InvalidQRPage from './InvalidQRPage';

export default function CustomerMenuPage() {
  // Supports both the canonical slug-based QR route (/r/:restaurantSlug/table/:tableNumber)
  // and the legacy query-param route (/menu?restaurant=<id>&table=<number>) kept for
  // backward compatibility with any QR codes already printed before this migration.
  const { restaurantSlug, tableNumber: routeTableNumber } = useParams();
  const [searchParams] = useSearchParams();
  const restaurantIdParam = searchParams.get('restaurant');
  const tableNumber = routeTableNumber || searchParams.get('table');

  const { user, isGuest, loginAsGuest, loading: authLoading } = useAuth();
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
      <MenuContent restaurant={restaurant} restaurantId={restaurant.id} table={table} isGuest={isGuest} />
    </CartProvider>
  );
}

function MenuContent({ restaurant, restaurantId, table, isGuest }) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All');
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [placing, setPlacing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

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

  const categories = useMemo(() => {
    const set = new Set(menuItems.map((i) => i.category || 'Uncategorized'));
    return ['All', ...Array.from(set)];
  }, [menuItems]);

  const visibleItems = useMemo(
    () => menuItems.filter((i) => activeCategory === 'All' || (i.category || 'Uncategorized') === activeCategory),
    [menuItems, activeCategory]
  );

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
      navigate(`/order/${result.orderId}`);
    } catch (err) {
      toast.error(err.message || 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="customer-page">
      <header className="customer-header">
        {restaurant.logo && <img src={restaurant.logo} alt="" className="restaurant-logo" />}
        <div>
          <h1>{restaurant.name}</h1>
          <p>Table {table.tableNumber}</p>
        </div>
      </header>

      <div className="category-tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`category-tab ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {menuLoading ? (
        <Loading label="Loading menu items…" />
      ) : visibleItems.length === 0 ? (
        <EmptyState icon="🍽️" title="No items yet" description="This restaurant hasn't added menu items in this category." />
      ) : (
        <div className="menu-grid">
          {visibleItems.map((item) => (
            <MenuItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {cart.itemCount > 0 && (
        <button className="cart-fab" onClick={() => setCartOpen(true)}>
          🛒 {cart.itemCount} item{cart.itemCount > 1 ? 's' : ''} · {formatLKR(cart.subtotal)}
        </button>
      )}

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
                        <button
                          onClick={() => cart.updateQuantity(item.menuItemId, item.notes, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          onClick={() => cart.updateQuantity(item.menuItemId, item.notes, item.quantity + 1)}
                        >
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

function MenuItemCard({ item }) {
  const cart = useCart();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const unavailable = item.available === false || item.soldOut === true;

  return (
    <div className={`menu-card ${unavailable ? 'menu-card-unavailable' : ''}`}>
      {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="menu-card-image" />}
      <div className="menu-card-body">
        <h3>{item.name}</h3>
        {item.description && <p>{item.description}</p>}
        <div className="menu-card-footer">
          <span className="menu-card-price">{formatLKR(item.price)}</span>
          {unavailable ? (
            <span className="badge badge-sold-out">Sold out</span>
          ) : (
            <button className="btn btn-small btn-primary" onClick={() => setShowNotes((s) => !s)}>
              Add
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
            <button
              className="btn btn-small btn-primary"
              onClick={() => {
                cart.addItem(item, 1, notes);
                setNotes('');
                setShowNotes(false);
              }}
            >
              Add to cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
