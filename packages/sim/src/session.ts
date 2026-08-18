/**
 * `createSession` — the session orchestrator.
 *
 * One object owns everything that spans hands: the seed hierarchy, the seat and
 * stack ledger, the button, the bots' memory (tilt carries over — that is the
 * whole point of a *session* rather than a pile of hands), and the assembly of
 * a complete `HandRecord` per docs/hand-format.md.
 *
 * ```text
 *              nextHand()                     act(heroAction)
 *   ready ──────────────────► awaiting-hero ────────────────► (loop)
 *     ▲                             │
 *     └──────── outcome ◄───────────┘
 * ```
 *
 * A lineup with no hero runs straight through: `nextHand()` returns the
 * finished hand. With a hero, it stops at every hero decision point and hands
 * back `{ awaitingHero: true, legalActions, snapshot }`; `act()` resumes.
 * Either way the caller drives — nothing here loops on its own, and nothing
 * here reads a clock.
 *
 * ## Determinism
 *
 * Given the same `(config, sessionSeed)` and the same hero decisions, every
 * hand's event log is byte-identical, on every platform. All luck comes from
 * `@poker/rng` streams keyed by structural position:
 *
 * - `hand/{N}/deck` — the whole runout, shuffled before a single action;
 * - `hand/{N}/bot/{seat}/{street}/{n}` — one decision's personality rolls;
 * - `hand/{N}/mc/{seat}/{street}/{n}` — that decision's Monte Carlo.
 *
 * `{n}` is the seat's 0-based action index on the street, so a what-if branch
 * reaching the same position re-decides with identical luck.
 */

import { freshDeck } from "@poker/core";
import type { PersonaConfig } from "@poker/bots";
import {
  type BotState,
  decide,
  initialBotState,
  observeHandEnd,
  personaById,
} from "@poker/bots";
import {
  type ActionInput,
  type Evaluate7,
  type LegalActions,
  type SeatConfig,
  type TableState,
  applyAction,
  initHand,
  legalActions,
} from "@poker/engine";
import { evaluate7 as evaluate7Cards } from "@poker/eval";
import {
  type HandEvent,
  type HandRecord,
  type Street,
  type TableConfig,
  HAND_RECORD_VERSION,
  decisionId as makeDecisionId,
  validateEvents,
} from "@poker/history";
import { streamFor } from "@poker/rng";
import { gradeRecord } from "./grade";
import { defaultSessionId, handId as makeHandId, handSeed } from "./ids";
import { RAKE_ANNOTATION_KEY, computeRake, validateRakeConfig } from "./rake";
import {
  type DecisionAnnotation,
  type HandOutcome,
  type HeroAction,
  type HeroSnapshot,
  type RakeLedger,
  type SeatSpec,
  type SessionConfig,
  type SessionRuntime,
  type SessionStatus,
  type SessionStep,
  type SessionView,
  isHeroSeat,
} from "./types";

/** Thrown for caller misuse: a bad config, or a call in the wrong state. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/** The shipped evaluator in the engine's array-taking shape (lower = stronger). */
export const defaultEvaluate7: Evaluate7 = (c) =>
  evaluate7Cards(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0, c[6] ?? 0);

/**
 * Hard stop on a hand that refuses to terminate. The engine guarantees
 * termination (chips are finite and every raise commits some), so this only
 * ever fires on a bug — but a wide-open min-raise war between six 200bb stacks
 * legitimately runs to ~90 decisions, so the ceiling sits far above anything a
 * real hand reaches.
 */
const MAX_DECISIONS_PER_HAND = 5_000;

/** The session's public surface. */
export interface Session {
  readonly sessionId: string;
  /** The resolved configuration, frozen. */
  readonly config: Readonly<SessionConfig>;
  /** Hero's seat, or `null` in a self-play lineup. */
  readonly heroSeat: number | null;
  /** The character seated at each seat (hero seats absent). */
  readonly personaBySeat: ReadonlyMap<number, PersonaConfig>;
  status(): SessionStatus;
  view(): SessionView;
  /**
   * Deal and play the next hand. Returns the finished hand, or pauses at the
   * first hero decision.
   * @throws SessionError when a hero decision is pending or the session is over.
   */
  nextHand(): SessionStep;
  /**
   * Resume from a hero pause.
   * @throws SessionError when no hero decision is pending; `EngineError` when
   * the action is not in the legal menu.
   */
  act(action: HeroAction): SessionStep;
  /** The pending hero decision, or `null`. */
  pending(): { legalActions: LegalActions; snapshot: HeroSnapshot } | null;
  /** Bot memory by seat — tilt, opponent models, tell cooldowns. */
  botStates(): ReadonlyMap<number, BotState>;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

interface Resolved {
  config: SessionConfig;
  sessionId: string;
  seatCount: number;
  heroSeat: number | null;
  personaBySeat: Map<number, PersonaConfig>;
  buyIns: number[];
  sb: number;
  bb: number;
  ante: number;
  button: number;
  rotateButton: boolean;
  rebuy: NonNullable<NonNullable<SessionConfig["dealerOptions"]>["rebuy"]>;
  minStackCents: number;
  maxHands: number;
  wantTraces: boolean;
  wantGrades: boolean;
  evaluate7: Evaluate7;
  tableConfig: TableConfig;
}

function assertCents(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new SessionError(`${what} must be a non-negative integer (cents), got ${String(n)}`);
  }
}

function resolve(config: SessionConfig, runtime: SessionRuntime | undefined): Resolved {
  if (typeof config.sessionSeed !== "string" || config.sessionSeed.length === 0) {
    throw new SessionError("sessionSeed must be a non-empty string");
  }
  if (config.format !== "cash") {
    throw new SessionError(`unsupported format ${JSON.stringify(config.format)} (v1 is cash only)`);
  }
  const seatCount = config.seats.length;
  if (seatCount < 2 || seatCount > 9) {
    throw new SessionError(`expected 2-9 seats, got ${seatCount}`);
  }

  const personaBySeat = new Map<number, PersonaConfig>();
  let heroSeat: number | null = null;
  for (let seat = 0; seat < seatCount; seat++) {
    const spec = config.seats[seat] as SeatSpec;
    if (isHeroSeat(spec)) {
      if (heroSeat !== null) throw new SessionError("at most one hero seat is supported");
      heroSeat = seat;
      continue;
    }
    personaBySeat.set(seat, personaById(spec.personaId));
  }

  const stacks = config.stackCents;
  const buyIns: number[] =
    typeof stacks === "number" ? new Array<number>(seatCount).fill(stacks) : [...stacks];
  if (buyIns.length !== seatCount) {
    throw new SessionError(`stackCents has ${buyIns.length} entries for ${seatCount} seats`);
  }
  buyIns.forEach((s, i) => {
    assertCents(s, `stackCents[${i}]`);
    if (s < 1) throw new SessionError(`stackCents[${i}] must be >= 1 cent`);
  });

  const sb = config.stakes.sbCents;
  const bb = config.stakes.bbCents;
  const ante = config.stakes.anteCents ?? 0;
  assertCents(sb, "stakes.sbCents");
  assertCents(bb, "stakes.bbCents");
  assertCents(ante, "stakes.anteCents");
  if (bb < 1) throw new SessionError("stakes.bbCents must be >= 1 cent");
  if (config.rake !== undefined) validateRakeConfig(config.rake);

  const dealer = config.dealerOptions ?? {};
  const button = dealer.button ?? 0;
  if (!Number.isSafeInteger(button) || button < 0 || button >= seatCount) {
    throw new SessionError(`dealerOptions.button ${String(button)} is not a seat`);
  }
  const minStackCents = dealer.minStackCents ?? 0;
  assertCents(minStackCents, "dealerOptions.minStackCents");
  const maxHands = dealer.maxHands ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxHands) || maxHands < 0) {
    throw new SessionError(`dealerOptions.maxHands must be a non-negative integer`);
  }

  return {
    config,
    sessionId: config.sessionId ?? defaultSessionId(config.sessionSeed),
    seatCount,
    heroSeat,
    personaBySeat,
    buyIns,
    sb,
    bb,
    ante,
    button,
    rotateButton: dealer.rotateButton ?? true,
    rebuy: dealer.rebuy ?? "off",
    minStackCents,
    maxHands,
    wantTraces: config.annotations?.traces ?? true,
    wantGrades: config.annotations?.grades ?? true,
    evaluate7: runtime?.evaluate7 ?? defaultEvaluate7,
    tableConfig: { variant: "nlhe", maxSeats: seatCount, sb, bb, ante },
  };
}

// ---------------------------------------------------------------------------
// Resume state (checkpoint.ts builds these)
// ---------------------------------------------------------------------------

/** Everything a checkpoint restores. @internal */
export interface ResumeState {
  handsPlayed: number;
  nextHandNumber: number;
  buttonCursor: number;
  stacks: number[];
  rakeTotalCents: number;
  buyInTotalCents: number;
  botStates: Map<number, BotState>;
}

/** The live internals a checkpoint captures. @internal */
export interface SessionInternals extends ResumeState {
  sessionId: string;
  config: SessionConfig;
  awaitingHero: boolean;
}

/** @internal — `checkpoint.ts` reads a session's internals through this. */
export const INTERNALS = Symbol.for("@poker/sim.internals");

interface InternalAccess {
  [INTERNALS]: () => SessionInternals;
}

/** @internal */
export function internalsOf(session: Session): SessionInternals {
  const access = session as unknown as Partial<InternalAccess>;
  const fn = access[INTERNALS];
  if (typeof fn !== "function") throw new SessionError("not a @poker/sim session");
  return fn();
}

// ---------------------------------------------------------------------------
// The live hand
// ---------------------------------------------------------------------------

interface LiveHand {
  handNumber: number;
  button: number;
  seats: number[];
  state: TableState;
  events: HandEvent[];
  /** `${street}:${seat}` -> count of that seat's prior acts on the street. */
  counters: Map<string, number>;
  annotations: Record<string, DecisionAnnotation>;
  decisionCount: number;
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

/**
 * Create a session.
 *
 * @param config JSON-safe description of the table, the seats and the seed.
 * @param runtime Injections that cannot be serialized (evaluator, chart set).
 */
export function createSession(config: SessionConfig, runtime?: SessionRuntime): Session {
  return build(config, runtime, undefined);
}

/** @internal — resume a session from a checkpoint's decoded state. */
export function resumeSession(
  config: SessionConfig,
  runtime: SessionRuntime | undefined,
  state: ResumeState,
): Session {
  return build(config, runtime, state);
}

function build(
  config: SessionConfig,
  runtime: SessionRuntime | undefined,
  resume: ResumeState | undefined,
): Session {
  const r = resolve(config, runtime);
  const chartSet = runtime?.chartSet;

  const stacks: number[] = resume ? [...resume.stacks] : [...r.buyIns];
  if (stacks.length !== r.seatCount) {
    throw new SessionError(`checkpoint has ${stacks.length} stacks for ${r.seatCount} seats`);
  }
  let handsPlayed = resume?.handsPlayed ?? 0;
  let nextHandNumber = resume?.nextHandNumber ?? 1;
  let buttonCursor = resume?.buttonCursor ?? r.button;
  let rakeTotalCents = resume?.rakeTotalCents ?? 0;
  let buyInTotalCents = resume?.buyInTotalCents ?? r.buyIns.reduce((a, b) => a + b, 0);

  const botStates = new Map<number, BotState>();
  for (const [seat, persona] of r.personaBySeat) {
    botStates.set(seat, resume?.botStates.get(seat) ?? initialBotState(persona));
  }

  let live: LiveHand | null = null;
  let pendingHero: { legalActions: LegalActions; snapshot: HeroSnapshot } | null = null;

  // --- seat funding ------------------------------------------------------

  function applyRebuys(): void {
    if (r.rebuy === "off") return;
    for (let seat = 0; seat < r.seatCount; seat++) {
      const target = r.buyIns[seat] ?? 0;
      const have = stacks[seat] ?? 0;
      const needsIt = r.rebuy === "top-up" ? have < target : have <= r.minStackCents;
      if (!needsIt || have >= target) continue;
      buyInTotalCents += target - have;
      stacks[seat] = target;
    }
  }

  function fundedSeats(): number[] {
    const out: number[] = [];
    for (let seat = 0; seat < r.seatCount; seat++) if ((stacks[seat] ?? 0) >= 1) out.push(seat);
    return out;
  }

  function currentStatus(): SessionStatus {
    if (pendingHero !== null) return "awaiting-hero";
    if (handsPlayed >= r.maxHands) return "finished";
    // Funding is decided at deal time; a peek must not mutate the ledger.
    let funded = 0;
    for (let seat = 0; seat < r.seatCount; seat++) {
      const target = r.buyIns[seat] ?? 0;
      const have = stacks[seat] ?? 0;
      const topped =
        r.rebuy === "top-up"
          ? Math.max(have, target)
          : r.rebuy === "rebuy-on-bust" && have <= r.minStackCents
            ? Math.max(have, target)
            : have;
      if (topped >= 1) funded += 1;
    }
    return funded >= 2 ? "ready" : "finished";
  }

  // --- hand assembly -----------------------------------------------------

  function heroSnapshotOf(
    state: TableState,
    hand: LiveHand,
    seat: number,
    menu: LegalActions,
  ): HeroSnapshot {
    let pot = 0;
    for (const s of state.seats) pot += s.committedTotal;
    const me = state.seats.find((s) => s.seat === seat);
    const n = hand.counters.get(`${state.street}:${seat}`) ?? 0;
    return {
      handNumber: hand.handNumber,
      seat,
      street: state.street,
      decisionId: makeDecisionId(state.street, seat, n),
      state,
      events: hand.events,
      holeCards: me?.holeCards ?? null,
      board: state.board,
      pot,
      toCall: menu.call?.amount ?? 0,
      stack: me?.stack ?? 0,
      livePlayers: state.seats.filter((s) => !s.folded).length,
    };
  }

  /** Record the action's events, stamping the observed think time on the `act`. */
  function pushEvents(hand: LiveHand, events: readonly HandEvent[], thinkTimeMs?: number): void {
    let stamped = false;
    for (const ev of events) {
      if (!stamped && ev.t === "act" && thinkTimeMs !== undefined) {
        stamped = true;
        hand.events.push({ ...ev, thinkTimeMs });
        continue;
      }
      hand.events.push(ev);
    }
  }

  function takeDecisionIndex(hand: LiveHand, street: Street, seat: number): number {
    const key = `${street}:${seat}`;
    const n = hand.counters.get(key) ?? 0;
    hand.counters.set(key, n + 1);
    return n;
  }

  function stepBot(hand: LiveHand, seat: number): void {
    const persona = r.personaBySeat.get(seat);
    if (persona === undefined) throw new SessionError(`seat ${seat} has no persona`);
    const botState = botStates.get(seat);
    if (botState === undefined) throw new SessionError(`seat ${seat} has no bot state`);

    const street = hand.state.street;
    const n = takeDecisionIndex(hand, street, seat);
    const path = `hand/${hand.handNumber}`;
    const decision = decide(
      {
        state: hand.state,
        seat,
        persona,
        events: hand.events,
        ...(r.heroSeat === null ? {} : { heroSeat: r.heroSeat }),
        legal: legalActions(hand.state),
      },
      botState,
      {
        decision: streamFor(r.config.sessionSeed, `${path}/bot/${seat}/${street}/${n}`),
        mc: streamFor(r.config.sessionSeed, `${path}/mc/${seat}/${street}/${n}`),
      },
    );
    botStates.set(seat, decision.nextBotState);

    if (r.wantTraces) {
      hand.annotations[makeDecisionId(street, seat, n)] = { trace: decision.trace };
    }

    const input: ActionInput = { seat, kind: decision.action };
    if (decision.amount !== undefined) input.amount = decision.amount;
    const result = applyAction(hand.state, input);
    hand.state = result.state;
    hand.decisionCount += 1;
    pushEvents(hand, result.events, Math.max(0, Math.round(decision.thinkTimeMs)));
  }

  /** Play until the hand ends or the hero must act. */
  function run(hand: LiveHand): SessionStep {
    while (!hand.state.handOver && hand.state.actionSeat !== null) {
      if (hand.decisionCount > MAX_DECISIONS_PER_HAND) {
        throw new SessionError(`hand ${hand.handNumber} did not terminate`);
      }
      const seat = hand.state.actionSeat;
      if (seat === r.heroSeat) {
        const menu = legalActions(hand.state);
        const snapshot = heroSnapshotOf(hand.state, hand, seat, menu);
        pendingHero = { legalActions: menu, snapshot };
        return { awaitingHero: true, legalActions: menu, snapshot };
      }
      stepBot(hand, seat);
    }
    return { awaitingHero: false, outcome: settle(hand) };
  }

  function settle(hand: LiveHand): HandOutcome {
    const events = hand.events;
    const validation = validateEvents(events);
    if (!validation.ok) {
      throw new SessionError(
        `hand ${hand.handNumber} produced an invalid event log:\n  ${validation.errors.join("\n  ")}`,
      );
    }

    // --- rake: a post-award adjustment, never part of the log --------------
    const committedBySeat = new Map<number, number>();
    for (const s of hand.state.seats) committedBySeat.set(s.seat, s.committedTotal);
    const awardedBySeat = new Map<number, number>();
    let sawBoard = false;
    for (const ev of events) {
      if (ev.t === "board") sawBoard = true;
      if (ev.t === "pot") awardedBySeat.set(ev.seat, (awardedBySeat.get(ev.seat) ?? 0) + ev.amount);
    }
    const rake: RakeLedger = computeRake(r.config.rake, {
      committedBySeat,
      awardedBySeat,
      sawBoard,
    });

    const netBySeat: Record<string, number> = {};
    const netAfterRakeBySeat: Record<string, number> = {};
    for (const ev of events) {
      if (ev.t !== "end") continue;
      for (const entry of ev.net) {
        const paid = rake.bySeat[String(entry.seat)] ?? 0;
        netBySeat[String(entry.seat)] = entry.net;
        netAfterRakeBySeat[String(entry.seat)] = entry.net - paid;
      }
    }

    for (const seat of hand.seats) {
      stacks[seat] = (stacks[seat] ?? 0) + (netAfterRakeBySeat[String(seat)] ?? 0);
    }
    rakeTotalCents += rake.totalCents;

    // --- the record --------------------------------------------------------
    const annotations: Record<string, unknown> = { ...hand.annotations };
    annotations[RAKE_ANNOTATION_KEY] = rake;

    const record: HandRecord = {
      v: HAND_RECORD_VERSION,
      id: makeHandId(r.sessionId, r.config.sessionSeed, hand.handNumber),
      sessionId: r.sessionId,
      seed: handSeed(r.config.sessionSeed, hand.handNumber),
      config: { ...r.tableConfig },
      events,
      annotations,
    };

    if (r.heroSeat !== null && r.wantGrades && hand.seats.includes(r.heroSeat)) {
      for (const grade of gradeRecord(record, {
        heroSeat: r.heroSeat,
        personaBySeat: r.personaBySeat,
        evaluate7: r.evaluate7,
        chartSet,
        trials: r.config.grading?.trials,
        estimateEv: r.config.grading?.estimateEv ?? false,
        tier: r.config.grading?.tier,
      })) {
        const existing = (annotations[grade.decisionId] as DecisionAnnotation | undefined) ?? {};
        annotations[grade.decisionId] = { ...existing, grade };
      }
    }

    // --- bot memory: decay, spikes, opponent models -------------------------
    const tiltBySeat: Record<string, number> = {};
    const tiltEvents: number[] = [];
    for (const seat of hand.seats) {
      const persona = r.personaBySeat.get(seat);
      const before = botStates.get(seat);
      if (persona === undefined || before === undefined) continue;
      const after = observeHandEnd(before, persona, events, {
        seat,
        ...(r.heroSeat === null ? {} : { heroSeat: r.heroSeat }),
      });
      botStates.set(seat, after);
      tiltBySeat[String(seat)] = after.tilt;
      if (after.tilt > before.tilt) tiltEvents.push(seat);
    }

    handsPlayed += 1;
    nextHandNumber = hand.handNumber + 1;
    if (r.rotateButton) buttonCursor = (hand.button + 1) % r.seatCount;
    live = null;

    return {
      handNumber: hand.handNumber,
      button: hand.button,
      seats: hand.seats,
      record,
      netBySeat,
      rake,
      netAfterRakeBySeat,
      stacksAfter: [...stacks],
      tiltBySeat,
      tiltEvents,
      decisionCount: hand.decisionCount,
    };
  }

  // --- public API ---------------------------------------------------------

  function nextHand(): SessionStep {
    if (pendingHero !== null) {
      throw new SessionError("a hero decision is pending — call act() first");
    }
    if (handsPlayed >= r.maxHands) {
      throw new SessionError(`session reached its ${r.maxHands}-hand limit`);
    }
    applyRebuys();
    const seats = fundedSeats();
    if (seats.length < 2) {
      throw new SessionError(`only ${seats.length} funded seat(s) — the session is over`);
    }

    // Button: the first funded seat at or after the ring cursor.
    let button = seats[0] as number;
    for (let i = 0; i < r.seatCount; i++) {
      const candidate = (buttonCursor + i) % r.seatCount;
      if (seats.includes(candidate)) {
        button = candidate;
        break;
      }
    }

    const handNumber = nextHandNumber;
    const deck = streamFor(r.config.sessionSeed, `hand/${handNumber}/deck`).shuffle(freshDeck());
    const seatConfigs: SeatConfig[] = seats.map((seat) => ({ seat, stack: stacks[seat] ?? 0 }));
    const { state, events } = initHand({
      handNumber,
      button,
      seats: seatConfigs,
      blinds: { sb: r.sb, bb: r.bb, ante: r.ante },
      deckOrder: deck,
      evaluate7: r.evaluate7,
    });

    const hand: LiveHand = {
      handNumber,
      button,
      seats,
      state,
      events: [...events],
      counters: new Map(),
      annotations: {},
      decisionCount: 0,
    };
    live = hand;
    return run(hand);
  }

  function act(action: HeroAction): SessionStep {
    const pendingNow = pendingHero;
    const hand = live;
    if (pendingNow === null || hand === null) {
      throw new SessionError("no hero decision is pending");
    }
    if (r.heroSeat === null) throw new SessionError("this session has no hero seat");

    const street = hand.state.street;
    const input: ActionInput = { seat: r.heroSeat, kind: action.kind };
    if (action.amount !== undefined) input.amount = action.amount;
    // Apply BEFORE mutating session bookkeeping: an illegal action must leave
    // the pause intact so the caller can simply try again.
    const result = applyAction(hand.state, input);
    takeDecisionIndex(hand, street, r.heroSeat);
    pendingHero = null;
    hand.state = result.state;
    hand.decisionCount += 1;
    const think = action.thinkTimeMs;
    pushEvents(
      hand,
      result.events,
      think === undefined ? undefined : Math.max(0, Math.round(think)),
    );
    return run(hand);
  }

  const session: Session & InternalAccess = {
    sessionId: r.sessionId,
    config: Object.freeze({ ...config }),
    heroSeat: r.heroSeat,
    personaBySeat: r.personaBySeat,
    status: currentStatus,
    view: (): SessionView => ({
      sessionId: r.sessionId,
      status: currentStatus(),
      handsPlayed,
      nextHandNumber,
      stacks: [...stacks],
      rakeTotalCents,
      buyInTotalCents,
      heroSeat: r.heroSeat,
    }),
    nextHand,
    act,
    pending: () => pendingHero,
    botStates: () => botStates,
    [INTERNALS]: (): SessionInternals => ({
      sessionId: r.sessionId,
      config,
      awaitingHero: pendingHero !== null,
      handsPlayed,
      nextHandNumber,
      buttonCursor,
      stacks: [...stacks],
      rakeTotalCents,
      buyInTotalCents,
      botStates,
    }),
  };
  return session;
}
