import { describe, expect, it } from "vitest";
import {
  MISTAKE_IDS_IN_USE,
  envelopeFor,
  resolveFrequencies,
  sizingSetOf,
  validatePersona,
  type Tier,
} from "../persona";
import { CAST, CAST_BY_ID, RIVALS_ARC, castOfTier, personaById } from "./index";

describe("the launch cast", () => {
  it("has twelve characters, two per tier", () => {
    expect(CAST).toHaveLength(12);
    for (const tier of [1, 2, 3, 4, 5, 6] as Tier[]) {
      expect(castOfTier(tier)).toHaveLength(2);
    }
  });

  it("has unique ids and names", () => {
    expect(new Set(CAST.map((p) => p.id)).size).toBe(12);
    expect(new Set(CAST.map((p) => p.name)).size).toBe(12);
    expect(CAST_BY_ID.size).toBe(12);
  });

  it.each(CAST.map((p) => [p.id, p] as const))("%s validates against its tier envelope", (_id, persona) => {
    const result = validatePersona(persona);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(CAST.map((p) => [p.id, p] as const))("%s declares a full character contract", (_id, persona) => {
    expect(persona.tells.length).toBeGreaterThanOrEqual(3);
    expect(persona.sketch.length).toBeGreaterThan(10);
    expect(persona.mistake.label.length).toBeGreaterThan(0);
    expect(persona.timing.floorMs).toBeGreaterThan(0);
    expect(persona.tilt.decayPerHand).toBeGreaterThan(0);
  });

  it("gives every tier-1..5 character exactly one signature tell", () => {
    for (const persona of CAST) {
      const signatures = persona.tells.filter((t) => t.signature === true);
      expect(signatures).toHaveLength(1);
    }
  });

  it("uses a distinct mistake class per character (authored imperfection)", () => {
    const ids = CAST.map((p) => p.mistake.id);
    expect(new Set(ids).size).toBe(12);
    for (const id of ids) expect(MISTAKE_IDS_IN_USE).toContain(id);
  });

  it("reserves deliberate false tells for Vera alone", () => {
    for (const persona of CAST) {
      const heroTargeted = persona.tells.filter((t) => t.trigger.vsHero === true && t.kind !== "banter");
      if (persona.id === "vera") expect(heroTargeted.length).toBeGreaterThan(0);
      else expect(heroTargeted).toHaveLength(0);
    }
  });

  it("keeps tier-6 error rates at or below the locked 0.04 ceiling", () => {
    for (const persona of castOfTier(6)) expect(persona.errorRate).toBeLessThanOrEqual(0.04);
    for (const persona of castOfTier(5)) {
      expect(persona.errorRate).toBeGreaterThanOrEqual(0.04);
      expect(persona.errorRate).toBeLessThanOrEqual(0.1);
    }
  });

  it("orders capability unlocks monotonically up the ladder", () => {
    let seenFiltering = false;
    let seenBlockers = false;
    let seenBalance = false;
    for (const tier of [1, 2, 3, 4, 5, 6] as Tier[]) {
      const caps = envelopeFor(tier).capabilities;
      if (caps.usesRangeFiltering) seenFiltering = true;
      else expect(seenFiltering).toBe(false);
      if (caps.usesBlockers) seenBlockers = true;
      else expect(seenBlockers).toBe(false);
      if (caps.balanceAware) seenBalance = true;
      else expect(seenBalance).toBe(false);
      // Blockers and balance never appear before range filtering.
      if (caps.usesBlockers) expect(caps.usesRangeFiltering).toBe(true);
      if (caps.balanceAware) expect(caps.usesBlockers).toBe(true);
    }
    expect([seenFiltering, seenBlockers, seenBalance]).toEqual([true, true, true]);
  });

  it("resolves both bias unit systems into sane frequencies", () => {
    for (const persona of CAST) {
      const { vpip, pfr } = resolveFrequencies(persona);
      const env = envelopeFor(persona.tier);
      expect(vpip).toBeGreaterThanOrEqual(env.vpipRange[0]);
      expect(vpip).toBeLessThanOrEqual(env.vpipRange[1]);
      expect(pfr).toBeLessThanOrEqual(vpip);
      expect(pfr).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the whales looser than the regs", () => {
    const barry = resolveFrequencies(personaById("barry"));
    const professor = resolveFrequencies(personaById("the-professor"));
    expect(barry.vpip).toBeGreaterThan(professor.vpip);
    expect(barry.pfr).toBeLessThan(professor.pfr);
  });

  it("keeps Doris the lowest PFR on the roster", () => {
    const doris = resolveFrequencies(personaById("doris")).pfr;
    for (const persona of CAST) {
      if (persona.id === "doris") continue;
      expect(resolveFrequencies(persona).pfr).toBeGreaterThanOrEqual(doris);
    }
  });

  it("never lets a persona's value and bluff sizing bands overlap", () => {
    for (const persona of CAST) {
      const sizing = sizingSetOf(persona);
      if (sizing.valueBand === undefined || sizing.bluffBand === undefined) continue;
      expect(sizing.bluffBand[1]).toBeLessThanOrEqual(sizing.valueBand[0]);
    }
  });

  it("names rivals that exist, in arc order", () => {
    expect(RIVALS_ARC).toEqual(["chip", "rocco", "ingrid", "vera"]);
    const tiers = RIVALS_ARC.map((id) => personaById(id).tier);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]).toBeGreaterThan(tiers[i - 1] as number);
    }
  });

  it("rejects an unknown persona id loudly", () => {
    expect(() => personaById("kevin")).toThrow(/unknown persona id/);
  });
});
