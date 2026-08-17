/**
 * @packageDocumentation
 * # @poker/ranges — weighted-range model
 *
 * The shared range representation for bots and analysis: a
 * {@link WeightedRange} is a `Float32Array(1326)` of per-combo weights in
 * [0, 1] over the canonical combo order from `@poker/core`.
 *
 * - `range.ts` — vector ops: construction, normalize, card-removal masking,
 *   169-grid expansion/aggregation, blending.
 * - `ranking.ts` — {@link DEFAULT_PREFLOP_RANKING}, the strongest-first
 *   ordering of the 169 classes used for soft percentile thresholds.
 * - `distort.ts` — persona distortion: topPercentByRanking, tighten,
 *   aggressionTransfer, polarize.
 * - `filter.ts` — Bayesian action {@link filter} (bot policy as generative
 *   model, range estimation as its inverse).
 *
 * Chart grids arrive as plain `ArrayLike<number>` of 169 weights; this
 * package stays decoupled from `@poker/charts`.
 */

export type { WeightedRange } from "./range";
export {
  RANGE_SIZE,
  GRID_SIZE,
  CLASS_OF_COMBO,
  COMBOS_OF_CLASS,
  CLASS_COMBO_COUNT,
  createRange,
  fullRange,
  clone,
  total,
  normalize,
  maskBlocked,
  fromGrid169,
  toGrid169,
  combine,
} from "./range";

export type { BranchPair } from "./distort";
export {
  TIGHTEN_MAX_EXPONENT,
  DEFAULT_EDGE_SOFTNESS,
  POLARIZE_BOTTOM_FRACTION,
  rankingMidpoints,
  topPercentByRanking,
  tighten,
  aggressionTransfer,
  polarize,
} from "./distort";

export { filter } from "./filter";

export { DEFAULT_PREFLOP_RANKING } from "./ranking";
