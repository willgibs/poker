/**
 * Layer 3 — skins.
 *
 * A skin is nothing but a set of semantic overrides. That is the whole
 * cosmetics engine: table themes, deck skins, and card backs are career unlocks
 * that flip `data-skin` on the document root, and every component follows for
 * free because components only ever speak semantic.
 *
 * Ship set (DC0):
 *   - afterhours  DEFAULT. Plum felt, peach->rose. "Late-night home game."
 *   - midnight    Green felt, mint->lavender. First unlockable table theme.
 *   - cardroom    Cardroom green, gold->sage. Prestige cosmetics line.
 *
 * A skin may not touch `pos` / `neg` — see the note in `semantic.ts`.
 */

import { semantic } from "./semantic";
import type { SemanticTokenName, SemanticTokens } from "./semantic";

export const skinNames = ["afterhours", "midnight", "cardroom"] as const;
export type SkinName = (typeof skinNames)[number];

export const DEFAULT_SKIN: SkinName = "afterhours";

/** A partial semantic layer. Absent keys fall through to the base. */
export type SkinOverrides = Readonly<Partial<Record<SemanticTokenName, string>>>;

export const skins: Readonly<Record<SkinName, SkinOverrides>> = {
  /** The base semantic layer IS Afterhours; it overrides nothing by design. */
  afterhours: {},

  midnight: {
    accentA: "#7fe0c3",
    accentB: "#c9b8ff",
    glow: "#7fe0c3",
    felt1: "#1a3a2f",
    felt2: "#0e211a",
    rail: "#14261f",
    plate: "#101a16",
  },

  cardroom: {
    accentA: "#e8c87a",
    accentB: "#8fb89a",
    glow: "#e8c87a",
    felt1: "#2e5c48",
    felt2: "#163024",
    rail: "#1d3a2c",
    plate: "#12201a",
  },
};

/**
 * Collapse a skin onto the base semantic layer. Total by construction: every
 * semantic token comes back with a concrete value under every skin.
 */
export function resolveSkin(skin: SkinName): SemanticTokens {
  const resolved: Record<string, string> = { ...semantic };
  for (const [name, value] of Object.entries(skins[skin])) {
    if (typeof value === "string") resolved[name] = value;
  }
  return resolved as SemanticTokens;
}
