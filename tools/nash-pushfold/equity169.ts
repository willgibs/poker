/**
 * Generate the 169x169 preflop all-in equity table.
 *
 * For every unordered pair of canonical hand classes (i < j) we:
 *  - fix a representative combo of class i (suit symmetry makes this exact),
 *  - exact-enumerate the disjoint class-j combos, deduped to suit-isomorphism
 *    orbit representatives with orbit-size weights (see matchups.ts),
 *  - Monte-Carlo boards per representative matchup with a seeded @poker/rng
 *    stream, allocating boards proportionally to orbit weights, in adaptive
 *    rounds until the weighted class-pair estimate reaches stderr < 0.2%
 *    (or the 200k-board cap).
 *
 * Diagonal entries are exactly 0.5 by symmetry and are not sampled. The
 * lower triangle is 1 - upper. Results cache to equity169.gen.json; finished
 * pairs are skipped on rerun, so interrupted runs resume incrementally.
 *
 * Run:  node --import tsx tools/nash-pushfold/equity169.ts
 * Env:  PAIR_LIMIT=<n> to stop after n newly computed pairs (pilot/testing).
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { HAND169_COUNT, label169, cardFromString } from "../../packages/core/src/index";
import { streamFor, type RngStream } from "../../packages/rng/src/index";
import { score7, best21Naive } from "./evaluator";
import { orbitReps, repCombo } from "./matchups";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(TOOL_DIR, "equity169.gen.json");

const SEED_ROOT = "charts/equity169/v1";
const STDERR_TARGET = 0.002;
const MAX_BOARDS = 200_000;
const FIRST_ROUND = 24_000;
const NEXT_ROUND = 12_000;
const CACHE_VERSION = 1;

interface PairResult {
  /** Class-i-vs-class-j equity for i (win + tie/2), 6 decimals. */
  eq: number;
  /** Total Monte-Carlo boards across representative matchups. */
  boards: number;
  /** Estimated standard error of eq. */
  stderr: number;
}

interface CacheFile {
  version: number;
  seedRoot: string;
  stderrTarget: number;
  maxBoards: number;
  pairs: Record<string, PairResult>;
}

// ---------------------------------------------------------------------------
// Evaluator self-check: refuse to generate with a broken evaluator.
// ---------------------------------------------------------------------------

function cards(str: string): number[] {
  return str.split(" ").map(cardFromString);
}

function selfTestEvaluator(): void {
  const sc = (str: string): number => {
    const c = cards(str);
    return score7(
      c[0] as number,
      c[1] as number,
      c[2] as number,
      c[3] as number,
      c[4] as number,
      c[5] as number,
      c[6] as number,
    );
  };

  // Strictly descending strength (ascending score).
  const ladder = [
    "As Ks Qs Js Ts 2c 3d", // royal flush
    "9h 8h 7h 6h 5h Ac Kd", // nine-high straight flush
    "As 2s 3s 4s 5s Kd Qc", // steel wheel
    "Ac Ad Ah As Kc 2d 3h", // quad aces
    "Kc Kd Kh Ks Ac 2d 3h", // quad kings
    "Ac Ad Ah Kc Kd 2s 3s", // aces full of kings
    "Ac Ad Ah 2c 2d Ks Qs", // aces full of twos
    "As Ks Qs Js 9s 2c 3d", // AKQJ9 flush
    "As Ks Qs Ts 9s 2c 3d", // AKQT9 flush
    "Ac Kd Qh Js Tc 2c 2d", // ace-high straight
    "Ac 2d 3h 4s 5c Kd Qh", // wheel straight
    "Ac Ad Ah Kc Qd 2s 3h", // trip aces
    "Ac Ad Kc Kd Qh Js 2c", // aces and kings, queen kicker
    "Ac Ad Kc Qd Jh 9s 2c", // pair of aces, KQJ kickers
    "Ac Ad Kc Qd Th 9s 2c", // pair of aces, KQT kickers
    "Ac Kd Qh Js 9c 8d 2h", // ace high
    "Kc Qd Jh Ts 8c 7d 2h", // king high
  ];
  for (let i = 1; i < ladder.length; i++) {
    const a = sc(ladder[i - 1] as string);
    const b = sc(ladder[i] as string);
    if (!(a < b)) {
      throw new Error(`evaluator ladder failed between "${ladder[i - 1]}" and "${ladder[i]}"`);
    }
  }

  // Equalities: two trips = full house; three pairs pick the right kicker.
  const eqPairs: Array<[string, string]> = [
    ["Ac Ad Ah Kc Kd Kh 2s", "As Ad Ah Ks Kd 2c 3d"], // AAAKK both ways
    ["Ac Ad Kc Kd Qh Qs Jc", "Ah Ad Kh Kd Qc Js 2c"], // two pair AK, Q kicker
    ["Ac Kd Qh Js Tc 2c 2d", "Ah Kh Qc Jd Td 3c 3d"], // straight ignores pairs
  ];
  for (const [x, y] of eqPairs) {
    if (sc(x) !== sc(y)) throw new Error(`evaluator equality failed: "${x}" vs "${y}"`);
  }

  // Random cross-check against the independent best-of-21 naive scorer.
  const stream = streamFor(SEED_ROOT, "selftest");
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  const draw7 = (): number[] => {
    for (let k = 0; k < 7; k++) {
      const j = k + stream.nextInt(52 - k);
      const tmp = deck[k] as number;
      deck[k] = deck[j] as number;
      deck[j] = tmp;
    }
    return deck.slice(0, 7);
  };
  const N = 4000;
  for (let t = 0; t < N; t++) {
    const h1 = draw7();
    const h2 = draw7();
    const f1 = score7(
      h1[0] as number,
      h1[1] as number,
      h1[2] as number,
      h1[3] as number,
      h1[4] as number,
      h1[5] as number,
      h1[6] as number,
    );
    const f2 = score7(
      h2[0] as number,
      h2[1] as number,
      h2[2] as number,
      h2[3] as number,
      h2[4] as number,
      h2[5] as number,
      h2[6] as number,
    );
    const n1 = best21Naive(h1);
    const n2 = best21Naive(h2);
    const fastCmp = Math.sign(f1 - f2);
    const naiveCmp = Math.sign(n1 - n2);
    if (fastCmp !== naiveCmp) {
      throw new Error(
        `evaluator mismatch: [${h1.join(",")}] vs [${h2.join(",")}] fast=${fastCmp} naive=${naiveCmp}`,
      );
    }
  }
  console.log(`evaluator self-check passed (${ladder.length} ladder + ${N} random cross-checks)`);
}

// ---------------------------------------------------------------------------
// Monte-Carlo equity for one class pair.
// ---------------------------------------------------------------------------

interface RepState {
  h0: number;
  h1: number;
  v0: number;
  v1: number;
  weight: number;
  deck: number[];
  stream: RngStream;
  n: number;
  sum: number;
  sq: number;
}

function buildRepStates(i: number, j: number): RepState[] {
  const hero = repCombo(i);
  return orbitReps(i, j).map((rep, k) => {
    const used = new Set<number>([hero[0], hero[1], rep.cards[0], rep.cards[1]]);
    const deck: number[] = [];
    for (let c = 0; c < 52; c++) {
      if (!used.has(c)) deck.push(c);
    }
    return {
      h0: hero[0],
      h1: hero[1],
      v0: rep.cards[0],
      v1: rep.cards[1],
      weight: rep.weight,
      deck,
      stream: streamFor(SEED_ROOT, `pair/${i}/${j}/${k}`),
      n: 0,
      sum: 0,
      sq: 0,
    };
  });
}

function runBoards(st: RepState, count: number): void {
  const deck = st.deck;
  const stream = st.stream;
  const h0 = st.h0;
  const h1 = st.h1;
  const v0 = st.v0;
  const v1 = st.v1;
  let sum = 0;
  let sq = 0;
  for (let b = 0; b < count; b++) {
    for (let k = 0; k < 5; k++) {
      const idx = k + stream.nextInt(48 - k);
      const tmp = deck[k] as number;
      deck[k] = deck[idx] as number;
      deck[idx] = tmp;
    }
    const b0 = deck[0] as number;
    const b1 = deck[1] as number;
    const b2 = deck[2] as number;
    const b3 = deck[3] as number;
    const b4 = deck[4] as number;
    const sH = score7(h0, h1, b0, b1, b2, b3, b4);
    const sV = score7(v0, v1, b0, b1, b2, b3, b4);
    if (sH < sV) {
      sum += 1;
      sq += 1;
    } else if (sH === sV) {
      sum += 0.5;
      sq += 0.25;
    }
  }
  st.n += count;
  st.sum += sum;
  st.sq += sq;
}

function aggregate(states: RepState[]): { mean: number; stderr: number; boards: number } {
  let totalW = 0;
  for (const st of states) totalW += st.weight;
  let mean = 0;
  let variance = 0;
  let boards = 0;
  for (const st of states) {
    const w = st.weight / totalW;
    const m = st.sum / st.n;
    mean += w * m;
    boards += st.n;
    const denom = st.n > 1 ? st.n - 1 : 1;
    const s2 = Math.max(0, (st.sq - (st.sum * st.sum) / st.n) / denom);
    variance += w * w * (s2 / st.n);
  }
  return { mean, stderr: Math.sqrt(variance), boards };
}

function computePair(i: number, j: number): PairResult {
  const states = buildRepStates(i, j);
  let totalW = 0;
  for (const st of states) totalW += st.weight;

  let roundSize = FIRST_ROUND;
  for (;;) {
    for (const st of states) {
      const share = Math.max(64, Math.ceil((roundSize * st.weight) / totalW));
      runBoards(st, share);
    }
    const agg = aggregate(states);
    if (agg.stderr < STDERR_TARGET || agg.boards >= MAX_BOARDS) {
      return {
        eq: Math.round(agg.mean * 1e6) / 1e6,
        boards: agg.boards,
        stderr: Math.round(agg.stderr * 1e7) / 1e7,
      };
    }
    roundSize = NEXT_ROUND;
  }
}

// ---------------------------------------------------------------------------
// Cache + driver.
// ---------------------------------------------------------------------------

function loadCache(): CacheFile {
  if (existsSync(CACHE_PATH)) {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    if (
      parsed.version === CACHE_VERSION &&
      parsed.seedRoot === SEED_ROOT &&
      parsed.stderrTarget === STDERR_TARGET &&
      parsed.maxBoards === MAX_BOARDS
    ) {
      return parsed;
    }
    console.log("cache parameters changed; starting fresh");
  }
  return {
    version: CACHE_VERSION,
    seedRoot: SEED_ROOT,
    stderrTarget: STDERR_TARGET,
    maxBoards: MAX_BOARDS,
    pairs: {},
  };
}

function saveCache(cache: CacheFile): void {
  const tmp = CACHE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, CACHE_PATH);
}

function main(): void {
  selfTestEvaluator();

  const cache = loadCache();
  const totalPairs = (HAND169_COUNT * (HAND169_COUNT - 1)) / 2;
  let done = Object.keys(cache.pairs).length;
  console.log(`equity169: ${done}/${totalPairs} pairs cached`);

  const pairLimitEnv = process.env["PAIR_LIMIT"];
  const pairLimit = pairLimitEnv !== undefined ? Number(pairLimitEnv) : Number.POSITIVE_INFINITY;

  const started = Date.now();
  let computed = 0;
  let boardsRun = 0;
  let sinceSave = 0;

  outer: for (let i = 0; i < HAND169_COUNT; i++) {
    for (let j = i + 1; j < HAND169_COUNT; j++) {
      const key = `${i}:${j}`;
      if (cache.pairs[key] !== undefined) continue;
      const res = computePair(i, j);
      cache.pairs[key] = res;
      computed++;
      done++;
      boardsRun += res.boards;
      sinceSave++;
      if (sinceSave >= 500) {
        saveCache(cache);
        sinceSave = 0;
        const elapsed = (Date.now() - started) / 1000;
        const rate = computed / elapsed;
        const eta = (totalPairs - done) / rate;
        console.log(
          `${done}/${totalPairs} pairs | ${(boardsRun / 1e6).toFixed(1)}M boards | ` +
            `${rate.toFixed(1)} pairs/s | eta ${(eta / 60).toFixed(1)} min`,
        );
      }
      if (computed >= pairLimit) break outer;
    }
  }

  saveCache(cache);
  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `done: ${done}/${totalPairs} pairs (${computed} new, ${(boardsRun / 1e6).toFixed(1)}M boards, ` +
      `${elapsed.toFixed(0)}s)`,
  );

  // Sanity anchors on well-known matchups (class-average equities).
  const anchor = (a: number, b: number): number | undefined => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const entry = cache.pairs[key];
    if (entry === undefined) return undefined;
    return a < b ? entry.eq : 1 - entry.eq;
  };
  const aaVsKk = anchor(0, 1); // AA vs KK ~ 0.82
  if (aaVsKk !== undefined) {
    console.log(`anchor AA vs KK = ${aaVsKk.toFixed(4)} (expect ~0.82)`);
    if (aaVsKk < 0.79 || aaVsKk > 0.85) throw new Error(`AA vs KK equity out of range: ${aaVsKk}`);
  }
  const aksVsQq = anchor(13, 2); // AKs vs QQ ~ 0.46
  if (aksVsQq !== undefined) {
    console.log(`anchor AKs vs QQ = ${aksVsQq.toFixed(4)} (expect ~0.46)`);
    if (aksVsQq < 0.42 || aksVsQq > 0.5) throw new Error(`AKs vs QQ equity out of range: ${aksVsQq}`);
  }
  console.log(`labels: 0=${label169(0)} 1=${label169(1)} 2=${label169(2)} 13=${label169(13)}`);
}

main();
