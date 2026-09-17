import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEscPosPayload } from '../src/escpos.js';
import { formatKotTicket } from '../src/kotFormatter.js';

const snapshot = {
  restaurantId: 'rest-1',
  restaurantName: 'Test Diner',
  orderId: 'order-1',
  tableNumber: '3',
  items: [{ name: 'Pizza', quantity: 1 }],
};

test('buildEscPosPayload() starts with the ESC @ initialize command', () => {
  const ticket = formatKotTicket(snapshot);
  const payload = buildEscPosPayload(ticket);
  assert.equal(payload[0], 0x1b);
  assert.equal(payload[1], 0x40);
});

test('buildEscPosPayload() ends with a feed-and-cut command', () => {
  const ticket = formatKotTicket(snapshot);
  const payload = buildEscPosPayload(ticket);
  const tail = payload.subarray(payload.length - 4);
  assert.deepEqual([...tail], [0x1d, 0x56, 0x42, 0x00]);
});

test('buildEscPosPayload() includes every ticket line as readable text', () => {
  const ticket = formatKotTicket(snapshot);
  const payload = buildEscPosPayload(ticket);
  const text = payload.toString('utf8');
  for (const line of ticket.lines) {
    assert.ok(text.includes(line), `expected payload to contain line: ${line}`);
  }
});

test('buildEscPosPayload() never includes price-like data (ticket already strips it)', () => {
  const withPrice = {
    ...snapshot,
    items: [{ name: 'Pizza', quantity: 1, price: 999 }],
  };
  const ticket = formatKotTicket(withPrice);
  const payload = buildEscPosPayload(ticket);
  assert.ok(!payload.toString('utf8').includes('999'));
});

test('buildEscPosPayload() throws on a ticket without a lines array', () => {
  assert.throws(() => buildEscPosPayload({}), /lines array/);
});
