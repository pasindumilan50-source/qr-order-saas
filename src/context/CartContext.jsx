import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

const CartContext = createContext(null);

function storageKey(restaurantId, tableId) {
  return `qr-cart:${restaurantId}:${tableId}`;
}

export function CartProvider({ restaurantId, tableId, children }) {
  const key = storageKey(restaurantId, tableId);
  const [items, setItems] = useState([]); // { menuItemId, name, price, quantity, notes, imageUrl }
  const [orderNotes, setOrderNotes] = useState('');

  // Load from sessionStorage on mount / when restaurant+table changes.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        setItems(parsed.items || []);
        setOrderNotes(parsed.orderNotes || '');
      } else {
        setItems([]);
        setOrderNotes('');
      }
    } catch {
      setItems([]);
    }
  }, [key]);

  // Persist on every change.
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ items, orderNotes }));
    } catch {
      // sessionStorage may be unavailable (e.g. private browsing) — cart still
      // works for the current page lifetime via React state.
    }
  }, [key, items, orderNotes]);

  const addItem = useCallback((menuItem, quantity = 1, notes = '') => {
    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (i) => i.menuItemId === menuItem.menuItemId && i.notes === notes
      );
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + quantity };
        return next;
      }
      return [
        ...prev,
        {
          menuItemId: menuItem.menuItemId,
          name: menuItem.name,
          price: menuItem.price,
          imageUrl: menuItem.imageUrl || '',
          quantity,
          notes,
        },
      ];
    });
  }, []);

  const updateQuantity = useCallback((menuItemId, notes, quantity) => {
    setItems((prev) => {
      if (quantity <= 0) {
        return prev.filter((i) => !(i.menuItemId === menuItemId && i.notes === notes));
      }
      return prev.map((i) =>
        i.menuItemId === menuItemId && i.notes === notes ? { ...i, quantity } : i
      );
    });
  }, []);

  const removeItem = useCallback((menuItemId, notes) => {
    setItems((prev) => prev.filter((i) => !(i.menuItemId === menuItemId && i.notes === notes)));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setOrderNotes('');
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }, [key]);

  const subtotal = useMemo(
    () => Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100,
    [items]
  );
  const itemCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);

  const value = {
    items,
    orderNotes,
    setOrderNotes,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    subtotal,
    itemCount,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
