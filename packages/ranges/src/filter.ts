/**
 * Bayesian action filtering.
 *
 * Range estimation is inference: the bot policy is the generative model
 * ("with combo c, how likely was the action we just observed?") and the
 * opponent's range is the posterior. Each observed action multiplies the
 * prior by that likelihood and renormalizes — textbook Bayes over 1326
 * hypotheses.
 */

import {
  type WeightedRange,
  RANGE_SIZE,
  assertRange,
  assertInRange,
} from "./range";

/**
 * Bayesian update of `range` on one observed action.
 *
 * `likelihood(comboIndex)` returns P(observed action | holding that combo)
 * under the acting player's policy model — any finite value >= 0 (negatives
 * are treated as 0). The posterior is `prior * max(likelihood, epsilonFloor)`
 * per combo, renormalized to total 1.
 *
 * ## Why the epsilon floor exists
 *
 * The policy model is wrong in exactly the way that matters: bots (and
 * humans) ERR. A model that says "this combo never raises here" assigns
 * likelihood 0, and multiplying by 0 is irreversible — once a combo's
 * posterior hits 0, no amount of later evidence (a showdown, a contradictory
 * line) can resurrect it, and one misread action collapses the whole
 * estimate. Flooring the likelihood at `epsilonFloor` keeps every combo the
 * prior considers possible alive with small mass, so the estimate degrades
 * gracefully instead of catastrophically when the model and the player
 * disagree. The floor applies to the LIKELIHOOD, not the posterior: combos
 * with prior 0 (card-removal blocks, folded branches) stay exactly 0 — the
 * floor models action noise, it does not invent impossible holdings.
 *
 * An all-zero prior has no posterior and is returned as-is (all zeros).
 */
export function filter(
  range: WeightedRange,
  likelihood: (comboIndex: number) => number,
  epsilonFloor: number,
  out?: WeightedRange,
): WeightedRange {
  assertRange(range);
  assertInRange(epsilonFloor, 0, 1, "epsilonFloor");
  if (epsilonFloor === 0) {
    throw new RangeError("epsilonFloor must be > 0: a zero floor lets one model miss zero a combo forever");
  }
  let dst: WeightedRange;
  if (out === undefined) dst = new Float32Array(RANGE_SIZE);
  else {
    assertRange(out, "out");
    dst = out;
  }

  let sum = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const prior = range[i] as number;
    if (prior <= 0) {
      dst[i] = 0;
      continue;
    }
    let like = likelihood(i);
    if (!Number.isFinite(like)) {
      throw new RangeError(`likelihood(${i}) must be finite, got ${like}`);
    }
    if (like < epsilonFloor) like = epsilonFloor; // never zero a live combo: bots err
    const mass = prior * like;
    dst[i] = mass;
    sum += mass;
  }

  if (sum <= 0) {
    // All-zero prior: nothing to normalize.
    return dst;
  }
  const inv = 1 / sum;
  for (let i = 0; i < RANGE_SIZE; i++) dst[i] = (dst[i] as number) * inv;
  return dst;
}
