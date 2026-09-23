# Local Print Bridge

Phase 4 foundation for `qr-order-saas`. This is an independent Node.js
process that runs on a computer at the restaurant (the one with access to
the existing KOT printer) and connects:

```
Supabase (kot_print_jobs)  →  Local Print Bridge  →  Printer Adapter  →  Existing KOT Printer
```

It does **not** run in the browser and does **not** require the Reception
Dashboard to stay open.

As of this phase, **no physical printer has been integrated** — see
[`PHYSICAL_PRINTER.md`](./PHYSICAL_PRINTER.md). This bridge ships with a
`DevelopmentPrinterAdapter` that never fakes a real print.

## 1. What the bridge does

1. Discovers jobs in `kot_print_jobs` with `status = 'queued'` for one
   restaurant, via a periodic reconciliation query **and** a Supabase
   Realtime subscription (whichever notices a job first wins — both call
   the same code path, so there's no duplicate logic to keep in sync).
2. Claims a job using the existing `claim_kot_print_job(p_job_id)` RPC.
   The bridge never writes to `kot_print_jobs.status` directly.
3. Formats the job's `kot_snapshot` into a printer-independent ticket
   (`src/kotFormatter.js`) — restaurant, table, order, items, quantities,
   notes. No prices, ever.
4. Hands the ticket to a `PrinterAdapter` (`src/printerAdapter.js`).
5. Only on a genuine, non-simulated print success does it call
   `mark_kot_print_job_printed(p_job_id)`. On a genuine failure, it calls
   `mark_kot_print_job_failed(p_job_id, p_error)`.
6. Processes **one job at a time** per bridge process, to avoid KOT order
   mixing.

## 2. Architecture

```
index.js            entrypoint: config, auth, health server, wiring, shutdown
config.js            env loading + validation
logger.js             structured JSON logs with secret redaction
supabaseClient.js    Supabase client + sign-in
kotFormatter.js       kot_snapshot -> printer-independent ticket (pure function)
printerAdapter.js     PrinterAdapter interface + DevelopmentPrinterAdapter
queueWorker.js         discovery, claiming, one-at-a-time processing, reporting
health.js              in-memory status + GET /health on 127.0.0.1
```

Each layer only talks to the layer next to it: the queue worker never
formats data itself, the formatter never talks to Supabase or a printer,
and the printer adapter never sees a raw database row — only a formatted
ticket.

## 3. Authentication model

`claim_kot_print_job`, `mark_kot_print_job_printed`, and
`mark_kot_print_job_failed` are `SECURITY DEFINER` RPCs that resolve
`auth.uid()` against `public.profiles` and require role `kitchen`,
`owner`, `admin`, or `super_admin` **for that job's restaurant**
(`0012_kot_print_queue.sql`).

The bridge therefore signs in as a **real Supabase Auth user** with
`supabase.auth.signInWithPassword()` — the same mechanism the Kitchen/
Reception dashboards use — using the project's ordinary `anon` key. It does
**not** use the `service_role` key. This means:

- The bridge can only ever act on the one restaurant its account belongs
  to (RLS enforces this, not application code).
- If the bridge's credentials leak, the blast radius is "one restaurant's
  KOT queue," not "the entire database."

**Before running the bridge**, create a dedicated staff account for it
(e.g. a `profiles` row with `role = 'kitchen'`, a distinct email like
`printer-bridge@<restaurant>.local`, and a strong generated password) —
don't reuse a real staff member's login. Put those credentials in
`BRIDGE_AUTH_EMAIL` / `BRIDGE_AUTH_PASSWORD`.

## 4. Installation

```bash
cd print-bridge
npm install
cp .env.example .env
# edit .env with real values
```

Requires Node.js 20.6+ (for `node --env-file`; the main repo already
requires Node 20+).

## 5. Environment variables

See [`.env.example`](./.env.example) for the full list with explanations:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BRIDGE_AUTH_EMAIL`,
`BRIDGE_AUTH_PASSWORD`, `RESTAURANT_ID`, `POLL_INTERVAL_MS`,
`MOCK_PRINTER`, `HEALTH_PORT`, `LOG_LEVEL`.

`HEALTH_PORT` controls the port only. The health server's **host** is
hardcoded to `127.0.0.1` in `config.js` — this is intentionally not
configurable from the environment (see "Security" below).

## 6. Running it

```bash
npm start
```

This runs `node --env-file=.env src/index.js`. To run without relying on
`--env-file` (e.g. an older process manager that injects env vars itself),
use `npm run start:no-env-file` and provide the variables another way.

## 7. Development / mock mode

With `MOCK_PRINTER=true` (the default), the bridge uses
`DevelopmentPrinterAdapter`, which:

- Connects and reports itself as connected.
- Logs the fully formatted ticket it *would* print.
- Returns `{ success: true, simulated: true }`.

The queue worker checks the `simulated` flag specifically and, when true,
**does not call `mark_kot_print_job_printed` or `mark_kot_print_job_failed`
at all**. The job is deliberately left in `printing`. This is intentional,
not an oversight: Phase 4's safety rule is that only a real printer
success may resolve a job, and mock mode exists to test discovery,
claiming, and formatting — not to complete jobs. See `job_left_in_printing_dev_mode`
in the logs.

Because of this, don't leave a bridge running in mock mode against a
restaurant's real KOT queue for actual service — jobs will pile up in
`printing` (see "Known limitations" for how to clear them).

## 8. How jobs are claimed

Only via the existing `claim_kot_print_job` RPC. If it returns `null` (the
row was already claimed by something else, or no longer queued), the
bridge logs `job_claim_missed` and moves on — it never prints or fails a
job it didn't successfully claim.

## 9. How printing is reported

- Real success → `mark_kot_print_job_printed`.
- Real failure (adapter returned `{ success: false, error }`, the adapter
  threw, or the KOT snapshot itself was malformed) → `mark_kot_print_job_failed`
  with the reason.
- Simulated (mock) result → neither call is made (see above).

## 10. How failures are handled

- **Printer failure** (adapter returns `success: false` or throws): job is
  marked `failed` with the adapter's error message. The bridge keeps
  running and keeps polling for the next job.
- **Supabase/network failure** during reconciliation: caught, logged
  (`reconcile_fetch_failed`), and retried on the next poll tick or Realtime
  event. The bridge process itself never crashes because one request
  failed.
- **Malformed KOT snapshot**: the job is marked `failed` with a
  descriptive error and is never sent to the printer adapter at all.

No retry-with-backoff scheduling is implemented for failed print jobs in
this phase — see "Known limitations."

## 11. What physical printer information is still required

See [`PHYSICAL_PRINTER.md`](./PHYSICAL_PRINTER.md).

## 12. Security considerations

- No `service_role` key anywhere in the bridge (see "Authentication
  model").
- Secrets are never logged: `logger.js` recursively redacts any object key
  matching `/key|token|password|secret|authorization/i` before writing a
  log line.
- The health endpoint only binds to `127.0.0.1` and exposes no
  credentials, only operational status (uptime, connection state, current
  job id, last successful print, last error message).
- There is no remote-control surface: the bridge accepts no incoming print
  commands from any client. The only inbound thing is the read-only
  `GET /health`.
- `.env` is git-ignored; only `.env.example` (with blank values) is
  committed.

## 13. Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Bridge exits immediately with a "Missing required environment variable" error | `.env` incomplete | Compare against `.env.example` |
| Bridge exits with "Bridge authentication failed" | Wrong email/password, or the account was deactivated | Confirm the `profiles` row for that user has `is_active = true` and the right `role`/`restaurant_id` |
| Jobs never get claimed | Bridge account's role isn't `kitchen`/`owner`/`admin` for this restaurant | Check `profiles.role` and `profiles.restaurant_id` for the bridge's auth user |
| Jobs stay `queued` even though the bridge is running | Realtime not delivering events | Wait for the next poll (`POLL_INTERVAL_MS`); check `GET /health` for `supabaseConnected` |
| Jobs pile up stuck in `printing` | Running in `MOCK_PRINTER=true` against a real queue (expected, see section 7), or a crash after claim but before print/report (see "Known limitations") | Check logs for `job_left_in_printing_dev_mode`; otherwise see the crash-recovery limitation below |
| `GET /health` connection refused | Bridge not running, or `HEALTH_PORT` conflicts with another local process | `curl http://127.0.0.1:<HEALTH_PORT>/health` |

## 14. What is intentionally NOT implemented yet

- **No real printer adapter.** See `PHYSICAL_PRINTER.md`.
- **No automatic recovery for stale `printing` jobs.** If the bridge
  crashes after claiming a job but before calling
  `mark_kot_print_job_printed`/`mark_kot_print_job_failed`, that job stays
  `printing` forever from the database's point of view. The bridge does
  **not** guess what happened and does **not** automatically requeue or
  reprint it — that would risk either a silently lost ticket or a
  duplicate physical printout, both unacceptable for a kitchen. Resolving
  a stuck `printing` job today requires manual operator judgment (check
  with the kitchen whether it printed, then use a super-admin-level tool
  to decide the job's fate). Automating this safely is explicitly deferred
  to a documented future phase (see Phase 4 spec, section 14).
- **No retry/backoff scheduling for failed jobs.** A failed job is
  terminal; nothing automatically re-queues it.
- **No multi-printer routing, no printer auto-discovery, no OS service
  installer (Windows service / launchd / systemd), no admin dashboard for
  the bridge itself.** Out of scope for this phase by design.
