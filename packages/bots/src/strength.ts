/**
 * Stage 3 — tier-dependent strength estimate.
 *
 * This is where the skill ladder becomes real, and the three rungs are exactly
 * the ones the PRD names:
 *
 * - **Whales (tiers 1-2)** measure raw strength against a random hand. Barry's
 *   "I have a pair" is a complete thought; he is not weighing it against what
 *   you would bet with.
 * - **Mid (tiers 3-4)** run Monte Carlo against the FILTERED range from stage
 *   2 — small fixed trial counts drawn from the bot's own `mc` stream, so a
 *   bot's read is reproducible and its noise is characterisation, not a bug.
 * - **Top (tiers 5-6)** add a blocker adjustment: holding a card that removes
 *   the villain's value combos is worth equity, capped so blockers stay a
 *   tiebreaker rather than a strategy.
 *
 * Trial counts come from the tier envelope and are never time-boxed
 * (docs/architecture.md: fixed iteration counts only).
 */

import { ALL_COMBOS, comboIndex, type Card } from "@poker/core";
import { equityVsRangeMC } from "@poker/equity";
import { RANGE_SIZE, type WeightedRange } from "@poker/ranges";
import type { RngStream } from "@poker/rng";
import { holdingFeatures } from "./handclass";
import { capabilitiesFor, envelopeFor, type PersonaConfig } from "./persona";
import type { DecisionContext } from "./context";
import type { RangeState } from "./rangeState";
import type { StrengthTrace } from "./trace";

/** Percentile above which a combo counts as the villain's "value" region. */
export const VALUE_PERCENTILE = 0.8;

/** Maximum equity swing a blocker read may produce, in equity points. */
export const MAX_BLOCKER_ADJUSTMENT = 0.05;

export interface StrengthEstimate {
  /** Equity used by stage 4 (post-blocker). */
  equity: number;
  /** Percentile of the bot's holding on this board, [0, 1]. */
  strengthPercentile: number;
  trace: StrengthTrace;
}

/**
 * Fraction of the villain's value combos that the bot's two cards remove.
 *
 * The value region is every combo above {@link VALUE_PERCENTILE} that the
 * board does not already block (board-blocked combos carry percentile 0 and so
 * never qualify). 0.5 is the neutral expectation; above that the bot holds
 * more than its share of the cards the villain needs.
 */
export function valueBlockedFraction(
  strength: Float32Array,
  hole: readonly [Card, Card],
  board: readonly Card[],
): number {
  const dead = new Set<Card>(board);
  let valueCombos = 0;
  let valueWithHero = 0;
  let liveCombos = 0;
  let liveWithHero = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const combo = ALL_COMBOS[i] as readonly [Card, Card];
    if (dead.has(combo[0]) || dead.has(combo[1])) continue;
    const holdsHero =
      combo[0] === hole[0] || combo[0] === hole[1] || combo[1] === hole[0] || combo[1] === hole[1];
    liveCombos++;
    if (holdsHero) liveWithHero++;
    if ((strength[i] ?? 0) < VALUE_PERCENTILE) continue;
    valueCombos++;
    if (holdsHero) valueWithHero++;
  }
  if (valueCombos === 0 || liveCombos === 0 || liveWithHero === 0) return 0.5;
  // Baseline: the share of ALL live combos the bot's two cards remove. The
  // value region's share is compared against that, so 0.5 means "exactly the
  // expected share" and 1 means "twice the expected share or more".
  const expected = liveWithHero / liveCombos;
  const observed = valueWithHero / valueCombos;
  return Math.max(0, Math.min(1, 0.5 * (observed / expected)));
}

/** Run stage 3. */
export function estimateStrength(
  ctx: DecisionContext,
  persona: PersonaConfig,
  rangeState: RangeState,
  mc: RngStream,
): StrengthEstimate {
  const caps = capabilitiesFor(persona.tier);
  const trials = envelopeFor(persona.tier).mcTrials;
  const strengthNow = rangeState.strength.forStreet(ctx.street);
  const features = holdingFeatures(ctx.hole, ctx.board);
  const strengthPercentile = strengthNow[comboIndex(ctx.hole[0], ctx.hole[1])] ?? 0;

  const equityRaw = monteCarloEquity(ctx, rangeState.primary, mc, trials);
  const method: StrengthTrace["method"] = !caps.usesRangeFiltering
    ? "raw-vs-random"
    : caps.usesBlockers
      ? "mc-vs-range-blockers"
      : "mc-vs-range";

  let blockerAdjustment = 0;
  let valueBlocked = 0;
  if (caps.usesBlockers) {
    valueBlocked = valueBlockedFraction(strengthNow, ctx.hole, ctx.board);
    blockerAdjustment = (valueBlocked - 0.5) * 2 * MAX_BLOCKER_ADJUSTMENT;
    blockerAdjustment = Math.max(-MAX_BLOCKER_ADJUSTMENT, Math.min(MAX_BLOCKER_ADJUSTMENT, blockerAdjustment));
  }

  const equity = Math.max(0, Math.min(1, equityRaw + blockerAdjustment));

  return {
    equity,
    strengthPercentile,
    trace: {
      method,
      trials,
      equityRaw,
      equity,
      blockerAdjustment,
      valueBlocked,
      strengthPercentile,
      made: features.made,
      flushDraw: features.flushDraw,
      oesd: features.oesd,
      gutshot: features.gutshot,
      outs: features.outs,
    },
  };
}

/**
 * Fixed-trial Monte Carlo against `range`, degrading to a coin flip rather
 * than throwing: a posterior can collapse when the policy model and the
 * observed line disagree badly, and a bot that shrugs is strictly better than
 * a bot that crashes a hand in progress.
 */
function monteCarloEquity(
  ctx: DecisionContext,
  range: WeightedRange,
  mc: RngStream,
  trials: number,
): number {
  let live = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    if ((range[i] as number) > 0) {
      live++;
      if (live > 1) break;
    }
  }
  if (live === 0) return 0.5;
  try {
    return equityVsRangeMC(ctx.hole, range, ctx.board, ctx.evaluate7, mc, trials).equity;
  } catch {
    return 0.5;
  }
}
