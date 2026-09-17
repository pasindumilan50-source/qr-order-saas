import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentPrinterAdapter, PrinterAdapter } from '../src/printerAdapter.js';
import { formatKotTicket } from '../src/kotFormatter.js';

const snapshot = {
  restaurantId: 'rest-1',
  restaurantName: 'Test Diner',
  orderId: 'order-1',
  tableNumber: '3',
  items: [{ name: 'Pizza', quantity: 1 }],
};

test('base PrinterAdapter methods are not implemented (forces real adapters to override)', async () => {
  const adapter = new PrinterAdapter();
  await assert.rejects(() => adapter.connect());
  await assert.rejects(() => adapter.testConnection());
  await assert.rejects(() => adapter.printKot({}));
});

test('DevelopmentPrinterAdapter reports not connected before connect()', async () => {
  const adapter = new DevelopmentPrinterAdapter();
  assert.equal(await adapter.testConnection(), false);
});

test('DevelopmentPrinterAdapter connects and reports connected', async () => {
  const adapter = new DevelopmentPrinterAdapter();
  await adapter.connect();
  assert.equal(await adapter.testConnection(), true);
});

test('DevelopmentPrinterAdapter receives the exact formatted ticket data', async () => {
  let received;
  const logger = {
    info: (event, meta) => {
      if (event === 'dev_printer_adapter_would_print') received = meta;
    },
    warn() {},
    error() {},
    debug() {},
  };
  const adapter = new DevelopmentPrinterAdapter({ logger });
  await adapter.connect();
  const ticket = formatKotTicket(snapshot);
  await adapter.printKot(ticket);

  assert.ok(received);
  assert.equal(received.orderId, 'order-1');
  assert.equal(received.tableNumber, '3');
  assert.equal(received.itemCount, 1);
});

test('DevelopmentPrinterAdapter always flags results as simulated (never a real success)', async () => {
  const adapter = new DevelopmentPrinterAdapter();
  await adapter.connect();
  const result = await adapter.printKot(formatKotTicket(snapshot));
  assert.equal(result.simulated, true);
});

test('DevelopmentPrinterAdapter fails cleanly if used before connect()', async () => {
  const adapter = new DevelopmentPrinterAdapter();
  const result = await adapter.printKot(formatKotTicket(snapshot));
  assert.equal(result.success, false);
  assert.ok(result.error);
});
