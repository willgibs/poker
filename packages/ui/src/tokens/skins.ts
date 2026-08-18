/**
 * Layer 3 — skins.
 *
 * A skin is nothing but a set of semantic overrides. That is the whole
 * cosmetics engine: table themes, deck skins, and card backs are career unlocks
 * that flip `data-skin` on the document root, and every component follows for
 * free because components only ever speak semantic.
 *
 * Ship set (Gate 1):
 *   - carbon  DEFAULT and, for now, ONLY. The locked foundation (L12).
 *
 * The pre-Carbon trio (afterhours / midnight / cardroom) is deleted, not
 * migrated: all three were built on gradient accents and coloured felts, which
 * L3 and L8 retired. Cosmetic skins return as a career-unlock surface once
 * Gate 3-5 says what a skin is allowed to touch under Signal — the mechanism
 * below is kept intact and exercised so that reopening it is a data change.
 *
 * A skin may not touch `pos` / `neg` — see the note in `semantic.ts`.
 */

import { semantic } from "./semantic";
import type { SemanticTokenName, SemanticTokens } from "./semantic";

export const skinNames = ["carbon"] as const;
export type SkinName = (typeof skinNames)[number];

export const DEFAULT_SKIN: SkinName = "carbon";

/** A partial semantic layer. Absent keys fall through to the base. */
export type SkinOverrides = Readonly<Partial<Record<SemanticTokenName, string>>>;

export const skins: Readonly<Record<SkinName, SkinOverrides>> = {
  /** The base semantic layer IS Carbon; it overrides nothing by design. */
  carbon: {},
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
