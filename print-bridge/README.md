# Local Print Bridge

Phase 4 foundation for `qr-order-saas`. This is an independent Node.js
process that runs on a computer at the restaurant (the one with access to
the existing KOT printer) and connects:

```
Supabase (kot_print_jobs)  →  Local Print Bridge  →  Printer Adapter  →  Existing KOT Printer
```

It does **not** run in the browser and does **not** require the Reception
Dashboard to stay open.

This bridge ships with a `DevelopmentPrinterAdapter` (mock mode, never
fakes a real print) and a real `TcpEscPosPrinterAdapter` for LAN/Wi-Fi
ESC/POS printers, configured per restaurant from **Settings → Kitchen
Printer** rather than from environment variables — see "Real printer
support" below and [`PHYSICAL_PRINTER.md`](./PHYSICAL_PRINTER.md) for what
is and isn't implemented (USB is not yet implemented).

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
printerSettings.js    loads + validates the active printer_settings row
escpos.js              formatted ticket -> raw ESC/POS bytes (pure function)
printerAdapter.js     PrinterAdapter interface + Development/Tcp/Dynamic adapters
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

## 11. Real printer support

With `MOCK_PRINTER=false`, the bridge uses `DynamicTcpPrinterAdapter`
(`src/printerAdapter.js`), which:

1. Loads the active `printer_settings` row for `RESTAURANT_ID`
   (`is_active = true`) — never from `.env`. Loading is scoped by RLS to
   the same authenticated bridge account used for the KOT queue.
2. Validates it (`src/printerSettings.js`): connection type, IP/hostname
   for LAN/Wi-Fi, port range.
3. For `lan`/`wifi`, opens a fresh TCP connection to `ip_address:port`
   per print, encodes the ticket as ESC/POS (`src/escpos.js`: initialize →
   text → feed/cut), and writes it (`TcpEscPosPrinterAdapter`). Only
   `{ success: true, simulated: false }` after the write genuinely
   completes — never because the socket merely connected or the config
   merely looked valid.
4. For `usb`, fails clearly with `USB printer transport is not
   implemented` rather than attempting fake printing — see
   [`PHYSICAL_PRINTER.md`](./PHYSICAL_PRINTER.md).
5. If no active printer exists, or the row is invalid, the bridge logs a
   clear error and exits at startup instead of silently falling back to
   mock mode.

**Printer replacement workflow:** because `printer_settings` is re-read
from Supabase before every connect/test/print (not cached for the
process's lifetime), an admin can go to Settings → Kitchen Printer, change
the brand/model/IP/port, and save — the very next KOT print picks up the
new configuration automatically. A bridge restart also always picks up
the latest configuration, but isn't required just to change the printer.

**Important limitation — what "success" actually means:** a successful
result here means the bridge opened a TCP connection to the configured
`ip_address:port` and the OS confirmed the ESC/POS bytes were fully
written to that socket. **It does not guarantee the printer actually
produced physical output.** A printer that is powered on, network-reachable,
out of paper, and jammed will still accept and acknowledge the TCP write —
the socket layer has no way to observe the print head or paper feed. This
is an inherent limitation of driving a printer over a raw ESC/POS socket
rather than a vendor SDK/driver with print-status feedback, and it applies
to virtually every low-level ESC/POS-over-TCP integration, not just this
one. If a restaurant reports "the bridge said it printed but nothing came
out," check paper/power/jam first — that is expected to look identical to
a genuine success from the bridge's point of view.

## 12. Setting up a real LAN/Wi-Fi ESC/POS printer

1. Confirm the printer is on the same network as the computer running the
   bridge, and note its IP address (most thermal KOT printers print a
   configuration/test ticket showing this from a physical button
   combination — check the printer's manual).
2. In the app, go to **Settings → Kitchen Printer** and enter: name,
   connection type (`LAN / Ethernet` or `Wi-Fi`), brand, model, the
   printer's IP address, and port (`9100` unless the printer's manual says
   otherwise). Save.
3. In `print-bridge/.env`, set `MOCK_PRINTER=false` (printer IP/port stay
   out of `.env` — they come from the row you just saved).
4. Start the bridge (`npm start`) and check the logs for
   `printer_adapter_ready` (confirms it loaded and validated your printer
   config) and `bridge_started`.
5. Optionally check `curl http://127.0.0.1:4788/health` — `printerConfig`
   should show the name/brand/model/IP/port you just entered, and
   `printerConnected` should be `true` if the printer is reachable.
6. Place a test order through the app so a KOT job is queued, and confirm
   in the logs: `job_claimed` → `printer_write_succeeded` → the job's
   status becomes `printed` in `kot_print_jobs`.
7. To replace the printer later (new hardware, new IP, etc.), just repeat
   step 2 with the new details and save — no `.env` change, no bridge
   restart, no developer involvement.

## 13. What physical printer information is still required

See [`PHYSICAL_PRINTER.md`](./PHYSICAL_PRINTER.md) — currently just USB.

## 14. Security considerations

- No `service_role` key anywhere in the bridge (see "Authentication
  model").
- Secrets are never logged: `logger.js` recursively redacts any object key
  matching `/key|token|password|secret|authorization/i` before writing a
  log line.
- The health endpoint only binds to `127.0.0.1` and exposes no
  credentials, only operational status (uptime, connection state,
  non-secret printer identity — name/brand/model/connection
  type/IP/port — current job id, last successful print, last error
  message).
- There is no remote-control surface: the bridge accepts no incoming print
  commands from any client. The only inbound thing is the read-only
  `GET /health`.
- `.env` is git-ignored; only `.env.example` (with blank values) is
  committed.

## 15. Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Bridge exits immediately with a "Missing required environment variable" error | `.env` incomplete | Compare against `.env.example` |
| Bridge exits with "Bridge authentication failed" | Wrong email/password, or the account was deactivated | Confirm the `profiles` row for that user has `is_active = true` and the right `role`/`restaurant_id` |
| Jobs never get claimed | Bridge account's role isn't `kitchen`/`owner`/`admin` for this restaurant | Check `profiles.role` and `profiles.restaurant_id` for the bridge's auth user |
| Jobs stay `queued` even though the bridge is running | Realtime not delivering events | Wait for the next poll (`POLL_INTERVAL_MS`); check `GET /health` for `supabaseConnected` |
| Jobs pile up stuck in `printing` | Running in `MOCK_PRINTER=true` against a real queue (expected, see section 7), or a crash after claim but before print/report (see "Known limitations") | Check logs for `job_left_in_printing_dev_mode`; otherwise see the crash-recovery limitation below |
| `GET /health` connection refused | Bridge not running, or `HEALTH_PORT` conflicts with another local process | `curl http://127.0.0.1:<HEALTH_PORT>/health` |
| Bridge exits with "No active printer configured for restaurant" (`MOCK_PRINTER=false`) | No row in `printer_settings` with `is_active = true` for this restaurant | Have an admin save one in Settings → Kitchen Printer |
| Bridge exits with "USB printer transport is not implemented" | `printer_settings.connection_type = 'usb'` | Switch to a LAN/Wi-Fi ESC/POS printer in Settings, or implement a USB adapter (see `PHYSICAL_PRINTER.md`) |
| Jobs marked `failed` with "Printer TCP connection failed" / "timed out" | Printer offline, wrong IP/port, or a network/firewall issue | Confirm the printer's IP/port in Settings, and that it's reachable from the bridge's machine (`GET /health` → `printerConnected`) |
| "Printer TCP connection failed" specifically (not a timeout) | Wrong IP, printer powered off, or wrong port (most ESC/POS printers use `9100`) | `telnet <ip> <port>` or `nc -zv <ip> <port>` from the bridge's machine |
| "Printer connection timed out" | Firewall/router blocking the port, printer on a different VLAN/guest network, or a wrong IP that happens to be silently dropped rather than refused | Confirm the bridge's machine and the printer are on the same LAN/subnet; check for client/AP isolation on the Wi-Fi network; check firewall rules on the bridge's machine and any router/switch in between |
| Bridge says printed (`printer_write_succeeded` / job → `printed`) but nothing physically printed | Expected limitation — a successful TCP write does not guarantee physical output (see section 11) | Check the printer for paper, power, a jam, or an open cover |

## 16. What is intentionally NOT implemented yet

- **No USB printer adapter.** LAN/Wi-Fi (ESC/POS over TCP) is implemented;
  USB requires a separate OS/platform-specific transport. See
  `PHYSICAL_PRINTER.md`.
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
