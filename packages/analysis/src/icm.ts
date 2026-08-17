/**
 * ICM — the Independent Chip Model (Malmuth-Harville).
 *
 * PRD Q50: "Full ICM integration — $EV grading, live risk-premium context,
 * push/fold charts for short stacks." In a tournament, chips are not money:
 * the chips you win are worth less than the chips you lose, because the payout
 * ladder is concave. ICM is the standard way to price that.
 *
 * ## The model
 *
 * Malmuth-Harville assumes the probability a player finishes next is their
 * share of the chips still in play among the players not yet placed. So for a
 * finishing set `S` already placed:
 *
 * ```text
 * P(player i places next | S) = stack[i] / (total − stacks in S)
 * ```
 *
 * This is a model, not a law — it ignores position, blinds, skill and the fact
 * that a chip leader's stack does work a short stack's cannot. It is
 * nonetheless the industry baseline, it is what published worked examples use,
 * and the tests here pin us to one.
 *
 * ## Implementation
 *
 * The naive recursion enumerates orderings — `n!/(n−k)!` — which blows up at a
 * full final table. This uses a subset DP instead: `f[S]` = probability that
 * the players in `S` are exactly the top `|S|` finishers, computed in
 * `O(2ⁿ · n)`. `n ≤ 16` is enforced.
 *
 * Payouts are integer cents; equities are EXPECTATIONS, so they are ordinary
 * floats — the same rule `@poker/equity` follows for EV.
 */

import { assertChips } from "@poker/core";
import { type Chart, type ChartSet, NASH_HU, actionWeights, getChart, nashHuJamChartId } from "@poker/charts";

/** Largest field ICM will solve. `2^16 · 16` subset-DP steps. */
export const MAX_ICM_PLAYERS = 16;

function assertIcmInput(stacks: readonly number[], payouts: readonly number[]): void {
  if (stacks.length < 2) {
    throw new RangeError(`icm requires at least 2 players, got ${stacks.length}`);
  }
  if (stacks.length > MAX_ICM_PLAYERS) {
    throw new RangeError(`icm supports at most ${MAX_ICM_PLAYERS} players, got ${stacks.length}`);
  }
  for (const s of stacks) {
    if (!Number.isFinite(s) || s <= 0) {
      throw new RangeError(`icm stacks must all be positive, got ${s}`);
    }
  }
  if (payouts.length === 0) throw new RangeError("icm requires at least one payout");
  if (payouts.length > stacks.length) {
    throw new RangeError(
      `icm has ${payouts.length} payouts for ${stacks.length} players — more places than players`,
    );
  }
  for (const p of payouts) assertChips(p, "payout");
}

/**
 * Malmuth-Harville equity per player, in the payout's units (cents).
 *
 * `stacks[i]` is player `i`'s chip count (must be positive); `payouts[k]` is
 * the prize for finishing `k + 1`-th. Unpaid places contribute nothing.
 *
 * The returned equities always sum to the total prize pool — every prize is
 * awarded to somebody — which is a property test in `icm.test.ts`.
 */
export function icmEquities(stacks: readonly number[], payouts: readonly number[]): number[] {
  assertIcmInput(stacks, payouts);
  const n = stacks.length;
  const places = payouts.length;
  const totalChips = stacks.reduce((a, b) => a + b, 0);

  const size = 1 << n;
  // f[S] = P(the players in S are exactly the top |S| finishers, in some order)
  const f = new Float64Array(size);
  f[0] = 1;
  // sum[S] = chips held by the players in S.
  const sum = new Float64Array(size);
  for (let s = 1; s < size; s++) {
    const low = s & -s;
    const i = 31 - Math.clz32(low);
    sum[s] = (sum[s ^ low] ?? 0) + (stacks[i] ?? 0);
  }

  const equities = new Array<number>(n).fill(0);

  // Walk subsets in increasing popcount order via a simple bucket pass.
  const bySize: number[][] = [];
  for (let k = 0; k <= n; k++) bySize.push([]);
  for (let s = 0; s < size; s++) bySize[popcount(s)]?.push(s);

  for (let k = 0; k < places; k++) {
    for (const s of bySize[k] ?? []) {
      const pSet = f[s] ?? 0;
      if (pSet <= 0) continue;
      const remaining = totalChips - (sum[s] ?? 0);
      if (remaining <= 0) continue;
      const payout = payouts[k] ?? 0;
      for (let i = 0; i < n; i++) {
        if ((s >> i) & 1) continue;
        const p = pSet * ((stacks[i] ?? 0) / remaining);
        equities[i] = (equities[i] ?? 0) + p * payout;
        const next = s | (1 << i);
        f[next] = (f[next] ?? 0) + p;
      }
    }
  }
  return equities;
}

function popcount(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >> 24;
}

/**
 * $EV change for `player` between two chip configurations under the same
 * payout ladder. The workhorse behind "that call cost you $3.40 even though it
 * was chip-EV neutral".
 */
export function icmDiff(
  before: readonly number[],
  after: readonly number[],
  payouts: readonly number[],
  player: number,
): number {
  const a = icmEquities(before, payouts);
  const b = icmEquities(after, payouts);
  return (b[player] ?? 0) - (a[player] ?? 0);
}

/** An all-in decision priced in both chips and money. */
export interface IcmAllInSpot {
  payouts: readonly number[];
  /** Index of the hero in every stack array. */
  hero: number;
  /** Stacks if hero folds (blinds already posted, hero's chips unchanged). */
  stacksIfFold: readonly number[];
  /** Stacks if hero takes the all-in and wins. */
  stacksIfWin: readonly number[];
  /** Stacks if hero takes the all-in and loses. */
  stacksIfLose: readonly number[];
  /** Hero's equity in the all-in, `[0, 1]` (ties folded in as half). */
  equity: number;
}

/** Result of pricing an all-in with ICM. */
export interface IcmAllInResult {
  /** Hero's $EV when the all-in is won. */
  evWin: number;
  /** Hero's $EV when the all-in is lost. */
  evLose: number;
  /** Hero's $EV of taking the all-in. */
  evTake: number;
  /** Hero's $EV of folding. */
  evFold: number;
  /** `evTake − evFold`: positive means taking it is right in money terms. */
  diff: number;
  /** Equity the all-in needs to break even in MONEY. */
  breakEvenEquity: number;
  /** Equity the all-in needs to break even in CHIPS. */
  chipBreakEvenEquity: number;
  /**
   * Risk premium: how much extra equity ICM demands over the chip answer.
   * Positive is the normal tournament case — chips lost hurt more than chips
   * won help.
   */
  riskPremium: number;
}

/**
 * Price an all-in in money terms.
 *
 * Two-outcome model: hero wins with `equity`, loses otherwise (ties are
 * already folded into equity as half a win — good enough for a decision aid,
 * and stated rather than hidden).
 */
export function icmAllInEv(spot: IcmAllInSpot): IcmAllInResult {
  if (!Number.isFinite(spot.equity) || spot.equity < 0 || spot.equity > 1) {
    throw new RangeError(`icm equity must be a fraction in [0, 1], got ${spot.equity}`);
  }
  const hero = spot.hero;
  const evWin = icmEquities(spot.stacksIfWin, spot.payouts)[hero] ?? 0;
  const evLose = icmEquities(spot.stacksIfLose, spot.payouts)[hero] ?? 0;
  const evFold = icmEquities(spot.stacksIfFold, spot.payouts)[hero] ?? 0;
  const evTake = spot.equity * evWin + (1 - spot.equity) * evLose;

  const chipWin = spot.stacksIfWin[hero] ?? 0;
  const chipLose = spot.stacksIfLose[hero] ?? 0;
  const chipFold = spot.stacksIfFold[hero] ?? 0;
  const chipSpan = chipWin - chipLose;
  const chipBreakEvenEquity = chipSpan === 0 ? 1 : (chipFold - chipLose) / chipSpan;

  // When winning and losing are worth the same money the decision is
  // money-neutral at every equity; reporting the chip threshold keeps the risk
  // premium at zero rather than inventing a number out of a division by zero.
  const moneySpan = evWin - evLose;
  const breakEvenEquity = moneySpan === 0 ? chipBreakEvenEquity : (evFold - evLose) / moneySpan;

  return {
    evWin,
    evLose,
    evTake,
    evFold,
    diff: evTake - evFold,
    breakEvenEquity,
    chipBreakEvenEquity,
    riskPremium: breakEvenEquity - chipBreakEvenEquity,
  };
}

/** How a push/fold decision compares with the equilibrium chart. */
export type CrossCheckVerdict = "agrees" | "mixed" | "diverges" | "no-chart";

/** Result of a push/fold chart cross-check. */
export interface PushFoldCrossCheck {
  chartId?: string;
  chartSetVersion?: string;
  /** Chart jam weight (0-100) for this hand at this depth. */
  jamWeight?: number;
  /** What the chart mostly does. */
  chartAction: "jam" | "fold" | "mixed" | "unknown";
  /** What hero did. */
  taken: "jam" | "fold";
  /** Risk premium applied, `[0, 1)`. */
  riskPremium: number;
  /**
   * Jam weight required before jamming is endorsed, after the risk premium
   * tightens the threshold.
   */
  requiredWeight: number;
  verdict: CrossCheckVerdict;
  note: string;
}

/** Chart weight at which a jam is called the chart's action, before ICM. */
export const CROSS_CHECK_JAM_WEIGHT = 50;

/**
 * Cross-check a short-stack decision against the equilibrium push/fold chart,
 * optionally tightened by an ICM risk premium.
 *
 * The chip-EV chart is the baseline; a risk premium means hero needs more than
 * the chip-EV answer to justify getting it in, so the jam threshold rises. The
 * tightening is linear in the risk premium and is a HEURISTIC bridge between a
 * chip-EV chart and a money spot — a real ICM-Nash solve is a different
 * artefact. It is labelled as such in `note` so no surface can present it as
 * an equilibrium.
 */
export function pushFoldCrossCheck(params: {
  depthBb: number;
  /** Canonical 169 index or label ("AA", "AKs", "T9o"). */
  hand: number | string;
  taken: "jam" | "fold";
  chartSet?: ChartSet;
  /** Chart id override; defaults to the heads-up Nash SB jam chart. */
  chartId?: string;
  /** ICM risk premium, `[0, 1)` — typically from {@link icmAllInEv}. */
  riskPremium?: number;
}): PushFoldCrossCheck {
  const set = params.chartSet ?? NASH_HU;
  const riskPremium = Math.max(0, Math.min(0.99, params.riskPremium ?? 0));
  const chartId = params.chartId ?? nashHuJamChartId(nearestDepth(set, params.depthBb));
  const chart: Chart | undefined = getChart(set, chartId);
  if (chart === undefined) {
    return {
      chartAction: "unknown",
      taken: params.taken,
      riskPremium,
      requiredWeight: CROSS_CHECK_JAM_WEIGHT,
      verdict: "no-chart",
      note: `no push/fold chart ${chartId} in this set — nothing to cross-check against`,
    };
  }
  const jamWeight = actionWeights(set, chartId, params.hand);
  // A risk premium tightens the jam threshold toward "only clear jams".
  const requiredWeight =
    CROSS_CHECK_JAM_WEIGHT + riskPremium * (100 - CROSS_CHECK_JAM_WEIGHT);
  const chartAction: "jam" | "fold" | "mixed" =
    jamWeight >= 90 ? "jam" : jamWeight <= 10 ? "fold" : "mixed";

  const endorsed = jamWeight >= requiredWeight;
  const verdict: CrossCheckVerdict =
    chartAction === "mixed" && riskPremium === 0
      ? "mixed"
      : (params.taken === "jam") === endorsed
        ? "agrees"
        : "diverges";

  const premiumNote =
    riskPremium > 0
      ? `; an ICM risk premium of ${(riskPremium * 100).toFixed(0)}% raises the jam threshold to ${requiredWeight.toFixed(0)}% (heuristic tightening of a chip-EV chart, not an ICM-Nash solve)`
      : "";
  return {
    chartId,
    chartSetVersion: set.version,
    jamWeight,
    chartAction,
    taken: params.taken,
    riskPremium,
    requiredWeight,
    verdict,
    note: `${chart.id} jams this hand ${jamWeight}% at ${chart.depthBb}bb${premiumNote}`,
  };
}

/** Nearest depth present in a chart set (by `depthBb`), for chart lookup. */
function nearestDepth(set: ChartSet, depthBb: number): number {
  let best = depthBb;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of set.charts) {
    const d = Math.abs(c.depthBb - depthBb);
    if (d < bestDist || (d === bestDist && c.depthBb > best)) {
      best = c.depthBb;
      bestDist = d;
    }
  }
  return Number.isFinite(bestDist) ? best : depthBb;
}
