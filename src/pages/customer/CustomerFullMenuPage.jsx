import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { Loading, EmptyState } from '../../components/Common';
import { useCustomerContext } from './CustomerLayout';
import { CustomerHeader, MenuItemCard, categoryEmoji } from './menuComponents';

export default function CustomerFullMenuPage() {
  const { restaurant, table, menuItems, menuLoading, setCartOpen, setDetailItem } = useCustomerContext();
  const cart = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideSoldOut, setHideSoldOut] = useState(false);

  // The ONLY source of truth for categories is the restaurant's own menu
  // items — never hard-coded. A category appears the moment an item in the
  // admin dashboard is tagged with it, and disappears the moment no item
  // carries it any more (the live Supabase subscription in CustomerLayout
  // keeps this in sync automatically, no redeploy needed).
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

  // Grouped by category (same real category names as above) for section
  // headings — this just buckets the already-filtered list, it doesn't add
  // or invent anything.
  const groupedMenu = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const cat = item.category || 'Uncategorized';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(item);
    });
    return Array.from(groups.entries());
  }, [visibleItems]);

  return (
    <>
      <CustomerHeader
        restaurant={restaurant}
        table={table}
        cartCount={cart.itemCount}
        onCartClick={() => setCartOpen(true)}
        onBack={() => navigate({ pathname: '..', search: location.search })}
      />

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

          <section className="complete-menu">
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
    </>
  );
}
