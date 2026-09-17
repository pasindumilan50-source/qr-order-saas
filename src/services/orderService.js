import { supabase } from '../supabase/config';

// Kitchen-visible statuses.
// Pending orders stay with Reception until the bill is confirmed and KOT
// is issued.
const KITCHEN_VISIBLE_STATUSES = ['confirmed', 'preparing', 'ready'];

function toOrder(row, items) {
  return {
    id: row.id,
    orderId: row.id,
    restaurantId: row.restaurant_id,
    tableId: row.table_id,
    tableNumber: row.table_number,
    customerId: row.customer_id,
    customerUid: row.customer_uid,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    notes: row.notes || '',
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    status: row.status,
    billConfirmedAt: row.bill_confirmed_at || null,
    billConfirmedBy: row.bill_confirmed_by || null,
    billReference: row.bill_reference || '',
    kotSentAt: row.kot_sent_at || null,
    kotSentBy: row.kot_sent_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (items || []).map((it) => ({
      menuItemId: it.menu_item_id,
      name: it.name,
      category: it.category,
      price: Number(it.price),
      quantity: it.quantity,
      lineTotal: Number(it.subtotal),
      notes: it.notes || '',
    })),
  };
}

async function fetchOrdersWithItems(query) {
  const { data: orders, error } = await query;

  if (error) throw error;

  if (!orders || orders.length === 0) {
    return [];
  }

  const orderIds = orders.map((o) => o.id);

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  if (itemsError) throw itemsError;

  const itemsByOrder = {};

  for (const item of items || []) {
    (itemsByOrder[item.order_id] ||= []).push(item);
  }

  return orders.map((o) =>
    toOrder(o, itemsByOrder[o.id])
  );
}

export async function createOrder(payload) {
  const { data, error } = await supabase.rpc('create_order', {
    p_restaurant_id: payload.restaurantId,
    p_table_id: payload.tableId,
    p_items: payload.items.map((i) => ({
      menu_item_id: i.menuItemId,
      quantity: i.quantity,
      notes: i.notes || null,
    })),
    p_customer_name: payload.customerName || null,
    p_customer_phone: payload.customerPhone || null,
    p_notes: payload.orderNotes || null,
  });

  if (error) {
    throw new Error(
      error.message || 'Could not place your order. Please try again.'
    );
  }

  return data;
}

// -----------------------------------------------------------------------------
// Kitchen orders
// -----------------------------------------------------------------------------

export function listenKitchenOrders(
  restaurantId,
  onData,
  onError
) {
  let cancelled = false;
  let channel = null;

  async function fetchAll() {
    if (cancelled) return;

    try {
      const orders = await fetchOrdersWithItems(
        supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .in('status', KITCHEN_VISIBLE_STATUSES)
          .order('created_at', { ascending: true })
      );

      const kitchenOrders = orders.filter(
        (o) =>
          o.status !== 'pending' &&
          (o.status !== 'confirmed' || o.kotSentAt)
      );

      if (!cancelled) {
        onData(kitchenOrders);
      }
    } catch (err) {
      if (!cancelled) {
        onError?.(err);
      }
    }
  }

  fetchAll();

  const channelName =
    `kitchen-orders-${restaurantId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  channel = supabase.channel(channelName);

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `restaurant_id=eq.${restaurantId}`,
    },
    () => {
      fetchAll();
    }
  );

  channel.subscribe((status) => {
    if (cancelled) return;

    if (status === 'CHANNEL_ERROR') {
      onError?.(
        new Error('Realtime subscription failed.')
      );
    }
  });

  return () => {
    cancelled = true;

    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

// -----------------------------------------------------------------------------
// Admin / Reception orders
// -----------------------------------------------------------------------------

export function listenOrdersForAdmin(
  restaurantId,
  { statusFilter, tableFilter } = {},
  onData,
  onError
) {
  let cancelled = false;
  let channel = null;

  async function fetchAll() {
    if (cancelled) return;

    try {
      let query = supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (tableFilter && tableFilter !== 'all') {
        query = query.eq('table_id', tableFilter);
      }

      query = query
        .order('created_at', { ascending: false })
        .limit(200);

      const orders = await fetchOrdersWithItems(query);

      if (!cancelled) {
        onData(orders);
      }
    } catch (err) {
      if (!cancelled) {
        onError?.(err);
      }
    }
  }

  fetchAll();

  // IMPORTANT:
  // Use a unique channel name every time so React StrictMode / effect
  // re-runs cannot accidentally reuse a subscribed channel.
  const channelName =
    `admin-orders-${restaurantId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  channel = supabase.channel(channelName);

  // Register postgres_changes BEFORE subscribe().
  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `restaurant_id=eq.${restaurantId}`,
    },
    () => {
      fetchAll();
    }
  );

  channel.subscribe((status) => {
    if (cancelled) return;

    if (status === 'CHANNEL_ERROR') {
      onError?.(
        new Error('Realtime subscription failed.')
      );
    }
  });

  return () => {
    cancelled = true;

    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

// -----------------------------------------------------------------------------
// Single order listener
// -----------------------------------------------------------------------------

export function listenOrder(
  orderId,
  onData,
  onError
) {
  let cancelled = false;
  let channel = null;

  async function fetchOne() {
    if (cancelled) return;

    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (error) throw error;

      if (!order) {
        if (!cancelled) {
          onData(null);
        }
        return;
      }

      const { data: items, error: itemsError } =
        await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', orderId);

      if (itemsError) throw itemsError;

      if (!cancelled) {
        onData(toOrder(order, items));
      }
    } catch (err) {
      if (!cancelled) {
        onError?.(err);
      }
    }
  }

  fetchOne();

  const channelName =
    `order-${orderId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  channel = supabase.channel(channelName);

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `id=eq.${orderId}`,
    },
    () => {
      fetchOne();
    }
  );

  channel.subscribe((status) => {
    if (cancelled) return;

    if (status === 'CHANNEL_ERROR') {
      onError?.(
        new Error('Realtime subscription failed.')
      );
    }
  });

  return () => {
    cancelled = true;

    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

// -----------------------------------------------------------------------------
// One-time order fetch
// -----------------------------------------------------------------------------

export async function getOrderOnce(orderId) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error) throw error;

  if (!order) return null;

  const { data: items, error: itemsError } =
    await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

  if (itemsError) throw itemsError;

  return toOrder(order, items);
}

// -----------------------------------------------------------------------------
// Order workflow RPC helper
// -----------------------------------------------------------------------------

async function callOrderRpc(fn, orderId) {
  const { data, error } = await supabase.rpc(fn, {
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(
      error.message || 'Could not update this order. Please try again.'
    );
  }

  return data;
}

// -----------------------------------------------------------------------------
// Reception: Confirm Bill + Send KOT
// -----------------------------------------------------------------------------

export async function confirmBillAndSendKot(
  orderId,
  billReference
) {
  const { data, error } = await supabase.rpc(
    'confirm_bill_and_send_kot',
    {
      p_order_id: orderId,
      p_bill_reference: billReference || null,
    }
  );

  if (error) {
    throw new Error(
      error.message ||
        'Could not confirm the bill and send KOT.'
    );
  }

  return data;
}

// -----------------------------------------------------------------------------
// Kitchen / Admin workflow
// -----------------------------------------------------------------------------

export async function startOrderPreparing(orderId) {
  return callOrderRpc(
    'start_order_preparing',
    orderId
  );
}

export async function markOrderReady(orderId) {
  return callOrderRpc(
    'mark_order_ready',
    orderId
  );
}

export async function completeOrder(orderId) {
  return callOrderRpc(
    'complete_order',
    orderId
  );
}

export async function cancelOrder(orderId) {
  return callOrderRpc(
    'cancel_order',
    orderId
  );
}