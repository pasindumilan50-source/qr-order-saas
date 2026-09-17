import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKotTicket, KotFormatError } from '../src/kotFormatter.js';

const baseSnapshot = {
  restaurantId: 'rest-1',
  restaurantName: 'Test Diner',
  orderId: 'order-1',
  tableNumber: '7',
  orderCreatedAt: '2026-01-01T10:00:00Z',
  kotIssuedAt: '2026-01-01T10:05:00Z',
  orderNotes: 'No onions',
  items: [
    { name: 'Burger', category: 'Mains', quantity: 2, notes: 'Well done' },
    { name: 'Fries', category: 'Sides', quantity: 1, notes: null },
  ],
};

test('formats a valid snapshot with restaurant, table, order, and items', () => {
  const ticket = formatKotTicket(baseSnapshot);
  assert.equal(ticket.restaurantName, 'Test Diner');
  assert.equal(ticket.orderId, 'order-1');
  assert.equal(ticket.tableNumber, '7');
  assert.equal(ticket.items.length, 2);
  assert.equal(ticket.items[0].name, 'Burger');
  assert.equal(ticket.items[0].quantity, 2);
  assert.equal(ticket.items[0].notes, 'Well done');
  assert.ok(ticket.lines.some((l) => l.includes('Burger')));
});

test('defaults missing/invalid quantity to 1', () => {
  const ticket = formatKotTicket({
    ...baseSnapshot,
    items: [{ name: 'Soup', quantity: 'not-a-number' }],
  });
  assert.equal(ticket.items[0].quantity, 1);
});

test('handles an empty items array', () => {
  const ticket = formatKotTicket({ ...baseSnapshot, items: [] });
  assert.deepEqual(ticket.items, []);
});

test('handles a missing items array', () => {
  const { items, ...rest } = baseSnapshot;
  void items;
  const ticket = formatKotTicket(rest);
  assert.deepEqual(ticket.items, []);
});

test('throws on missing snapshot', () => {
  assert.throws(() => formatKotTicket(null), KotFormatError);
});

test('throws on missing orderId', () => {
  const { orderId, ...rest } = baseSnapshot;
  void orderId;
  assert.throws(() => formatKotTicket(rest), KotFormatError);
});

test('throws when an item has no name', () => {
  assert.throws(
    () => formatKotTicket({ ...baseSnapshot, items: [{ quantity: 1 }] }),
    KotFormatError
  );
});

test('never surfaces price/total/tax fields even if present on the snapshot', () => {
  const ticket = formatKotTicket({
    ...baseSnapshot,
    items: [
      {
        name: 'Burger',
        quantity: 1,
        price: 999,
        subtotal: 999,
        tax: 10,
        total: 1009,
      },
    ],
  });
  const item = ticket.items[0];
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'price'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'total'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'tax'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'subtotal'), false);
  const serialized = JSON.stringify(ticket);
  assert.ok(!serialized.includes('999'));
});
