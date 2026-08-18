/**
 * Layer 2 — semantic tokens.
 *
 * Meaning, not appearance. Components may only ever reference this layer (and
 * the non-colour primitives); they never name a primitive colour and never name
 * a skin. Layer 3 (`skins.ts`) reassigns a subset of these, which is the entire
 * cosmetics mechanism — deck skins, card backs, and table themes are unlocks
 * that swap `data-skin`, nothing more.
 *
 * The base values below ARE the default skin, "Carbon" (design-law L12, locked
 * at Gate 1 as variation C).
 *
 * Doctrine this layer encodes:
 *   - L8 "Signal": the chrome is achromatic. Chromatic tokens exist only where
 *     colour carries meaning — suits, states, data encodings, art.
 *   - L12: the Carbon values, verbatim. Crisp 1px edges are part of the identity.
 *   - L13: suits are vivid, and the spade is TWO tokens, not a hue.
 *   - L3: gradients are dead as a system. The `accentA` / `accentB` pair
 *     survives only as a compatibility alias (see below).
 *   - L16: the felt is still open. Both candidate values ship as tokens; the
 *     live `felt` is a placeholder, not a decision.
 */

import { ink } from "./primitives";

export const semantic = {
  /* --- surfaces ------------------------------------------------------- */
  /** The page. Near-black, never pure black. */
  canvas: ink[50],
  /** Panels, sheets, cards resting on the canvas. */
  surface: ink[150],
  /** A surface lifted one step: seat plates, hover fills, inset chrome. */
  raised: ink[200],
  /** The visible 1px edge. Structural, not decorative — L12. */
  line: ink[300],
  /** The quieter divider: internal rules inside an already-bordered panel. */
  hairline: ink[250],
  /** Legacy name for `line`; the concept survives unchanged. */
  edge: ink[300],

  /* --- text ----------------------------------------------------------- */
  /** Primary reading colour. */
  text: ink[950],
  /** Secondary prose, supporting numerals, stat labels. */
  dim: ink[800],
  /** Tertiary chrome: timestamps, disabled, legends, captions. */
  faint: ink[600],
  /** Legacy name for `dim` — the pre-Carbon layer called the secondary "muted". */
  muted: ink[800],

  /* --- primary action (L8: primaries are WHITE, not chromatic) -------- */
  /** Primary button fill. */
  primary: "#f3f4f6",
  /** Ink on a primary fill. */
  onPrimary: "#050507",
  primaryHover: "#ffffff",
  primaryPress: "#d6d9de",

  /* --- focus ---------------------------------------------------------- */
  /** The focus ring: 2px, with a 2px surface-coloured offset. One ring, system-wide. */
  focus: "#f3f4f6",
  /**
   * Legacy name for `focus` — pre-Carbon this was a chromatic halo. Under L5
   * the glow is gone; the token remains so every existing `:focus-visible`
   * rule keeps drawing the sanctioned white ring.
   */
  glow: "#f3f4f6",

  /* --- brand ---------------------------------------------------------- */
  /**
   * Gradients are dead as a system (L3). Both ends of the old gradient pair now
   * resolve to the white primary, so every surviving `linear-gradient(a, b)`
   * collapses to the flat, correct Carbon fill instead of stranding a colour.
   * These retire when their components are rebuilt at Gate 3-5.
   */
  accentA: "#f3f4f6",
  accentB: "#f3f4f6",

  /* --- the table ------------------------------------------------------ */
  /**
   * FELT IS OPEN (L16) — the achromatic/whisper-green/no-felt call is judged on
   * the real table organism, together with the floating-stage question. Both
   * candidates ship as tokens so the exploration is a one-line swap; `felt`
   * points at the achromatic option as a PLACEHOLDER, not as a decision.
   */
  felt: "#0a0b0d",
  /** Candidate A — achromatic, one step off the canvas. Current placeholder. */
  feltAchromatic: "#0a0b0d",
  /** Candidate B — whisper green: a hue you feel rather than read. */
  feltWhisperGreen: "#090e0c",
  /** The 1px edge that separates felt from what it sits on. */
  feltEdge: ink[250],
  /** Legacy felt pair. The Carbon felt is flat, so both ends are the same value. */
  felt1: "#0a0b0d",
  felt2: "#0a0b0d",
  /** The rail ringing the felt. */
  rail: ink[150],
  /** Seat plate background. */
  plate: ink[200],

  /* --- cards ---------------------------------------------------------- */
  /** Card stock — the brightest object on screen, by a wide margin, on purpose. */
  cardface: "#f5f7f9",
  /** Ink printed on the card stock. */
  cardInk: "#0f1113",

  /* --- suits (L13 — vivid; the achromatic field is what makes them pop) */
  suitH: "#f04a37",
  suitD: "#2f7ff2",
  suitC: "#0cbd78",
  /**
   * The spade is not a hue. Its identity is maximum contrast against whatever
   * it is printed on, which makes it two tokens: near-black on a card face,
   * near-white on dark chrome. Never resolve one of these to "the spade colour".
   */
  suitSpadeFace: "#050507",
  suitSpadeChrome: "#ffffff",
  /** Legacy single-token spade. Points at the card-face reading (the common case). */
  suitS: "#050507",

  /* --- money and states ----------------------------------------------- */
  /**
   * Win / loss. Deliberately NOT skin-overridable: profit must mean the same
   * colour in every theme, and an accent sharing a hue family with the money
   * colour makes accents read as P&L.
   */
  pos: "#1cb271",
  neg: "#e84a39",
  /** Warning / attention. A state, never decoration. */
  warn: "#e2aa1c",
  /** Analytics encoding base (L10) — data colour, never chrome. */
  chart: "#38c8e6",

  /* --- modes ---------------------------------------------------------- */
  /**
   * Off-the-record accent. Achromatic under L8: a mode indicator is not on the
   * sanctioned-colour list, so it reads in the neutral ramp until a gate says
   * otherwise.
   */
  offRecord: ink[800],
} as const;

export type SemanticTokenName = keyof typeof semantic;

/** A fully-resolved semantic layer: every token, one concrete value. */
export type SemanticTokens = Readonly<Record<SemanticTokenName, string>>;

/** Every semantic token name, in declaration (and therefore emission) order. */
export const semanticTokenNames = Object.keys(semantic) as readonly SemanticTokenName[];
