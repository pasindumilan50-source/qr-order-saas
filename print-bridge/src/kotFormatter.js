// Converts a `kot_print_jobs.kot_snapshot` (as built by
// confirm_bill_and_send_kot() in 0012_kot_print_queue.sql) into a
// printer-independent ticket structure. This module knows nothing about
// ESC/POS, USB, network sockets, or any specific printer — it only shapes
// data. A PrinterAdapter is responsible for turning the returned ticket
// into whatever bytes/commands the real printer needs.
//
// The snapshot is produced by a trusted, SECURITY DEFINER database
// function and already excludes price/subtotal/total by design (see the
// migration's own comments). This formatter defensively strips any
// price-like fields anyway, in case a future backend change adds them to
// the snapshot — a KOT ticket must never show money.

const PRICE_KEY_PATTERN = /price|amount|subtotal|total|tax|discount|cost/i;

export class KotFormatError extends Error {}

function stripPriceLikeFields(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PRICE_KEY_PATTERN.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * @param {object} snapshot - kot_print_jobs.kot_snapshot (jsonb)
 * @returns {{
 *   restaurantName: string,
 *   restaurantId: string,
 *   orderId: string,
 *   tableNumber: string|number|null,
 *   orderCreatedAt: string|null,
 *   kotIssuedAt: string|null,
 *   orderNotes: string|null,
 *   items: Array<{name: string, category: string|null, quantity: number, notes: string|null}>,
 *   lines: string[]  // plain-text rendering, ready for adapters that just want text
 * }}
 */
export function formatKotTicket(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new KotFormatError('KOT snapshot is missing or not an object.');
  }
  if (!snapshot.orderId) {
    throw new KotFormatError('KOT snapshot is missing orderId.');
  }
  if (!snapshot.restaurantId) {
    throw new KotFormatError('KOT snapshot is missing restaurantId.');
  }

  const rawItems = Array.isArray(snapshot.items) ? snapshot.items : [];
  const items = rawItems.map((rawItem, index) => {
    const item = stripPriceLikeFields(rawItem || {});
    if (!item.name) {
      throw new KotFormatError(`KOT snapshot item at index ${index} is missing a name.`);
    }
    const quantity = Number(item.quantity);
    return {
      name: String(item.name),
      category: item.category ? String(item.category) : null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      notes: item.notes ? String(item.notes) : null,
    };
  });

  const ticket = {
    restaurantName: snapshot.restaurantName ? String(snapshot.restaurantName) : 'Restaurant',
    restaurantId: String(snapshot.restaurantId),
    orderId: String(snapshot.orderId),
    tableNumber: snapshot.tableNumber ?? null,
    orderCreatedAt: snapshot.orderCreatedAt ?? null,
    kotIssuedAt: snapshot.kotIssuedAt ?? null,
    orderNotes: snapshot.orderNotes ? String(snapshot.orderNotes) : null,
    items,
  };

  ticket.lines = renderPlainTextLines(ticket);
  return ticket;
}

function renderPlainTextLines(ticket) {
  const lines = [];
  lines.push(ticket.restaurantName);
  lines.push('*** KITCHEN ORDER TICKET ***');
  lines.push(`Table: ${ticket.tableNumber ?? '-'}`);
  lines.push(`Order: ${ticket.orderId}`);
  if (ticket.kotIssuedAt) lines.push(`Issued: ${ticket.kotIssuedAt}`);
  if (ticket.orderNotes) lines.push(`Notes: ${ticket.orderNotes}`);
  lines.push('--------------------------------');
  for (const item of ticket.items) {
    const category = item.category ? ` [${item.category}]` : '';
    lines.push(`${item.quantity} x ${item.name}${category}`);
    if (item.notes) lines.push(`    note: ${item.notes}`);
  }
  lines.push('--------------------------------');
  return lines;
}
