/**
 * Calibration harness — seeded multi-hand self-play, measured.
 *
 * `packages/bots` sits below `sim` and `analysis` in the package map, so this
 * cannot reuse the session orchestrator or `aggregateStats`: the dependency
 * would point upward. It therefore drives `@poker/engine` directly through
 * `playHand` and recomputes the five behavioural statistics from the canonical
 * event log, using the SAME definitions `@poker/analysis` uses — the
 * definitions are restated here, and `calibration.test.ts` pins them against
 * hand-built logs so the two copies cannot drift silently.
 *
 * Everything is a pure function of `(seed, personas, hands, stakes)`. No clock,
 * no `Math.random`, no environment reads.
 */

import { applyAction, legalActions, type ActionInput, type LegalActions } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { decide } from "../src/pipeline";
import { playHand, startHand, streamsFor, type TableSetup } from "../src/test-helpers";
import { observeHandEnd } from "../src/observe";
import { initialBotState, type BotState } from "../src/state";
import type { PersonaConfig } from "../src/persona";

/** The five statistics the bibles are calibrated against, plus results. */
export interface SeatMeasurement {
  seat: number;
  personaId: string;
  /** Hands dealt in. */
  hands: number;
  /** Voluntarily put money in pot, percent. */
  vpip: number;
  /** Preflop raise, percent. */
  pfr: number;
  /** Re-raised facing exactly one raise, percent; `null` with no opportunities. */
  threeBet: number | null;
  /** Postflop (bets + raises) / calls; `null` when the seat never acted postflop. */
  af: number | null;
  /** Went to showdown having seen a flop, percent; `null` with no flops seen. */
  wtsd: number | null;
  /** Big blinds won per 100 hands. */
  bb100: number;
  /** Half-width of the 95% confidence interval on `bb100`. */
  ci95: number;
  /** Highest tilt the seat reached. */
  peakTilt: number;
}

/** Counters behind one seat's measurement, poolable across matches. */
export interface SeatCounters {
  hands: number;
  vpipN: number;
  pfrN: number;
  threeBetN: number;
  threeBetD: number;
  aggressiveN: number;
  callD: number;
  flopsSeen: number;
  showdowns: number;
  /** Per-hand net in big blinds — the confidence interval's sample. */
  netBb: number[];
  peakTilt: number;
}

export function emptyCounters(): SeatCounters {
  return {
    hands: 0,
    vpipN: 0,
    pfrN: 0,
    threeBetN: 0,
    threeBetD: 0,
    aggressiveN: 0,
    callD: 0,
    flopsSeen: 0,
    showdowns: 0,
    netBb: [],
    peakTilt: 0,
  };
}

/** Fold `b` into `a` (used to pool a persona across many seatings). */
export function mergeCounters(a: SeatCounters, b: SeatCounters): SeatCounters {
  return {
    hands: a.hands + b.hands,
    vpipN: a.vpipN + b.vpipN,
    pfrN: a.pfrN + b.pfrN,
    threeBetN: a.threeBetN + b.threeBetN,
    threeBetD: a.threeBetD + b.threeBetD,
    aggressiveN: a.aggressiveN + b.aggressiveN,
    callD: a.callD + b.callD,
    flopsSeen: a.flopsSeen + b.flopsSeen,
    showdowns: a.showdowns + b.showdowns,
    netBb: [...a.netBb, ...b.netBb],
    peakTilt: Math.max(a.peakTilt, b.peakTilt),
  };
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

/**
 * Fold one hand's event log into a seat's counters.
 *
 * Definitions, matching `@poker/analysis`:
 * - **VPIP** — any preflop `call`/`bet`/`raise`. Blind posts are not `act`
 *   events, so they never count.
 * - **PFR** — any preflop `raise`.
 * - **3-bet** — the seat's FIRST preflop action taken with exactly one raise
 *   already in front of it; numerator when that action is itself a raise.
 * - **AF** — postflop bets + raises over postflop calls, pooled.
 * - **WTSD** — of hands where the seat was still live when the flop came, the
 *   share that reached a showdown.
 */
export function foldHand(counters: SeatCounters, events: readonly HandEvent[], seat: number, bb: number): void {
  let dealtIn = false;
  for (const ev of events) {
    if (ev.t === "start") {
      dealtIn = ev.seats.some((s) => s.seat === seat);
      break;
    }
  }
  if (!dealtIn) return;
  counters.hands += 1;

  let street: "preflop" | "flop" | "turn" | "river" = "preflop";
  let folded = false;
  let sawFlop = false;
  let raisesBeforeFirstAction = 0;
  let firstPreflopAction: HandEvent | null = null;
  let voluntary = false;
  let raisedPreflop = false;
  let preflopRaisesSoFar = 0;

  for (const ev of events) {
    if (ev.t === "board") {
      street = ev.street;
      if (ev.street === "flop" && !folded) sawFlop = true;
      continue;
    }
    if (ev.t === "showdown") {
      if (ev.reveals.some((r) => r.seat === seat)) counters.showdowns += 1;
      continue;
    }
    if (ev.t !== "act") continue;

    if (ev.seat !== seat) {
      if (street === "preflop" && ev.kind === "raise") preflopRaisesSoFar += 1;
      continue;
    }

    if (street === "preflop") {
      if (firstPreflopAction === null) {
        firstPreflopAction = ev;
        raisesBeforeFirstAction = preflopRaisesSoFar;
      }
      if (ev.kind === "call" || ev.kind === "bet" || ev.kind === "raise") voluntary = true;
      if (ev.kind === "raise") {
        raisedPreflop = true;
        preflopRaisesSoFar += 1;
      }
    } else {
      if (ev.kind === "bet" || ev.kind === "raise") counters.aggressiveN += 1;
      if (ev.kind === "call") counters.callD += 1;
    }
    if (ev.kind === "fold") folded = true;
  }

  if (voluntary) counters.vpipN += 1;
  if (raisedPreflop) counters.pfrN += 1;
  if (firstPreflopAction !== null && raisesBeforeFirstAction === 1) {
    counters.threeBetD += 1;
    if (firstPreflopAction.t === "act" && firstPreflopAction.kind === "raise") counters.threeBetN += 1;
  }
  if (sawFlop) counters.flopsSeen += 1;

  for (const ev of events) {
    if (ev.t !== "end") continue;
    const mine = ev.net.find((n) => n.seat === seat);
    counters.netBb.push((mine?.net ?? 0) / bb);
  }
}

/** Project counters into the reported measurement. */
export function measure(seat: number, personaId: string, c: SeatCounters): SeatMeasurement {
  const { mean, stderr } = meanAndStderr(c.netBb);
  const pct = (n: number, d: number): number => (d === 0 ? 0 : (100 * n) / d);
  return {
    seat,
    personaId,
    hands: c.hands,
    vpip: pct(c.vpipN, c.hands),
    pfr: pct(c.pfrN, c.hands),
    threeBet: c.threeBetD === 0 ? null : pct(c.threeBetN, c.threeBetD),
    af: c.callD === 0 ? (c.aggressiveN === 0 ? null : Number.POSITIVE_INFINITY) : c.aggressiveN / c.callD,
    wtsd: c.flopsSeen === 0 ? null : pct(c.showdowns, c.flopsSeen),
    bb100: mean * 100,
    ci95: 1.96 * stderr * 100,
    peakTilt: c.peakTilt,
  };
}

export interface MatchOptions {
  seed: string;
  /** One persona per seat, seat number = index. */
  personas: readonly PersonaConfig[];
  hands: number;
  /** Buy-in in cents, restored before every hand so results measure strategy. */
  stackCents?: number;
  blinds?: TableSetup["blinds"];
}

/**
 * Play `hands` seeded hands, rotating the button one seat per hand and topping
 * stacks back up to the buy-in each time — the arena's convention, so bb/100
 * measures strategy rather than the survivorship of a bust-out ladder.
 *
 * Bot memory (tilt, opponent models) threads across hands exactly as the real
 * session does: `observeHandEnd` per seat at every hand boundary.
 */
export function playMatch(opts: MatchOptions): SeatCounters[] {
  const personas = opts.personas;
  const seats = personas.length;
  const stack = opts.stackCents ?? 20_000;
  const blinds = opts.blinds ?? { sb: 50, bb: 100, ante: 0 };
  const counters = personas.map(() => emptyCounters());
  const botStates = new Map<number, BotState>();
  personas.forEach((p, seat) => botStates.set(seat, initialBotState(p)));

  for (let hand = 1; hand <= opts.hands; hand++) {
    const played = playHand(
      {
        seed: `${opts.seed}/h${hand}`,
        handNumber: hand,
        button: (hand - 1) % seats,
        stacks: new Array<number>(seats).fill(stack),
        blinds,
      },
      (seat) => personas[seat] as PersonaConfig,
      botStates,
    );
    for (let seat = 0; seat < seats; seat++) {
      foldHand(counters[seat] as SeatCounters, played.events, seat, blinds.bb);
      const persona = personas[seat] as PersonaConfig;
      const next = observeHandEnd(
        botStates.get(seat) ?? initialBotState(persona),
        persona,
        played.events,
        { seat },
      );
      botStates.set(seat, next);
      const c = counters[seat] as SeatCounters;
      if (next.tilt > c.peakTilt) c.peakTilt = next.tilt;
    }
  }
  return counters;
}

/** Heads-up margin for `a` against `b`, in bb/100, with its 95% half-width. */
export function headsUpMargin(
  a: PersonaConfig,
  b: PersonaConfig,
  seed: string,
  hands: number,
): { bb100: number; ci95: number; hands: number } {
  const counters = playMatch({ seed, personas: [a, b], hands });
  const m = measure(0, a.id, counters[0] as SeatCounters);
  return { bb100: m.bb100, ci95: m.ci95, hands: m.hands };
}

// ---------------------------------------------------------------------------
// Adversarial probes
// ---------------------------------------------------------------------------

/**
 * A scripted decider: the engine's legal menu in, one legal action out.
 *
 * Probes are deliberately NOT personas. They are degenerate strategies whose
 * only job is to press one axis of a character's decision surface until
 * something breaks — a persona that loses money to `always-fold`, or wins
 * nothing from `pure-station`, has a bug rather than a personality. Driving
 * them purely from `legalActions` means a probe can never propose an action
 * the engine would reject and never needs a rules model of its own.
 *
 * This mirrors `tools/arena/probes.ts`; `bots` cannot import from `tools`, and
 * the calibration thresholds have to live in a committed test rather than in a
 * CLI a human has to remember to run.
 */
export type Probe = (legal: LegalActions) => { kind: ActionInput["kind"]; amount?: number };

export interface ProbeSpec {
  id: string;
  /** What a healthy persona must do about it. */
  expectation: string;
  decide: Probe;
}

export const PROBES: readonly ProbeSpec[] = [
  {
    id: "always-min-raise",
    expectation: "a competent persona 3-bets or calls down and prints",
    decide: (legal) => {
      if (legal.raise !== undefined) return { kind: "raise", amount: legal.raise.minTo };
      if (legal.bet !== undefined) return { kind: "bet", amount: legal.bet.min };
      if (legal.check !== undefined) return { kind: "check" };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      return { kind: "fold" };
    },
  },
  {
    id: "always-jam",
    expectation: "the target profits by calling only its strong range",
    decide: (legal) => {
      if (legal.raise !== undefined) return { kind: "raise", amount: legal.raise.maxTo };
      if (legal.bet !== undefined) return { kind: "bet", amount: legal.bet.max };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      if (legal.check !== undefined) return { kind: "check" };
      return { kind: "fold" };
    },
  },
  {
    id: "always-fold",
    expectation: "free blinds: the target must collect roughly +50bb/100",
    decide: (legal) => {
      if (legal.fold !== undefined) return { kind: "fold" };
      if (legal.check !== undefined) return { kind: "check" };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      return { kind: "fold" };
    },
  },
  {
    id: "pure-station",
    expectation: "value-bet relentlessly, never bluff: the target must print",
    decide: (legal) => {
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      if (legal.check !== undefined) return { kind: "check" };
      return { kind: "fold" };
    },
  },
];

export interface ProbeMatchOptions {
  seed: string;
  /** The persona under test; it sits in seat 1, the probe in seat 0. */
  persona: PersonaConfig;
  probe: ProbeSpec;
  hands: number;
  stackCents?: number;
  blinds?: TableSetup["blinds"];
}

/**
 * Heads-up: the probe in seat 0, the persona under test in seat 1. Returns the
 * PERSONA's counters — the probe's own numbers are not a statistic about
 * anything.
 */
export function playProbeMatch(opts: ProbeMatchOptions): SeatCounters {
  const stack = opts.stackCents ?? 20_000;
  const blinds = opts.blinds ?? { sb: 50, bb: 100, ante: 0 };
  const counters = emptyCounters();
  let botState = initialBotState(opts.persona);

  for (let hand = 1; hand <= opts.hands; hand++) {
    const seed = `${opts.seed}/h${hand}`;
    const { state: initial, events } = startHand({
      seed,
      handNumber: hand,
      button: (hand - 1) % 2,
      stacks: [stack, stack],
      blinds,
    });
    let state = initial;
    const log: HandEvent[] = [...events];
    const counts = new Map<string, number>();
    let guard = 0;
    while (!state.handOver && state.actionSeat !== null) {
      if (guard++ > 200) throw new Error("probe hand did not terminate");
      const seat = state.actionSeat;
      const legal = legalActions(state);
      let input: ActionInput;
      if (seat === 0) {
        const chosen = opts.probe.decide(legal);
        input = chosen.amount === undefined
          ? { seat, kind: chosen.kind }
          : { seat, kind: chosen.kind, amount: chosen.amount };
      } else {
        const key = `${state.street}:${seat}`;
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        const decision = decide(
          { state, seat, persona: opts.persona, events: log, legal },
          botState,
          streamsFor(seed, seat, state.street, n),
        );
        botState = decision.nextBotState;
        input = decision.amount === undefined
          ? { seat, kind: decision.action }
          : { seat, kind: decision.action, amount: decision.amount };
      }
      const result = applyAction(state, input);
      state = result.state;
      for (const ev of result.events) log.push(ev);
    }
    foldHand(counters, log, 1, blinds.bb);
    botState = observeHandEnd(botState, opts.persona, log, { seat: 1 });
    if (botState.tilt > counters.peakTilt) counters.peakTilt = botState.tilt;
  }
  return counters;
}
