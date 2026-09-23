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
