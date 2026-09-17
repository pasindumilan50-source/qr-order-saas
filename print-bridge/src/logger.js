import { SECRET_KEY_PATTERN } from './config.js';

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

// Recursively strips any value whose key looks secret-like. This runs on
// every log call's metadata so a future accidental
// `logger.info('config', config)` can't leak SUPABASE_ANON_KEY,
// BRIDGE_AUTH_PASSWORD, etc. The anon key isn't a high-value secret (see
// .env.example), but it's still redacted for defense in depth and because
// this same redaction path guards genuinely sensitive fields like
// BRIDGE_AUTH_PASSWORD and any future access token.
export function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(val, seen);
    }
  }
  return out;
}

export function createLogger({ level = 'info', now = () => new Date() } = {}) {
  const threshold = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;

  function write(lvl, event, meta) {
    if (LEVEL_ORDER[lvl] < threshold) return;
    const line = {
      ts: now().toISOString(),
      level: lvl,
      event,
      ...(meta ? redact(meta) : {}),
    };
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  }

  return {
    debug: (event, meta) => write('debug', event, meta),
    info: (event, meta) => write('info', event, meta),
    warn: (event, meta) => write('warn', event, meta),
    error: (event, meta) => write('error', event, meta),
  };
}
