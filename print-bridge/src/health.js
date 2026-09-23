import http from 'node:http';

// Local-only health/status reporting. Bound to 127.0.0.1 by default and
// never configurable to bind elsewhere from this module (see README
// "Security" / Phase 4 section 21) — the caller decides the host, but this
// module's own default and every place it's constructed in this codebase
// use 127.0.0.1.

export function createStatusStore() {
  const state = {
    startedAt: new Date().toISOString(),
    supabaseConnected: false,
    printerConnected: false,
    currentJob: null, // { id, orderId, tableNumber, claimedAt } | null
    lastSuccessfulPrint: null, // { id, orderId, printedAt } | null
    lastError: null, // { message, at } | null
  };

  return {
    getState: () => ({ ...state }),
    setSupabaseConnected(value) {
      state.supabaseConnected = value;
    },
    setPrinterConnected(value) {
      state.printerConnected = value;
    },
    setCurrentJob(job) {
      state.currentJob = job;
    },
    setLastSuccessfulPrint(info) {
      state.lastSuccessfulPrint = info;
    },
    setLastError(message) {
      state.lastError = message ? { message: String(message), at: new Date().toISOString() } : null;
    },
  };
}

export function startHealthServer({ host, port, statusStore, logger }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = JSON.stringify(statusStore.getState(), null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      logger?.info('health_server_started', { host, port });
      resolve(server);
    });
  });
}
