// Minimal, vendor-neutral ESC/POS encoding for a formatted KOT ticket.
//
// Deliberately does NOT implement any vendor-specific proprietary protocol.
// Brand/model (Epson, Xprinter, Bixolon, Star, Rongta, SNBC, ...) are
// configuration metadata only (see PHYSICAL_PRINTER.md) — this module
// targets the standard ESC/POS command set that virtually all of those
// printers understand when driven over a raw TCP socket on port 9100.
//
// kotFormatter.js already produces `ticket.lines` (plain text, one KOT
// line per array entry). This module's only job is turning that into
// bytes: initialize printer, send text, feed, cut.

const ESC = 0x1b;
const GS = 0x1d;

// ESC @ — initialize printer (reset any prior state, e.g. from a job that
// errored mid-stream).
const INIT = Buffer.from([ESC, 0x40]);

// GS V 66 0 — feed and partial cut. Widely supported across ESC/POS
// thermal printers (Epson, and the common clones: Xprinter, Rongta, SNBC,
// Bixolon, Star's ESC/POS-compatible emulation mode). If a specific
// printer doesn't support this exact cut variant it simply ignores the
// command and leaves the ticket uncut — it does not corrupt the text
// output above it.
const FEED_AND_PARTIAL_CUT = Buffer.from([GS, 0x56, 0x42, 0x00]);

/**
 * @param {{lines: string[]}} ticket - output of kotFormatter.formatKotTicket()
 * @returns {Buffer} raw bytes ready to write to the printer's TCP socket
 */
export function buildEscPosPayload(ticket) {
  if (!ticket || !Array.isArray(ticket.lines)) {
    throw new Error('buildEscPosPayload() requires a formatted ticket with a lines array.');
  }

  // Trailing blank lines give the thermal head paper to advance past the
  // cut point before it fires, so the last line of text isn't clipped.
  const text = `${ticket.lines.join('\n')}\n\n\n`;

  return Buffer.concat([INIT, Buffer.from(text, 'utf8'), FEED_AND_PARTIAL_CUT]);
}
