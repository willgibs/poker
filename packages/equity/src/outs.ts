/**
 * Outs counter for the beginner-facing layer.
 *
 * Definition (honest and simple, documented rather than clever): hero is
 * *drawing* iff hero's current hand does not already beat the current
 * "board-best" benchmark (`proxyNow <= heroNow`); when not drawing the
 * answer is `[]`. While drawing, a live card `c` is an **out** iff it moves
 * hero from *not beating* to *beating* the benchmark as it stands after `c`:
 *
 *   out(c)  <=>  heroAfter(c) < proxyAfter(c) <= heroNow
 *
 * where lower = stronger (injected evaluate7 order), and
 *
 * - `heroNow` — hero's current strength: hero's two cards + board, with the
 *   unknown future cards filled by the *weakest* completions (exact: max over
 *   all live fillers). This is hero's guaranteed floor today.
 * - `proxyAfter(c)` — the benchmark after `c` arrives: a heuristic villain
 *   holding **top pair of the board** — one live card of the highest board
 *   rank plus a deliberately blank low kicker — evaluated on board + `c`.
 *   If no live card of any board rank exists, the proxy holds two blanks
 *   (the board's own hand).
 * - `heroAfter(c)` — hero's strength on board + `c` (again weakest-filled).
 *
 * Consequences (all deliberate):
 * - Strict improvement is implied (`heroAfter < heroNow` follows from the
 *   inequality chain), so no-op cards never count.
 * - Board-pairing cards that help every player equally are not outs (the
 *   proxy's hand improves too).
 * - Kicker-only "improvements" (e.g. overcard turns bare-kicker upgrades)
 *   are not outs unless they actually beat top pair.
 * - When hero already beats the current benchmark (an overpair, a set, top
 *   pair better kicker...), the result is `[]` — hero is not drawing, outs
 *   do not apply, even if hero could still improve further.
 * - The count is not range-aware: dirty/tainted outs (cards that also
 *   improve a real villain to something better) are still counted. That is
 *   the classic beginner simplification and it is documented in the UI layer.
 *
 * Classic sanity checks that fall out of this definition: a flush draw has 9
 * outs, an open-ended straight draw 8, two overcards 6, a pocket pair below
 * top pair 2 (its set cards).
 *
 * Cost in evaluate7 calls (L = live cards, 47 on the flop / 46 on the turn):
 * - board of 4: `L` (heroNow) + per candidate `1 + 1`      ≈ 140 evals
 * - board of 3: `C(L,2)` (heroNow) + per candidate `~2L`   ≈ 5.5k evals
 *
 * Deterministic: a pure function of its inputs.
 */

import { type Card, rankOf, suitOf } from "@poker/core";
import { type Evaluate7, deadFlagsFor, liveCardsFrom } from "./common";

/** Rank bitmasks of the ten straight windows (wheel A-5 first). */
const STRAIGHT_WINDOWS: readonly number[] = (() => {
  const windows: number[] = [0b1_0000_0000_1111]; // A,2,3,4,5 -> ranks {12,0,1,2,3}
  for (let hi = 4; hi <= 12; hi++) windows.push(0b11111 << (hi - 4));
  return windows;
})();

/**
 * Cards that improve hero to a hand beating the current board-best heuristic
 * (top pair of the board with a blank kicker). Board must have 3 or 4 cards.
 * Returns the outs ascending by card int. See the module doc for the exact
 * definition and its caveats.
 */
export function outs(
  hero: readonly [Card, Card],
  board: readonly Card[],
  evaluate7: Evaluate7,
): Card[] {
  const boardLen = board.length;
  if (boardLen !== 3 && boardLen !== 4) {
    throw new RangeError(`outs requires a 3 or 4 card board, got ${boardLen}`);
  }
  const dead = deadFlagsFor(hero, board);
  const live = liveCardsFrom(dead);
  const cards7 = new Array<number>(7).fill(0);

  /** Evaluate [p0, p1, board, extra?, fillers?]; slots must total 7. */
  const evalWith = (p0: number, p1: number, extra: number, f1: number, f2: number): number => {
    cards7[0] = p0;
    cards7[1] = p1;
    for (let i = 0; i < boardLen; i++) cards7[2 + i] = board[i] ?? 0;
    let idx = 2 + boardLen;
    if (extra >= 0) {
      cards7[idx] = extra;
      idx++;
    }
    if (f1 >= 0) {
      cards7[idx] = f1;
      idx++;
    }
    if (f2 >= 0) {
      cards7[idx] = f2;
      idx++;
    }
    return evaluate7(cards7);
  };

  /**
   * Strength of the holding (p0, p1) on board (+ optional extra card), with
   * any remaining slots filled by the *weakest* live completions — exact via
   * max over all fillers (numeric max = weakest, lower = stronger). This
   * equals the holding's current best five-card hand as long as some filler
   * adds nothing, which always holds with 44+ live cards.
   */
  const strengthOf = (p0: number, p1: number, extra: number): number => {
    const slots = 5 - boardLen - (extra >= 0 ? 1 : 0);
    if (slots === 0) return evalWith(p0, p1, extra, -1, -1);
    let weakest = Number.NEGATIVE_INFINITY;
    if (slots === 1) {
      for (const z of live) {
        if (z === extra || z === p0 || z === p1) continue;
        const v = evalWith(p0, p1, extra, z, -1);
        if (v > weakest) weakest = v;
      }
    } else {
      for (let i = 0; i < live.length; i++) {
        const z1 = live[i] ?? 0;
        if (z1 === extra || z1 === p0 || z1 === p1) continue;
        for (let j = i + 1; j < live.length; j++) {
          const z2 = live[j] ?? 0;
          if (z2 === extra || z2 === p0 || z2 === p1) continue;
          const v = evalWith(p0, p1, extra, z1, z2);
          if (v > weakest) weakest = v;
        }
      }
    }
    return weakest;
  };

  const h0 = hero[0];
  const h1 = hero[1];
  const heroNow = strengthOf(h0, h1, -1);

  // Not drawing? Hero already beats the current benchmark -> no outs.
  {
    const proxyCardNow = pickProxyCard(live, board, -1);
    let p0: number;
    let p1: number;
    if (proxyCardNow >= 0) {
      p0 = proxyCardNow;
      p1 = pickBlank(live, [...board, proxyCardNow]);
    } else {
      p0 = pickBlank(live, [...board]);
      p1 = pickBlank(live, [...board, p0]);
    }
    const proxyNow = strengthOf(p0, p1, -1);
    if (heroNow < proxyNow) return [];
  }

  const result: Card[] = [];
  for (const c of live) {
    const heroAfter = strengthOf(h0, h1, c);
    if (heroAfter >= heroNow) continue; // no strict improvement (also implied below)
    const proxyCard = pickProxyCard(live, board, c);
    const ctx: number[] = [...board, c];
    let p0: number;
    let p1: number;
    if (proxyCard >= 0) {
      p0 = proxyCard;
      p1 = pickBlank(live, [...ctx, proxyCard]);
    } else {
      p0 = pickBlank(live, ctx);
      p1 = pickBlank(live, [...ctx, p0]);
    }
    const proxyAfter = strengthOf(p0, p1, c);
    if (heroAfter < proxyAfter && proxyAfter <= heroNow) result.push(c);
  }
  return result.sort((x, y) => x - y);
}

/**
 * One live card of the highest board rank that still has a live card
 * (excluding candidate `c`), preferring the suit least represented on
 * board + c to avoid gifting the proxy accidental flush strength.
 * Returns -1 when every board rank is exhausted.
 */
function pickProxyCard(live: readonly Card[], board: readonly Card[], c: Card): number {
  const boardRanks = [...new Set(board.map((x) => rankOf(x) as number))].sort((x, y) => y - x);
  for (const r of boardRanks) {
    let best = -1;
    let bestSuitCount = Number.POSITIVE_INFINITY;
    for (const cand of live) {
      if (cand === c || rankOf(cand) !== r) continue;
      const s = suitOf(cand);
      let suitCount = suitOf(c) === s ? 1 : 0;
      for (const bc of board) if (suitOf(bc) === s) suitCount++;
      if (suitCount < bestSuitCount) {
        bestSuitCount = suitCount;
        best = cand;
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Lowest live card that adds nothing to `ctx`: pairs no ctx rank, cannot
 * complete a five-card flush, completes no new straight window. Falls back
 * to the lowest non-ctx live card in the (practically unreachable) case
 * where no card qualifies.
 */
function pickBlank(live: readonly Card[], ctx: readonly number[]): Card {
  let ctxMask = 0;
  const suitCounts = [0, 0, 0, 0];
  for (const x of ctx) {
    ctxMask |= 1 << rankOf(x);
    const s = suitOf(x);
    suitCounts[s] = (suitCounts[s] ?? 0) + 1;
  }
  for (const cand of live) {
    if (ctx.includes(cand)) continue;
    const r = rankOf(cand);
    if ((ctxMask & (1 << r)) !== 0) continue;
    if ((suitCounts[suitOf(cand)] ?? 0) >= 4) continue;
    const newMask = ctxMask | (1 << r);
    let completes = false;
    for (const w of STRAIGHT_WINDOWS) {
      if ((newMask & w) === w && (ctxMask & w) !== w) {
        completes = true;
        break;
      }
    }
    if (!completes) return cand;
  }
  for (const cand of live) {
    if (!ctx.includes(cand)) return cand;
  }
  throw new Error("outs: deck exhausted while picking a blank card"); // unreachable
}
