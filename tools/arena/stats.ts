/**
 * Arena statistics — the numbers the report prints.
 *
 * Behavioural stats (VPIP/PFR/3bet/AF/WTSD) come from `@poker/analysis`'s
 * `aggregateStats`, so the arena measures a persona with exactly the counters
 * the product measures the player with — one definition of "3-bet", not two.
 * Everything else is here: the per-hand bb series behind the confidence
 * interval, tilt-event counts, and the think-time distribution.
 *
 * Results are reported in **bb/100 after rake** — the number a player actually
 * keeps — while the event log itself stays rake-free (rake is a session-ledger
 * adjustment; see `packages/sim/README.md`).
 */

import { type StatAggregate, aggregateStats, statValue } from "../../packages/analysis/src/index";
import type { HandRecord } from "../../packages/history/src/index";
import type { HandOutcome } from "../../packages/sim/src/index";

/** Everything measured about one seat over one run. */
export interface SeatStats {
  seat: number;
  personaId: string;
  /** Hands the seat was dealt into. */
  hands: number;
  vpip: number | undefined;
  pfr: number | undefined;
  threeBet: number | undefined;
  af: number | undefined;
  wtsd: number | undefined;
  /** Big blinds won per 100 hands, after rake. */
  bb100: number;
  /** Half-width of the 95% confidence interval on `bb100`. */
  ci95: number;
  /** Hands on which this seat's tilt rose. */
  tiltEvents: number;
  /** Highest tilt reached. */
  peakTilt: number;
  /** Sorted think times in ms — deterministic, computed by the bot. */
  thinkTimesMs: number[];
  /** Net after rake across the run, cents. */
  netCents: number;
  aggregate: StatAggregate;
}

/** An accumulator fed one finished hand at a time. */
export class ArenaStats {
  private readonly records: HandRecord[] = [];
  private readonly bbSeries = new Map<number, number[]>();
  private readonly netCents = new Map<number, number>();
  private readonly tiltEvents = new Map<number, number>();
  private readonly peakTilt = new Map<number, number>();
  private readonly thinkTimes = new Map<number, number[]>();
  private hands = 0;

  constructor(
    private readonly personaBySeat: ReadonlyMap<number, string>,
    private readonly bbCents: number,
  ) {}

  get handCount(): number {
    return this.hands;
  }

  /** The per-hand bb series for a seat — pooled across runs by the caller. */
  seriesOf(seat: number): readonly number[] {
    return this.bbSeries.get(seat) ?? [];
  }

  fold(outcome: HandOutcome): void {
    this.hands += 1;
    this.records.push(outcome.record);

    for (const seat of outcome.seats) {
      const net = outcome.netAfterRakeBySeat[String(seat)] ?? 0;
      this.netCents.set(seat, (this.netCents.get(seat) ?? 0) + net);
      const series = this.bbSeries.get(seat) ?? [];
      series.push(net / this.bbCents);
      this.bbSeries.set(seat, series);
    }
    for (const seat of outcome.tiltEvents) {
      this.tiltEvents.set(seat, (this.tiltEvents.get(seat) ?? 0) + 1);
    }
    for (const [seat, tilt] of Object.entries(outcome.tiltBySeat)) {
      const n = Number(seat);
      if (tilt > (this.peakTilt.get(n) ?? 0)) this.peakTilt.set(n, tilt);
    }
    for (const ev of outcome.record.events) {
      if (ev.t !== "act" || ev.thinkTimeMs === undefined) continue;
      const times = this.thinkTimes.get(ev.seat) ?? [];
      times.push(ev.thinkTimeMs);
      this.thinkTimes.set(ev.seat, times);
    }
  }

  /** Finalize per-seat statistics, seats ascending. */
  finish(): SeatStats[] {
    const out: SeatStats[] = [];
    for (const [seat, personaId] of [...this.personaBySeat].sort((a, b) => a[0] - b[0])) {
      const aggregate = aggregateStats(this.records, seat);
      const series = this.bbSeries.get(seat) ?? [];
      const { mean, stderr } = meanAndStderr(series);
      out.push({
        seat,
        personaId,
        hands: aggregate.hands,
        vpip: statValue(aggregate, "vpip"),
        pfr: statValue(aggregate, "pfr"),
        threeBet: statValue(aggregate, "threeBet"),
        af: statValue(aggregate, "af"),
        wtsd: statValue(aggregate, "wtsd"),
        bb100: mean * 100,
        ci95: 1.96 * stderr * 100,
        tiltEvents: this.tiltEvents.get(seat) ?? 0,
        peakTilt: this.peakTilt.get(seat) ?? 0,
        thinkTimesMs: [...(this.thinkTimes.get(seat) ?? [])].sort((a, b) => a - b),
        netCents: this.netCents.get(seat) ?? 0,
        aggregate,
      });
    }
    return out;
  }
}

/** Sample mean and standard error of the mean. */
export function meanAndStderr(xs: readonly number[]): { mean: number; stderr: number } {
  const n = xs.length;
  if (n === 0) return { mean: 0, stderr: 0 };
  let sum = 0;
  for (const x of xs) sum += x;
  const mean = sum / n;
  if (n < 2) return { mean, stderr: 0 };
  let sq = 0;
  for (const x of xs) sq += (x - mean) * (x - mean);
  return { mean, stderr: Math.sqrt(sq / (n - 1)) / Math.sqrt(n) };
}

/** Quantile of a pre-sorted array (nearest-rank). Returns 0 when empty. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}
