/**
 * Freeroll arena — headless self-play harness.
 *
 * ```bash
 * node --import tsx tools/arena/arena.ts --lineup barry,doris --hands 500 --seed s1
 * node --import tsx tools/arena/arena.ts --probe vera --hands 400
 * node --import tsx tools/arena/arena.ts --matrix --hands 300
 * ```
 *
 * Three modes, one engine:
 *
 * - **lineup** (default) — seat a cast, play N hands, print the per-persona
 *   stat table (VPIP/PFR/3bet/AF/WTSD, bb/100 with a 95% CI), tilt-event counts
 *   and the think-time distribution.
 * - **`--probe <target>`** — four adversarial scripted deciders (see
 *   `probes.ts`) each play heads-up against the target persona. These are not
 *   personas: they are degenerate strategies that press one axis until
 *   something breaks. A character that loses to `always-fold` has a bug.
 * - **`--matrix`** — every tier against the tier below, heads-up, all pairings.
 *   `docs/testing.md`'s bot bar is "each tier beats the tier below at a
 *   margin"; this is the instrument that reads that margin.
 *
 * **Deterministic per seed.** Every number in the report is a pure function of
 * `(seed, lineup, hands, stakes)`. The only non-deterministic line is the
 * wall-clock footer, which is labelled as such.
 *
 * Stacks are topped back up to the buy-in before every hand, so bb/100 measures
 * strategy rather than the survivorship of a bust-out ladder.
 */

import { CAST, TIERS, castOfTier, personaById, type Tier } from "../../packages/bots/src/index";
import { createSession, type HandOutcome, type SessionConfig } from "../../packages/sim/src/index";
import { PROBES, type ProbeSpec } from "./probes";
import { ArenaStats, meanAndStderr, quantile, type SeatStats } from "./stats";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  lineup: string[];
  hands: number;
  seed: string;
  sbCents: number;
  bbCents: number;
  stackCents: number;
  probe: string | null;
  matrix: boolean;
}

const DEFAULT_LINEUP = ["barry", "doris", "hank", "rocco", "silas", "vera"];

const USAGE = `Freeroll arena — headless self-play

  node --import tsx tools/arena/arena.ts [options]

  --lineup a,b,c     persona ids to seat (default: ${DEFAULT_LINEUP.join(",")})
  --hands N          hands per run (default: 200)
  --seed S           session seed (default: "arena")
  --stakes sb/bb     blinds in cents (default: 50/100)
  --stack N          buy-in in cents (default: 20000)
  --probe <persona>  run the adversarial probes heads-up vs <persona>
  --matrix           run each tier vs the tier below, heads-up
  --help

  Known personas: ${CAST.map((p) => p.id).join(", ")}
`;

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    lineup: DEFAULT_LINEUP,
    hands: 200,
    seed: "arena",
    sbCents: 50,
    bbCents: 100,
    stackCents: 20_000,
    probe: null,
    matrix: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    const need = (): string => {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${String(flag)} needs a value`);
      }
      i += 1;
      return value;
    };
    switch (flag) {
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case "--lineup":
        opts.lineup = need()
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      case "--hands":
        opts.hands = parseCount(need(), "--hands");
        break;
      case "--seed":
        opts.seed = need();
        break;
      case "--stack":
        opts.stackCents = parseCount(need(), "--stack");
        break;
      case "--stakes": {
        const parts = need().split("/");
        if (parts.length !== 2) throw new Error("--stakes wants sb/bb, e.g. 50/100");
        opts.sbCents = parseCount(parts[0] as string, "--stakes sb");
        opts.bbCents = parseCount(parts[1] as string, "--stakes bb");
        break;
      }
      case "--probe":
        opts.probe = need();
        break;
      case "--matrix":
        opts.matrix = true;
        break;
      default:
        throw new Error(`unknown flag ${String(flag)}\n\n${USAGE}`);
    }
  }
  if (opts.hands < 1) throw new Error("--hands must be at least 1");
  if (opts.bbCents < 1) throw new Error("--stakes bb must be at least 1 cent");
  for (const id of opts.lineup) personaById(id); // throws on a typo
  if (opts.probe !== null) personaById(opts.probe);
  return opts;
}

function parseCount(raw: string, what: string): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer`);
  return n;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

interface RunResult {
  stats: SeatStats[];
  statsBySeat: Map<number, SeatStats>;
  series: Map<number, readonly number[]>;
  hands: number;
  decisions: number;
  wallMs: number;
}

/**
 * Play `hands` hands of a lineup, optionally with a scripted probe in seat 0.
 * Traces and grades are off: bulk self-play does not need 10k trace objects.
 */
function run(opts: {
  seed: string;
  personas: readonly string[];
  probe: ProbeSpec | null;
  hands: number;
  sbCents: number;
  bbCents: number;
  stackCents: number;
}): RunResult {
  const seats: SessionConfig["seats"] = opts.probe === null
    ? opts.personas.map((personaId) => ({ personaId }))
    : [{ hero: true }, ...opts.personas.map((personaId) => ({ personaId }))];

  const personaBySeat = new Map<number, string>();
  seats.forEach((spec, seat) => {
    if ("personaId" in spec) personaBySeat.set(seat, spec.personaId);
  });
  if (opts.probe !== null) personaBySeat.set(0, `probe:${opts.probe.id}`);

  const session = createSession({
    sessionSeed: opts.seed,
    format: "cash",
    stakes: { sbCents: opts.sbCents, bbCents: opts.bbCents },
    seats,
    stackCents: opts.stackCents,
    dealerOptions: { rebuy: "top-up" },
    annotations: { traces: false, grades: false },
  });

  const acc = new ArenaStats(personaBySeat, opts.bbCents);
  let decisions = 0;
  const started = performance.now();
  for (let i = 0; i < opts.hands; i++) {
    let step = session.nextHand();
    let guard = 0;
    while (step.awaitingHero) {
      if (guard++ > 500) throw new Error("probe loop did not terminate");
      if (opts.probe === null) throw new Error("a hero seat with no probe cannot act");
      step = session.act(opts.probe.decide(step.legalActions, step.snapshot));
    }
    const outcome: HandOutcome = step.outcome;
    decisions += outcome.decisionCount;
    acc.fold(outcome);
  }
  const wallMs = performance.now() - started;

  const stats = acc.finish();
  const series = new Map<number, readonly number[]>();
  for (const s of stats) series.set(s.seat, acc.seriesOf(s.seat));
  return {
    stats,
    statsBySeat: new Map(stats.map((s) => [s.seat, s])),
    series,
    hands: opts.hands,
    decisions,
    wallMs,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pct(v: number | undefined): string {
  return v === undefined ? "   -" : v.toFixed(1);
}

function ratio(v: number | undefined): string {
  return v === undefined ? "   -" : v.toFixed(2);
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

interface Column {
  head: string;
  width: number;
  align: "left" | "right";
}

function table(columns: readonly Column[], rows: readonly string[][]): string {
  const line = (cells: readonly string[]): string =>
    columns
      .map((c, i) => {
        const cell = cells[i] ?? "";
        return c.align === "left" ? cell.padEnd(c.width) : cell.padStart(c.width);
      })
      .join("  ")
      .trimEnd();
  const head = line(columns.map((c) => c.head));
  const rule = line(columns.map((c) => "-".repeat(Math.min(c.width, c.head.length + 2))));
  return [head, rule, ...rows.map(line)].join("\n");
}

const STAT_COLUMNS: readonly Column[] = [
  { head: "persona", width: 16, align: "left" },
  { head: "tier", width: 4, align: "right" },
  { head: "hands", width: 6, align: "right" },
  { head: "VPIP", width: 6, align: "right" },
  { head: "PFR", width: 6, align: "right" },
  { head: "3bet", width: 6, align: "right" },
  { head: "AF", width: 6, align: "right" },
  { head: "WTSD", width: 6, align: "right" },
  { head: "bb/100", width: 8, align: "right" },
  { head: "+/-95%", width: 8, align: "right" },
  { head: "tilt", width: 5, align: "right" },
  { head: "peak", width: 5, align: "right" },
];

function tierOf(personaId: string): string {
  if (personaId.startsWith("probe:")) return "-";
  return String(personaById(personaId).tier);
}

function displayName(personaId: string): string {
  return personaId.startsWith("probe:") ? personaId.slice("probe:".length) : personaById(personaId).name;
}

function statRows(stats: readonly SeatStats[]): string[][] {
  return stats.map((s) => [
    displayName(s.personaId),
    tierOf(s.personaId),
    String(s.hands),
    pct(s.vpip),
    pct(s.pfr),
    pct(s.threeBet),
    ratio(s.af),
    pct(s.wtsd),
    signed(s.bb100),
    s.ci95.toFixed(1),
    String(s.tiltEvents),
    s.peakTilt.toFixed(2),
  ]);
}

const TIMING_COLUMNS: readonly Column[] = [
  { head: "persona", width: 16, align: "left" },
  { head: "n", width: 6, align: "right" },
  { head: "p10", width: 7, align: "right" },
  { head: "p50", width: 7, align: "right" },
  { head: "p90", width: 7, align: "right" },
  { head: "max", width: 7, align: "right" },
];

function timingRows(stats: readonly SeatStats[]): string[][] {
  return stats
    .filter((s) => s.thinkTimesMs.length > 0)
    .map((s) => [
      displayName(s.personaId),
      String(s.thinkTimesMs.length),
      String(quantile(s.thinkTimesMs, 0.1)),
      String(quantile(s.thinkTimesMs, 0.5)),
      String(quantile(s.thinkTimesMs, 0.9)),
      String(quantile(s.thinkTimesMs, 1)),
    ]);
}

function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function header(opts: Options, mode: string): void {
  const money = (c: number): string => (c / 100).toFixed(2);
  say(`Freeroll arena — ${mode}`);
  say(
    `seed "${opts.seed}" · ${money(opts.sbCents)}/${money(opts.bbCents)} · ` +
      `${opts.hands} hands/run · ${money(opts.stackCents)} buy-in (topped up each hand)`,
  );
  say();
}

function reportRun(result: RunResult, note?: string): void {
  say(table(STAT_COLUMNS, statRows(result.stats)));
  say();
  if (note !== undefined) {
    say(note);
    say();
  }
  const timing = timingRows(result.stats);
  if (timing.length > 0) {
    say("think time (ms at 1x — computed by the bot, never measured)");
    say(table(TIMING_COLUMNS, timing));
    say();
  }
}

function footer(hands: number, decisions: number, wallMs: number): void {
  const perDecision = decisions === 0 ? 0 : wallMs / decisions;
  say(
    `[wall clock, not deterministic] ${hands} hands · ${decisions} decisions · ` +
      `${(wallMs / 1000).toFixed(1)}s · ${perDecision.toFixed(2)} ms/decision`,
  );
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function runLineup(opts: Options): void {
  header(opts, `${opts.lineup.length}-handed self-play`);
  const result = run({
    seed: opts.seed,
    personas: opts.lineup,
    probe: null,
    hands: opts.hands,
    sbCents: opts.sbCents,
    bbCents: opts.bbCents,
    stackCents: opts.stackCents,
  });
  reportRun(result, "bb/100 is after rake and sums to ~0 across a rake-free table.");
  footer(result.hands, result.decisions, result.wallMs);
}

function runProbes(opts: Options, target: string): void {
  header(opts, `adversarial probes vs ${personaById(target).name}`);
  const rows: string[][] = [];
  let hands = 0;
  let decisions = 0;
  let wallMs = 0;

  for (const probe of PROBES) {
    const result = run({
      seed: `${opts.seed}/probe/${probe.id}`,
      personas: [target],
      probe,
      hands: opts.hands,
      sbCents: opts.sbCents,
      bbCents: opts.bbCents,
      stackCents: opts.stackCents,
    });
    hands += result.hands;
    decisions += result.decisions;
    wallMs += result.wallMs;
    const targetStats = result.statsBySeat.get(1);
    if (targetStats === undefined) throw new Error("target seat missing from the run");
    rows.push([
      probe.label,
      String(targetStats.hands),
      pct(targetStats.vpip),
      pct(targetStats.pfr),
      ratio(targetStats.af),
      pct(targetStats.wtsd),
      signed(targetStats.bb100),
      targetStats.ci95.toFixed(1),
      String(targetStats.tiltEvents),
      probe.expectation,
    ]);
  }

  say(`${personaById(target).name}'s results against each probe (heads-up):`);
  say();
  say(
    table(
      [
        { head: "probe", width: 17, align: "left" },
        { head: "hands", width: 6, align: "right" },
        { head: "VPIP", width: 6, align: "right" },
        { head: "PFR", width: 6, align: "right" },
        { head: "AF", width: 6, align: "right" },
        { head: "WTSD", width: 6, align: "right" },
        { head: "bb/100", width: 8, align: "right" },
        { head: "+/-95%", width: 8, align: "right" },
        { head: "tilt", width: 5, align: "right" },
        { head: "expectation", width: 1, align: "left" },
      ],
      rows,
    ),
  );
  say();
  footer(hands, decisions, wallMs);
}

function runMatrix(opts: Options): void {
  header(opts, "tier ladder — each tier vs the tier below, heads-up");
  const rows: string[][] = [];
  let hands = 0;
  let decisions = 0;
  let wallMs = 0;

  for (const tier of TIERS) {
    if (tier === TIERS[0]) continue;
    const upper = castOfTier(tier);
    const lower = castOfTier((tier - 1) as Tier);
    const pooled: number[] = [];
    let matches = 0;
    let wins = 0;

    for (const a of upper) {
      for (const b of lower) {
        const result = run({
          seed: `${opts.seed}/matrix/${a.id}-vs-${b.id}`,
          personas: [a.id, b.id],
          probe: null,
          hands: opts.hands,
          sbCents: opts.sbCents,
          bbCents: opts.bbCents,
          stackCents: opts.stackCents,
        });
        hands += result.hands;
        decisions += result.decisions;
        wallMs += result.wallMs;
        matches += 1;
        const series = result.series.get(0) ?? [];
        pooled.push(...series);
        if ((result.statsBySeat.get(0)?.bb100 ?? 0) > 0) wins += 1;
      }
    }

    const { mean, stderr } = meanAndStderr(pooled);
    rows.push([
      `tier ${tier} vs ${tier - 1}`,
      upper.map((p) => p.name).join("/"),
      lower.map((p) => p.name).join("/"),
      String(pooled.length),
      signed(mean * 100),
      (1.96 * stderr * 100).toFixed(1),
      `${wins}/${matches}`,
    ]);
  }

  say(
    table(
      [
        { head: "ladder", width: 13, align: "left" },
        { head: "upper", width: 22, align: "left" },
        { head: "lower", width: 22, align: "left" },
        { head: "hands", width: 6, align: "right" },
        { head: "bb/100", width: 8, align: "right" },
        { head: "+/-95%", width: 8, align: "right" },
        { head: "matches won", width: 11, align: "right" },
      ],
      rows,
    ),
  );
  say();
  say("bb/100 is the UPPER tier's, pooled over every pairing against the tier below.");
  say();
  footer(hands, decisions, wallMs);
}

// ---------------------------------------------------------------------------

function main(): void {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
    return;
  }
  if (opts.matrix) {
    runMatrix(opts);
    return;
  }
  if (opts.probe !== null) {
    runProbes(opts, opts.probe);
    return;
  }
  runLineup(opts);
}

main();
