/**
 * Table positions, seat-relative-to-button.
 *
 * Seat 0 is the button; seats proceed clockwise (order of action):
 * seat 1 posts the small blind, seat 2 the big blind, and so on.
 * Heads-up (tableSize 2): the button posts the small blind and is
 * labeled "BTN"; the other seat is "BB".
 *
 * Label tables (a PUBLIC CONTRACT — snapshot-tested, do not change):
 * middle seats fill early positions (UTG, UTG1, UTG2) forward from the
 * big blind and late positions (LJ, HJ, CO) backward from the button.
 * "UTG2" exists only at 9-max: nine seats need nine distinct labels,
 * and it follows the UTG1 naming pattern.
 */

export type PositionLabel =
  | "BTN"
  | "SB"
  | "BB"
  | "UTG"
  | "UTG1"
  | "UTG2"
  | "LJ"
  | "HJ"
  | "CO";

export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 9;

const TABLES: ReadonlyArray<readonly PositionLabel[]> = [
  /* 2 */ ["BTN", "BB"],
  /* 3 */ ["BTN", "SB", "BB"],
  /* 4 */ ["BTN", "SB", "BB", "UTG"],
  /* 5 */ ["BTN", "SB", "BB", "UTG", "CO"],
  /* 6 */ ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  /* 7 */ ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
  /* 8 */ ["BTN", "SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO"],
  /* 9 */ ["BTN", "SB", "BB", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO"],
];

function assertTableSize(tableSize: number): void {
  if (!Number.isInteger(tableSize) || tableSize < MIN_TABLE_SIZE || tableSize > MAX_TABLE_SIZE) {
    throw new RangeError(
      `invalid table size: ${tableSize} (expected integer ${MIN_TABLE_SIZE}-${MAX_TABLE_SIZE})`,
    );
  }
}

/** Ordered position labels starting at the button (seat 0). */
export function positionsFor(tableSize: number): readonly PositionLabel[] {
  assertTableSize(tableSize);
  const table = TABLES[tableSize - MIN_TABLE_SIZE];
  if (table === undefined) throw new RangeError(`invalid table size: ${tableSize}`);
  return table;
}

/** Position label for a seat, where seat 0 is the button and seats go clockwise. */
export function positionOf(tableSize: number, seatFromButton: number): PositionLabel {
  const table = positionsFor(tableSize);
  if (!Number.isInteger(seatFromButton) || seatFromButton < 0 || seatFromButton >= tableSize) {
    throw new RangeError(
      `invalid seat: ${seatFromButton} (expected integer 0-${tableSize - 1} for table size ${tableSize})`,
    );
  }
  const label = table[seatFromButton];
  if (label === undefined) throw new RangeError(`invalid seat: ${seatFromButton}`);
  return label;
}
