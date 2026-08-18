import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COMBO_COUNT, HAND169_COUNT } from "@poker/core";
import { CLASS_OF_COMBO, COMBOS_OF_CLASS, clone, createRange, fullRange, total } from "./range";
import {
  POLARIZE_BOTTOM_FRACTION,
  aggressionTransfer,
  assertRanking,
  polarize,
  rankingMidpoints,
  tighten,
  topPercentByRanking,
} from "./distort";
import { DEFAULT_PREFLOP_RANKING } from "./ranking";
import { expectUnitInterval, lcg, pseudoRange } from "./test-helpers";

const seedArb = fc.integer({ min: 0, max: 0x7fffffff });
const unitArb = fc.double({ min: 0, max: 1, noNaN: true });
const R = DEFAULT_PREFLOP_RANKING;

function expectClose(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/** A deterministic non-default ranking: reverse of the default. */
const reversedRanking = Uint16Array.from(Array.from(R).reverse());

describe("rankingMidpoints", () => {
  it("assigns increasing midpoints along the ranking, all inside (0,1)", () => {
    const mids = rankingMidpoints(R);
    let prev = 0;
    for (let p = 0; p < HAND169_COUNT; p++) {
      const q = mids[R[p]!]!;
      expect(q).toBeGreaterThan(prev);
      expect(q).toBeLessThan(1);
      prev = q;
    }
  });

  it("caches per ranking object", () => {
    expect(rankingMidpoints(R)).toBe(rankingMidpoints(R));
    expect(rankingMidpoints(reversedRanking)).not.toBe(rankingMidpoints(R));
  });

  it("rejects malformed rankings", () => {
    expect(() => assertRanking(new Uint16Array(5))).toThrow(RangeError);
    const dup = Uint16Array.from(R);
    dup[1] = dup[0]!;
    expect(() => assertRanking(dup)).toThrow(RangeError);
    const oob = Uint16Array.from(R);
    oob[0] = 169;
    expect(() => assertRanking(oob)).toThrow(RangeError);
  });
});

describe("topPercentByRanking", () => {
  it("is empty at 0, full at 1", () => {
    expect(total(topPercentByRanking(0, R))).toBe(0);
    expect(total(topPercentByRanking(1, R))).toBe(COMBO_COUNT);
  });

  it("holds ~pct of combo mass and is monotone in pct (property)", () => {
    fc.assert(
      fc.property(unitArb, unitArb, (p1, p2) => {
        const lo = Math.min(p1, p2);
        const hi = Math.max(p1, p2);
        const rLo = topPercentByRanking(lo, R);
        const rHi = topPercentByRanking(hi, R);
        expectUnitInterval(rLo);
        expectUnitInterval(rHi);
        expectClose(total(rLo), lo * COMBO_COUNT, 0.06 * COMBO_COUNT + 12);
        expect(total(rHi)).toBeGreaterThanOrEqual(total(rLo) - 1e-3);
      }),
    );
  });

  it("softness=0 gives hard 0/1 edges; soft edges have a falloff band", () => {
    const hard = topPercentByRanking(0.3, R, 0);
    for (let i = 0; i < COMBO_COUNT; i++) {
      expect(hard[i] === 0 || hard[i] === 1).toBe(true);
    }
    const soft = topPercentByRanking(0.3, R, 0.05);
    let fractional = 0;
    for (let i = 0; i < COMBO_COUNT; i++) {
      const w = soft[i]!;
      if (w > 0 && w < 1) fractional++;
    }
    expect(fractional).toBeGreaterThan(0);
  });

  it("stronger classes get weight before weaker ones", () => {
    const r = topPercentByRanking(0.15, R);
    const mids = rankingMidpoints(R);
    const aaCombo = COMBOS_OF_CLASS[R[0]!]![0]!;
    const worstCombo = COMBOS_OF_CLASS[R[168]!]![0]!;
    expect(r[aaCombo]).toBe(1);
    expect(r[worstCombo]).toBe(0);
    // weight is non-increasing in class midpoint
    for (let i = 1; i < COMBO_COUNT; i++) {
      const qa = mids[CLASS_OF_COMBO[i - 1]!]!;
      const qb = mids[CLASS_OF_COMBO[i]!]!;
      if (qa <= qb) expect(r[i - 1]!).toBeGreaterThanOrEqual(r[i]!);
    }
  });
});

describe("tighten", () => {
  it("is the identity at tightness 0", () => {
    const r = pseudoRange(11);
    expect(Array.from(tighten(r, 0, R))).toEqual(Array.from(r));
  });

  it("is monotone: higher tightness => fewer effective combos (property)", () => {
    fc.assert(
      fc.property(seedArb, unitArb, unitArb, (seed, t1, t2) => {
        const lo = Math.min(t1, t2);
        const hi = Math.max(t1, t2);
        const r = pseudoRange(seed);
        const tLo = tighten(r, lo, R);
        const tHi = tighten(r, hi, R);
        expectUnitInterval(tLo);
        expectUnitInterval(tHi);
        expect(total(tHi)).toBeLessThanOrEqual(total(tLo) + 1e-3);
        // never adds weight anywhere
        for (let i = 0; i < COMBO_COUNT; i++) {
          expect(tHi[i]!).toBeLessThanOrEqual(r[i]! + 1e-7);
        }
      }),
    );
  });

  it("strictly shrinks a full range as tightness rises", () => {
    const full = fullRange();
    const t2 = total(tighten(full, 0.2, R));
    const t5 = total(tighten(full, 0.5, R));
    const t8 = total(tighten(full, 0.8, R));
    expect(t2).toBeLessThan(COMBO_COUNT);
    expect(t5).toBeLessThan(t2);
    expect(t8).toBeLessThan(t5);
  });

  it("keeps more of the top of the ranking than the bottom", () => {
    const t = tighten(fullRange(), 0.5, R);
    const best = COMBOS_OF_CLASS[R[0]!]![0]!;
    const worst = COMBOS_OF_CLASS[R[168]!]![0]!;
    expect(t[best]!).toBeGreaterThan(t[worst]!);
  });
});

describe("aggressionTransfer", () => {
  /** Branch pair with passive[i] + aggressive[i] <= 1 (a real partition). */
  function branchPair(seed: number): { p: Float32Array; a: Float32Array } {
    const next = lcg(seed);
    const p = createRange();
    const a = createRange();
    for (let i = 0; i < COMBO_COUNT; i++) {
      const u = next();
      const v = next();
      p[i] = u * v;
      a[i] = (1 - u) * v;
    }
    return { p, a };
  }

  it("conserves per-combo mass and moves it the right way (property)", () => {
    fc.assert(
      fc.property(seedArb, fc.double({ min: -1, max: 1, noNaN: true }), (seed, t) => {
        const { p, a } = branchPair(seed);
        const { passive, aggressive } = aggressionTransfer(p, a, t);
        expectUnitInterval(passive);
        expectUnitInterval(aggressive);
        for (let i = 0; i < COMBO_COUNT; i++) {
          expectClose(passive[i]! + aggressive[i]!, p[i]! + a[i]!, 1e-6);
          if (t >= 0) {
            expect(aggressive[i]!).toBeGreaterThanOrEqual(a[i]! - 1e-7);
            expect(passive[i]!).toBeLessThanOrEqual(p[i]! + 1e-7);
          } else {
            expect(passive[i]!).toBeGreaterThanOrEqual(p[i]! - 1e-7);
            expect(aggressive[i]!).toBeLessThanOrEqual(a[i]! + 1e-7);
          }
        }
      }),
    );
  });

  it("transfer=1 empties the passive branch; transfer=0 is the identity", () => {
    const { p, a } = branchPair(3);
    const all = aggressionTransfer(p, a, 1);
    expect(total(all.passive)).toBe(0);
    expectClose(total(all.aggressive), total(p) + total(a), 1e-2);
    const none = aggressionTransfer(p, a, 0);
    expect(Array.from(none.passive)).toEqual(Array.from(p));
    expect(Array.from(none.aggressive)).toEqual(Array.from(a));
  });

  it("clamps rather than exceed weight 1 on malformed inputs", () => {
    const p = fullRange();
    const a = fullRange();
    const { passive, aggressive } = aggressionTransfer(p, a, 1);
    expectUnitInterval(passive);
    expectUnitInterval(aggressive);
    expect(aggressive.every((w) => w === 1)).toBe(true);
    expect(passive.every((w) => w === 1)).toBe(true); // nothing could move
  });

  it("is monotone in transfer: total aggressive mass rises as transfer rises (property)", () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (seed, t1, t2) => {
          const lo = Math.min(t1, t2);
          const hi = Math.max(t1, t2);
          const { p, a } = branchPair(seed);
          const totalMass = total(p) + total(a); // conserved regardless of t
          const rLo = aggressionTransfer(p, a, lo);
          const rHi = aggressionTransfer(p, a, hi);
          expectClose(total(rLo.passive) + total(rLo.aggressive), totalMass, 1e-2);
          expectClose(total(rHi.passive) + total(rHi.aggressive), totalMass, 1e-2);
          expect(total(rHi.aggressive)).toBeGreaterThanOrEqual(total(rLo.aggressive) - 1e-3);
        },
      ),
    );
  });

  it("preserves normalization: a branch pair that starts summed to 1 stays summed to 1", () => {
    fc.assert(
      fc.property(seedArb, fc.double({ min: -1, max: 1, noNaN: true }), (seed, t) => {
        const { p, a } = branchPair(seed);
        // Rescale the pair jointly so passive+aggressive is a normalized
        // distribution over the two branches (total mass exactly 1).
        const mass = total(p) + total(a);
        if (mass <= 0) return; // degenerate all-zero draw, nothing to normalize
        const inv = 1 / mass;
        for (let i = 0; i < COMBO_COUNT; i++) {
          p[i] = (p[i] as number) * inv;
          a[i] = (a[i] as number) * inv;
        }
        expectClose(total(p) + total(a), 1, 1e-3);
        const { passive, aggressive } = aggressionTransfer(p, a, t);
        expectClose(total(passive) + total(aggressive), 1, 1e-3); // still normalized
      }),
    );
  });
});

describe("polarize", () => {
  it("adds weight ONLY to bottom-of-ranking combos (property)", () => {
    fc.assert(
      fc.property(seedArb, unitArb, (seed, bluff) => {
        const r = pseudoRange(seed);
        const before = clone(r);
        const out = polarize(r, bluff, R);
        expectUnitInterval(out);
        const mids = rankingMidpoints(R);
        const bandStart = 1 - POLARIZE_BOTTOM_FRACTION;
        for (let i = 0; i < COMBO_COUNT; i++) {
          const q = mids[CLASS_OF_COMBO[i]!]!;
          if (q <= bandStart) {
            expect(out[i]).toBe(r[i]); // bit-exact untouched
          } else {
            expect(out[i]!).toBeGreaterThanOrEqual(r[i]!);
            expect(out[i]!).toBeLessThanOrEqual(1);
          }
        }
        expect(Array.from(r)).toEqual(Array.from(before)); // pure
      }),
    );
  });

  it("bluffWeight=0 is the identity; deeper trash gains more", () => {
    const r = pseudoRange(5);
    expect(Array.from(polarize(r, 0, R))).toEqual(Array.from(r));

    const out = polarize(createRange(), 0.6, R);
    const worst = COMBOS_OF_CLASS[R[168]!]![0]!; // deepest class
    const shallower = COMBOS_OF_CLASS[R[150]!]![0]!; // inside band, higher up
    expect(out[worst]!).toBeGreaterThan(out[shallower]!);
    expect(total(out)).toBeGreaterThan(0);
  });

  it("respects a custom bottomFraction and validates it", () => {
    const out = polarize(createRange(), 1, R, 0.1);
    const mids = rankingMidpoints(R);
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (mids[CLASS_OF_COMBO[i]!]! <= 0.9) expect(out[i]).toBe(0);
    }
    expect(() => polarize(createRange(), 1, R, 0)).toThrow(RangeError);
    expect(() => polarize(createRange(), 1, R, 1.5)).toThrow(RangeError);
  });

  it("is monotone in bluffWeight: more bluff weight never lowers a combo's weight (property)", () => {
    fc.assert(
      fc.property(seedArb, unitArb, unitArb, (seed, b1, b2) => {
        const lo = Math.min(b1, b2);
        const hi = Math.max(b1, b2);
        const r = pseudoRange(seed);
        const pLo = polarize(r, lo, R);
        const pHi = polarize(r, hi, R);
        expectUnitInterval(pLo);
        expectUnitInterval(pHi);
        for (let i = 0; i < COMBO_COUNT; i++) {
          expect(pHi[i]!).toBeGreaterThanOrEqual(pLo[i]! - 1e-7);
        }
        expect(total(pHi)).toBeGreaterThanOrEqual(total(pLo) - 1e-3);
      }),
    );
  });
});

describe("input validation", () => {
  it("rejects out-of-domain parameters on every distortion op", () => {
    const r = pseudoRange(1);
    expect(() => topPercentByRanking(-0.1, R)).toThrow(RangeError);
    expect(() => topPercentByRanking(1.1, R)).toThrow(RangeError);
    expect(() => topPercentByRanking(0.5, R, -0.01)).toThrow(RangeError);
    expect(() => topPercentByRanking(0.5, R, 0.51)).toThrow(RangeError);
    expect(() => topPercentByRanking(0.5, R, Number.NaN)).toThrow(RangeError);

    expect(() => tighten(r, -0.1, R)).toThrow(RangeError);
    expect(() => tighten(r, 1.1, R)).toThrow(RangeError);
    expect(() => tighten(r, Number.NaN, R)).toThrow(RangeError);

    expect(() => aggressionTransfer(r, r, -1.1)).toThrow(RangeError);
    expect(() => aggressionTransfer(r, r, 1.1)).toThrow(RangeError);
    expect(() => aggressionTransfer(r, r, Number.NaN)).toThrow(RangeError);

    expect(() => polarize(r, -0.1, R)).toThrow(RangeError);
    expect(() => polarize(r, 1.1, R)).toThrow(RangeError);
    expect(() => polarize(r, Number.NaN, R)).toThrow(RangeError);
  });

  it("rejects malformed range/ranking arguments", () => {
    const bad = new Float32Array(5);
    const full = fullRange();
    expect(() => tighten(bad, 0.5, R)).toThrow(RangeError);
    expect(() => aggressionTransfer(bad, full, 0.5)).toThrow(RangeError);
    expect(() => aggressionTransfer(full, bad, 0.5)).toThrow(RangeError);
    expect(() => polarize(bad, 0.5, R)).toThrow(RangeError);

    const shortRanking = new Uint16Array(10);
    expect(() => topPercentByRanking(0.5, shortRanking)).toThrow(RangeError);
    expect(() => tighten(full, 0.5, shortRanking)).toThrow(RangeError);
    expect(() => polarize(full, 0.5, shortRanking)).toThrow(RangeError);
  });
});

describe("determinism", () => {
  it("independent calls with identical inputs produce bit-identical output", () => {
    const r = pseudoRange(55);
    const { p, a } = (() => {
      const next = lcg(66);
      const pp = createRange();
      const aa = createRange();
      for (let i = 0; i < COMBO_COUNT; i++) {
        const u = next();
        const v = next();
        pp[i] = u * v;
        aa[i] = (1 - u) * v;
      }
      return { p: pp, a: aa };
    })();

    expect(Array.from(topPercentByRanking(0.3, R))).toEqual(Array.from(topPercentByRanking(0.3, R)));
    expect(Array.from(tighten(r, 0.4, R))).toEqual(Array.from(tighten(r, 0.4, R)));
    expect(Array.from(polarize(r, 0.2, R))).toEqual(Array.from(polarize(r, 0.2, R)));

    const run1 = aggressionTransfer(p, a, 0.25);
    const run2 = aggressionTransfer(p, a, 0.25);
    expect(Array.from(run1.passive)).toEqual(Array.from(run2.passive));
    expect(Array.from(run1.aggressive)).toEqual(Array.from(run2.aggressive));
  });
});
