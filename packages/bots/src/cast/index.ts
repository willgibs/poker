/**
 * The launch cast — 12 characters, two per tier.
 *
 * Each file is a straight transcription of that character's bible
 * (`poker-internal/content/characters/*.md`): parameters, deterministic tells,
 * timing signature, characteristic mistake class and mood arc. Banter is
 * content-layer and deliberately out of scope here; the tells that leak
 * through chat are recorded as `banter`-kind specs so the content layer has
 * one schema to read from.
 *
 * `cast.test.ts` validates every entry against its tier envelope, so a
 * parameter drifting out of band is a failing test, not a subtle behaviour bug.
 */

import type { PersonaConfig, Tier } from "../persona";

import { BARRY } from "./barry";
import { LUNA } from "./luna";
import { CHIP } from "./chip";
import { DORIS } from "./doris";
import { HANK } from "./hank";
import { PRIYA } from "./priya";
import { ROCCO } from "./rocco";
import { MAXINE } from "./maxine";
import { SILAS } from "./silas";
import { INGRID } from "./ingrid";
import { THE_PROFESSOR } from "./theProfessor";
import { VERA } from "./vera";

export { BARRY } from "./barry";
export { LUNA } from "./luna";
export { CHIP } from "./chip";
export { DORIS } from "./doris";
export { HANK } from "./hank";
export { PRIYA } from "./priya";
export { ROCCO } from "./rocco";
export { MAXINE } from "./maxine";
export { SILAS } from "./silas";
export { INGRID } from "./ingrid";
export { THE_PROFESSOR } from "./theProfessor";
export { VERA } from "./vera";

/** All twelve, in roster order (tier 1 first, two per tier). */
export const CAST: readonly PersonaConfig[] = [
  BARRY,
  LUNA,
  CHIP,
  DORIS,
  HANK,
  PRIYA,
  ROCCO,
  MAXINE,
  SILAS,
  INGRID,
  THE_PROFESSOR,
  VERA,
];

/** Cast lookup by persona id. */
export const CAST_BY_ID: ReadonlyMap<string, PersonaConfig> = new Map(
  CAST.map((p) => [p.id, p] as const),
);

/** Persona by id. Throws on an unknown id — a typo should not silently seat a whale. */
export function personaById(id: string): PersonaConfig {
  const p = CAST_BY_ID.get(id);
  if (p === undefined) throw new RangeError(`unknown persona id: ${JSON.stringify(id)}`);
  return p;
}

/** The two characters of a tier, in roster order. */
export function castOfTier(tier: Tier): readonly PersonaConfig[] {
  return CAST.filter((p) => p.tier === tier);
}

/**
 * The rivals arc (PRD "Content Architecture"): Chip early, Rocco mid, Ingrid
 * late, Vera endgame.
 */
export const RIVALS_ARC: readonly string[] = ["chip", "rocco", "ingrid", "vera"];
