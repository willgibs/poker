/**
 * Monte Carlo equity with fixed trial counts (never time-boxed, per the
 * determinism rules). All randomness comes from the injected RngStream;
 * identical (inputs, stream seed, trials) always produce identical results.
 */

import { DECK_SIZE, type Card } from "@poker/core";
import type { RngStream } from "@poker/rng";
import {
  type EquityResult,
  type Evaluate7,
  type SamplableRange,
  assertTrials,
  deadFlagsFor,
  liveCardsFrom,
  samplableRangeOf,
  sampleIndex,
} from "./common";

/** Attempt cap per trial for multiway disjoint-combo rejection sampling. */
const MAX_TUPLE_ATTEMPTS = 1000;

/**
 * Monte Carlo equity of `hero` vs a weighted `range` on a 0-5 card board.
 *
 * Per trial the villain combo is drawn proportionally to its weight
 * (cumulative-sum inverse-CDF with binary search over unblocked combos),
 * then the runout is drawn without replacement from the remaining deck via
 * a partial Fisher-Yates shuffle. Cost: exactly `2 * trials` evaluate7 calls.
 *
 * Stream consumption per trial (deterministic): one `nextFloat` for the
 * combo, then `5 - board.length` `nextInt` draws for the runout (each
 * `nextInt` may consume several raw u32s via rejection sampling, but is
 * itself deterministic).
 *
 * Throws RangeError on invalid input or when the range has no unblocked
 * combo with positive weight.
 */
export function equityVsRangeMC(
  hero: readonly [Card, Card],
  range: Float32Array,
  board: readonly Card[],
  evaluate7: Evaluate7,
  stream: RngStream,
  trials: number,
): EquityResult {
  const boardLen = board.length;
  if (boardLen > 5) {
    throw new RangeError(`equityVsRangeMC requires a 0-5 card board, got ${boardLen}`);
  }
  assertTrials(trials);
  const dead = deadFlagsFor(hero, board);
  const sampler = samplableRangeOf(range, dead);
  if (sampler === null) {
    throw new RangeError("equityVsRangeMC: range has no unblocked combo with positive weight");
  }
  const live = liveCardsFrom(dead);
  const posInLive = new Int32Array(DECK_SIZE).fill(-1);
  for (let i = 0; i < live.length; i++) posInLive[live[i] ?? 0] = i;

  const need = 5 - boardLen;
  const h0 = hero[0];
  const h1 = hero[1];
  const cards7 = new Array<number>(7).fill(0);
  for (let i = 0; i < boardLen; i++) cards7[2 + i] = board[i] ?? 0;
  const scratch = live.slice(); // reused per-trial runout buffer

  let wins = 0;
  let ties = 0;

  for (let t = 0; t < trials; t++) {
    const u = stream.nextFloat() * sampler.total;
    const k = sampleIndex(sampler.cum, u);
    const va = sampler.a[k] ?? 0;
    const vb = sampler.b[k] ?? 0;

    if (need > 0) {
      // scratch = live minus the villain's two cards (swap-remove), then a
      // partial Fisher-Yates draw of `need` cards.
      for (let i = 0; i < live.length; i++) scratch[i] = live[i] ?? 0;
      let len = live.length;
      const ia = posInLive[va] ?? 0;
      len -= 1;
      scratch[ia] = scratch[len] ?? 0;
      let ib = posInLive[vb] ?? 0;
      if (ib === len) ib = ia; // vb had been moved into va's slot
      len -= 1;
      scratch[ib] = scratch[len] ?? 0;
      for (let d = 0; d < need; d++) {
        const j = d + stream.nextInt(len - d);
        const tmp = scratch[d] ?? 0;
        scratch[d] = scratch[j] ?? 0;
        scratch[j] = tmp;
        cards7[2 + boardLen + d] = scratch[d] ?? 0;
      }
    }

    cards7[0] = h0;
    cards7[1] = h1;
    const heroVal = evaluate7(cards7);
    cards7[0] = va;
    cards7[1] = vb;
    const villainVal = evaluate7(cards7);
    if (heroVal < villainVal) wins++;
    else if (heroVal === villainVal) ties++;
  }

  return {
    win: wins / trials,
    tie: ties / trials,
    equity: (wins + ties / 2) / trials,
  };
}

/**
 * Monte Carlo equity of `hero` against multiple weighted villain ranges
 * (one per live villain) on a 0-5 card board.
 *
 * Villain combos are drawn jointly by whole-tuple rejection: each villain's
 * combo is sampled independently by weight, and if any two villains collide
 * the entire tuple is redrawn. The accepted tuple distribution is therefore
 * exactly proportional to the product of combo weights over card-disjoint
 * tuples. A trial throws (Error) after {@link MAX_TUPLE_ATTEMPTS} failed
 * attempts — only reachable with pathologically narrow, conflicting ranges.
 *
 * `equity` is hero's expected pot share with exact tie splitting: an
 * outright win scores 1, a tie with `m` villains scores `1 / (1 + m)`.
 * `win`/`tie` are the fractions of trials hero won outright / tied for best.
 *
 * Stream consumption per trial (deterministic): one `nextFloat` per villain
 * per tuple attempt (villains sampled in range order; an attempt stops at
 * the first collision), then `5 - board.length` `nextInt` runout draws.
 *
 * Cost: `(1 + ranges.length) * trials` evaluate7 calls (plus rejected
 * attempts, which cost no evaluations).
 */
export function multiwayEquityMC(
  hero: readonly [Card, Card],
  ranges: readonly Float32Array[],
  board: readonly Card[],
  evaluate7: Evaluate7,
  stream: RngStream,
  trials: number,
): EquityResult {
  const boardLen = board.length;
  if (boardLen > 5) {
    throw new RangeError(`multiwayEquityMC requires a 0-5 card board, got ${boardLen}`);
  }
  assertTrials(trials);
  if (ranges.length < 1) {
    throw new RangeError("multiwayEquityMC requires at least one villain range");
  }
  const dead = deadFlagsFor(hero, board);
  const live = liveCardsFrom(dead);
  const n = ranges.length;
  const need = 5 - boardLen;
  if (live.length - 2 * n < need) {
    throw new RangeError(
      `multiwayEquityMC: not enough cards for ${n} villains plus a ${need}-card runout`,
    );
  }
  const samplers: SamplableRange[] = [];
  for (let v = 0; v < n; v++) {
    const r = ranges[v];
    if (r === undefined) throw new RangeError(`multiwayEquityMC: missing range at index ${v}`);
    const sampler = samplableRangeOf(r, dead);
    if (sampler === null) {
      throw new RangeError(
        `multiwayEquityMC: range ${v} has no unblocked combo with positive weight`,
      );
    }
    samplers.push(sampler);
  }

  const h0 = hero[0];
  const h1 = hero[1];
  const cards7 = new Array<number>(7).fill(0);
  for (let i = 0; i < boardLen; i++) cards7[2 + i] = board[i] ?? 0;
  const used = new Uint8Array(DECK_SIZE);
  const va = new Array<number>(n).fill(0);
  const vb = new Array<number>(n).fill(0);
  const scratch = live.slice();

  let wins = 0;
  let ties = 0;
  let equitySum = 0;

  for (let t = 0; t < trials; t++) {
    // Whole-tuple rejection sampling of disjoint villain combos.
    let ok = false;
    for (let attempt = 0; attempt < MAX_TUPLE_ATTEMPTS && !ok; attempt++) {
      ok = true;
      let assigned = 0;
      for (let v = 0; v < n; v++) {
        const smp = samplers[v] as SamplableRange;
        const u = stream.nextFloat() * smp.total;
        const k = sampleIndex(smp.cum, u);
        const ca = smp.a[k] ?? 0;
        const cb = smp.b[k] ?? 0;
        if (used[ca] === 1 || used[cb] === 1) {
          ok = false;
          break;
        }
        used[ca] = 1;
        used[cb] = 1;
        va[v] = ca;
        vb[v] = cb;
        assigned = v + 1;
      }
      if (!ok) {
        for (let v = 0; v < assigned; v++) {
          used[va[v] ?? 0] = 0;
          used[vb[v] ?? 0] = 0;
        }
      }
    }
    if (!ok) {
      throw new Error(
        `multiwayEquityMC: failed to sample disjoint villain combos after ${MAX_TUPLE_ATTEMPTS} attempts`,
      );
    }

    if (need > 0) {
      let len = 0;
      for (const c of live) {
        if (used[c] !== 1) {
          scratch[len] = c;
          len++;
        }
      }
      for (let d = 0; d < need; d++) {
        const j = d + stream.nextInt(len - d);
        const tmp = scratch[d] ?? 0;
        scratch[d] = scratch[j] ?? 0;
        scratch[j] = tmp;
        cards7[2 + boardLen + d] = scratch[d] ?? 0;
      }
    }

    for (let v = 0; v < n; v++) {
      used[va[v] ?? 0] = 0;
      used[vb[v] ?? 0] = 0;
    }

    cards7[0] = h0;
    cards7[1] = h1;
    const heroVal = evaluate7(cards7);
    let bestVillain = Number.POSITIVE_INFINITY;
    let tiedWithBest = 0;
    for (let v = 0; v < n; v++) {
      cards7[0] = va[v] ?? 0;
      cards7[1] = vb[v] ?? 0;
      const val = evaluate7(cards7);
      if (val < bestVillain) {
        bestVillain = val;
        tiedWithBest = 1;
      } else if (val === bestVillain) {
        tiedWithBest++;
      }
    }
    if (heroVal < bestVillain) {
      wins++;
      equitySum += 1;
    } else if (heroVal === bestVillain) {
      ties++;
      equitySum += 1 / (1 + tiedWithBest);
    }
  }

  return { win: wins / trials, tie: ties / trials, equity: equitySum / trials };
}
