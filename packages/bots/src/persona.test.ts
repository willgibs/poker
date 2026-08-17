import { describe, expect, it } from "vitest";
import {
  TIER_ENVELOPES,
  capabilitiesFor,
  envelopeFor,
  resolveFrequencies,
  sizingSetOf,
  validatePersona,
  validateTell,
  validateTiming,
  type PersonaConfig,
} from "./persona";
import { BARRY, ROCCO } from "./cast/index";

function mutate(base: PersonaConfig, patch: Partial<PersonaConfig>): PersonaConfig {
  return { ...base, ...patch };
}

describe("tier envelopes", () => {
  it("covers all six tiers with ascending capability", () => {
    expect(Object.keys(TIER_ENVELOPES)).toHaveLength(6);
    expect(capabilitiesFor(1).usesRangeFiltering).toBe(false);
    expect(capabilitiesFor(3).usesRangeFiltering).toBe(true);
    expect(capabilitiesFor(4).usesBlockers).toBe(false);
    expect(capabilitiesFor(5).usesBlockers).toBe(true);
    expect(capabilitiesFor(6).balanceAware).toBe(true);
  });

  it("keeps Monte Carlo trial counts small and ascending with tier", () => {
    let previous = 0;
    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      const trials = envelopeFor(tier).mcTrials;
      expect(trials).toBeGreaterThanOrEqual(previous);
      expect(trials).toBeLessThanOrEqual(400); // fixed and SMALL, per the budget
      previous = trials;
    }
  });

  it("tightens VPIP ranges as the tier climbs", () => {
    const width = (tier: 1 | 2 | 3 | 4 | 5 | 6): number => {
      const [lo, hi] = envelopeFor(tier).vpipRange;
      return hi - lo;
    };
    expect(width(1)).toBeGreaterThan(width(3));
    expect(width(3)).toBeGreaterThan(width(6));
  });

  it("rejects an unknown tier", () => {
    // @ts-expect-error deliberately out of range
    expect(() => envelopeFor(9)).toThrow(/unknown tier/);
  });
});

describe("bias resolution", () => {
  it("maps envelope-normalized -1/0/+1 to floor, midpoint and ceiling", () => {
    const env = envelopeFor(1);
    const at = (bias: number) => resolveFrequencies({ ...BARRY, vpipBias: bias, pfrBias: bias }).vpip;
    expect(at(-1)).toBeCloseTo(env.vpipRange[0], 10);
    expect(at(1)).toBeCloseTo(env.vpipRange[1], 10);
    expect(at(0)).toBeCloseTo((env.vpipRange[0] + env.vpipRange[1]) / 2, 10);
  });

  it("maps probability-points as an absolute offset from the tier baseline", () => {
    const env = envelopeFor(4);
    const baseline = (env.vpipRange[0] + env.vpipRange[1]) / 2;
    expect(resolveFrequencies({ ...ROCCO, vpipBias: 0 }).vpip).toBeCloseTo(baseline, 10);
    expect(resolveFrequencies({ ...ROCCO, vpipBias: 0.05 }).vpip).toBeCloseTo(baseline + 0.05, 10);
  });

  it("clamps into the tier range and never lets PFR exceed VPIP", () => {
    const wild = resolveFrequencies({ ...ROCCO, vpipBias: 5, pfrBias: 5 });
    expect(wild.vpip).toBeLessThanOrEqual(envelopeFor(4).vpipRange[1]);
    expect(wild.pfr).toBeLessThanOrEqual(wild.vpip);
    const passive = resolveFrequencies({ ...BARRY, vpipBias: -1, pfrBias: 1 });
    expect(passive.pfr).toBeLessThanOrEqual(passive.vpip);
  });
});

describe("validatePersona", () => {
  it("accepts the shipped cast", () => {
    expect(validatePersona(BARRY).ok).toBe(true);
    expect(validatePersona(ROCCO).ok).toBe(true);
  });

  it("catches a parameter pushed outside its tier envelope", () => {
    const result = validatePersona(mutate(BARRY, { aggression: 0.95 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/aggression 0.95 is outside its tier envelope/);
  });

  it("catches a tier-6 persona with a tier-1 error rate", () => {
    const result = validatePersona(mutate(ROCCO, { tier: 6, biasUnits: "probability-points", errorRate: 0.5 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/errorRate/);
  });

  it("catches the wrong bias unit convention for the tier", () => {
    const result = validatePersona(mutate(ROCCO, { biasUnits: "envelope-normalized" }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/roster doctrine says "probability-points"/);
  });

  it("catches overlapping value and bluff sizing bands", () => {
    const result = validatePersona(
      mutate(ROCCO, {
        sizing: { ...sizingSetOf(ROCCO), valueBand: [0.4, 1.3], bluffBand: [0.3, 0.6] },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/bands overlap/);
  });

  it("catches more than one signature tell", () => {
    const tells = ROCCO.tells.map((t) => ({ ...t, signature: true as const }));
    const result = validatePersona(mutate(ROCCO, { tells }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/at most one signature tell/);
  });

  it("reports every violation, not just the first", () => {
    const result = validatePersona(
      mutate(BARRY, { aggression: 0.99, tightness: 0.9, callDownTendency: 0.1 }),
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateTell", () => {
  it("requires a timing tell to actually modulate time", () => {
    const result = validateTell({
      id: "x",
      kind: "timing",
      trigger: {},
      behavior: { sizeScale: 2 },
      read: "…",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must modulate think time/);
  });

  it("requires a sizing tell to actually modulate sizing", () => {
    const result = validateTell({
      id: "x",
      kind: "sizing",
      trigger: {},
      behavior: { thinkTimeScale: 2 },
      read: "…",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must modulate sizing/);
  });

  it("rejects an empty strength window and a no-op behavior", () => {
    expect(
      validateTell({
        id: "x",
        kind: "behavior",
        trigger: { minStrength: 0.9, maxStrength: 0.2 },
        behavior: {},
        read: "…",
      }).errors.join(" "),
    ).toMatch(/strength window is empty|does nothing/);
  });

  it("requires a ladder to ascend", () => {
    const result = validateTell({
      id: "x",
      kind: "sizing",
      trigger: {},
      behavior: { sizeLadder: [0.6, 0.3] },
      read: "…",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/must ascend/);
  });
});

describe("validateTiming", () => {
  it("rejects an inverted band", () => {
    const result = validateTiming({
      ...BARRY.timing,
      base: { minMs: 4000, maxMs: 100 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/maxMs must be >= minMs/);
  });

  it("rejects a non-integer floor and a non-positive tilt scale", () => {
    const result = validateTiming({ ...BARRY.timing, floorMs: 12.5, tiltScale: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/floorMs/);
    expect(result.errors.join(" ")).toMatch(/tiltScale/);
  });
});

describe("sizingSetOf", () => {
  it("falls back to the style default when a persona declares no sizing", () => {
    const bare = mutate(ROCCO, {});
    delete (bare as { sizing?: unknown }).sizing;
    expect(sizingSetOf(bare).potFractions.length).toBeGreaterThan(0);
  });

  it("prefers the persona's own vocabulary", () => {
    expect(sizingSetOf(ROCCO).valueBand).toEqual([0.8, 1.3]);
  });
});
