/**
 * Table generator for the two-table 7-card evaluator (phevaluator-style
 * scheme, implemented from first principles — no code copied).
 *
 * Run from repo root:  node --import tsx packages/eval/tablegen/generate.ts
 * (or `pnpm --filter @poker/eval tablegen`). Takes ~10-30s; slow is fine.
 *
 * Emits src/tables.gen.ts containing:
 *  - FLUSH_B64:  Int16Array(8192) base64. Indexed by the 13-bit rank mask of
 *    the flush suit (5..7 bits set) -> best 5-card flush/straight-flush class.
 *  - NOFLUSH_B64: Int16Array(49205) base64. Indexed by the perfect-hash rank
 *    of the quinary rank-count vector (13 digits 0..4 summing to 7) -> best
 *    5-card class ignoring suits.
 *  - DPH_DATA: Int32Array(13*8*5) flat DP offset table for the perfect hash:
 *    DPH[i*40 + s*5 + q] = number of valid completions that precede digit q at
 *    position i given prefix sum s (lexicographic ranking of quinary vectors,
 *    position 0 = rank 0 = deuce, most significant).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import {
  buildClassMap,
  rankValue5,
  HAND_COUNTS_5,
  CLASS_COUNTS_5,
} from "./reference";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`tablegen assertion failed: ${msg}`);
}

const t0 = performance.now();

// ---------------------------------------------------------------------------
// 1. Reference class map from full C(52,5) enumeration, with sanity checks.
// ---------------------------------------------------------------------------
const { classOf, classCat, handCounts5, classCount } = buildClassMap();
assert(classCount === 7462, `class count ${classCount} !== 7462`);
for (let cat = 0; cat < 9; cat++) {
  assert(
    handCounts5[cat] === HAND_COUNTS_5[cat],
    `5-card hand count for cat ${cat}: ${handCounts5[cat]} !== ${HAND_COUNTS_5[cat]}`,
  );
}
// Classes must form contiguous category blocks in the standard order.
{
  let cls = 1;
  const order = [8, 7, 6, 5, 4, 3, 2, 1, 0]; // SF, quads, FH, flush, straight, trips, 2pair, pair, high
  for (const cat of order) {
    for (let i = 0; i < CLASS_COUNTS_5[cat]!; i++) {
      assert(classCat[cls] === cat, `class ${cls} category ${classCat[cls]} !== ${cat}`);
      cls++;
    }
  }
  assert(cls === 7463, "class boundary walk incomplete");
}
console.log(`class map built in ${(performance.now() - t0).toFixed(0)}ms`);

// ---------------------------------------------------------------------------
// 2. FLUSH table: 13-bit rank mask (popcount 5..7) -> best flush/SF class.
// ---------------------------------------------------------------------------
const FLUSH = new Int16Array(8192);
let flushEntries = 0;
{
  const ranks: number[] = [];
  const sub = new Array<number>(5);
  for (let mask = 0; mask < 8192; mask++) {
    let pc = 0;
    for (let r = 0; r < 13; r++) if (mask & (1 << r)) pc++;
    if (pc < 5 || pc > 7) continue;
    ranks.length = 0;
    for (let r = 0; r < 13; r++) if (mask & (1 << r)) ranks.push(r);
    let best = 0x7fff;
    // all 5-subsets of the (5..7) same-suit ranks
    const n = ranks.length;
    for (let a = 0; a < n - 4; a++)
      for (let b = a + 1; b < n - 3; b++)
        for (let c = b + 1; c < n - 2; c++)
          for (let d = c + 1; d < n - 1; d++)
            for (let e = d + 1; e < n; e++) {
              sub[0] = ranks[a]!;
              sub[1] = ranks[b]!;
              sub[2] = ranks[c]!;
              sub[3] = ranks[d]!;
              sub[4] = ranks[e]!;
              const cls = classOf.get(rankValue5(sub, true));
              assert(cls !== undefined, "flush value missing from class map");
              if (cls! < best) best = cls!;
            }
    FLUSH[mask] = best;
    flushEntries++;
  }
}
assert(flushEntries === 1287 + 1716 + 1716, `flush entries ${flushEntries}`);
console.log(`flush table built (${flushEntries} entries)`);

// ---------------------------------------------------------------------------
// 3. Perfect hash DP for quinary rank-count vectors (13 digits 0..4, sum 7).
// ---------------------------------------------------------------------------
// N[k][t] = number of length-k vectors with digits 0..4 summing to exactly t.
const N: number[][] = [];
for (let k = 0; k <= 13; k++) {
  N[k] = new Array<number>(8).fill(0);
}
N[0]![0] = 1;
for (let k = 1; k <= 13; k++) {
  for (let t = 0; t <= 7; t++) {
    let sum = 0;
    for (let d = 0; d <= 4 && d <= t; d++) sum += N[k - 1]![t - d]!;
    N[k]![t] = sum;
  }
}
const NOFLUSH_SIZE = N[13]![7]!;
assert(NOFLUSH_SIZE === 49205, `noflush size ${NOFLUSH_SIZE} !== 49205`);

// DPH[i*40 + s*5 + q] = sum_{d<q} N[12-i][7-s-d]
const DPH = new Int32Array(13 * 8 * 5);
for (let i = 0; i < 13; i++) {
  for (let s = 0; s <= 7; s++) {
    for (let q = 0; q <= 4; q++) {
      let v = 0;
      for (let d = 0; d < q; d++) {
        const t = 7 - s - d;
        if (t >= 0) v += N[12 - i]![t]!;
      }
      DPH[i * 40 + s * 5 + q] = v;
    }
  }
}

/** Runtime hash replicated here to verify against enumeration order. */
function hashOf(q: Uint8Array): number {
  let idx = 0;
  let s = 0;
  for (let i = 0; i < 13; i++) {
    idx += DPH[i * 40 + s * 5 + q[i]!]!;
    s += q[i]!;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// 4. NOFLUSH table: best 5-card class of each rank multiset, suits ignored.
// ---------------------------------------------------------------------------
const NOFLUSH = new Int16Array(NOFLUSH_SIZE);
{
  const q = new Uint8Array(13);
  const chosen: number[] = [];
  let counter = 0;

  /** Best class over all 5-card sub-multisets of q, flushes impossible. */
  function bestClass(): number {
    let best = 0x7fff;
    function pick(i: number, remaining: number): void {
      if (remaining === 0) {
        const cls = classOf.get(rankValue5(chosen, false));
        if (cls === undefined) throw new Error("noflush value missing from class map");
        if (cls < best) best = cls;
        return;
      }
      if (i === 13) return;
      const maxTake = Math.min(q[i]!, remaining);
      for (let c = maxTake; c >= 0; c--) {
        for (let t = 0; t < c; t++) chosen.push(i);
        pick(i + 1, remaining - c);
        for (let t = 0; t < c; t++) chosen.pop();
      }
    }
    pick(0, 5);
    return best;
  }

  // Enumerate vectors in lexicographic order (position 0 most significant,
  // digits ascending) — the perfect hash must equal the running counter.
  function rec(i: number, remaining: number): void {
    if (i === 13) {
      if (remaining !== 0) return;
      const h = hashOf(q);
      assert(h === counter, `hash ${h} !== counter ${counter}`);
      NOFLUSH[counter] = bestClass();
      counter++;
      return;
    }
    const maxLeft = 4 * (12 - i);
    for (let d = 0; d <= 4 && d <= remaining; d++) {
      if (remaining - d > maxLeft) continue;
      q[i] = d;
      rec(i + 1, remaining - d);
    }
    q[i] = 0;
  }
  rec(0, 7);
  assert(counter === NOFLUSH_SIZE, `enumerated ${counter} !== ${NOFLUSH_SIZE}`);
  for (let i = 0; i < NOFLUSH_SIZE; i++) {
    assert(NOFLUSH[i]! >= 1 && NOFLUSH[i]! <= 7462, `noflush[${i}] out of range`);
  }
}
console.log(`noflush table built (${NOFLUSH_SIZE} entries)`);

// ---------------------------------------------------------------------------
// 5. Emit src/tables.gen.ts
// ---------------------------------------------------------------------------
function int16ToB64(arr: Int16Array): string {
  const bytes = new Uint8Array(arr.length * 2); // explicit little-endian
  for (let i = 0; i < arr.length; i++) {
    bytes[i * 2] = arr[i]! & 0xff;
    bytes[i * 2 + 1] = (arr[i]! >> 8) & 0xff;
  }
  return Buffer.from(bytes).toString("base64");
}

const out = `// AUTO-GENERATED by tablegen/generate.ts — DO NOT EDIT.
// Regenerate with: pnpm --filter @poker/eval tablegen
//
// FLUSH_B64:   Int16Array(8192) little-endian base64. Index = 13-bit rank mask
//              of the >=5-card suit -> best 5-card flush/straight-flush class.
// NOFLUSH_B64: Int16Array(${NOFLUSH_SIZE}) little-endian base64. Index = perfect hash
//              of the quinary rank-count vector -> best 5-card class, no flush.
// DPH_DATA:    Int32 DP offsets, DPH[i*40 + s*5 + q], for the perfect hash.

export const NOFLUSH_SIZE = ${NOFLUSH_SIZE};

export const FLUSH_B64 =
  "${int16ToB64(FLUSH)}";

export const NOFLUSH_B64 =
  "${int16ToB64(NOFLUSH)}";

export const DPH_DATA: readonly number[] = [
${(() => {
  const rows: string[] = [];
  for (let i = 0; i < DPH.length; i += 20) {
    rows.push("  " + Array.from(DPH.subarray(i, i + 20)).join(", ") + ",");
  }
  return rows.join("\n");
})()}
];
`;

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "src", "tables.gen.ts");
writeFileSync(target, out);
console.log(
  `wrote ${target} (${(out.length / 1024).toFixed(1)} KiB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
