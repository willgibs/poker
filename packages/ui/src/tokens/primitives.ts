/**
 * Layer 1 — primitives.
 *
 * Raw, meaningless values: the only place in the repo where a colour literal,
 * a pixel, or a millisecond may be written down. Nothing here knows what it is
 * *for*; `semantic.ts` assigns meaning and `skins.ts` reassigns it.
 *
 * Every scalar group in this file is emitted as `--fr-<group>-<token>` CSS
 * custom properties by `emit.ts`. Groups that cannot be expressed as CSS values
 * (spring physics, sound cue ids) stay TypeScript-only.
 *
 * Sources of truth:
 *   - palette / type / spacing: DC0-DC1 explorations (poker-internal/design/explorations)
 *   - duration + easing + spring tables: poker-internal/content/motion/beats.md §2
 *   - sound cues: beats.md §6.2
 */

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The ink ramp — the near-black neutral family the whole brand sits on.
 * `0` is deeper than the canvas (shadows, wells); `1000` is the card-stock
 * white. Dark-only brand: there is no light ramp and there will not be one.
 */
export const ink = {
  0: "#07080a",
  50: "#0a0b0e",
  100: "#0b0c10",
  150: "#0e0f14",
  200: "#121016",
  250: "#16181d",
  300: "#1d1f27",
  400: "#2a2c36",
  500: "#3d3f4d",
  600: "#5c5966",
  700: "#7b7889",
  800: "#918e9f",
  900: "#c9c2d1",
  950: "#e6e4ee",
  1000: "#fbfaf7",
} as const;

/* -------------------------------------------------------------------------- */
/* Space & shape                                                              */
/* -------------------------------------------------------------------------- */

/** 4-based space scale. Key is the step count; value is `step * 4px`. */
export const space = {
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
  24: "96px",
} as const;

export const radius = {
  none: "0px",
  xs: "4px",
  sm: "6px",
  md: "10px",
  lg: "14px",
  xl: "18px",
  xxl: "24px",
  pill: "999px",
  circle: "50%",
} as const;

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Provisional stacks. The display face is a self-hosted geometric sans chosen
 * at DC1; until then Avenir Next / Futura carry the "oversized friendly
 * geometric" brief with a system fallback chain.
 */
export const fontFamily = {
  display: '"Avenir Next", Futura, "Century Gothic", -apple-system, "Segoe UI", system-ui, sans-serif',
  body: '"Avenir Next", Futura, "Century Gothic", -apple-system, "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

export const fontSize = {
  displayXl: "44px",
  displayLg: "34px",
  displayMd: "27px",
  displaySm: "21px",
  bodyLg: "16.5px",
  bodyMd: "15px",
  bodySm: "13.5px",
  bodyXs: "12.5px",
  labelLg: "13px",
  labelMd: "11.5px",
  labelSm: "10px",
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeight = {
  tight: "1.1",
  snug: "1.25",
  normal: "1.5",
  relaxed: "1.6",
} as const;

export const letterSpacing = {
  tighter: "-0.02em",
  tight: "-0.015em",
  snug: "-0.01em",
  normal: "0em",
  wide: "0.14em",
  wider: "0.18em",
  widest: "0.26em",
} as const;

/** A complete text role: everything a label needs, nothing it does not. */
export interface TextStyle {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly textTransform?: "uppercase";
}

/**
 * The composed type scale. Three roles: `display` (headings, the brand voice),
 * `body` (prose and numerals), `label` (tracked uppercase chrome).
 */
export const textStyles = {
  displayXl: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.displayXl,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tighter,
  },
  displayLg: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.displayLg,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  displayMd: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.displayMd,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  displaySm: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.displaySm,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.snug,
  },
  bodyLg: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  bodyMd: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  bodySm: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  bodyXs: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.bodyXs,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  labelLg: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.labelLg,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.wide,
    textTransform: "uppercase",
  },
  labelMd: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.labelMd,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.wider,
    textTransform: "uppercase",
  },
  labelSm: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.labelSm,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.widest,
    textTransform: "uppercase",
  },
} as const satisfies Readonly<Record<string, TextStyle>>;

/* -------------------------------------------------------------------------- */
/* Stacking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The table is a physical scene, so the ramp reads bottom-up: felt, then the
 * things resting on it, then the chrome floating above it. Nothing outside
 * this list may set a z-index.
 */
export const zLayer = {
  felt: "0",
  board: "10",
  bet: "20",
  seat: "30",
  pot: "40",
  marker: "50",
  overlay: "60",
  rail: "70",
  header: "80",
  sheet: "90",
  toast: "100",
  tooltip: "110",
} as const;

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Flat-beat durations — beats.md §2.2, verbatim. No flat beat may invent a
 * duration outside this table.
 */
export const durationMs = {
  stagger: 40,
  micro: 80,
  quick: 150,
  fast: 250,
  medium: 350,
  slow: 400,
  verySlow: 500,
} as const;

/** The same table as CSS time values. Kept in lockstep with `durationMs`. */
export const duration = {
  stagger: "40ms",
  micro: "80ms",
  quick: "150ms",
  fast: "250ms",
  medium: "350ms",
  slow: "400ms",
  verySlow: "500ms",
} as const;

/**
 * Easings — beats.md §2.2. `ease-in` appears nowhere in this app, by law:
 * entrances and exits both use `smoothOut`.
 */
export const easing = {
  smoothOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "ease-in-out",
  bounce: "cubic-bezier(0.34, 1.36, 0.64, 1)",
  out: "ease-out",
} as const;

/** Blur is capped at 2px for motion (beats.md §5.4); 3px is celebration-only. */
export const blur = {
  none: "0px",
  small: "2px",
  medium: "3px",
} as const;

/**
 * A spring, in physical terms. `motion/react` accepts either form; we store
 * both so the physics is inspectable and the perceptual source values from
 * beats.md §2.1 stay auditable.
 */
export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  /** Apple-style perceptual duration, seconds (beats.md §2.1 source value). */
  readonly durationSec: number;
  /** Apple-style bounce, 0..1 (beats.md §2.1 source value). */
  readonly bounce: number;
}

/**
 * beats.md §2.1 converted to physics with mass = 1:
 *   omega = 2*PI / durationSec, zeta = 1 - bounce
 *   stiffness = omega^2 * mass, damping = 2 * zeta * omega * mass
 * Rounded to 0.1 — well inside perceptual noise, and keeps the table readable.
 */
export const spring = {
  /** Crisp professional dealer, zero wobble — hole cards, street slides. */
  deal: { stiffness: 815.7, damping: 57.1, mass: 1, durationSec: 0.22, bounce: 0 },
  /** A card snapping over, faint life — hero flip, street flip, showdown. */
  flip: { stiffness: 631.7, damping: 45.2, mass: 1, durationSec: 0.25, bounce: 0.1 },
  /** Chips have weight; tiny settle jiggle on landing. */
  chip: { stiffness: 385.5, damping: 32.2, mass: 1, durationSec: 0.32, bounce: 0.18 },
  /** Heavier mass, longer glide — pot merge, pot award. */
  pot: { stiffness: 195.0, damping: 24.6, mass: 1, durationSec: 0.45, bounce: 0.12 },
  /** Dead cards do not bounce. */
  muck: { stiffness: 503.6, damping: 44.9, mass: 1, durationSec: 0.28, bounce: 0 },
  /** Flat surfaces, no personality — affordances, panels, action bar arm. */
  ui: { stiffness: 987.0, damping: 62.8, mass: 1, durationSec: 0.2, bounce: 0 },
  /** The app's only bouncy spring. Session-end celebration slot only. */
  celebrate: { stiffness: 157.9, damping: 18.8, mass: 1, durationSec: 0.5, bounce: 0.25 },
  /** The interrupt ramp — retarget-to-settled, velocity preserved. */
  flush: { stiffness: 2741.6, damping: 104.7, mass: 1, durationSec: 0.12, bounce: 0 },
} as const satisfies Readonly<Record<string, SpringConfig>>;

export type SpringName = keyof typeof spring;

/* -------------------------------------------------------------------------- */
/* Sound                                                                      */
/* -------------------------------------------------------------------------- */

/** Mixer buses — each gets its own volume slider under a master (beats.md §6.1). */
export const soundBuses = ["cards", "chips", "cues", "moments"] as const;
export type SoundBus = (typeof soundBuses)[number];

/**
 * Every cue id in the app (beats.md §6.2). The sprite sheet is authored against
 * exactly this list; a cue that is not here does not exist.
 */
export const soundCues = [
  "card_slide",
  "card_flip",
  "fold_muck",
  "check_knock",
  "chip_click_1",
  "chip_click_2",
  "chip_click_3",
  "chip_allin",
  "pot_merge",
  "pot_slide",
  "turn_blip",
  "badge_tick",
  "win_chime",
  "celebrate_milestone",
  "celebrate_unlock",
  "celebrate_level",
] as const;
export type SoundCueId = (typeof soundCues)[number];

/** Bus routing per cue (beats.md §6.2). */
export const soundCueBus = {
  card_slide: "cards",
  card_flip: "cards",
  fold_muck: "cards",
  check_knock: "cues",
  chip_click_1: "chips",
  chip_click_2: "chips",
  chip_click_3: "chips",
  chip_allin: "chips",
  pot_merge: "chips",
  pot_slide: "chips",
  turn_blip: "cues",
  badge_tick: "cues",
  win_chime: "moments",
  celebrate_milestone: "moments",
  celebrate_unlock: "moments",
  celebrate_level: "moments",
} as const satisfies Readonly<Record<SoundCueId, SoundBus>>;

/** Default gain per cue, dB relative to its bus (beats.md §6.2). */
export const soundCueDefaultDb = {
  card_slide: -10,
  card_flip: -8,
  fold_muck: -12,
  check_knock: -8,
  chip_click_1: -8,
  chip_click_2: -7,
  chip_click_3: -6,
  chip_allin: -5,
  pot_merge: -9,
  pot_slide: -6,
  turn_blip: -6,
  badge_tick: -12,
  win_chime: -6,
  celebrate_milestone: -6,
  celebrate_unlock: -6,
  celebrate_level: -6,
} as const satisfies Readonly<Record<SoundCueId, number>>;
