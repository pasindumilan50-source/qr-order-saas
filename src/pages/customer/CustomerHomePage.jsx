import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { listenHeroSlides, listenPromotions } from '../../services/homeContentService';
import { FEATURED_SECTIONS } from '../../utils/badges';
import { useCustomerContext } from './CustomerLayout';
import { CustomerHeader, FeaturedCard } from './menuComponents';

const DEFAULT_HERO = {
  label: 'Good Food',
  heading: 'Good Food. Good Mood.',
  description: 'Fresh ingredients and unforgettable experiences.',
  buttonText: 'View Menu',
};

export default function CustomerHomePage() {
  const { restaurant, restaurantId, table, menuItems, menuLoading, setCartOpen, setDetailItem } = useCustomerContext();
  const cart = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const goToMenu = () => navigate({ pathname: 'menu', search: location.search });

  const [heroSlides, setHeroSlides] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [promoIndex, setPromoIndex] = useState(0);

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

  useEffect(() => {
    const unsub = listenHeroSlides(restaurantId, setHeroSlides);
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const unsub = listenPromotions(restaurantId, (rows) => setPromotions(rows.filter((p) => p.isActive)));
    return () => unsub();
  }, [restaurantId]);

  // Auto-advance the hero slideshow — only while there's more than one real
  // slide to show.
  useEffect(() => {
    if (heroSlides.length < 2) return;
    const t = setInterval(() => setSlideIndex((i) => (i + 1) % heroSlides.length), 4500);
    return () => clearInterval(t);
  }, [heroSlides.length]);

  useEffect(() => {
    if (promotions.length < 2) return;
    const t = setInterval(() => setPromoIndex((i) => (i + 1) % promotions.length), 5000);
    return () => clearInterval(t);
  }, [promotions.length]);

  const touchStartX = useRef(null);
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (setIndex, len) => (e) => {
    if (touchStartX.current === null || len < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) {
      setIndex((i) => (dx < 0 ? (i + 1) % len : (i - 1 + len) % len));
    }
    touchStartX.current = null;
  };

  const heroLabel = restaurant.heroLabel || DEFAULT_HERO.label;
  const heroHeading = restaurant.heroHeading || DEFAULT_HERO.heading;
  const heroDescription = restaurant.heroDescription || DEFAULT_HERO.description;
  const heroButtonText = restaurant.heroButtonText || DEFAULT_HERO.buttonText;
  const headingStyle = {
    fontFamily: restaurant.heroFontFamily || undefined,
    fontSize: restaurant.heroFontSize || undefined,
    fontWeight: restaurant.heroFontWeight || undefined,
  };

  const featuredGroups = useMemo(
    () =>
      FEATURED_SECTIONS.map((section) => ({
        ...section,
        items: menuItems.filter(
          (i) => i.available !== false && !i.soldOut && i.badges?.includes(section.badgeId)
        ),
      })).filter((g) => g.items.length > 0),
    [menuItems]
  );

  return (
    <>
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

      <CustomerHeader restaurant={restaurant} table={table} cartCount={cart.itemCount} onCartClick={() => setCartOpen(true)} />

      <section
        className="customer-hero customer-hero--slideshow"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd(setSlideIndex, heroSlides.length)}
      >
        <div className="customer-hero-text">
          <span className="customer-hero-eyebrow">{heroLabel}</span>
          <h2 style={headingStyle}>{heroHeading}</h2>
          <p>{heroDescription}</p>
          <button className="customer-hero-cta" onClick={goToMenu}>
            {heroButtonText}
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className="customer-hero-media">
          {heroSlides.length > 0 ? (
            <img src={heroSlides[slideIndex]?.imageUrl} alt="" />
          ) : (
            <div className="customer-hero-media-default" aria-hidden="true" />
          )}
          {heroSlides.length > 1 && (
            <div className="hero-dots">
              {heroSlides.map((slide, i) => (
                <button
                  key={slide.id}
                  className={`hero-dot ${i === slideIndex ? 'active' : ''}`}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setSlideIndex(i)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {!menuLoading &&
        featuredGroups.map((group) => (
          <section className="popular-section" key={group.badgeId}>
            <div className="popular-section-head">
              <h2>{group.heading}</h2>
              <button className="popular-view-all" onClick={goToMenu}>
                View All <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="popular-scroll">
              {group.items.map((item) => (
                <FeaturedCard key={item.id} item={item} badgeId={group.badgeId} onOpenDetails={setDetailItem} />
              ))}
            </div>
          </section>
        ))}

      {promotions.length > 0 && (
        <section
          className="promo-section"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd(setPromoIndex, promotions.length)}
        >
          <div className={`promo-card ${promotions[promoIndex].imageUrl ? '' : 'promo-card--text-only'}`}>
            {promotions[promoIndex].imageUrl && <img src={promotions[promoIndex].imageUrl} alt="" />}
            <div className="promo-card-text">{promotions[promoIndex].text}</div>
          </div>
          {promotions.length > 1 && (
            <div className="hero-dots promo-dots">
              {promotions.map((promo, i) => (
                <button
                  key={promo.id}
                  className={`hero-dot ${i === promoIndex ? 'active' : ''}`}
                  aria-label={`Promotion ${i + 1}`}
                  onClick={() => setPromoIndex(i)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
