import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueWorker } from '../src/queueWorker.js';

function noopLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

// Minimal fake Supabase client. Only implements the query/rpc shapes
// queueWorker.js actually calls, as thenable builders (matching how the
// real supabase-js client resolves `.select().eq().order().limit()`).
function makeFakeSupabase({ queuedJobs = [], claimResults = {}, rpcErrors = {} } = {}) {
  const rpcCalls = [];

  const selectBuilder = {
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve) {
      resolve({ data: queuedJobs, error: null });
    },
  };

  return {
    rpcCalls,
    from() {
      return { select: () => selectBuilder };
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (rpcErrors[name]) {
        return { data: null, error: new Error(rpcErrors[name]) };
      }
      if (name === 'claim_kot_print_job') {
        const result = claimResults[params.p_job_id];
        return { data: result === undefined ? null : result, error: null };
      }
      return { data: { id: params.p_job_id }, error: null };
    },
    channel() {
      return {
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    async removeChannel() {},
  };
}

function makeFakeStatusStore() {
  return {
    setSupabaseConnected() {},
    setPrinterConnected() {},
    setCurrentJob() {},
    setLastSuccessfulPrint() {},
    setLastError() {},
  };
}

const snapshot = { restaurantId: 'r1', orderId: 'o1', items: [{ name: 'Soup', quantity: 1 }] };

test('discovers a queued job and claims it', async () => {
  const job = { id: 'job-1', order_id: 'o1', kot_snapshot: snapshot, claimed_at: 'now' };
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: { 'job-1': job },
  });
  const printerAdapter = { printKot: async () => ({ success: true }) };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  const claimCall = supabase.rpcCalls.find((c) => c.name === 'claim_kot_print_job');
  assert.ok(claimCall);
  assert.equal(claimCall.params.p_job_id, 'job-1');
  const printedCall = supabase.rpcCalls.find((c) => c.name === 'mark_kot_print_job_printed');
  assert.ok(printedCall, 'a real (non-simulated) success should mark the job printed');
});

test('a job already claimed by someone else is skipped, not printed or failed', async () => {
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: {}, // claim_kot_print_job returns null: already claimed elsewhere
  });
  let printCalled = false;
  const printerAdapter = {
    printKot: async () => {
      printCalled = true;
      return { success: true };
    },
  };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  assert.equal(printCalled, false);
  assert.equal(supabase.rpcCalls.some((c) => c.name === 'mark_kot_print_job_printed'), false);
  assert.equal(supabase.rpcCalls.some((c) => c.name === 'mark_kot_print_job_failed'), false);
});

test('a simulated (mock/dev) print result never marks the job printed or failed', async () => {
  const job = { id: 'job-1', order_id: 'o1', kot_snapshot: snapshot, claimed_at: 'now' };
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: { 'job-1': job },
  });
  const printerAdapter = { printKot: async () => ({ success: true, simulated: true }) };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  assert.equal(supabase.rpcCalls.some((c) => c.name === 'mark_kot_print_job_printed'), false);
  assert.equal(supabase.rpcCalls.some((c) => c.name === 'mark_kot_print_job_failed'), false);
});

test('a real printer failure marks the job failed with the reported error', async () => {
  const job = { id: 'job-1', order_id: 'o1', kot_snapshot: snapshot, claimed_at: 'now' };
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: { 'job-1': job },
  });
  const printerAdapter = { printKot: async () => ({ success: false, error: 'printer offline' }) };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  const failCall = supabase.rpcCalls.find((c) => c.name === 'mark_kot_print_job_failed');
  assert.ok(failCall);
  assert.equal(failCall.params.p_error, 'printer offline');
});

test('a malformed snapshot is marked failed and never sent to the printer', async () => {
  const job = { id: 'job-1', order_id: 'o1', kot_snapshot: { items: [] }, claimed_at: 'now' }; // missing orderId/restaurantId
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: { 'job-1': job },
  });
  let printCalled = false;
  const printerAdapter = {
    printKot: async () => {
      printCalled = true;
      return { success: true };
    },
  };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  assert.equal(printCalled, false);
  assert.ok(supabase.rpcCalls.find((c) => c.name === 'mark_kot_print_job_failed'));
});

test('only one job is processed per reconcile cycle even if multiple are queued', async () => {
  const jobA = { id: 'job-a', order_id: 'oa', kot_snapshot: { ...snapshot, orderId: 'oa' }, claimed_at: 'now' };
  const supabase = makeFakeSupabase({
    queuedJobs: [
      { id: 'job-a', order_id: 'oa', queued_at: 't1' },
      { id: 'job-b', order_id: 'ob', queued_at: 't2' },
    ],
    claimResults: { 'job-a': jobA },
  });
  const printerAdapter = { printKot: async () => ({ success: true }) };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  await worker.reconcile();

  const claimCalls = supabase.rpcCalls.filter((c) => c.name === 'claim_kot_print_job');
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].params.p_job_id, 'job-a');
});

test('reconcile() is a no-op while a job is already being processed (busy)', async () => {
  const job = { id: 'job-1', order_id: 'o1', kot_snapshot: snapshot, claimed_at: 'now' };
  const supabase = makeFakeSupabase({
    queuedJobs: [{ id: 'job-1', order_id: 'o1', queued_at: 't1' }],
    claimResults: { 'job-1': job },
  });
  let resolvePrint;
  const printGate = new Promise((resolve) => {
    resolvePrint = resolve;
  });
  const printerAdapter = {
    printKot: async () => {
      await printGate;
      return { success: true };
    },
  };
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: noopLogger(),
    statusStore: makeFakeStatusStore(),
  });

  const firstReconcile = worker.reconcile();
  // Worker should now be busy inside printKot. A second reconcile call
  // must not attempt another claim while the first job is in flight.
  await worker.reconcile();
  assert.equal(supabase.rpcCalls.filter((c) => c.name === 'claim_kot_print_job').length, 1);

  resolvePrint();
  await firstReconcile;
});

test('a Supabase fetch failure during reconcile does not throw', async () => {
  const supabase = makeFakeSupabase();
  supabase.from = () => ({
    select: () => ({
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      then(_resolve, reject) {
        reject(new Error('network down'));
      },
    }),
  });
  const printerAdapter = { printKot: async () => ({ success: true }) };
  const errors = [];
  const worker = new QueueWorker({
    supabase,
    restaurantId: 'r1',
    printerAdapter,
    logger: { info() {}, warn: (e, m) => errors.push([e, m]), error() {}, debug() {} },
    statusStore: makeFakeStatusStore(),
  });

  await assert.doesNotReject(() => worker.reconcile());
  assert.ok(errors.some(([event]) => event === 'reconcile_fetch_failed'));
});
