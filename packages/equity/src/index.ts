/**
 * @packageDocumentation
 * # @poker/equity — exact & Monte Carlo equity, EV helpers, outs
 *
 * Zero-runtime-dependency equity engine. Three rules shape every API here:
 *
 * 1. **Evaluation is injected.** This package never imports a hand
 *    evaluator; every public function takes an {@link Evaluate7}
 *    (`(cards: number[]) => number`, lower = stronger, 7462-class order).
 * 2. **Ranges are `Float32Array(1326)`** weight vectors in the canonical
 *    combo order of `@poker/core`'s `comboIndex` (the `@poker/ranges`
 *    contract). Combos blocked by visible cards contribute zero.
 * 3. **Determinism.** Monte Carlo uses injected `RngStream`s and *fixed*
 *    trial counts — same inputs, same seed, same result, on every platform.
 *
 * Layout:
 * - {@link equityVsRange} — exact enumeration on 3-5 card boards
 *   (complexity per street documented on the function).
 * - {@link equityVsRangeMC} / {@link multiwayEquityMC} — fixed-trial Monte
 *   Carlo for preflop, wide ranges, and multiway pots.
 * - {@link potOdds} / {@link callEV} / {@link foldEquityEV} — EV algebra.
 * - {@link outs} — beginner-layer outs counter (honest heuristic,
 *   definition documented on the module).
 */

export type { Evaluate7, EquityResult } from "./common";
export { equityVsRange } from "./exact";
export { equityVsRangeMC, multiwayEquityMC } from "./mc";
export { potOdds, callEV, foldEquityEV } from "./ev";
export { outs } from "./outs";
