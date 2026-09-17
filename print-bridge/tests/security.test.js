import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { startHealthServer, createStatusStore } from '../src/health.js';

test('redact() strips secret-like keys anywhere in a nested object', () => {
  const input = {
    restaurantId: 'r1',
    supabaseAnonKey: 'super-secret-anon-key',
    nested: {
      bridgeAuthPassword: 'hunter2',
      accessToken: 'abc.def.ghi',
      ok: 'fine',
    },
    list: [{ password: 'p1' }, { safe: 'value' }],
  };

  const out = redact(input);

  assert.equal(out.restaurantId, 'r1');
  assert.equal(out.supabaseAnonKey, '[redacted]');
  assert.equal(out.nested.bridgeAuthPassword, '[redacted]');
  assert.equal(out.nested.accessToken, '[redacted]');
  assert.equal(out.nested.ok, 'fine');
  assert.equal(out.list[0].password, '[redacted]');
  assert.equal(out.list[1].safe, 'value');
});

test('loadConfig() throws a clear error when required vars are missing', () => {
  assert.throws(() => loadConfig({}), /Missing required environment variable/);
});

test('loadConfig() defaults the health server to loopback-only and is not overridable via env', () => {
  const config = loadConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    BRIDGE_AUTH_EMAIL: 'bridge@example.com',
    BRIDGE_AUTH_PASSWORD: 'pw',
    RESTAURANT_ID: 'r1',
    // Even if something injected an attempted override, loadConfig has no
    // knob for it — this is intentional, see config.js.
    HEALTH_HOST: '0.0.0.0',
  });
  assert.equal(config.healthHost, '127.0.0.1');
});

test('health server actually binds to 127.0.0.1 and serves /health', async () => {
  const statusStore = createStatusStore();
  const server = await startHealthServer({
    host: '127.0.0.1',
    port: 0, // ask the OS for a free port
    statusStore,
    logger: { info() {} },
  });
  try {
    const address = server.address();
    assert.equal(address.address, '127.0.0.1');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.supabaseConnected, false);
    assert.equal(body.printerConnected, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
