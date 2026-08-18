/**
 * The ground-truth policy adapter.
 *
 * The claim this file exists to keep honest: the likelihood the grader is
 * handed is the SAME generative model the bot decided with, not a lookalike.
 * `likelihoodOf` is checked against `@poker/bots`' own `policyLikelihood` over a
 * dense grid of (action, size, strength, persona) — if the bots package ever
 * retunes its curves, this fails until the adapter follows.
 */

import { describe, expect, it } from "vitest";
import type { VillainActionContext } from "@poker/analysis";
import { CAST, DEFAULT_POLICY_PARAMS, personaById, policyLikelihood, type PolicyParams } from "@poker/bots";
import type { ActionKind } from "@poker/history";
import { groundTruthPolicy, likelihoodOf, meanPolicyParams, policyParamsOf } from "./policy";

const ACTIONS: readonly ActionKind[] = ["fold", "check", "call", "bet", "raise"];
const RANGE_SIZE = 1326;

function strengthTable(value: number, at: number): Float32Array {
  const arr = new Float32Array(RANGE_SIZE);
  arr[at] = value;
  return arr;
}

describe("policyParamsOf", () => {
  it("reads a persona's declared parameters, unmodified", () => {
    const barry = personaById("barry");
    expect(policyParamsOf(barry)).toEqual({
      aggression: barry.aggression,
      bluffFrequency: barry.bluffFrequency,
      callDownTendency: barry.callDownTendency,
      tightness: barry.tightness,
    });
  });

  it("separates the station from the over-folder", () => {
    expect(policyParamsOf(personaById("barry")).callDownTendency).toBeGreaterThan(
      policyParamsOf(personaById("priya")).callDownTendency,
    );
  });
});

describe("meanPolicyParams", () => {
  it("is the neutral model for an empty table", () => {
    expect(meanPolicyParams([])).toEqual(DEFAULT_POLICY_PARAMS);
  });

  it("averages component-wise", () => {
    const a: PolicyParams = { aggression: 0.2, bluffFrequency: 0.1, callDownTendency: 0.9, tightness: 0.3 };
    const b: PolicyParams = { aggression: 0.4, bluffFrequency: 0.3, callDownTendency: 0.5, tightness: 0.7 };
    const mean = meanPolicyParams([a, b]);
    expect(mean.aggression).toBeCloseTo(0.3, 12);
    expect(mean.bluffFrequency).toBeCloseTo(0.2, 12);
    expect(mean.callDownTendency).toBeCloseTo(0.7, 12);
    expect(mean.tightness).toBeCloseTo(0.5, 12);
  });
});

describe("likelihoodOf mirrors @poker/bots' policyLikelihood exactly", () => {
  it("agrees on every action, size and strength, for every character", () => {
    const comboIndex = 613;
    let checks = 0;
    for (const persona of CAST) {
      const params = policyParamsOf(persona);
      for (const action of ACTIONS) {
        for (const sizeFraction of [0, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2.5]) {
          for (let s = 0; s <= 1.0001; s += 0.05) {
            // The bots package reads strengths out of a Float32Array; read the
            // rounded value back so the comparison is of the MODEL, not of f32
            // vs f64 storage.
            const table = strengthTable(Math.min(1, s), comboIndex);
            const strength = table[comboIndex] as number;
            const expected = policyLikelihood({
              action,
              street: "flop",
              sizeFraction,
              strength: table,
              params,
            })(comboIndex);
            expect(likelihoodOf(action, sizeFraction, strength, params)).toBe(expected);
            checks += 1;
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(9_000);
  });

  it("stays a finite probability at the extremes (the filter's epsilon does the rest)", () => {
    for (const persona of CAST) {
      const params = policyParamsOf(persona);
      for (const action of ACTIONS) {
        for (const [size, strength] of [
          [0, 0],
          [0, 1],
          [3, 0],
          [3, 1],
        ] as const) {
          const v = likelihoodOf(action, size, strength, params);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is monotone in strength for value aggression", () => {
    const params = policyParamsOf(personaById("the-professor"));
    let previous = -1;
    for (let s = 0.3; s <= 1; s += 0.05) {
      const v = likelihoodOf("bet", 0.75, s, params);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });
});

describe("groundTruthPolicy", () => {
  const ctx = (seat: number, kind: ActionKind, strength: number): VillainActionContext => ({
    seat,
    street: "flop",
    kind,
    potBefore: 1_000,
    toCall: 500,
    invested: 500,
    board: [],
    livePlayers: 2,
    sizeFraction: 0.5,
    aggressionIndex: 0,
    strength,
  });

  it("uses the seated character's own parameters", () => {
    const personas = new Map([
      [1, personaById("barry")],
      [2, personaById("priya")],
    ]);
    const policy = groundTruthPolicy(personas);
    // The station folds a marginal holding far less often than the over-folder.
    expect(policy(ctx(1, "fold", 0.45), 0)).toBeLessThan(policy(ctx(2, "fold", 0.45), 0));
  });

  it("matches likelihoodOf for a seated character", () => {
    const persona = personaById("rocco");
    const policy = groundTruthPolicy(new Map([[3, persona]]));
    expect(policy(ctx(3, "bet", 0.8), 0)).toBe(
      likelihoodOf("bet", 0.5, 0.8, policyParamsOf(persona)),
    );
  });

  it("falls back to the table's mean character for an unseated seat (hero)", () => {
    const personas = new Map([
      [1, personaById("barry")],
      [2, personaById("vera")],
    ]);
    const policy = groundTruthPolicy(personas);
    const mean = meanPolicyParams([policyParamsOf(personaById("barry")), policyParamsOf(personaById("vera"))]);
    expect(policy(ctx(0, "call", 0.6), 0)).toBe(likelihoodOf("call", 0.5, 0.6, mean));
  });

  it("clamps a negative strength rather than extrapolating", () => {
    const policy = groundTruthPolicy(new Map([[1, personaById("hank")]]));
    expect(policy(ctx(1, "bet", -0.5), 0)).toBe(policy(ctx(1, "bet", 0), 0));
  });
});
