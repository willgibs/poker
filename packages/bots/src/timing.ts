/**
 * Stage 8 — think time.
 *
 * Think time is COMPUTED, never measured: nothing in this package reads a
 * clock. The value returned is raw milliseconds at 1x; the Presenter owns the
 * player's speed control (docs/architecture.md, ring 2), so a bot's timing
 * texture survives every speed setting instead of being baked into one.
 *
 * The band is a function of decision closeness — the normalised EV gap between
 * the best two shaped candidates — interpolated across the persona's
 * `trivial → base → close` anchors. Then, in order:
 *
 * 1. per-action and per-street overrides (Doris's metronome, Barry's tank);
 * 2. timing TELLS, which replace or scale the band outright;
 * 3. tilt (Chip compresses 40%, Priya stretches 50%);
 * 4. seeded jitter — "never metronomic" is doctrine, so even Doris wobbles;
 * 5. the persona's floor.
 */

import type { PersonaConfig, TimingBand } from "./persona";
import type { Candidate } from "./candidates";
import type { DecisionContext } from "./context";
import type { TimingTrace } from "./trace";

function lerpBand(a: TimingBand, b: TimingBand, t: number): TimingBand {
  return {
    minMs: a.minMs + (b.minMs - a.minMs) * t,
    maxMs: a.maxMs + (b.maxMs - a.maxMs) * t,
  };
}

/**
 * Band implied by closeness alone: `trivial` at 0, the middle anchor at 0.5,
 * `close` at 1. Piecewise so all three anchors are honoured exactly.
 *
 * A per-street band replaces the MIDDLE anchor rather than the whole curve, so
 * a character with an authored street tempo still tanks on genuinely close
 * decisions and still snaps on trivial ones. Replacing the curve outright
 * would silently delete the closeness clock on every street the persona names.
 */
export function bandForCloseness(
  persona: PersonaConfig,
  closeness: number,
  middle?: TimingBand,
): TimingBand {
  const c = closeness < 0 ? 0 : closeness > 1 ? 1 : closeness;
  const t = persona.timing;
  const mid = middle ?? t.base;
  return c <= 0.5 ? lerpBand(t.trivial, mid, c * 2) : lerpBand(mid, t.close, (c - 0.5) * 2);
}

export interface TimingInput {
  ctx: DecisionContext;
  persona: PersonaConfig;
  candidate: Candidate;
  closeness: number;
  tilt: number;
  /** Band override from a timing tell, when one fired. */
  tellBand: TimingBand | null;
  /** Multiplicative modulation from timing tells. */
  tellScale: number;
  /** Uniform in [0, 1) for jitter. */
  jitterRoll: number;
}

export interface TimingResult {
  thinkTimeMs: number;
  trace: TimingTrace;
}

/** Compute the think time (stage 8). */
export function computeThinkTime(input: TimingInput): TimingResult {
  const { ctx, persona, candidate, closeness, tilt, tellBand, tellScale, jitterRoll } = input;
  const t = persona.timing;

  let band = bandForCloseness(persona, closeness, t.streets?.[ctx.street]);
  const baseBand = { minMs: band.minMs, maxMs: band.maxMs };

  // Authored habit bands replace the curve outright: Barry always tanks his
  // folds, Chip always auto-clicks his air-checks.
  if (candidate.kind === "fold" && t.fold !== undefined) band = t.fold;
  else if (candidate.kind === "check" && t.check !== undefined) band = t.check;
  else if ((candidate.kind === "bet" || candidate.kind === "raise") && t.aggression !== undefined) {
    band = t.aggression;
  }
  if (tellBand !== null) band = tellBand;

  const width = Math.max(0, band.maxMs - band.minMs);
  // Jitter draws across the whole band and then shrinks toward the centre by
  // (1 - jitter), so `jitter = 0` still lands mid-band rather than at the edge.
  const centre = band.minMs + width / 2;
  const spread = width * t.jitter;
  const raw = centre - spread / 2 + spread * jitterRoll;

  const tiltFactor = 1 + tilt * persona.tiltSusceptibility * (t.tiltScale - 1);
  const scaled = raw * tiltFactor * tellScale;
  const thinkTimeMs = Math.max(t.floorMs, Math.round(scaled));

  return {
    thinkTimeMs,
    trace: {
      closeness,
      baseBand,
      band: { minMs: band.minMs, maxMs: band.maxMs },
      jitterRoll,
      tiltScale: tiltFactor,
      floorMs: t.floorMs,
      thinkTimeMs,
    },
  };
}
