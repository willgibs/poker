/**
 * Layer 2 — semantic tokens.
 *
 * Meaning, not appearance. Components may only ever reference this layer (and
 * the non-colour primitives); they never name a primitive colour and never name
 * a skin. Layer 3 (`skins.ts`) reassigns a subset of these, which is the entire
 * cosmetics mechanism — deck skins, card backs, and table themes are unlocks
 * that swap `data-skin`, nothing more.
 *
 * The base values below ARE the default skin, "Afterhours" (DC0 study B).
 */

import { ink } from "./primitives";

export const semantic = {
  /* --- surfaces ------------------------------------------------------- */
  /** The page. Near-black, never pure black. */
  canvas: ink[50],
  /** Panels, sheets, cards resting on the canvas. */
  surface: ink[200],
  /** Hairlines, dividers, resting borders. */
  edge: ink[300],

  /* --- text ----------------------------------------------------------- */
  /** Primary reading colour. */
  text: ink[950],
  /** Secondary prose, supporting numerals. */
  muted: ink[800],
  /** Tertiary chrome: timestamps, disabled, legends. */
  dim: ink[600],

  /* --- brand ---------------------------------------------------------- */
  /** Gradient start. Exactly one gradient CTA may be live per screen. */
  accentA: "#ffb98a",
  /** Gradient end. */
  accentB: "#ff9ec4",
  /** Rings, focus, specular glints. Skin-owned, hue-locked to accentA. */
  glow: "#ffb98a",

  /* --- the table ------------------------------------------------------ */
  /** Felt centre (radial highlight). */
  felt1: "#3a2333",
  /** Felt edge (radial falloff). */
  felt2: "#1d1220",
  /** The padded rail ringing the felt. */
  rail: "#241522",
  /** Seat plate background. */
  plate: "#16121a",

  /* --- cards ---------------------------------------------------------- */
  /** Card stock. */
  cardface: "#fbfaf7",
  /** 4-colour deck — colourblind-safe by construction, not by toggle. */
  suitS: "#16181d",
  suitH: "#d0453a",
  suitD: "#2e6fd8",
  suitC: "#1f9d63",

  /* --- money ---------------------------------------------------------- */
  /**
   * Win / loss. Deliberately NOT skin-overridable: profit must mean the same
   * colour in every theme, and the DC0 menu study showed that an accent sharing
   * a hue family with the money colour makes accents read as P&L (the Midnight
   * mint/win-green collision). Afterhours' peach/rose sits clear of both.
   */
  pos: "#7fe0b0",
  neg: "#f0908c",

  /* --- modes ---------------------------------------------------------- */
  /** Off-the-record accent: slate. Reads on any felt, sells nothing. */
  offRecord: "#9aa2b6",
} as const;

export type SemanticTokenName = keyof typeof semantic;

/** A fully-resolved semantic layer: every token, one concrete value. */
export type SemanticTokens = Readonly<Record<SemanticTokenName, string>>;

/** Every semantic token name, in declaration (and therefore emission) order. */
export const semanticTokenNames = Object.keys(semantic) as readonly SemanticTokenName[];
