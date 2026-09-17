import net from 'node:net';

// Loads the active `public.printer_settings` row for this bridge's
// restaurant and validates it into a shape the printer adapters can use.
//
// This is the ONLY place printer IP/port/brand/model configuration comes
// from. It is never read from environment variables (see .env.example —
// printer IP/port/model/brand are deliberately absent from the required
// keys in config.js). That's what lets a restaurant admin replace a
// printer from Settings without touching the bridge's environment or
// source code (Phase 4 section 15/33).

export class PrinterConfigError extends Error {}

const VALID_CONNECTION_TYPES = ['lan', 'wifi', 'usb'];
const DEFAULT_PORT = 9100;

// Accepts dotted-quad IPv4, standard IPv6, or a bare hostname (a LAN
// printer is sometimes reachable by mDNS/local hostname rather than a
// static IP). Intentionally permissive about hostname shape — the real
// test is whether a TCP connection to it succeeds, not this regex.
const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,62}))*)?$/;

function isValidHost(value) {
  if (!value) return false;
  if (net.isIP(value) !== 0) return true;
  return HOSTNAME_PATTERN.test(value);
}

/**
 * Pure validation function (no I/O) so it's trivially unit-testable.
 * @param {object|null} row - a printer_settings row, or null if none found
 * @returns {{id: string, name: string, connectionType: 'lan'|'wifi'|'usb',
 *            brand: string, model: string|null,
 *            ipAddress: string|null, port: number|null}}
 */
export function validatePrinterSettings(row) {
  if (!row) {
    throw new PrinterConfigError('No active printer configured for restaurant.');
  }

  if (!VALID_CONNECTION_TYPES.includes(row.connection_type)) {
    throw new PrinterConfigError(`Unsupported printer connection type: ${row.connection_type}`);
  }

  const base = {
    id: row.id,
    name: row.name || 'Kitchen Printer',
    connectionType: row.connection_type,
    brand: row.brand || null,
    model: row.model || null,
  };

  if (row.connection_type === 'usb') {
    return { ...base, ipAddress: null, port: null };
  }

  const ip = typeof row.ip_address === 'string' ? row.ip_address.trim() : '';
  if (!isValidHost(ip)) {
    throw new PrinterConfigError('Invalid printer IP address.');
  }

  const port = Number.parseInt(row.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrinterConfigError('Invalid printer port.');
  }

  return { ...base, ipAddress: ip, port: port || DEFAULT_PORT };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} restaurantId
 */
export async function loadActivePrinterSettings(supabase, restaurantId) {
  const { data, error } = await supabase
    .from('printer_settings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new PrinterConfigError(`Failed to load printer configuration: ${error.message}`);
  }

  return validatePrinterSettings(data);
}
