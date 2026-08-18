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
 *   - palette: design-law L12 ("Carbon"), gate1 variation C
 *   - radii: design-law L14 (tight family, 2 / 4 / 7)
 *   - type: design-law L9 (General Sans), L1 (tight tracking), L2 (sentence
 *     case), gate1's shared type scale
 *   - duration + easing + spring tables: poker-internal/content/motion/beats.md §2
 *   - distance + scale tables: .agents/skills/transitions-dev/_root.css
 *     (the flat-component recipes the UI kit is authored against)
 *   - sound cues: beats.md §6.2
 */

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The ink ramp — the Carbon neutral family the whole brand sits on (L12).
 * `0` is deeper than the canvas (shadows, wells); `1000` is the card stock.
 * The named L12 anchors live on the steps they were locked at:
 *
 *   50 canvas · 150 surface / card ink · 200 raised · 250 hairline
 *   300 line · 600 faint · 800 dim · 950 text · 1000 card face
 *
 * Dark-only brand: there is no light ramp and there will not be one.
 */
export const ink = {
  0: "#020203",
  50: "#050507",
  100: "#0a0b0d",
  150: "#0f1113",
  200: "#171a1e",
  250: "#1b1e22",
  300: "#2c2f35",
  400: "#3a3e45",
  500: "#4a4e55",
  600: "#55585f",
  700: "#6d717a",
  800: "#868a92",
  900: "#b9bdc4",
  950: "#f3f4f6",
  1000: "#f5f7f9",
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

/**
 * The radius family is TIGHT (L14): three steps, 2 / 4 / 7. Crisp 1px edges
 * and near-square corners are part of the Carbon identity — a soft corner is
 * now a deliberate exception, not a default.
 *
 *   sm  2px — card faces, seat plates, the smallest chrome
 *   md  4px — buttons, inputs, felt panels
 *   lg  7px — cards, sheets, the largest containers
 *
 * `xs` / `xl` / `xxl` are retained as aliases onto the three-step family so
 * component CSS written against the pre-Carbon scale keeps resolving; they
 * retire when those components are rebuilt at Gate 3-5.
 */
export const radius = {
  none: "0px",
  sm: "2px",
  md: "4px",
  lg: "7px",
  pill: "999px",
  circle: "50%",
  /* aliases onto the tight family — see above */
  xs: "2px",
  xl: "7px",
  xxl: "7px",
} as const;

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * General Sans is the voice (L9) — display and UI from one family. The webfont
 * is self-hosted; see `fonts.gen.css` (`import "@poker/ui/fonts.css"`).
 */
export const fontFamily = {
  display: "'General Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  body: "'General Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
} as const;

/**
 * The Carbon type scale — gate1's shared scale, six roles, one family:
 *
 *   display  32   / 600 / -0.021em
 *   title    22   / 600 / -0.018em
 *   heading  17   / 600 / -0.014em
 *   body     14   / 400 / -0.006em
 *   small    12.5 / 400 / -0.004em
 *   label    11   / 500 / +0.08em, uppercase (the ONLY tracked role — L1)
 *
 * The `display*` / `body*` / `label*` keys below are pre-Carbon names kept as
 * aliases onto the nearest role so component CSS keeps resolving until those
 * components are rebuilt at Gate 3-5.
 */
export const fontSize = {
  display: "32px",
  title: "22px",
  heading: "17px",
  body: "14px",
  small: "12.5px",
  label: "11px",
  /* aliases onto the six roles — see above */
  displayXl: "32px",
  displayLg: "32px",
  displayMd: "22px",
  displaySm: "17px",
  bodyLg: "14px",
  bodyMd: "14px",
  bodySm: "12.5px",
  bodyXs: "12.5px",
  labelLg: "12.5px",
  labelMd: "11px",
  labelSm: "11px",
} as const;

/**
 * The shipped General Sans subsets carry 400 and 600 only (see
 * `fonts.gen.css`). `medium` resolves to the 400 face and `bold` is pinned to
 * 600 rather than 700 so the browser never synthesises a weight that has no
 * drawn face. The full weight set lands at Gate 5.
 */
export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "600",
} as const;

export const lineHeight = {
  tight: "1.1",
  snug: "1.2",
  heading: "1.3",
  normal: "1.5",
  relaxed: "1.6",
} as const;

/**
 * Tracking is tight to neutral (L1). Wide tracking survives in exactly one
 * place — the 11px uppercase eyebrow (`label`, +0.08em). The pre-Carbon
 * `wide` / `wider` / `widest` steps (0.14 / 0.18 / 0.26em) are dead; they now
 * alias onto the single sanctioned label value so no surface can reintroduce
 * them by name.
 */
export const letterSpacing = {
  display: "-0.021em",
  title: "-0.018em",
  heading: "-0.014em",
  body: "-0.006em",
  small: "-0.004em",
  label: "0.08em",
  normal: "0em",
  /* aliases — see above */
  tighter: "-0.021em",
  tight: "-0.018em",
  snug: "-0.014em",
  wide: "0.08em",
  wider: "0.08em",
  widest: "0.08em",
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
 * The composed type scale — the six gate1 roles, nothing else. Hierarchy comes
 * from size contrast and spacing, not from stacking weight + tracking + colour
 * (L4): only `label` carries a second device, and only because an 11px eyebrow
 * cannot carry size contrast at all.
 */
export const textStyles = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.display,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.display,
  },
  title: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.title,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.title,
  },
  heading: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.heading,
    letterSpacing: letterSpacing.heading,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.relaxed,
    letterSpacing: letterSpacing.body,
  },
  small: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.small,
  },
  label: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.label,
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
 *
 * `linear` is the one exception to "everything eases": an ambient loop that
 * accelerates reads as a stutter every time it wraps, so a pulse or a spinner
 * runs flat. It is *not* a licence for a travelling gradient in chrome — the
 * glint ruling (L3) still stands.
 */
export const easing = {
  smoothOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "ease-in-out",
  bounce: "cubic-bezier(0.34, 1.36, 0.64, 1)",
  out: "ease-out",
  linear: "linear",
} as const;

/**
 * Travel distances for flat component motion — the transitions.dev
 * `--distance-*` scale (`.agents/skills/transitions-dev/_root.css`), which the
 * flat recipes are authored against:
 *
 *   micro   4px — text swap
 *   small   6px — error shake, small segment
 *   base    8px — badge diagonal reveal, page slide, error shake large segment
 *   medium 12px — text reveal
 *   large  30px — check-badge appear
 *
 * The table's *physical* travel (cards, chips, pots) is not here: it is
 * geometry the Presenter computes, not a token (beats.md §4).
 */
export const distance = {
  micro: "4px",
  small: "6px",
  base: "8px",
  medium: "12px",
  large: "30px",
} as const;

/**
 * Pre/post scales for flat component motion — the transitions.dev `--scale-*`
 * scale (same file):
 *
 *   large  0.96 — modal open / close
 *   medium 0.97 — dropdown open (and the hero press, beats.md §4.15)
 *   small  0.98 — tooltip open
 *   tiny   0.99 — dropdown close
 */
export const scale = {
  large: "0.96",
  medium: "0.97",
  small: "0.98",
  tiny: "0.99",
} as const;

/**
 * The same table as numbers, for `motion/react` — which takes a scale as a
 * number, not a CSS string. This mirrors the `duration` / `durationMs` pair
 * exactly: the string table is emitted as custom properties, the number table
 * is TypeScript-only, and `tokens.test.ts` keeps the two in lockstep.
 */
export const scaleNum = {
  large: 0.96,
  medium: 0.97,
  small: 0.98,
  tiny: 0.99,
} as const;

/**
 * Ambient loop periods. An ambient beat is free-running garnish (beats.md
 * §2.3, class AMBIENT): it never speed-scales, and it may be suppressed but
 * never hurried. `pulse` is the seat think-pulse period — beats.md §4.14's
 * "ring opacity 0.7↔1.0, 1.2s loop".
 */
export const loop = {
  pulse: "1200ms",
} as const;

/**
 * The blur ladder, tiered by L21 (ratified Gate 3M, 2026-08-18): ≤2px on
 * chrome, 3px mid-flight on a surface already travelling, 8px only on a
 * delight-tier entrance (success-check open, smoky-dissolve bloom) — and
 * never on exit. Nothing above 8px, ever. Reduce-motion caps at 2px
 * (beats.md §5.4).
 */
export const blur = {
  none: "0px",
  small: "2px",
  medium: "3px",
  large: "8px",
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
