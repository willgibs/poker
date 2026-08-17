/**
 * Stage 6 — tilt and the deliberate error.
 *
 * Two mechanisms, both authored rather than random:
 *
 * **Tilt** is a scalar in [0, 1] that decays every hand and spikes on the
 * events the character's bible says get to them. It never appears as a meter
 * (design law); it shows only in play, portrait and banter tone. Its effect is
 * a multiplier on aggression, call-down and error rate, scaled by the
 * persona's own `tiltSusceptibility` — so Doris at maximum tilt is still
 * Doris, and Chip at 0.3 is already spiralling.
 *
 * **The deliberate error** is the PRD's "authored imperfection": each
 * character errs in their OWN way. When the persona's mistake class is
 * eligible and the roll comes in under the (tilt-amplified) error rate, the
 * bot knowingly takes a worse action in its characteristic direction, and the
 * trace records exactly how much EV it gave up. Uniform noise would be easier
 * and would make every read unlearnable; that is precisely why it is banned.
 */

import { holdingFeatures } from "./handclass";
import type { PersonaConfig } from "./persona";
import type { Candidate } from "./candidates";
import type { DecisionContext } from "./context";
import type { HandScan } from "./eventscan";
import type { OpponentStats } from "./state";
import { madeRankOf } from "./handclass";

/** Call-down rate above which an opponent is modelled as a station. */
export const STATION_CALLDOWN = 0.55;
/** Fold-to-bet rate above which an opponent is modelled as an over-folder. */
export const OVERFOLDER_FOLD_TO_BET = 0.6;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Persona parameters after tilt modulation. */
export interface TiltAdjustedParams {
  aggression: number;
  callDownTendency: number;
  bluffFrequency: number;
  errorRate: number;
  tightness: number;
  /** Effective tilt intensity actually felt, `tilt * tiltSusceptibility`. */
  intensity: number;
}

/** Apply the persona's tilt gains at the given tilt level. */
export function tiltAdjust(persona: PersonaConfig, tilt: number): TiltAdjustedParams {
  const f = clamp01(tilt) * persona.tiltSusceptibility;
  const gain = (base: number, g: number): number => clamp01(base * (1 + f * (g - 1)));
  return {
    aggression: gain(persona.aggression, persona.tilt.aggressionGain),
    callDownTendency: gain(persona.callDownTendency, persona.tilt.callDownGain),
    bluffFrequency: gain(persona.bluffFrequency, 1 + (persona.tilt.aggressionGain - 1) * 0.6),
    errorRate: gain(persona.errorRate, persona.tilt.errorGain),
    // Tilt loosens; a tilted character does not get MORE disciplined.
    tightness: clamp01(persona.tightness * (1 - 0.35 * f)),
    intensity: f,
  };
}

/**
 * True when `seat` took a bad beat in the completed hand: it got to showdown
 * with two pair or better, and lost. Deterministic and constructible — no
 * equity replay, no clock.
 */
export function detectBadBeat(scan: HandScan, seat: number): boolean {
  const hole = scan.revealsBySeat.get(seat) ?? scan.holeBySeat.get(seat);
  if (hole === undefined) return false;
  if (scan.revealsBySeat.size < 2) return false; // never reached a real showdown
  if (!scan.revealsBySeat.has(seat)) return false;
  const net = scan.netBySeat.get(seat);
  if (net === undefined || net >= 0) return false;
  const features = holdingFeatures(hole, scan.board);
  return features.madeRank >= madeRankOf("two-pair");
}

/** Whether the persona's characteristic mistake is even eligible right now. */
export function mistakeEligible(
  ctx: DecisionContext,
  persona: PersonaConfig,
  strengthPercentile: number,
  tilt: number,
  opponent: OpponentStats | null,
): boolean {
  const w = persona.mistake.when;
  if (w.streets !== undefined && !w.streets.includes(ctx.street)) return false;
  if (w.facingBet !== undefined && w.facingBet !== ctx.facingBet) return false;
  if (w.minStrength !== undefined && strengthPercentile < w.minStrength) return false;
  if (w.maxStrength !== undefined && strengthPercentile > w.maxStrength) return false;
  if (w.requiresTilt !== undefined && tilt < w.requiresTilt) return false;
  if (w.withDraw === true) {
    const f = holdingFeatures(ctx.hole, ctx.board);
    if (!f.flushDraw && !f.oesd && !f.gutshot) return false;
  }
  if (w.vsStation === true && (opponent === null || opponent.callDown < STATION_CALLDOWN)) return false;
  if (w.vsOverfolder === true && (opponent === null || opponent.foldToBet < OVERFOLDER_FOLD_TO_BET)) return false;
  if (w.maxOpponentHands !== undefined && opponent !== null && opponent.hands > w.maxOpponentHands) return false;
  return true;
}

export interface ErrorInjection {
  candidate: Candidate;
  deliberateError: boolean;
  evSacrificed: number;
  roll: number;
  effectiveErrorRate: number;
}

/**
 * Roll for the characteristic mistake and, when it fires, swap in the best
 * candidate that points in the persona's error direction and costs no more
 * than `maxEvSacrificeBb` big blinds.
 *
 * The roll is drawn unconditionally so stream alignment does not depend on
 * eligibility — determinism must not be a function of the board.
 */
export function injectDeliberateError(
  ctx: DecisionContext,
  persona: PersonaConfig,
  chosen: Candidate,
  candidates: readonly Candidate[],
  eligible: boolean,
  effectiveErrorRate: number,
  roll: number,
): ErrorInjection {
  const base: ErrorInjection = {
    candidate: chosen,
    deliberateError: false,
    evSacrificed: 0,
    roll,
    effectiveErrorRate,
  };
  if (!eligible || roll >= effectiveErrorRate) return base;

  const budget = persona.mistake.maxEvSacrificeBb * ctx.bb;
  const bias = persona.mistake.bias;
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c === chosen || c.gatedOut) continue;
    if (c.kind !== bias) continue;
    const sacrifice = chosen.ev - c.ev;
    if (sacrifice <= 0) continue; // not a mistake if it is not worse
    if (sacrifice > budget) continue;
    if (best === null || c.ev > best.ev) best = c;
  }
  if (best === null) return base;
  return {
    candidate: best,
    deliberateError: true,
    evSacrificed: chosen.ev - best.ev,
    roll,
    effectiveErrorRate,
  };
}
