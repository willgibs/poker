/**
 * Money display formatting — the canonical cents→dollars string.
 *
 * Chips are integer cents everywhere in the engine (see CLAUDE.md — "no
 * floats in chip math, ever"). `formatCents` is the one sanctioned way to
 * turn a cents integer into a display string; it never touches floating
 * point arithmetic itself (integer division + remainder only), so it is
 * exact for every value a `number` can hold without precision loss.
 *
 * `packages/ui/src/components/formatCents.ts` re-exports this and adds the
 * other units (big blinds, the editable amount-field string) on top of it —
 * this file owns only the one canonical string.
 *
 * Pair the returned string with the `.fr-num` class (`components.css`,
 * `font-variant-numeric: tabular-nums`) — this helper only owns the digits,
 * not the type-setting.
 */

export interface FormatCentsOptions {
  /** Prefix a "+" for positive values — useful for net P&L displays. Default false. */
  readonly showPositiveSign?: boolean;
}

/**
 * Formats an integer cents amount as a dollar string, e.g. `1250` -> `"$12.50"`,
 * `125000` -> `"$1,250.00"`, `-620` -> `"−$6.20"` (a true minus sign, U+2212,
 * matching the DC4 menu study's negative-number treatment).
 *
 * Throws on non-integer input — a fractional cents value is a bug upstream,
 * not something to silently round here.
 */
export function formatCents(cents: number, options: FormatCentsOptions = {}): string {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new TypeError(`formatCents expects an integer cents value, got ${String(cents)}`);
  }

  const { showPositiveSign = false } = options;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const wholeDollars = Math.floor(abs / 100);
  const remainderCents = abs % 100;
  const centsPart = remainderCents < 10 ? `0${remainderCents}` : `${remainderCents}`;
  const dollarsPart = new Intl.NumberFormat("en-US").format(wholeDollars);

  const sign = negative ? "−" : showPositiveSign && abs > 0 ? "+" : "";
  return `${sign}$${dollarsPart}.${centsPart}`;
}
