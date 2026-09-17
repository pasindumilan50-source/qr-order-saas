import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './logger.js';
import { createSupabaseClient, authenticate } from './supabaseClient.js';
import { DevelopmentPrinterAdapter, DynamicTcpPrinterAdapter } from './printerAdapter.js';
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

  const statusStore = createStatusStore();

  // --- Supabase ---------------------------------------------------------------
  // Authenticate before touching the printer adapter: in real mode the
  // active printer configuration is loaded from `printer_settings`, which
  // is RLS-gated to an authenticated staff-like user for this restaurant
  // (see supabaseClient.js / README "Authentication model").
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

  // --- Printer adapter ------------------------------------------------------
  let printerAdapter;
  if (config.mockPrinter) {
    printerAdapter = new DevelopmentPrinterAdapter({ logger });
  } else {
    // Printer identity (name/brand/model/connection type/IP/port) is
    // loaded from `printer_settings`, scoped to this bridge's
    // RESTAURANT_ID, and re-read on every connect/test/print — never from
    // environment variables. This is what lets an admin replace a broken
    // printer from Settings without editing `.env` or restarting the
    // bridge (Phase 4 section 15/33). If there's no valid active printer,
    // connect() below throws and the bridge exits rather than silently
    // falling back to mock mode.
    printerAdapter = new DynamicTcpPrinterAdapter({
      supabase,
      restaurantId: config.restaurantId,
      logger,
    });
  }

  try {
    await printerAdapter.connect();
  } catch (err) {
    logger.error('printer_startup_failed', { error: err.message });
    process.exit(1);
    return;
  }

  statusStore.setPrinterConnected(await printerAdapter.testConnection());
  if (typeof printerAdapter.getConfigSnapshot === 'function') {
    statusStore.setPrinterConfig(printerAdapter.getConfigSnapshot());
  }

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
