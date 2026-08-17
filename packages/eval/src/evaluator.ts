import { FLUSH, NOFLUSH, DPH } from "./tables";

/**
 * Evaluate a 7-card poker hand.
 *
 * Signature: SEVEN SEPARATE number arguments (card ints 0-51, any order,
 * assumed distinct and valid — no validation in the hot path). Chosen over a
 * `readonly number[]` parameter deliberately: callers never allocate a
 * wrapper array, V8 keeps the call site monomorphic with all args in
 * registers, and equity/enumeration loops can feed cards straight from their
 * own loop variables.
 *
 * Returns the hand's equivalence class 1..7462 over the standard 5-card
 * classes — LOWER = STRONGER (1 = royal flush, 7462 = 7-5-4-3-2 offsuit).
 *
 * Scheme (phevaluator-style two-table lookup, built from first principles):
 * count suits with 3-bit packed counters; if any suit has >=5 cards the best
 * hand is necessarily a flush/straight-flush in that suit (with 7 cards,
 * quads/full house cannot coexist with a 5-card suit), so index FLUSH with
 * that suit's 13-bit rank mask. Otherwise perfect-hash the quinary
 * rank-count vector (13 counts 0..4 summing to 7) via a DP offset table and
 * index NOFLUSH. Zero allocation, no branches beyond the suit test.
 */
export function evaluate7(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  c5: number,
  c6: number,
): number {
  // Packed suit counters: 3 bits per suit (max count 7 fits).
  const sc =
    (1 << ((c0 & 3) * 3)) +
    (1 << ((c1 & 3) * 3)) +
    (1 << ((c2 & 3) * 3)) +
    (1 << ((c3 & 3) * 3)) +
    (1 << ((c4 & 3) * 3)) +
    (1 << ((c5 & 3) * 3)) +
    (1 << ((c6 & 3) * 3));

  let flushSuit = -1;
  if ((sc & 7) >= 5) flushSuit = 0;
  else if (((sc >> 3) & 7) >= 5) flushSuit = 1;
  else if (((sc >> 6) & 7) >= 5) flushSuit = 2;
  else if (((sc >> 9) & 7) >= 5) flushSuit = 3;

  if (flushSuit >= 0) {
    let m = 0;
    if ((c0 & 3) === flushSuit) m |= 1 << (c0 >> 2);
    if ((c1 & 3) === flushSuit) m |= 1 << (c1 >> 2);
    if ((c2 & 3) === flushSuit) m |= 1 << (c2 >> 2);
    if ((c3 & 3) === flushSuit) m |= 1 << (c3 >> 2);
    if ((c4 & 3) === flushSuit) m |= 1 << (c4 >> 2);
    if ((c5 & 3) === flushSuit) m |= 1 << (c5 >> 2);
    if ((c6 & 3) === flushSuit) m |= 1 << (c6 >> 2);
    return FLUSH[m]!;
  }

  // Rank counts as packed nibbles: lo = ranks 0-7, hi = ranks 8-12.
  // Counts are <=4 so nibbles never carry.
  let lo = 0;
  let hi = 0;
  const r0 = c0 >> 2;
  if (r0 < 8) lo += 1 << (r0 << 2);
  else hi += 1 << ((r0 - 8) << 2);
  const r1 = c1 >> 2;
  if (r1 < 8) lo += 1 << (r1 << 2);
  else hi += 1 << ((r1 - 8) << 2);
  const r2 = c2 >> 2;
  if (r2 < 8) lo += 1 << (r2 << 2);
  else hi += 1 << ((r2 - 8) << 2);
  const r3 = c3 >> 2;
  if (r3 < 8) lo += 1 << (r3 << 2);
  else hi += 1 << ((r3 - 8) << 2);
  const r4 = c4 >> 2;
  if (r4 < 8) lo += 1 << (r4 << 2);
  else hi += 1 << ((r4 - 8) << 2);
  const r5 = c5 >> 2;
  if (r5 < 8) lo += 1 << (r5 << 2);
  else hi += 1 << ((r5 - 8) << 2);
  const r6 = c6 >> 2;
  if (r6 < 8) lo += 1 << (r6 << 2);
  else hi += 1 << ((r6 - 8) << 2);

  // Perfect hash: lexicographic rank of the quinary count vector.
  let idx = 0;
  let s = 0;
  let off = 0;
  for (let i = 0; i < 8; i++) {
    const q = (lo >>> (i << 2)) & 15;
    idx += DPH[off + s * 5 + q]!;
    s += q;
    off += 40;
  }
  for (let i = 0; i < 5; i++) {
    const q = (hi >>> (i << 2)) & 15;
    idx += DPH[off + s * 5 + q]!;
    s += q;
    off += 40;
  }
  return NOFLUSH[idx]!;
}
