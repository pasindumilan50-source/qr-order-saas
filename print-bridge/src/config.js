// Configuration loading + validation for the Local Print Bridge.
//
// Deliberately reads from a plain `env` object (defaulting to process.env)
// rather than reaching into process.env directly everywhere else in the
// codebase, so this stays trivially unit-testable without spawning a real
// process or writing temp .env files.
//
// This project runs its main app entirely on VITE_*-prefixed env vars
// resolved by Vite at build time (see src/supabase/config.js at the repo
// root). The bridge is a separate, plain Node process with no bundler, so
// it uses its own (non-VITE_-prefixed) variable names and Node's built-in
// `--env-file` flag (Node 20.6+) instead of pulling in a dotenv dependency.

const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'BRIDGE_AUTH_EMAIL',
  'BRIDGE_AUTH_PASSWORD',
  'RESTAURANT_ID',
];

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
  }

  const pollIntervalMs = Number.parseInt(env.POLL_INTERVAL_MS ?? '15000', 10);
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
    throw new ConfigError('POLL_INTERVAL_MS must be a number >= 1000 (milliseconds).');
  }

  const healthPort = Number.parseInt(env.HEALTH_PORT ?? '4788', 10);
  if (!Number.isFinite(healthPort) || healthPort <= 0 || healthPort > 65535) {
    throw new ConfigError('HEALTH_PORT must be a valid port number.');
  }

  const logLevel = (env.LOG_LEVEL ?? 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`);
  }

  const mockPrinter = String(env.MOCK_PRINTER ?? 'true').toLowerCase() !== 'false';

  return {
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    bridgeAuthEmail: env.BRIDGE_AUTH_EMAIL,
    bridgeAuthPassword: env.BRIDGE_AUTH_PASSWORD,
    restaurantId: env.RESTAURANT_ID,
    pollIntervalMs,
    // Health server is intentionally hardcoded to loopback-only — this is
    // not configurable via env on purpose (see README "Security").
    healthHost: '127.0.0.1',
    healthPort,
    logLevel,
    mockPrinter,
  };
}

// Keys that must never be logged, even indirectly (e.g. inside a
// "configuration summary" log line). Matched case-insensitively against
// object keys anywhere in a nested structure.
export const SECRET_KEY_PATTERN = /key|token|password|secret|authorization/i;
