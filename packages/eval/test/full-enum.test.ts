/**
 * Full 7-card enumeration: all C(52,7) = 133,784,560 hands through evaluate7
 * must reproduce the published 7-card category counts EXACTLY.
 *
 * Guarded by FULL_ENUM=1 (slow CI job):
 *   FULL_ENUM=1 pnpm vitest run packages/eval
 * Expected runtime: ~10-20s on Apple Silicon (M-series), a few minutes on
 * slower CI runners.
 */

import process from "node:process";
import { describe, it, expect } from "vitest";
import { evaluate7, handCategory, type HandCategory } from "../src/index";

const FULL = process.env["FULL_ENUM"] === "1";

describe("full C(52,7) enumeration", () => {
  it.skipIf(!FULL)(
    "reproduces the published 7-card category counts exactly",
    () => {
      const byClass = new Uint32Array(7463);
      for (let a = 0; a < 46; a++)
        for (let b = a + 1; b < 47; b++)
          for (let c = b + 1; c < 48; c++)
            for (let d = c + 1; d < 49; d++)
              for (let e = d + 1; e < 50; e++)
                for (let f = e + 1; f < 51; f++)
                  for (let g = f + 1; g < 52; g++) {
                    const cls = evaluate7(a, b, c, d, e, f, g);
                    byClass[cls] = byClass[cls]! + 1;
                  }

      const counts: Record<string, number> = {};
      let total = 0;
      for (let cls = 1; cls <= 7462; cls++) {
        const cat = handCategory(cls);
        counts[cat] = (counts[cat] ?? 0) + byClass[cls]!;
        total += byClass[cls]!;
      }
      const expected: Record<HandCategory, number> = {
        "straight-flush": 41584,
        "four-of-a-kind": 224848,
        "full-house": 3473184,
        flush: 4047644,
        straight: 6180020,
        "three-of-a-kind": 6461620,
        "two-pair": 31433400,
        pair: 58627800,
        "high-card": 23294460,
      };
      expect(total).toBe(133784560);
      for (const [cat, want] of Object.entries(expected)) {
        expect(counts[cat] ?? 0, cat).toBe(want);
      }
    },
    900_000,
  );
});
