# Physical Printer Integration Status

**`PHYSICAL PRINTER INTEGRATION: BLOCKED UNTIL PRINTER MODEL/CONNECTION DETAILS ARE PROVIDED`**

Nothing in the `qr-order-saas` repository (migrations, services, README,
env files) identifies:

- a printer vendor or model (e.g. Epson, Star, Xprinter, SNBC, a generic
  POS-58/POS-80 unit),
- a printer protocol (ESC/POS or otherwise),
- a connection type (USB, Ethernet/network, Wi-Fi, Bluetooth),
- an operating system the restaurant's computer runs (Windows/macOS/Linux)
  or an existing OS-level print pipeline (Windows spooler, CUPS, a vendor
  SDK).

Per the Phase 4 instructions, none of this was assumed or guessed. Building
a vendor-specific adapter without this information would risk producing
code that silently does the wrong thing against real kitchen hardware.

## What exists instead

- `src/printerAdapter.js` defines the `PrinterAdapter` interface
  (`connect()`, `testConnection()`, `printKot(ticket)`, `disconnect()`)
  that any real adapter must implement.
- `DevelopmentPrinterAdapter` implements that interface for local testing
  only, and is structurally incapable of reporting a real success (every
  result it returns is tagged `simulated: true`, which `queueWorker.js`
  specifically checks for and never treats as a real print).

## What's needed to unblock this

To build a real adapter, the following needs to be confirmed for the
restaurant(s) this bridge will serve:

1. **Printer make/model** (e.g. "Epson TM-T88VI", "Xprinter XP-58IIH").
2. **Connection type**: USB, Ethernet (with IP/port), Wi-Fi, or Bluetooth.
3. **Protocol**: ESC/POS is the most common for thermal KOT printers, but
   this should be confirmed rather than assumed, especially if the
   printer is already integrated with another POS system.
4. **Operating system** of the computer the bridge will run on, and
   whether that OS already has a working print path to this printer today
   (e.g. it shows up as a Windows printer, or a CUPS queue).
5. **Existing driver or SDK**, if any, that the restaurant's current
   workflow already relies on.

## Once that information is available

A new adapter class implementing `PrinterAdapter` (e.g.
`EscPosUsbAdapter`, `EscPosNetworkAdapter`, or an OS-print-queue-based
adapter) should be added alongside `DevelopmentPrinterAdapter`, wired up
in `src/index.js` behind the existing `MOCK_PRINTER` flag, without
changing `queueWorker.js`, `kotFormatter.js`, or any Supabase-facing code —
that's the entire point of the adapter boundary.
