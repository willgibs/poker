/**
 * Money formatting — the single display path for chip amounts.
 *
 * Chips are integer cents everywhere in the engine (CLAUDE.md: "no floats in
 * chip math, ever"); the UI is the only place they become a string, and this is
 * that place. Nothing renders a raw amount: every visible chip number in
 * `packages/ui` / `packages/table-ui` goes through one of these functions, and
 * the element that carries it wears `NUM_CLASS` (tabular figures — see
 * `components.css`) so a changing amount never re-flows the row it sits in.
 *
 * Integer division and remainder only — no floating-point arithmetic on the
 * money path, and no `Intl.NumberFormat`, which reads the environment's locale.
 * One amount produces one string, on every machine, forever.
 */

/** The class every element carrying a formatted amount must wear. */
export const NUM_CLASS = "fr-num";

export interface FormatCentsOptions {
  /** Prefix the amount with `$`. Default true. */
  readonly currency?: boolean;
  /**
   * Drop `.00` on whole-dollar amounts (`$18` rather than `$18.00`).
   * Default false — the table keeps two decimals so column widths are stable.
   */
  readonly trimZeroCents?: boolean;
  /** Group thousands with `,` (`$1,240.00`). Default true. */
  readonly group?: boolean;
  /** Prefix a `+` on positive amounts. For session net, off everywhere else. */
  readonly showPositiveSign?: boolean;
}

/**
 * `1840` → `"$18.40"`. Losses carry a leading `-` (`-1840` → `"-$18.40"`).
 *
 * Throws on a non-integer: a fractional cent is a chip-math bug upstream, and
 * quietly rounding it here would hide the bug behind a plausible number.
 */
export function formatCents(cents: number, options: FormatCentsOptions = {}): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`invalid chip amount: ${cents} (expected integer cents)`);
  }
  const { currency = true, trimZeroCents = false, group = true, showPositiveSign = false } = options;

  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;

  const sign = cents < 0 ? "-" : showPositiveSign && cents > 0 ? "+" : "";
  const whole = group ? groupThousands(dollars) : String(dollars);
  const fraction = trimZeroCents && remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;

  return `${sign}${currency ? "$" : ""}${whole}${fraction}`;
}

/**
 * Amounts in big blinds — the other unit the header's net toggle offers.
 * One decimal; `signed` prefixes a `+` for wins, because a session net without
 * a sign is a number you have to think about.
 */
export function formatBb(cents: number, bigBlindCents: number, options: { signed?: boolean } = {}): string {
  if (!Number.isSafeInteger(bigBlindCents) || bigBlindCents <= 0) {
    throw new RangeError(`invalid big blind: ${bigBlindCents} (expected positive integer cents)`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`invalid chip amount: ${cents} (expected integer cents)`);
  }
  const rounded = Math.round((cents / bigBlindCents) * 10) / 10;
  const sign = options.signed === true && rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}bb`;
}

/** The stake pair as one label: `formatStakes(10, 25)` → `"$0.10/$0.25"`. */
export function formatStakes(smallBlindCents: number, bigBlindCents: number): string {
  return `${formatCents(smallBlindCents)}/${formatCents(bigBlindCents)}`;
}

/**
 * The editable form: `1250` → `"12.50"`. No currency mark and no thousands
 * separator, because this string goes back into a text field the player edits —
 * a grouping comma there is something to delete, not something to read.
 */
export function formatAmountInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`invalid chip amount: ${cents} (expected non-negative integer cents)`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** `"12.5"`, `"$1,250"`, `"9.20"` → integer cents. `null` when it is not a price. */
export function parseAmountInput(input: string): number | null {
  const trimmed = input.trim().replace(/[$,\s]/g, "");
  if (trimmed === "" || trimmed === "." || !/^\d*(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function groupThousands(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s.charAt(i);
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ",";
  }
  return out;
}
