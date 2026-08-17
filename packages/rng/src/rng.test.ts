import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createStream, deriveSeed, hashString, streamFor } from "./index";
import type { RngStream } from "./index";

function draw(stream: RngStream, n: number): number[] {
  return Array.from({ length: n }, () => stream.nextU32());
}

describe("hashString (FNV-1a 32-bit)", () => {
  it("matches published FNV-1a vectors for ASCII input", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(0xe40c292c);
    expect(hashString("foobar")).toBe(0xbf9cf968);
  });

  it("always returns an unsigned 32-bit integer", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hashString(s);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(0x1_0000_0000);
      }),
    );
  });
});

describe("deriveSeed", () => {
  it("is deterministic and label-sensitive", () => {
    expect(deriveSeed(0, "deck")).toBe(deriveSeed(0, "deck"));
    expect(deriveSeed(0, "deck")).toBe(0x79ab1269); // regression vector
    expect(deriveSeed(0, "deck")).not.toBe(deriveSeed(0, "bot"));
    expect(deriveSeed(0, "deck")).not.toBe(deriveSeed(1, "deck"));
  });

  it("normalizes the parent to u32 (parent | parent >>> 0 equivalent)", () => {
    expect(deriveSeed(-1, "x")).toBe(deriveSeed(0xffffffff, "x"));
  });
});

describe("createStream known-answer regression vectors", () => {
  // Computed once from this implementation (splitmix32-seeded xoshiro128**).
  // These must never change: any drift silently invalidates every replay.
  it("first 8 u32 outputs for seed 0", () => {
    expect(draw(createStream(0), 8)).toEqual([
      0x6ab03720, 0x02ae349e, 0x96495024, 0xe5671339,
      0x43d97292, 0x2ca867b9, 0x71383cfe, 0x76ec2c7f,
    ]);
  });

  it("first 8 u32 outputs for seed 0xDEADBEEF", () => {
    expect(draw(createStream(0xdeadbeef), 8)).toEqual([
      0xe5076515, 0x34691d44, 0xdc3818f8, 0xa62df8aa,
      0x37ae13b7, 0x29e51bd9, 0xcbf9d062, 0x0a13fc11,
    ]);
  });
});

describe("determinism", () => {
  it("same seed produces identical first 1000 outputs", () => {
    expect(draw(createStream(12345), 1000)).toEqual(draw(createStream(12345), 1000));
  });

  it("same seed determinism holds for arbitrary seeds (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        expect(draw(createStream(seed), 50)).toEqual(draw(createStream(seed), 50));
      }),
    );
  });

  it("different seeds produce different sequences", () => {
    expect(draw(createStream(1), 1000)).not.toEqual(draw(createStream(2), 1000));
  });

  it("different labels derive streams with different sequences", () => {
    const a = createStream(deriveSeed(777, "deck"));
    const b = createStream(deriveSeed(777, "bot/3/flop/0"));
    expect(draw(a, 1000)).not.toEqual(draw(b, 1000));
  });
});

describe("nextU32 / nextFloat ranges", () => {
  it("nextU32 stays within u32 and nextFloat within [0, 1)", () => {
    const s = createStream(42);
    for (let i = 0; i < 10_000; i++) {
      const u = s.nextU32();
      expect(Number.isInteger(u)).toBe(true);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(0x1_0000_0000);
    }
    const f = createStream(42);
    for (let i = 0; i < 10_000; i++) {
      const x = f.nextFloat();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("nextInt", () => {
  it("respects bounds over 10k draws", () => {
    const s = createStream(0xbadc0de);
    for (let i = 0; i < 10_000; i++) {
      const v = s.nextInt(52);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(52);
    }
  });

  it("respects bounds for arbitrary seeds and bounds (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (seed, bound) => {
          const s = createStream(seed);
          for (let i = 0; i < 20; i++) {
            const v = s.nextInt(bound);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(bound);
          }
        },
      ),
    );
  });

  it("is roughly uniform over 10k draws (chi-square-lite)", () => {
    // 10 buckets, 10k draws, expected 1000 per bucket. Chi-square with 9 dof:
    // p=0.001 critical value is 27.88. Fixed seed, so this is a regression
    // check on uniformity rather than a flaky statistical test.
    const s = createStream(2026);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      const v = s.nextInt(10);
      buckets[v] = (buckets[v] ?? 0) + 1;
    }
    const expected = 1000;
    let chi2 = 0;
    for (const observed of buckets) {
      chi2 += ((observed - expected) * (observed - expected)) / expected;
    }
    expect(chi2).toBeLessThan(27.88);
  });

  it("handles bound 1 and the full u32 bound", () => {
    const s = createStream(7);
    expect(s.nextInt(1)).toBe(0);
    const v = s.nextInt(0x1_0000_0000);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0x1_0000_0000);
  });

  it("rejects invalid bounds", () => {
    const s = createStream(7);
    expect(() => s.nextInt(0)).toThrow(RangeError);
    expect(() => s.nextInt(-5)).toThrow(RangeError);
    expect(() => s.nextInt(2.5)).toThrow(RangeError);
    expect(() => s.nextInt(0x1_0000_0001)).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("produces a permutation of the input, in place", () => {
    const original = Array.from({ length: 52 }, (_, i) => i);
    const arr = [...original];
    const result = createStream(99).shuffle(arr);
    expect(result).toBe(arr); // in place, same reference
    expect([...result].sort((a, b) => a - b)).toEqual(original);
  });

  it("is a permutation for arbitrary arrays and seeds (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.integer({ min: 0, max: 0xffffffff }),
        (arr, seed) => {
          const copy = [...arr];
          createStream(seed).shuffle(copy);
          expect([...copy].sort((a, b) => a - b)).toEqual([...arr].sort((a, b) => a - b));
        },
      ),
    );
  });

  it("is deterministic per seed", () => {
    const deck = (): number[] => Array.from({ length: 52 }, (_, i) => i);
    const a = createStream(4242).shuffle(deck());
    const b = createStream(4242).shuffle(deck());
    expect(a).toEqual(b);
  });

  it("different seeds give different orders (for a 52-card deck)", () => {
    const deck = (): number[] => Array.from({ length: 52 }, (_, i) => i);
    const a = createStream(1).shuffle(deck());
    const b = createStream(2).shuffle(deck());
    expect(a).not.toEqual(b);
  });

  it("handles empty and single-element arrays", () => {
    const s = createStream(5);
    expect(s.shuffle([])).toEqual([]);
    expect(s.shuffle(["x"])).toEqual(["x"]);
  });
});

describe("fork", () => {
  it("child draws do not affect the parent sequence", () => {
    const reference = draw(createStream(31337), 1000);

    const parent = createStream(31337);
    const first500 = draw(parent, 500);
    const child = parent.fork("child");
    draw(child, 250); // consume the child heavily mid-stream
    const last500 = draw(parent, 500);

    expect([...first500, ...last500]).toEqual(reference);
  });

  it("fork is keyed by seed and label, not stream position", () => {
    const a = createStream(31337);
    const b = createStream(31337);
    draw(b, 123); // advance one parent; forks must still agree
    expect(draw(a.fork("deck"), 100)).toEqual(draw(b.fork("deck"), 100));
  });

  it("different fork labels yield different sequences", () => {
    const parent = createStream(8);
    expect(draw(parent.fork("a"), 1000)).not.toEqual(draw(parent.fork("b"), 1000));
  });

  it("forks of forks are deterministic", () => {
    const a = createStream(1).fork("hand").fork("deck");
    const b = createStream(1).fork("hand").fork("deck");
    expect(draw(a, 100)).toEqual(draw(b, 100));
  });
});

describe("streamFor", () => {
  it("derives segment by segment, matching manual deriveSeed chaining", () => {
    const manual = createStream(deriveSeed(deriveSeed(deriveSeed(555, "hand"), "42"), "deck"));
    expect(draw(streamFor(555, "hand/42/deck"), 100)).toEqual(draw(manual, 100));
  });

  it("accepts a string root seed via hashString", () => {
    const fromString = streamFor("session-1", "hand/42/deck");
    const fromNumber = streamFor(hashString("session-1"), "hand/42/deck");
    expect(draw(fromString, 100)).toEqual(draw(fromNumber, 100));
  });

  it("different paths produce different streams", () => {
    expect(draw(streamFor(9, "hand/1/deck"), 1000)).not.toEqual(
      draw(streamFor(9, "hand/2/deck"), 1000),
    );
    expect(draw(streamFor(9, "hand/1/deck"), 1000)).not.toEqual(
      draw(streamFor(9, "hand/1/mc"), 1000),
    );
  });

  it("ignores empty segments (leading/trailing/doubled slashes)", () => {
    expect(draw(streamFor(3, "/hand//42/deck/"), 50)).toEqual(
      draw(streamFor(3, "hand/42/deck"), 50),
    );
  });

  it("path derivation equals iterated forking from the root stream's seed space", () => {
    const viaPath = streamFor(777, "hand/42");
    const viaFork = createStream(deriveSeed(777, "hand")).fork("42");
    expect(draw(viaPath, 100)).toEqual(draw(viaFork, 100));
  });
});
