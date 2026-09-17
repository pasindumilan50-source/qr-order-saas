import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  TcpEscPosPrinterAdapter,
  DynamicTcpPrinterAdapter,
} from '../src/printerAdapter.js';
import { formatKotTicket } from '../src/kotFormatter.js';

const snapshot = {
  restaurantId: 'rest-1',
  restaurantName: 'Test Diner',
  orderId: 'order-1',
  tableNumber: '3',
  items: [{ name: 'Pizza', quantity: 1 }],
};

function noopLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

// Starts a local TCP server on an OS-assigned free port and resolves with
// { server, port } once listening, so tests don't hardcode ports that
// might already be in use.
function startFakeServer(onConnection) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('TcpEscPosPrinterAdapter.testConnection() returns true when the TCP handshake succeeds', async () => {
  const { server, port } = await startFakeServer((socket) => socket.destroy());
  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port, logger: noopLogger() });
  await adapter.connect();
  const result = await adapter.testConnection();
  assert.equal(result, true);
  await stopServer(server);
});

test('TcpEscPosPrinterAdapter.testConnection() returns false when the port refuses connections', async () => {
  // Bind a server just to reserve a free port, then close it immediately
  // so nothing is listening there.
  const { server, port } = await startFakeServer(() => {});
  await stopServer(server);

  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port, logger: noopLogger() });
  await adapter.connect();
  const result = await adapter.testConnection();
  assert.equal(result, false);
});

test('TcpEscPosPrinterAdapter.testConnection() returns false before connect() has been called', async () => {
  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port: 9100, logger: noopLogger() });
  assert.equal(await adapter.testConnection(), false);
});

test('TcpEscPosPrinterAdapter.printKot() reports success only after the socket write completes', async () => {
  let received = Buffer.alloc(0);
  const { server, port } = await startFakeServer((socket) => {
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
    });
  });

  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port, logger: noopLogger() });
  await adapter.connect();
  const ticket = formatKotTicket(snapshot);
  const result = await adapter.printKot(ticket);

  assert.equal(result.success, true);
  assert.equal(result.simulated, false);
  // Give the server's 'data' handler a tick to run before asserting.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(received.toString('utf8').includes('Pizza'));

  await stopServer(server);
});

test('TcpEscPosPrinterAdapter.printKot() fails cleanly when the connection is refused', async () => {
  const { server, port } = await startFakeServer(() => {});
  await stopServer(server);

  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port, logger: noopLogger() });
  await adapter.connect();
  const result = await adapter.printKot(formatKotTicket(snapshot));

  assert.equal(result.success, false);
  assert.ok(result.error);
});

test('TcpEscPosPrinterAdapter.printKot() fails cleanly when the server drops the connection mid-write', async () => {
  const { server, port } = await startFakeServer((socket) => {
    // Accept the connection, then immediately reset it — simulates a
    // printer that dropped off the network mid-print.
    socket.on('data', () => socket.destroy());
  });

  const adapter = new TcpEscPosPrinterAdapter({ host: '127.0.0.1', port, logger: noopLogger() });
  await adapter.connect();
  const result = await adapter.printKot(formatKotTicket(snapshot));

  // Either the write itself errors, or it succeeds at the OS level before
  // the reset arrives — both are legitimate given TCP timing, but the
  // adapter must never crash the process either way.
  assert.equal(typeof result.success, 'boolean');

  await stopServer(server);
});

test('TcpEscPosPrinterAdapter.connect() throws without a host/port', async () => {
  const adapter = new TcpEscPosPrinterAdapter({ logger: noopLogger() });
  await assert.rejects(() => adapter.connect());
});

function makeFakeSupabaseWithPrinter(row) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
    },
  };
}

// Like makeFakeSupabaseWithPrinter, but the row can be swapped out between
// calls — simulating an admin saving a new printer configuration in
// Settings while the bridge process keeps running.
function makeMutableFakeSupabase(initialRow) {
  let row = initialRow;
  return {
    setRow(nextRow) {
      row = nextRow;
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
    },
  };
}

test('DynamicTcpPrinterAdapter.connect() fails clearly when there is no active printer', async () => {
  const supabase = makeFakeSupabaseWithPrinter(null);
  const adapter = new DynamicTcpPrinterAdapter({
    supabase,
    restaurantId: 'r1',
    logger: noopLogger(),
  });
  await assert.rejects(() => adapter.connect(), /No active printer configured/);
});

test('DynamicTcpPrinterAdapter.connect() fails clearly for a USB printer (not implemented)', async () => {
  const supabase = makeFakeSupabaseWithPrinter({
    id: 'p1',
    name: 'Kitchen Printer',
    connection_type: 'usb',
    brand: 'Star',
    model: null,
    ip_address: null,
    port: 9100,
  });
  const adapter = new DynamicTcpPrinterAdapter({
    supabase,
    restaurantId: 'r1',
    logger: noopLogger(),
  });
  await assert.rejects(() => adapter.connect(), /USB printer transport is not implemented/);
});

test('DynamicTcpPrinterAdapter prints against whatever printer_settings currently says (hot reload)', async () => {
  let received = Buffer.alloc(0);
  const { server, port } = await startFakeServer((socket) => {
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
    });
  });

  const supabase = makeFakeSupabaseWithPrinter({
    id: 'p1',
    name: 'Kitchen Printer',
    connection_type: 'lan',
    brand: 'Epson',
    model: 'TM-T20III',
    ip_address: '127.0.0.1',
    port,
  });

  const adapter = new DynamicTcpPrinterAdapter({
    supabase,
    restaurantId: 'r1',
    logger: noopLogger(),
  });

  await adapter.connect();
  assert.deepEqual(adapter.getConfigSnapshot().ipAddress, '127.0.0.1');

  const result = await adapter.printKot(formatKotTicket(snapshot));
  assert.equal(result.success, true);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(received.toString('utf8').includes('Pizza'));

  await stopServer(server);
});

test('printer replacement takes effect on the very next print, without recreating the adapter (no bridge restart needed)', async () => {
  let receivedOnOldPrinter = Buffer.alloc(0);
  let receivedOnNewPrinter = Buffer.alloc(0);

  const { server: oldServer, port: oldPort } = await startFakeServer((socket) => {
    socket.on('data', (chunk) => {
      receivedOnOldPrinter = Buffer.concat([receivedOnOldPrinter, chunk]);
    });
  });
  const { server: newServer, port: newPort } = await startFakeServer((socket) => {
    socket.on('data', (chunk) => {
      receivedOnNewPrinter = Buffer.concat([receivedOnNewPrinter, chunk]);
    });
  });

  const oldRow = {
    id: 'p1',
    name: 'Kitchen Printer',
    connection_type: 'lan',
    brand: 'Epson',
    model: 'TM-T20III',
    ip_address: '127.0.0.1',
    port: oldPort,
  };
  const supabase = makeMutableFakeSupabase(oldRow);

  // This ONE adapter instance stays alive for the whole test, exactly as
  // it would across the bridge's whole process lifetime — nothing here
  // simulates a restart.
  const adapter = new DynamicTcpPrinterAdapter({
    supabase,
    restaurantId: 'r1',
    logger: noopLogger(),
  });

  await adapter.connect();
  assert.equal(adapter.getConfigSnapshot().port, oldPort);

  const firstResult = await adapter.printKot(formatKotTicket(snapshot));
  assert.equal(firstResult.success, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(receivedOnOldPrinter.length > 0, 'first print should have reached the old printer');
  assert.equal(receivedOnNewPrinter.length, 0, 'first print must not reach the new printer');

  // Admin replaces the printer in Settings → Kitchen Printer and saves.
  supabase.setRow({ ...oldRow, ip_address: '127.0.0.1', port: newPort });

  const secondResult = await adapter.printKot(formatKotTicket(snapshot));
  assert.equal(secondResult.success, true);
  assert.equal(adapter.getConfigSnapshot().port, newPort);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(receivedOnNewPrinter.length > 0, 'second print should reach the new printer');

  await stopServer(oldServer);
  await stopServer(newServer);
});
