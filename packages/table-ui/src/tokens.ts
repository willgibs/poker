/**
 * Motion tokens and the speed model.
 *
 * Normative source: `poker-internal/content/motion/beats.md` §2 (token
 * vocabulary) and §3 (the speed model). Nothing here is invented: every value
 * is either a transitions.dev CSS duration token, a per-beat number authored in
 * beats.md, or derived from it by the documented scaling law.
 *
 * The Presenter is headless — these tokens are *data*. Rendering (springs,
 * CSS transitions) happens in `packages/ui` / `apps/web`; this package only
 * decides *when* things happen and *how long* they last.
 */

/** Global speed multiplier. `"instant"` snaps everything but the traces. */
export type Speed = 0.5 | 1 | 2 | 3 | "instant";

/** Every speed, in order, ascending. */
export const SPEEDS = [0.5, 1, 2, 3, "instant"] as const satisfies readonly Speed[];

/** transitions.dev duration scale (beats.md §2.2) — ms. */
export const DURATION = {
  stagger: 40,
  micro: 80,
  quick: 150,
  fast: 250,
  medium: 350,
  slow: 400,
  verySlow: 500,
} as const;

export type DurationToken = keyof typeof DURATION;

/** Spring tokens (beats.md §2.1). Carried on beats for the renderer to apply. */
export type SpringToken =
  | "spring/deal"
  | "spring/flip"
  | "spring/chip"
  | "spring/pot"
  | "spring/muck"
  | "spring/ui"
  | "spring/celebrate"
  | "spring/flush";

/**
 * Compression tier applied at a speed (beats.md §3):
 * 0 = none (0.5x, 1x) · 1 = arcs flatten, passes merge (2x) ·
 * 2 = per-item beats become per-group, travel becomes fade-at-destination (3x) ·
 * 3 = snap; only *keeps-a-trace* beats render (instant).
 */
export type CompressionTier = 0 | 1 | 2 | 3;

export function compressionTier(speed: Speed): CompressionTier {
  if (speed === "instant") return 3;
  if (speed === 3) return 2;
  if (speed === 2) return 1;
  return 0;
}

/** `true` when the speed snaps everything (beats.md §3, instant column). */
export function isInstant(speed: Speed): speed is "instant" {
  return speed === "instant";
}

/**
 * Fraction of an actor beat that must elapse before the *next* actor may begin
 * (beats.md §5.1, actor lane: "settle-overlappable"). The trailing 30% is the
 * spring's settle, which the next actor's think-time may overlap.
 */
export const ACTOR_SETTLE_OVERLAP = 0.7;

/** Backlog guard (beats.md §3): queued un-played beats above this escalate a tier. */
export const BACKLOG_GUARD_MS = 1500;

/** Think-time floor at any speed (PRD pacing budget). */
export const THINK_FLOOR_MS = 250;

/** Auto-deal rest after award settles (beats.md §5.2), before speed scaling. */
export const AUTO_DEAL_REST_MS = 600;

/** Delay from showdown settle to the mind-reveal affordance (beats.md §4.10). */
export const MIND_AFFORDANCE_DELAY_MS = 250;

/** Delay from the last showdown flip to the winning-hand glow (beats.md §4.9). */
export const WINNER_GLOW_DELAY_MS = 300;

/** Arc height in px for card travel (beats.md §4.1) — flattened by tier 1. */
export const CARD_ARC_PX = 12;

/** Arc height in px for chip travel (beats.md §4.3) — flattened by tier 1. */
export const CHIP_ARC_PX = 10;

/**
 * A beat's duration in token form. `base` is the @1x, pre-clamp authored value.
 *
 * The PACED law (beats.md §2.3): `dur/S`, clamped to `[floor, 2 × base]`.
 * 0.5x therefore lands exactly on the clamp ceiling; 3x on the floor for any
 * beat that travels (`collapse3x`), because tier-2 turns travel into
 * fade-at-destination.
 */
export interface DurationSpec {
  /** Authored @1x duration, ms. */
  readonly base: number;
  /** PACED clamp floor, ms. */
  readonly floor: number;
  /** Duration used under reduce-motion (the fade variant). Defaults to `base`. */
  readonly rmBase?: number;
  /** Tier-2 (3x) collapses this beat to its floor. Default `true`. */
  readonly collapse3x?: boolean;
  /** Explicit tier-1 (2x) duration where beats.md merges sub-beats. */
  readonly at2x?: number;
  /** Duration at instant. Default 0 (snap); non-zero only for *keeps-a-trace*. */
  readonly atInstant?: number;
}

function clampRound(v: number, lo: number, hi: number): number {
  return Math.round(Math.min(Math.max(v, lo), hi));
}

/** Resolve a PACED duration for a speed / reduce-motion combination. */
export function resolveDuration(spec: DurationSpec, speed: Speed, reduceMotion: boolean): number {
  if (speed === "instant") return spec.atInstant ?? 0;
  const base = reduceMotion ? (spec.rmBase ?? spec.base) : spec.base;
  if (speed === 2 && spec.at2x !== undefined && !reduceMotion) return spec.at2x;
  if (speed === 3 && (spec.collapse3x ?? true)) return spec.floor;
  return clampRound(base / speed, spec.floor, base * 2);
}

/**
 * Stagger scaling (beats.md §3): 0.5x ×2 · 1x base · 2x ×0.5 · 3x and instant 0
 * (simultaneous). Staggers are *kept* under reduce-motion — rhythm without
 * motion (beats.md §5.4).
 */
export function resolveStagger(base: number, speed: Speed): number {
  if (speed === "instant" || speed === 3) return 0;
  if (speed === 2) return Math.round(base / 2);
  if (speed === 0.5) return base * 2;
  return base;
}

/** Next compression tier up, for the backlog guard. `"instant"` is terminal. */
export function nextSpeedTier(speed: Speed): Speed {
  if (speed === 0.5) return 1;
  if (speed === 1) return 2;
  if (speed === 2) return 3;
  return "instant";
}
