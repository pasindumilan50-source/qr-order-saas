import net from 'node:net';
import { buildEscPosPayload } from './escpos.js';
import { loadActivePrinterSettings, PrinterConfigError } from './printerSettings.js';

// Printer abstraction. No adapter here talks about a specific vendor,
// protocol, or connection type — that information was not available in the
// repository at the time this bridge foundation was built (see
// PHYSICAL_PRINTER.md). A future real adapter (e.g. an ESC/POS-over-USB or
// ESC/POS-over-network adapter) should implement this same interface.
//
// Contract every adapter must follow:
//   - connect()         resolves once the adapter is ready to attempt prints.
//                        Throws/rejects on failure.
//   - testConnection()  resolves to true/false. Never throws for a routine
//                        "printer is offline" condition — that's a false,
//                        not an exception.
//   - printKot(ticket)  attempts a REAL print. Must resolve to
//                        { success: true } only if the print genuinely
//                        succeeded, or { success: false, error } otherwise.
//                        Must never resolve { success: true } for a
//                        simulated/mock print — see MockPrinterAdapter's
//                        `simulated: true` flag, which the queue worker
//                        treats as "never call mark_kot_print_job_printed
//                        for this result" regardless of `success`.
//   - disconnect()      best-effort cleanup. Should not throw.

export class PrinterAdapter {
  /** @returns {Promise<void>} */
  async connect() {
    throw new Error('PrinterAdapter.connect() not implemented.');
  }

  /** @returns {Promise<boolean>} */
  async testConnection() {
    throw new Error('PrinterAdapter.testConnection() not implemented.');
  }

  /**
   * @param {object} ticket - output of kotFormatter.formatKotTicket()
   * @returns {Promise<{success: boolean, error?: string, simulated?: boolean}>}
   */
  async printKot(_ticket) {
    throw new Error('PrinterAdapter.printKot() not implemented.');
  }

  /** @returns {Promise<void>} */
  async disconnect() {
    // Default no-op; adapters that hold a real connection should override.
  }
}

// Development/mock adapter. Used when MOCK_PRINTER=true (the default).
//
// SAFETY: this adapter NEVER represents a real print. Every result it
// returns is tagged `simulated: true`. The queue worker (queueWorker.js)
// checks this flag and refuses to call mark_kot_print_job_printed for a
// simulated result — per Phase 4 section 20, it stops before the final
// `printed` transition rather than guessing. The job is left in
// `printing` and the worker logs a clear warning explaining why, so the
// state in the database is never wrong.
export class DevelopmentPrinterAdapter extends PrinterAdapter {
  constructor({ logger } = {}) {
    super();
    this.logger = logger ?? { info() {}, warn() {}, error() {}, debug() {} };
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    this.logger.info('dev_printer_adapter_connected', {
      note: 'No physical printer. Development/mock mode only.',
    });
  }

  async testConnection() {
    return this.connected;
  }

  async printKot(ticket) {
    if (!this.connected) {
      return { success: false, error: 'Development adapter is not connected.' };
    }
    this.logger.info('dev_printer_adapter_would_print', {
      orderId: ticket.orderId,
      tableNumber: ticket.tableNumber,
      itemCount: ticket.items.length,
      preview: ticket.lines,
    });
    // Intentionally `success: true` (the formatting/adapter call itself
    // "worked") but `simulated: true` — the queue worker must treat these
    // two flags separately. Never merge this into a real print result.
    return { success: true, simulated: true };
  }

  async disconnect() {
    this.connected = false;
  }
}

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_WRITE_TIMEOUT_MS = 5000;

// Real production adapter. Speaks raw ESC/POS over a plain TCP socket —
// this is what virtually every LAN/Wi-Fi thermal KOT printer exposes on
// port 9100 (Epson, Xprinter, Bixolon, Star's ESC/POS emulation, Rongta,
// SNBC, generic "POS-58/POS-80" clones), so brand/model stay configuration
// metadata rather than driving a different code path per vendor (see
// PHYSICAL_PRINTER.md).
//
// Deliberately opens a fresh TCP connection per operation (test/print)
// rather than holding one open for the adapter's lifetime: restaurant LAN
// printers routinely idle-disconnect or get power-cycled between orders,
// and a short-lived connection avoids the adapter silently believing it's
// still connected when it isn't. `connect()` here only validates the
// adapter has a target host/port — see the class doc comment in
// PrinterAdapter for the interface contract.
export class TcpEscPosPrinterAdapter extends PrinterAdapter {
  constructor({
    host,
    port,
    logger = NOOP_LOGGER,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
  } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.logger = logger;
    this.connectTimeoutMs = connectTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.ready = false;
  }

  async connect() {
    if (!this.host || !this.port) {
      throw new Error('TcpEscPosPrinterAdapter requires a host and port.');
    }
    this.ready = true;
  }

  async testConnection() {
    if (!this.ready) return false;
    try {
      await this._withSocket(async () => {
        // Connecting successfully IS the test — no write. A socket that
        // opens and immediately closes cleanly still proves TCP
        // connectivity, which is all this method promises to check.
      });
      return true;
    } catch (err) {
      this.logger.warn('printer_test_connection_failed', {
        host: this.host,
        port: this.port,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * @param {object} ticket - output of kotFormatter.formatKotTicket()
   */
  async printKot(ticket) {
    if (!this.ready) {
      return { success: false, error: 'Printer adapter is not connected.' };
    }

    let payload;
    try {
      payload = buildEscPosPayload(ticket);
    } catch (err) {
      return { success: false, error: `Failed to encode ticket: ${err.message}` };
    }

    try {
      await this._withSocket((socket) => this._write(socket, payload));
      this.logger.info('printer_write_succeeded', {
        orderId: ticket.orderId,
        host: this.host,
        port: this.port,
      });
      // Only reported after the socket write genuinely completed — see
      // Phase 4 section 14: this must never be returned just because a
      // socket connected or configuration looked valid.
      //
      // LIMITATION: a completed socket write is NOT proof of physical
      // output. It only proves the OS handed the bytes to the network
      // stack and the printer's TCP stack acknowledged them — it says
      // nothing about paper, power, jams, or a closed cover on the
      // physical device. See README.md section 11 / PHYSICAL_PRINTER.md.
      return { success: true, simulated: false };
    } catch (err) {
      this.logger.error('printer_write_failed', {
        orderId: ticket.orderId,
        host: this.host,
        port: this.port,
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  }

  async disconnect() {
    this.ready = false;
  }

  // Opens one TCP connection, runs `fn(socket)` against it, and always
  // tears the socket down afterward (success or failure). Centralizes
  // connect-timeout / connection-refused / socket-error handling so
  // testConnection() and printKot() don't duplicate it.
  _withSocket(fn) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        if (err) reject(err);
        else resolve(result);
      };

      socket.setTimeout(this.connectTimeoutMs);
      socket.once('timeout', () => finish(new Error('Printer connection timed out.')));
      socket.once('error', (err) =>
        finish(new Error(`Printer TCP connection failed: ${err.message}`))
      );

      socket.connect(this.port, this.host, () => {
        // Writes shouldn't inherit the connect timeout indefinitely once
        // we're past the handshake; give writes their own timer inside fn.
        socket.setTimeout(0);
        Promise.resolve()
          .then(() => fn(socket))
          .then((result) => finish(null, result))
          .catch((err) => finish(err));
      });
    });
  }

  _write(socket, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Printer write timed out.'));
      }, this.writeTimeoutMs);

      socket.write(payload, (err) => {
        clearTimeout(timer);
        if (err) reject(new Error(`Printer write failed: ${err.message}`));
        else resolve();
      });
    });
  }
}

// Wraps TcpEscPosPrinterAdapter with a fresh `printer_settings` read from
// Supabase before every connect/test/print. This is what makes the
// "replace a broken printer" workflow (Phase 4 section 15/33) work without
// restarting the bridge process: the admin saves a new IP in Settings, and
// the very next print (or health check) picks it up automatically. If the
// row is missing/invalid, or has been switched to `connection_type: usb`,
// this surfaces as a clear, typed error rather than a silent fallback.
export class DynamicTcpPrinterAdapter extends PrinterAdapter {
  constructor({ supabase, restaurantId, logger = NOOP_LOGGER, connectTimeoutMs, writeTimeoutMs }) {
    super();
    this.supabase = supabase;
    this.restaurantId = restaurantId;
    this.logger = logger;
    this.connectTimeoutMs = connectTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.currentConfig = null;
  }

  async _refreshConfig() {
    const printerConfig = await loadActivePrinterSettings(this.supabase, this.restaurantId);
    if (printerConfig.connectionType === 'usb') {
      // Deliberately not "faked": USB requires a separate OS/platform-
      // specific transport (Phase 4 section 8) that does not exist yet.
      throw new PrinterConfigError(
        'USB printer transport is not implemented. Configure a LAN or Wi-Fi ' +
          'ESC/POS printer in Settings, or implement a platform-specific USB adapter.'
      );
    }
    this.currentConfig = printerConfig;
    return printerConfig;
  }

  _adapterFor(config) {
    return new TcpEscPosPrinterAdapter({
      host: config.ipAddress,
      port: config.port,
      logger: this.logger,
      connectTimeoutMs: this.connectTimeoutMs,
      writeTimeoutMs: this.writeTimeoutMs,
    });
  }

  // Fails fast at startup if there's no valid active printer — Phase 4
  // section 19/21: "If printer configuration is missing or invalid, fail
  // clearly. Do not silently switch to mock mode."
  async connect() {
    const config = await this._refreshConfig();
    this.logger.info('printer_adapter_ready', {
      name: config.name,
      brand: config.brand,
      model: config.model,
      connectionType: config.connectionType,
      ipAddress: config.ipAddress,
      port: config.port,
    });
  }

  async testConnection() {
    try {
      const config = await this._refreshConfig();
      const adapter = this._adapterFor(config);
      await adapter.connect();
      return await adapter.testConnection();
    } catch (err) {
      this.logger.warn('printer_test_connection_failed', { error: err.message });
      return false;
    }
  }

  async printKot(ticket) {
    let config;
    try {
      config = await this._refreshConfig();
    } catch (err) {
      return { success: false, error: err.message };
    }
    const adapter = this._adapterFor(config);
    await adapter.connect();
    return adapter.printKot(ticket);
  }

  async disconnect() {
    // No persistent socket is held between operations — nothing to close.
  }

  // Non-secret snapshot for the health endpoint (see health.js). May be
  // null before the first successful connect()/refresh.
  getConfigSnapshot() {
    return this.currentConfig ? { ...this.currentConfig } : null;
  }
}
