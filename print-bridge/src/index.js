import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './logger.js';
import { createSupabaseClient, authenticate } from './supabaseClient.js';
import { DevelopmentPrinterAdapter } from './printerAdapter.js';
import { QueueWorker } from './queueWorker.js';
import { createStatusStore, startHealthServer } from './health.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[print-bridge] Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({ level: config.logLevel });

  logger.info('bridge_starting', {
    restaurantId: config.restaurantId,
    mockPrinter: config.mockPrinter,
    pollIntervalMs: config.pollIntervalMs,
    healthPort: config.healthPort,
    // Never log the anon key, email, or password (see logger.js redaction;
    // this summary also just doesn't include them in the first place).
  });

  // --- Printer adapter ------------------------------------------------------
  let printerAdapter;
  if (config.mockPrinter) {
    printerAdapter = new DevelopmentPrinterAdapter({ logger });
  } else {
    // No physical printer information was available in the repository when
    // this bridge foundation was built (see PHYSICAL_PRINTER.md). Rather
    // than guess a vendor/protocol, the bridge refuses to start in
    // non-mock mode until a real adapter exists.
    logger.error('no_real_printer_adapter_configured', {
      note:
        'MOCK_PRINTER=false but no real PrinterAdapter implementation exists yet. ' +
        'See PHYSICAL_PRINTER.md for what is needed to add one.',
    });
    process.exit(1);
    return;
  }

  const statusStore = createStatusStore();

  // --- Supabase ---------------------------------------------------------------
  const supabase = createSupabaseClient({
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
  });

  try {
    await authenticate(
      supabase,
      { email: config.bridgeAuthEmail, password: config.bridgeAuthPassword },
      logger
    );
    statusStore.setSupabaseConnected(true);
  } catch (err) {
    logger.error('bridge_authentication_failed', { error: err.message });
    process.exit(1);
    return;
  }

  await printerAdapter.connect();
  statusStore.setPrinterConnected(await printerAdapter.testConnection());

  // --- Health endpoint -----------------------------------------------------
  const healthServer = await startHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    statusStore,
    logger,
  });

  // --- Queue worker -----------------------------------------------------------
  const worker = new QueueWorker({
    supabase,
    restaurantId: config.restaurantId,
    printerAdapter,
    logger,
    statusStore,
  });
  worker.start(config.pollIntervalMs);

  logger.info('bridge_started', {});

  // --- Graceful shutdown -------------------------------------------------------
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('bridge_shutting_down', { signal });
    try {
      await worker.stop();
      await printerAdapter.disconnect();
      await new Promise((resolve) => healthServer.close(resolve));
    } finally {
      logger.info('bridge_stopped', {});
      process.exit(0);
    }
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[print-bridge] Fatal error during startup:', err);
  process.exit(1);
});
