/**
 * Heads-up jam/fold Nash equilibrium via fictitious play over the 169-hand
 * abstraction.
 *
 * Game: blinds 0.5/1bb, both stacks D bb (depths 2..15, 1bb steps). SB (the
 * button heads-up) either jams all-in or folds; facing a jam, BB either calls
 * or folds. EV is measured in bb relative to start-of-hand stacks:
 *   SB fold: -0.5     SB jam + BB fold: +1     jam + call: 2*D*eq - D.
 *
 * Card removal is exact: the joint weight of (SB class i, BB class j) is
 * count(i) * A[i][j], where A[i][j] = number of class-j combos disjoint from
 * a fixed class-i combo (identical for every class-i combo by suit symmetry;
 * rows sum to C(50,2) = 1225).
 *
 * Fictitious play (alternating best responses to the opponent's average
 * strategy, uniform averaging) runs until the exploitability of the average
 * strategy pair — v(BR_SB vs avg_BB) - v(avg_SB vs BR_BB) — is < 0.001 bb.
 *
 * Reads tools/nash-pushfold/equity169.gen.json (run equity169.ts first) and
 * writes packages/charts/src/nashHU.gen.ts.
 *
 * Run:  node --import tsx tools/nash-pushfold/solve.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { HAND169_COUNT, combosOf169, label169 } from "../../packages/core/src/index";
import { disjointCount } from "./matchups";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(TOOL_DIR, "equity169.gen.json");
const OUT_PATH = join(TOOL_DIR, "..", "..", "packages", "charts", "src", "nashHU.gen.ts");

const N = HAND169_COUNT;
const DEPTHS: number[] = [];
for (let d = 2; d <= 15; d++) DEPTHS.push(d);

const EPSILON_TARGET = 0.001;
const MAX_ITERS = 2_000_000;
const CHECK_EVERY = 200;
/**
 * Keep averaging past convergence so the iteration-1 transient (every hand
 * best-responds "jam" against an empty call range once) decays below the
 * 0-100 rounding resolution: 1/MIN_ITERS < 0.005.
 */
const MIN_ITERS = 5_000;

interface PairResult {
  eq: number;
  boards: number;
  stderr: number;
}

interface CacheFile {
  version: number;
  seedRoot: string;
  pairs: Record<string, PairResult>;
}

function loadEquityMatrix(): Float64Array {
  const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
  const eq = new Float64Array(N * N);
  let filled = 0;
  for (let i = 0; i < N; i++) {
    eq[i * N + i] = 0.5; // exact by symmetry
    for (let j = i + 1; j < N; j++) {
      const entry = cache.pairs[`${i}:${j}`];
      if (entry === undefined) throw new Error(`equity cache incomplete: missing pair ${i}:${j}`);
      eq[i * N + j] = entry.eq;
      eq[j * N + i] = 1 - entry.eq;
      filled++;
    }
  }
  console.log(`loaded equity matrix (${filled} pairs + diagonal)`);
  return eq;
}

interface Solution {
  jam: Float64Array;
  call: Float64Array;
  epsilon: number;
  iters: number;
}

function solveDepth(
  depth: number,
  eq: Float64Array,
  A: Float64Array,
  counts: Float64Array,
): Solution {
  // G[i][j] = A[i][j] * (M_ij - 1) with M_ij = 2*D*eq_ij - D (jam+call payoff).
  const G = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const m = 2 * depth * (eq[i * N + j] as number) - depth;
      G[i * N + j] = (A[i * N + j] as number) * (m - 1);
    }
  }

  const totalJoint = 1326 * 1225;
  const sAvg = new Float64Array(N); // SB jam probability per class (average strategy)
  const cAvg = new Float64Array(N); // BB call probability per class
  const gc = new Float64Array(N); // (G · cAvg)_i
  const coef = new Float64Array(N); // (G^T · (counts ∘ sAvg))_j

  const brS = new Float64Array(N);
  const brC = new Float64Array(N);

  const evJamRow = (i: number): number => {
    let acc = 0;
    const base = i * N;
    for (let j = 0; j < N; j++) acc += (G[base + j] as number) * (cAvg[j] as number);
    gc[i] = acc;
    return (1225 + acc) / 1225;
  };

  const exploitability = (): number => {
    // v(BR_SB vs cAvg): SB best-responds per class.
    let vBrSb = 0;
    for (let i = 0; i < N; i++) {
      const ev = evJamRow(i);
      vBrSb += ((counts[i] as number) / 1326) * Math.max(-0.5, ev);
    }
    // v(sAvg vs BR_BB): BB best-responds per class.
    let foldPart = 0;
    let jamBase = 0;
    for (let i = 0; i < N; i++) {
      const pi = (counts[i] as number) / 1326;
      foldPart += pi * (1 - (sAvg[i] as number)) * -0.5;
      jamBase += (counts[i] as number) * (sAvg[i] as number);
    }
    let minSum = 0;
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        acc += (counts[i] as number) * (sAvg[i] as number) * (G[i * N + j] as number);
      }
      coef[j] = acc;
      if (acc < 0) minSum += acc;
    }
    const vBrBb = foldPart + (1225 * jamBase + minSum) / totalJoint;
    return vBrSb - vBrBb;
  };

  let epsilon = Number.POSITIVE_INFINITY;
  let iters = 0;
  for (let t = 1; t <= MAX_ITERS; t++) {
    iters = t;
    // SB best response to cAvg.
    for (let i = 0; i < N; i++) {
      const ev = evJamRow(i);
      brS[i] = ev > -0.5 ? 1 : 0;
    }
    const alphaS = 1 / t;
    for (let i = 0; i < N; i++) {
      sAvg[i] = (sAvg[i] as number) + alphaS * ((brS[i] as number) - (sAvg[i] as number));
    }
    // BB best response to (updated) sAvg.
    for (let j = 0; j < N; j++) coef[j] = 0;
    for (let i = 0; i < N; i++) {
      const u = (counts[i] as number) * (sAvg[i] as number);
      if (u === 0) continue;
      const base = i * N;
      for (let j = 0; j < N; j++) {
        coef[j] = (coef[j] as number) + u * (G[base + j] as number);
      }
    }
    for (let j = 0; j < N; j++) brC[j] = (coef[j] as number) < 0 ? 1 : 0;
    const alphaC = 1 / t;
    for (let j = 0; j < N; j++) {
      cAvg[j] = (cAvg[j] as number) + alphaC * ((brC[j] as number) - (cAvg[j] as number));
    }

    if (t >= MIN_ITERS && t % CHECK_EVERY === 0) {
      epsilon = exploitability();
      if (epsilon < EPSILON_TARGET) break;
    }
  }
  if (epsilon >= EPSILON_TARGET) {
    throw new Error(
      `depth ${depth}bb did not converge: epsilon ${epsilon.toFixed(6)} after ${iters} iterations`,
    );
  }
  return { jam: sAvg, call: cAvg, epsilon, iters };
}

function rangeFraction(weights: Float64Array, counts: Float64Array): number {
  let acc = 0;
  for (let i = 0; i < N; i++) acc += (weights[i] as number) * (counts[i] as number);
  return acc / 1326;
}

function toPercents(weights: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const w = Math.round((weights[i] as number) * 100);
    out.push(Math.max(0, Math.min(100, w)));
  }
  return out;
}

function main(): void {
  const eq = loadEquityMatrix();

  const A = new Float64Array(N * N);
  const counts = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    counts[i] = combosOf169(i).length;
    for (let j = 0; j < N; j++) A[i * N + j] = disjointCount(i, j);
  }
  // Row-sum invariant: every row of A must sum to C(50,2).
  for (let i = 0; i < N; i++) {
    let rowSum = 0;
    for (let j = 0; j < N; j++) rowSum += A[i * N + j] as number;
    if (rowSum !== 1225) throw new Error(`A row ${i} sums to ${rowSum}, expected 1225`);
  }

  const jamRows: number[][] = [];
  const callRows: number[][] = [];
  const epsilons: number[] = [];
  const started = Date.now();

  for (const depth of DEPTHS) {
    const t0 = Date.now();
    const sol = solveDepth(depth, eq, A, counts);
    jamRows.push(toPercents(sol.jam));
    callRows.push(toPercents(sol.call));
    epsilons.push(Math.round(sol.epsilon * 1e7) / 1e7);
    console.log(
      `depth ${String(depth).padStart(2)}bb: jam ${(rangeFraction(sol.jam, counts) * 100).toFixed(1)}% ` +
        `call ${(rangeFraction(sol.call, counts) * 100).toFixed(1)}% ` +
        `eps ${sol.epsilon.toExponential(2)} iters ${sol.iters} (${Date.now() - t0}ms)`,
    );
  }

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * GENERATED FILE - do not edit by hand.");
  lines.push(" *");
  lines.push(" * Heads-up Nash jam/fold equilibrium over the canonical 169-hand grid,");
  lines.push(" * solved by fictitious play (exploitability < 0.001 bb per depth) on an");
  lines.push(" * in-repo Monte-Carlo all-in equity table (seeded @poker/rng streams,");
  lines.push(" * stderr < 0.2% per class matchup). No third-party chart data. CC0.");
  lines.push(" *");
  lines.push(" * Regenerate:");
  lines.push(" *   node --import tsx tools/nash-pushfold/equity169.ts");
  lines.push(" *   node --import tsx tools/nash-pushfold/solve.ts");
  lines.push(" */");
  lines.push("");
  lines.push(`export const NASH_HU_VERSION = "nash-hu-fp-v1";`);
  lines.push("");
  lines.push("/** Stack depths (bb) covered, ascending; both stacks equal, blinds 0.5/1. */");
  lines.push(`export const NASH_HU_DEPTHS_BB: readonly number[] = [${DEPTHS.join(", ")}];`);
  lines.push("");
  lines.push("/** jam[d][h]: SB jam weight 0-100 for depth NASH_HU_DEPTHS_BB[d], hand169 h. */");
  lines.push("export const NASH_HU_JAM_WEIGHTS: ReadonlyArray<readonly number[]> = [");
  for (const row of jamRows) lines.push(`  [${row.join(",")}],`);
  lines.push("];");
  lines.push("");
  lines.push("/** call[d][h]: BB call-vs-jam weight 0-100, same indexing as jam weights. */");
  lines.push("export const NASH_HU_CALL_WEIGHTS: ReadonlyArray<readonly number[]> = [");
  for (const row of callRows) lines.push(`  [${row.join(",")}],`);
  lines.push("];");
  lines.push("");
  lines.push("/** Achieved exploitability (bb) per depth, matching NASH_HU_DEPTHS_BB. */");
  lines.push(`export const NASH_HU_EPSILON_BB: readonly number[] = [${epsilons.join(", ")}];`);
  lines.push("");

  writeFileSync(OUT_PATH, lines.join("\n"));
  console.log(`wrote ${OUT_PATH} (${lines.join("\n").length} bytes)`);
  console.log(`total ${(Date.now() - started) / 1000}s`);

  // Quick human-readable sanity: a few well-known hands across depths.
  const show = ["AA", "A2o", "KTs", "32o", "22"];
  const labelIdx = new Map<string, number>();
  for (let i = 0; i < N; i++) labelIdx.set(label169(i), i);
  for (const lbl of show) {
    const idx = labelIdx.get(lbl);
    if (idx === undefined) continue;
    const jam = DEPTHS.map((_, k) => (jamRows[k] as number[])[idx]).join(" ");
    console.log(`jam ${lbl.padEnd(3)}: ${jam}`);
  }
}

main();
