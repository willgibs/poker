/**
 * Ranking-based range construction and persona distortion operators.
 *
 * All operators here take a `ranking`: a Uint16Array(169) permutation of the
 * canonical 169 class indices, strongest class first (see
 * {@link DEFAULT_PREFLOP_RANKING} in ./ranking.ts). A class's *position* in
 * that permutation, converted to a cumulative combo percentile (AA's 6 combos
 * span the first 6/1326, etc.), is the "how strong is this holding" axis the
 * distortions bend along. Percentiles are cached per ranking object
 * (WeakMap), so hot paths that reuse one ranking allocate nothing.
 *
 * These are BOT-MODEL operators, not solver math: they exist so personas can
 * warp a baseline chart range in ways that read as human (nits over-fold the
 * bottom, maniacs turn junk into bluffs) while staying cheap and pure.
 */

import { HAND169_COUNT } from "@poker/core";
import {
  type WeightedRange,
  RANGE_SIZE,
  CLASS_OF_COMBO,
  CLASS_COMBO_COUNT,
  assertRange,
  assertInRange,
} from "./range";

/** Maps tightness 1.0 → falloff exponent (see {@link tighten}). */
export const TIGHTEN_MAX_EXPONENT = 8;

/** Default soft-edge halfwidth for {@link topPercentByRanking} (combo mass). */
export const DEFAULT_EDGE_SOFTNESS = 0.05;

/** Default "bottom of the ranking" band injected by {@link polarize}. */
export const POLARIZE_BOTTOM_FRACTION = 0.25;

/** @internal Throw unless `ranking` is a Uint16Array(169) permutation of 0..168. */
export function assertRanking(ranking: Uint16Array): void {
  if (ranking.length !== HAND169_COUNT) {
    throw new RangeError(`ranking must have ${HAND169_COUNT} entries, got ${ranking.length}`);
  }
  const seen = new Uint8Array(HAND169_COUNT);
  for (let p = 0; p < HAND169_COUNT; p++) {
    const cls = ranking[p] as number;
    if (cls >= HAND169_COUNT || seen[cls]) {
      throw new RangeError(`ranking must be a permutation of 0..${HAND169_COUNT - 1}`);
    }
    seen[cls] = 1;
  }
}

const midpointCache = new WeakMap<Uint16Array, Float64Array>();

/**
 * Midpoint combo percentile of each CLASS under `ranking`: walking the
 * ranking strongest-first and accumulating combo counts (6/4/12), a class
 * occupying cumulative combos `[start, start + n)` gets percentile
 * `(start + n/2) / 1326`. Indexed by class (not by ranking position).
 * Validates and caches per ranking object.
 */
export function rankingMidpoints(ranking: Uint16Array): Float64Array {
  const cached = midpointCache.get(ranking);
  if (cached !== undefined) return cached;
  assertRanking(ranking);
  const mids = new Float64Array(HAND169_COUNT);
  let cum = 0;
  for (let p = 0; p < HAND169_COUNT; p++) {
    const cls = ranking[p] as number;
    const n = CLASS_COMBO_COUNT[cls] as number;
    mids[cls] = (cum + n / 2) / RANGE_SIZE;
    cum += n;
  }
  midpointCache.set(ranking, mids);
  return mids;
}

function resolveOut(out: WeightedRange | undefined): WeightedRange {
  if (out === undefined) return new Float32Array(RANGE_SIZE);
  assertRange(out, "out");
  return out;
}

/**
 * The strongest `pct` (0..1, fraction of the 1326 combos) of `ranking`, with
 * SOFT EDGES: instead of a hard cliff at the threshold, weights fall off
 * linearly from 1 to 0 across a band of halfwidth `softness` (combo-mass
 * units) centred on the threshold. Soft edges are deliberate: bot ranges
 * built from percentile thresholds should not snap whole classes in/out as
 * a persona parameter drifts by epsilon — the falloff band makes nearby
 * thresholds produce nearby ranges. The band is clamped to `min(softness,
 * pct, 1 - pct)` so `pct = 0` is exactly empty and `pct = 1` exactly full;
 * `softness = 0` gives a hard threshold. Total mass ≈ `pct * 1326`.
 */
export function topPercentByRanking(
  pct: number,
  ranking: Uint16Array,
  softness: number = DEFAULT_EDGE_SOFTNESS,
  out?: WeightedRange,
): WeightedRange {
  assertInRange(pct, 0, 1, "pct");
  assertInRange(softness, 0, 0.5, "softness");
  const mids = rankingMidpoints(ranking);
  const dst = resolveOut(out);
  const band = Math.min(softness, pct, 1 - pct);
  for (let i = 0; i < RANGE_SIZE; i++) {
    const q = mids[CLASS_OF_COMBO[i] as number] as number;
    let w: number;
    if (band === 0) w = q < pct ? 1 : 0;
    else {
      w = (pct + band - q) / (2 * band);
      if (w < 0) w = 0;
      else if (w > 1) w = 1;
    }
    dst[i] = w;
  }
  return dst;
}

/**
 * Persona tightness: downweight combos by how deep they sit in `ranking`.
 * Each combo's weight is multiplied by `(1 - q) ^ k` where `q` is its
 * class's midpoint percentile and `k = tightness * TIGHTEN_MAX_EXPONENT`.
 *
 * `tightness = 0` is the identity; higher tightness shrinks every factor
 * (strictly, for q > 0), so `total(tighten(r, t2)) <= total(tighten(r, t1))`
 * whenever `t2 >= t1` — the "monotone: tighter persona, fewer effective
 * combos" contract. Never renormalizes: a nit playing fewer combos is the
 * point, not a rescaled distribution.
 */
export function tighten(
  range: WeightedRange,
  tightness: number,
  ranking: Uint16Array,
  out?: WeightedRange,
): WeightedRange {
  assertRange(range);
  assertInRange(tightness, 0, 1, "tightness");
  const mids = rankingMidpoints(ranking);
  const dst = resolveOut(out);
  if (tightness === 0) {
    if (dst !== range) dst.set(range);
    return dst;
  }
  const k = tightness * TIGHTEN_MAX_EXPONENT;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const q = mids[CLASS_OF_COMBO[i] as number] as number;
    dst[i] = (range[i] as number) * Math.pow(1 - q, k);
  }
  return dst;
}

/** Result pair of {@link aggressionTransfer}. */
export interface BranchPair {
  passive: WeightedRange;
  aggressive: WeightedRange;
}

/**
 * Shift combo mass between the two action branches of a decision point
 * (e.g. call-range vs raise-range). `transfer` in [-1, 1]:
 * positive moves that fraction of each combo's PASSIVE weight into the
 * aggressive branch (a more aggressive persona raises hands it would have
 * called); negative moves that fraction of the aggressive weight back to
 * passive. Per-combo mass `passive[i] + aggressive[i]` is conserved, so the
 * parent range the branches partition is untouched — the persona changes HOW
 * hands are played, not WHICH hands are played.
 *
 * When the branches genuinely partition a parent range,
 * `passive[i] + aggressive[i] <= 1` and the receiving side can never exceed
 * 1. For malformed inputs where it would, the moved amount is clamped so
 * weights stay in [0, 1] (sacrificing conservation for those combos).
 */
export function aggressionTransfer(
  passive: WeightedRange,
  aggressive: WeightedRange,
  transfer: number,
  outPassive?: WeightedRange,
  outAggressive?: WeightedRange,
): BranchPair {
  assertRange(passive, "passive");
  assertRange(aggressive, "aggressive");
  assertInRange(transfer, -1, 1, "transfer");
  const dstP = resolveOut(outPassive);
  const dstA = resolveOut(outAggressive);
  const toAggressive = transfer >= 0;
  const frac = toAggressive ? transfer : -transfer;
  for (let i = 0; i < RANGE_SIZE; i++) {
    let p = passive[i] as number;
    let a = aggressive[i] as number;
    if (toAggressive) {
      let moved = p * frac;
      if (moved > 1 - a) moved = 1 - a;
      p -= moved;
      a += moved;
    } else {
      let moved = a * frac;
      if (moved > 1 - p) moved = 1 - p;
      a -= moved;
      p += moved;
    }
    dstP[i] = p;
    dstA[i] = a;
  }
  return { passive: dstP, aggressive: dstA };
}

/**
 * Polarize: inject bluff mass at the BOTTOM of the ranking. Combos whose
 * class midpoint percentile lies in the weakest `bottomFraction` of combo
 * mass gain up to `bluffWeight`, scaled linearly with depth (the very worst
 * trash gains the most — the classic polar shape: nutted hands plus junk
 * that can only win by betting). Everything above the band is bit-for-bit
 * unchanged, and weights are capped at 1.
 */
export function polarize(
  range: WeightedRange,
  bluffWeight: number,
  ranking: Uint16Array,
  bottomFraction: number = POLARIZE_BOTTOM_FRACTION,
  out?: WeightedRange,
): WeightedRange {
  assertRange(range);
  assertInRange(bluffWeight, 0, 1, "bluffWeight");
  if (!Number.isFinite(bottomFraction) || bottomFraction <= 0 || bottomFraction > 1) {
    throw new RangeError(`bottomFraction must be in (0, 1], got ${bottomFraction}`);
  }
  const mids = rankingMidpoints(ranking);
  const dst = resolveOut(out);
  const bandStart = 1 - bottomFraction;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const w = range[i] as number;
    const q = mids[CLASS_OF_COMBO[i] as number] as number;
    if (q <= bandStart) {
      dst[i] = w;
      continue;
    }
    const depth = (q - bandStart) / bottomFraction; // (0, 1], 1 = very bottom
    const bumped = w + bluffWeight * depth;
    dst[i] = bumped > 1 ? 1 : bumped;
  }
  return dst;
}
