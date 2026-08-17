/**
 * evaluate7 throughput benchmark.
 *
 * Run from repo root:  pnpm bench:eval
 * or from the package: pnpm --filter @poker/eval bench
 *
 * Generates 1,000,000 seeded random 7-card boards (inline LCG, fixed seed),
 * warms up, then times repeated full passes and reports evals/sec.
 */

import { performance } from "node:perf_hooks";
import { evaluate7 } from "../src/index";

const BOARDS = 1_000_000;
const WARMUP_PASSES = 3;
const TIMED_PASSES = 7;

// --- seeded LCG (Numerical Recipes constants), deterministic boards ---
let lcg = 0xbe5c0de >>> 0;
function next(): number {
  lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
  return lcg;
}

// --- board generation: partial Fisher-Yates over a fresh deck ---
const boards = new Uint8Array(BOARDS * 7);
{
  const base = new Uint8Array(52);
  for (let i = 0; i < 52; i++) base[i] = i;
  const deck = new Uint8Array(52);
  for (let n = 0; n < BOARDS; n++) {
    deck.set(base);
    const off = n * 7;
    for (let i = 0; i < 7; i++) {
      // use HIGH bits for the index — LCG low bits are correlated
      const j = i + (((next() / 4294967296) * (52 - i)) | 0);
      const tmp = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = tmp;
      boards[off + i] = deck[i]!;
    }
  }
}

function pass(): number {
  let checksum = 0;
  for (let off = 0; off < boards.length; off += 7) {
    checksum ^= evaluate7(
      boards[off]!,
      boards[off + 1]!,
      boards[off + 2]!,
      boards[off + 3]!,
      boards[off + 4]!,
      boards[off + 5]!,
      boards[off + 6]!,
    );
  }
  return checksum;
}

let sink = 0;
for (let i = 0; i < WARMUP_PASSES; i++) sink = (sink + pass()) | 0;

let bestRate = 0;
let totalMs = 0;
for (let i = 0; i < TIMED_PASSES; i++) {
  const t0 = performance.now();
  sink = (sink + pass()) | 0;
  const ms = performance.now() - t0;
  totalMs += ms;
  const rate = BOARDS / (ms / 1000);
  if (rate > bestRate) bestRate = rate;
  console.log(`pass ${i + 1}: ${ms.toFixed(1)}ms  (${(rate / 1e6).toFixed(2)}M evals/sec)`);
}
const avgRate = (BOARDS * TIMED_PASSES) / (totalMs / 1000);
console.log(
  `evaluate7: avg ${(avgRate / 1e6).toFixed(2)}M evals/sec, best ${(bestRate / 1e6).toFixed(2)}M evals/sec (checksum ${sink})`,
);
