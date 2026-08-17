/**
 * Side-pot oracle: buildPots vs a brute-force cent-by-cent allocator.
 *
 * The oracle walks every cent level 1..maxCommitted and assigns that level's
 * cents (one per seat committed that far) to the pot keyed by the set of
 * non-folded seats still contesting that level; cents above the highest
 * contested level (folded overage) join the last contested pot. This is an
 * independent construction of the layered side-pot rule.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildPots, type PotEntry } from "../src/index";

interface OraclePot {
  amount: number;
  eligible: string; // sorted seat key
}

function oracle(entries: readonly PotEntry[]): OraclePot[] {
  const active = entries.filter((e) => !e.folded && e.committed > 0);
  const maxCommitted = Math.max(0, ...entries.map((e) => e.committed));
  const pots: OraclePot[] = [];
  let last: OraclePot | null = null;
  for (let level = 1; level <= maxCommitted; level++) {
    const cents = entries.filter((e) => e.committed >= level).length;
    if (cents === 0) continue;
    const contesting = active.filter((e) => e.committed >= level).map((e) => e.seat);
    if (contesting.length === 0) {
      // Folded overage above the top contested level: joins the last pot.
      if (last === null) throw new Error("cents with no contender");
      last.amount += cents;
      continue;
    }
    const key = [...contesting].sort((a, b) => a - b).join(",");
    if (last !== null && last.eligible === key) {
      last.amount += cents;
    } else {
      last = { amount: cents, eligible: key };
      pots.push(last);
    }
  }
  return pots;
}

function normalize(pots: ReturnType<typeof buildPots>): OraclePot[] {
  return pots.map((p) => ({
    amount: p.amount,
    eligible: [...p.eligible].sort((a, b) => a - b).join(","),
  }));
}

describe("buildPots vs brute-force oracle", () => {
  it("matches the oracle on fuzzed all-in scenarios", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            committed: fc.integer({ min: 1, max: 400 }),
            folded: fc.boolean(),
          }),
          { minLength: 2, maxLength: 9 },
        ),
        (rows) => {
          const entries: PotEntry[] = rows.map((r, i) => ({ seat: i, ...r }));
          // Engine precondition: at least one non-folded contender.
          if (entries.every((e) => e.folded)) entries[0]!.folded = false;

          const got = normalize(buildPots(entries));
          expect(got).toEqual(oracle(entries));

          // Conservation: pots exactly redistribute all committed chips.
          const total = entries.reduce((a, e) => a + e.committed, 0);
          expect(got.reduce((a, p) => a + p.amount, 0)).toBe(total);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("eligibility strictly shrinks and the main pot has every contender", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            committed: fc.integer({ min: 1, max: 50 }),
            folded: fc.boolean(),
          }),
          { minLength: 2, maxLength: 9 },
        ),
        (rows) => {
          const entries: PotEntry[] = rows.map((r, i) => ({ seat: i, ...r }));
          if (entries.every((e) => e.folded)) entries[0]!.folded = false;
          const pots = buildPots(entries);
          const contenders = entries.filter((e) => !e.folded).map((e) => e.seat);
          expect(pots[0]!.eligible).toEqual(contenders);
          for (let i = 1; i < pots.length; i++) {
            const prev = new Set(pots[i - 1]!.eligible);
            expect(pots[i]!.eligible.length).toBeLessThan(prev.size);
            for (const s of pots[i]!.eligible) expect(prev.has(s)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("handles the textbook 3-way layering", () => {
    const pots = buildPots([
      { seat: 0, committed: 1000, folded: false },
      { seat: 1, committed: 300, folded: false },
      { seat: 2, committed: 800, folded: false },
      { seat: 3, committed: 150, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 1050, eligible: [0, 1, 2] }, // 300×3 + 150 dead
      { amount: 1000, eligible: [0, 2] }, // (800−300)×2
      { amount: 200, eligible: [0] }, // uncalled
    ]);
  });
});
