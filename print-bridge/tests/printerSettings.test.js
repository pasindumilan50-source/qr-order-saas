import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePrinterSettings,
  loadActivePrinterSettings,
  PrinterConfigError,
} from '../src/printerSettings.js';

const validLanRow = {
  id: 'printer-1',
  name: 'Kitchen Printer',
  connection_type: 'lan',
  brand: 'Epson',
  model: 'TM-T20III',
  ip_address: '192.168.1.100',
  port: 9100,
};

test('validatePrinterSettings() accepts a valid LAN row', () => {
  const config = validatePrinterSettings(validLanRow);
  assert.equal(config.connectionType, 'lan');
  assert.equal(config.ipAddress, '192.168.1.100');
  assert.equal(config.port, 9100);
});

test('validatePrinterSettings() accepts a valid Wi-Fi row the same as LAN', () => {
  const config = validatePrinterSettings({ ...validLanRow, connection_type: 'wifi' });
  assert.equal(config.connectionType, 'wifi');
  assert.equal(config.ipAddress, '192.168.1.100');
});

test('validatePrinterSettings() accepts USB with no IP/port required', () => {
  const config = validatePrinterSettings({
    id: 'printer-2',
    name: 'Kitchen Printer',
    connection_type: 'usb',
    brand: 'Star',
    model: null,
    ip_address: null,
    port: 9100,
  });
  assert.equal(config.connectionType, 'usb');
  assert.equal(config.ipAddress, null);
  assert.equal(config.port, null);
});

test('validatePrinterSettings() throws a clear error when no active printer exists', () => {
  assert.throws(() => validatePrinterSettings(null), /No active printer configured/);
});

test('validatePrinterSettings() throws on an unsupported connection type', () => {
  assert.throws(
    () => validatePrinterSettings({ ...validLanRow, connection_type: 'bluetooth' }),
    /Unsupported printer connection type/
  );
});

test('validatePrinterSettings() throws on a missing/blank IP for LAN', () => {
  assert.throws(
    () => validatePrinterSettings({ ...validLanRow, ip_address: '' }),
    /Invalid printer IP address/
  );
});

test('validatePrinterSettings() accepts a bare hostname as well as an IPv4 address', () => {
  const config = validatePrinterSettings({ ...validLanRow, ip_address: 'kitchen-printer.local' });
  assert.equal(config.ipAddress, 'kitchen-printer.local');
});

test('validatePrinterSettings() throws on an out-of-range port', () => {
  assert.throws(
    () => validatePrinterSettings({ ...validLanRow, port: 70000 }),
    /Invalid printer port/
  );
  assert.throws(
    () => validatePrinterSettings({ ...validLanRow, port: 0 }),
    /Invalid printer port/
  );
});

test('validatePrinterSettings() errors are PrinterConfigError instances', () => {
  try {
    validatePrinterSettings(null);
    assert.fail('expected a throw');
  } catch (err) {
    assert.ok(err instanceof PrinterConfigError);
  }
});

function makeFakeSupabase({ data = null, error = null } = {}) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data, error }),
      };
    },
  };
}

test('loadActivePrinterSettings() returns the validated active printer', async () => {
  const supabase = makeFakeSupabase({ data: validLanRow });
  const config = await loadActivePrinterSettings(supabase, 'restaurant-1');
  assert.equal(config.ipAddress, '192.168.1.100');
});

test('loadActivePrinterSettings() throws when the database query itself fails', async () => {
  const supabase = makeFakeSupabase({ error: new Error('connection reset') });
  await assert.rejects(
    () => loadActivePrinterSettings(supabase, 'restaurant-1'),
    /Failed to load printer configuration/
  );
});

test('loadActivePrinterSettings() throws when there is no active printer row', async () => {
  const supabase = makeFakeSupabase({ data: null });
  await assert.rejects(
    () => loadActivePrinterSettings(supabase, 'restaurant-1'),
    /No active printer configured/
  );
});
