/**
 * Offline generator for DEFAULT_PREFLOP_RANKING (src/ranking.ts).
 *
 * For each of the 169 canonical hand classes, estimates all-in equity vs ONE
 * uniformly random opponent hand by fixed-seed Monte Carlo (deterministic:
 * @poker/rng streams, no Math.random), then prints the classes sorted
 * strongest-first as a paste-ready TypeScript snippet.
 *
 * The evaluator here is deliberately naive-but-correct: best-of-21 five-card
 * hands out of seven, category scoring. Slow is fine — this runs offline only.
 *
 * Run: node --import tsx packages/ranges/tools/gen-ranking.ts
 */

import { HAND169_COUNT, DECK_SIZE, combosOf169, label169 } from "@poker/core";
import { streamFor } from "../../rng/src/index.ts";

const TRIALS = 50_000;
const SEED_PATH_ROOT = "ranges/default-preflop-ranking/v1";

// ---------------------------------------------------------------------------
// Naive 5-card scorer: HIGHER = stronger. cat in bits 20+, tiebreak ranks
// (0..12) packed 4 bits each below.
// ---------------------------------------------------------------------------

const counts = new Uint8Array(13);

function score5(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  const r0 = c0 >> 2;
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const r3 = c3 >> 2;
  const r4 = c4 >> 2;
  const flush =
    (c0 & 3) === (c1 & 3) && (c0 & 3) === (c2 & 3) && (c0 & 3) === (c3 & 3) && (c0 & 3) === (c4 & 3);

  counts.fill(0);
  counts[r0]++;
  counts[r1]++;
  counts[r2]++;
  counts[r3]++;
  counts[r4]++;

  // Gather ranks by multiplicity, high rank first.
  let quad = -1;
  let trip = -1;
  let pairHi = -1;
  let pairLo = -1;
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = counts[r] as number;
    if (n === 4) quad = r;
    else if (n === 3) trip = r;
    else if (n === 2) {
      if (pairHi < 0) pairHi = r;
      else pairLo = r;
    } else if (n === 1) singles.push(r);
  }

  const pack = (a: number, b = 0, c = 0, d = 0, e = 0): number =>
    (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;

  if (quad >= 0) return (7 << 20) | pack(quad, singles[0] ?? 0);
  if (trip >= 0 && pairHi >= 0) return (6 << 20) | pack(trip, pairHi);

  let straightTop = -1;
  if (singles.length === 5) {
    const hi = singles[0] as number;
    const lo = singles[4] as number;
    if (hi - lo === 4) straightTop = hi;
    // wheel: A5432 → singles [12, 3, 2, 1, 0]
    else if (hi === 12 && singles[1] === 3 && lo === 0) straightTop = 3;
  }

  if (flush && straightTop >= 0) return (8 << 20) | pack(straightTop);
  if (flush) {
    const s = singles;
    return (5 << 20) | pack(s[0] as number, s[1] as number, s[2] as number, s[3] as number, s[4] as number);
  }
  if (straightTop >= 0) return (4 << 20) | pack(straightTop);
  if (trip >= 0) return (3 << 20) | pack(trip, singles[0] as number, singles[1] as number);
  if (pairLo >= 0) return (2 << 20) | pack(pairHi, pairLo, singles[0] as number);
  if (pairHi >= 0)
    return (1 << 20) | pack(pairHi, singles[0] as number, singles[1] as number, singles[2] as number);
  const s = singles;
  return pack(s[0] as number, s[1] as number, s[2] as number, s[3] as number, s[4] as number);
}

/** All C(7,5)=21 five-card subsets, as the two indices to EXCLUDE. */
const EXCLUDE_PAIRS: Array<[number, number]> = [];
for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) EXCLUDE_PAIRS.push([i, j]);

const seven = new Array<number>(7);
const five = new Array<number>(5);

function best7(): number {
  let best = -1;
  for (const [x, y] of EXCLUDE_PAIRS) {
    let k = 0;
    for (let i = 0; i < 7; i++) {
      if (i === x || i === y) continue;
      five[k++] = seven[i] as number;
    }
    const s = score5(
      five[0] as number,
      five[1] as number,
      five[2] as number,
      five[3] as number,
      five[4] as number,
    );
    if (s > best) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Monte Carlo: each class's representative combo vs one random hand.
// ---------------------------------------------------------------------------

function classEquity(cls: number): number {
  const rep = combosOf169(cls)[0];
  if (!rep) throw new Error(`no combos for class ${cls}`);
  const [heroA, heroB] = rep;
  const pool: number[] = [];
  for (let c = 0; c < DECK_SIZE; c++) if (c !== heroA && c !== heroB) pool.push(c);

  const stream = streamFor(SEED_PATH_ROOT, `class/${cls}`);
  let winHalves = 0; // wins count 2, ties count 1

  for (let t = 0; t < TRIALS; t++) {
    // Partial Fisher-Yates: draw 7 cards (2 opponent + 5 board) from the 50.
    for (let i = 0; i < 7; i++) {
      const j = i + stream.nextInt(pool.length - i);
      const tmp = pool[i] as number;
      pool[i] = pool[j] as number;
      pool[j] = tmp;
    }
    seven[2] = pool[2] as number;
    seven[3] = pool[3] as number;
    seven[4] = pool[4] as number;
    seven[5] = pool[5] as number;
    seven[6] = pool[6] as number;

    seven[0] = heroA;
    seven[1] = heroB;
    const heroScore = best7();
    seven[0] = pool[0] as number;
    seven[1] = pool[1] as number;
    const oppScore = best7();

    if (heroScore > oppScore) winHalves += 2;
    else if (heroScore === oppScore) winHalves += 1;
  }
  return winHalves / (2 * TRIALS);
}

const started = performance.now();
const equities = new Float64Array(HAND169_COUNT);
for (let cls = 0; cls < HAND169_COUNT; cls++) {
  equities[cls] = classEquity(cls);
}

const order = Array.from({ length: HAND169_COUNT }, (_, i) => i).sort(
  (a, b) => (equities[b] as number) - (equities[a] as number) || a - b,
);

// Paste-ready snippet: 8 indices per line, annotated with labels + equity.
const lines: string[] = [];
for (let i = 0; i < order.length; i += 8) {
  const chunk = order.slice(i, i + 8);
  const nums = chunk.map((c) => String(c)).join(", ");
  const labels = chunk
    .map((c) => `${label169(c)} ${((equities[c] as number) * 100).toFixed(1)}`)
    .join("  ");
  lines.push(`  ${nums}, // ${labels}`);
}
console.log("// prettier-ignore");
console.log("const DEFAULT_PREFLOP_RANKING_DATA: readonly number[] = [");
console.log(lines.join("\n"));
console.log("];");
console.error(`done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
