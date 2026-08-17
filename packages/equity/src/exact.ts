/**
 * Exact equity by full enumeration.
 */

import type { Card } from "@poker/core";
import {
  type EquityResult,
  type Evaluate7,
  activeCombosOf,
  deadFlagsFor,
  liveCardsFrom,
} from "./common";

/**
 * Exact equity of `hero` against a weighted villain `range` on a 3-5 card
 * board, by enumerating every remaining runout x every unblocked
 * positive-weight villain combo.
 *
 * Semantics: each compatible (villain combo, runout) pair is counted once
 * with the combo's weight; combos blocked by hero/board (or by the runout
 * being enumerated) contribute zero. `win`/`tie` are weighted fractions of
 * that enumeration; `equity = win + tie / 2` (heads-up ties split the pot).
 *
 * Complexity, measured in `evaluate7` calls, with K = unblocked
 * positive-weight combos (K <= 1326) and 45/44 live cards behind a
 * 3/4-card board:
 * - river (board 5): `1 + K`               — worst case ~1.3k evals
 * - turn  (board 4): `44 * (1 + K)`        — worst case ~58k evals
 * - flop  (board 3): `C(45,2)=990 runouts` → `990 * (1 + K)` — worst case
 *   ~1.3M evals (hero is evaluated once per runout, villains once per pair)
 *
 * Throws RangeError on invalid input or when the range has no unblocked
 * combo with positive weight.
 */
export function equityVsRange(
  hero: readonly [Card, Card],
  range: Float32Array,
  board: readonly Card[],
  evaluate7: Evaluate7,
): EquityResult {
  const boardLen = board.length;
  if (boardLen < 3 || boardLen > 5) {
    throw new RangeError(
      `equityVsRange requires a 3-5 card board, got ${boardLen} (use equityVsRangeMC preflop)`,
    );
  }
  const dead = deadFlagsFor(hero, board);
  const { a, b, w, count } = activeCombosOf(range, dead);
  if (count === 0) {
    throw new RangeError("equityVsRange: range has no unblocked combo with positive weight");
  }
  const live = liveCardsFrom(dead);
  const need = 5 - boardLen;
  const h0 = hero[0];
  const h1 = hero[1];

  // Scratch layout: [holeA, holeB, board..., runout...].
  const cards7 = new Array<number>(7).fill(0);
  for (let i = 0; i < boardLen; i++) cards7[2 + i] = board[i] ?? 0;

  let win = 0;
  let tie = 0;
  let total = 0;

  /** Tally all unblocked combos for the runout currently in cards7[5..6]. */
  const tallyRunout = (r1: number, r2: number): void => {
    cards7[0] = h0;
    cards7[1] = h1;
    const heroVal = evaluate7(cards7);
    for (let k = 0; k < count; k++) {
      const va = a[k] ?? 0;
      const vb = b[k] ?? 0;
      if (va === r1 || va === r2 || vb === r1 || vb === r2) continue; // blocked by runout
      const wk = w[k] ?? 0;
      cards7[0] = va;
      cards7[1] = vb;
      const villainVal = evaluate7(cards7);
      total += wk;
      if (heroVal < villainVal) win += wk;
      else if (heroVal === villainVal) tie += wk;
    }
  };

  if (need === 0) {
    tallyRunout(-1, -1);
  } else if (need === 1) {
    for (const r of live) {
      cards7[6] = r;
      tallyRunout(r, -1);
    }
  } else {
    for (let i = 0; i < live.length; i++) {
      const r1 = live[i] ?? 0;
      cards7[5] = r1;
      for (let j = i + 1; j < live.length; j++) {
        const r2 = live[j] ?? 0;
        cards7[6] = r2;
        tallyRunout(r1, r2);
      }
    }
  }

  if (total <= 0) {
    // Unreachable with count > 0 and need <= 2, kept as a correctness guard.
    throw new RangeError("equityVsRange: no compatible (combo, runout) pair");
  }
  return { win: win / total, tie: tie / total, equity: (win + tie / 2) / total };
}
