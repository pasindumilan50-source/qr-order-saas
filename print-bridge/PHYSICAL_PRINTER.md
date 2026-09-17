# Physical Printer Integration Status

**LAN / Wi-Fi (ESC/POS over TCP): IMPLEMENTED.**
**USB: NOT IMPLEMENTED.**

The printer's identity (name, connection type, brand, model, IP address,
port) is admin-configurable per restaurant via **Settings → Kitchen
Printer** in the app, stored in `public.printer_settings`, and read by the
bridge — never hardcoded and never put in `.env`. See the main
[`README.md`](./README.md) sections "Real printer support" and "Printer
replacement workflow."

## What's implemented

- `src/printerSettings.js` — loads and validates the active
  `printer_settings` row for `RESTAURANT_ID`.
- `src/escpos.js` — encodes a formatted KOT ticket (`kotFormatter.js`
  output) into raw ESC/POS bytes: initialize, text, feed, partial cut.
- `src/printerAdapter.js`:
  - `TcpEscPosPrinterAdapter` — opens a TCP socket to the configured
    `ip_address:port` and writes the ESC/POS payload. Only reports
    `{ success: true }` after the socket write genuinely completes.
  - `DynamicTcpPrinterAdapter` — wraps the above and re-reads
    `printer_settings` from Supabase before every connect/test/print, so a
    printer swap in Settings takes effect on the very next print without
    restarting the bridge process.

This targets the standard ESC/POS command set that Epson, Xprinter,
Bixolon, Star (ESC/POS emulation), Rongta, SNBC, and most generic
POS-58/POS-80 clones all understand over a raw TCP socket — no
vendor-specific SDK or proprietary protocol is used. Brand/model remain
configuration metadata.

**Limitation — "success" means the socket write completed, not that paper
came out.** `TcpEscPosPrinterAdapter` only reports success after the OS
confirms the ESC/POS bytes were fully written to the TCP socket. It has no
way to observe the printer's physical state — out of paper, a jam, a
closed-but-not-latched cover, or (rarely) a printer that accepts a TCP
write but silently drops it in its own firmware. This is an inherent
limitation of raw socket-based ESC/POS printing (as opposed to a vendor
driver/SDK with print-status callbacks), not a bug in this adapter. See
README.md section 11.

## What's NOT implemented: USB

If a restaurant's `printer_settings.connection_type` is `usb`, the bridge
fails clearly at startup (or on the next print, if switched to USB while
running) with `USB printer transport is not implemented`. It does **not**
attempt fake printing and does **not** mark any job as printed.

USB requires an OS/platform-specific transport (e.g. a Windows raw-printer
API, a CUPS backend, or a native USB HID/bulk-transfer library) that is
out of scope for this phase. To add it:

1. Confirm the target OS(es) the bridge will actually run on.
2. Implement a new adapter class (e.g. `UsbEscPosPrinterAdapter`)
   implementing the same `PrinterAdapter` interface (`connect()`,
   `testConnection()`, `printKot(ticket)`, `disconnect()`).
3. Wire it into `DynamicTcpPrinterAdapter`'s connection-type branch (or an
   equivalent dispatcher) in place of the current
   `PrinterConfigError('USB printer transport is not implemented...')`
   throw — without changing `queueWorker.js`, `kotFormatter.js`, or any
   Supabase-facing code, per the existing adapter boundary.
