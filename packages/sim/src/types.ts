/**
 * Public configuration and result types of the session orchestrator.
 *
 * Everything in `SessionConfig` is JSON-safe by construction — the checkpoint
 * blob stores it verbatim. Things that cannot be serialized (an injected
 * evaluator, a chart set) live in {@link SessionRuntime}, which the caller
 * re-supplies on restore.
 */

import type { ChartSet } from "@poker/charts";
import type { DecisionGrade, PolicyTier } from "@poker/analysis";
import type { DecisionTrace } from "@poker/bots";
import type { Evaluate7, LegalActions, TableState } from "@poker/engine";
import type { ActionKind, Card, HandEvent, HandRecord, Street } from "@poker/history";

/** A seat is either a scripted character or the human/driven hero. */
export type SeatSpec = { personaId: string } | { hero: true };

/** True when a seat spec names the hero seat. */
export function isHeroSeat(spec: SeatSpec): spec is { hero: true } {
  return "hero" in spec && spec.hero === true;
}

/** Blind structure, integer cents. */
export interface SessionStakes {
  sbCents: number;
  bbCents: number;
  anteCents?: number;
}

/**
 * Rake taken at pot award. `pct` is a fraction (0.05 = 5%), `capCents` the
 * per-hand ceiling. `noFlopNoDrop` (default `true`) skips the drop entirely on
 * hands that never dealt a board. See the package README for the exact base.
 */
export interface RakeConfig {
  pct: number;
  capCents: number;
  noFlopNoDrop?: boolean;
}

/** What happens to a seat that runs out of chips at a hand boundary. */
export type RebuyPolicy =
  /** Bust seats sit out; the session ends when fewer than two seats are funded. */
  | "off"
  /** Every seat is topped back up to its configured buy-in before each hand. */
  | "top-up"
  /** Only seats below `minStackCents` are reset to their configured buy-in. */
  | "rebuy-on-bust";

/** Dealing/table-management knobs. All optional, all deterministic. */
export interface DealerOptions {
  /** Seat the button starts on (defaults to seat 0). */
  button?: number;
  /** Rotate the button one seat clockwise each hand. Default `true`. */
  rotateButton?: boolean;
  /** Default `"off"`. */
  rebuy?: RebuyPolicy;
  /**
   * Stack at or below which `"rebuy-on-bust"` fires, cents. Default `0`, i.e.
   * only a genuinely busted seat rebuys.
   */
  minStackCents?: number;
  /** Hard cap on hands the session will deal. Default: unlimited. */
  maxHands?: number;
}

/** Which annotations the record carries. Both default to `true`. */
export interface AnnotationOptions {
  /** Bot decision traces, keyed by decisionId. */
  traces?: boolean;
  /** Hero decision grades, keyed by decisionId. Requires a hero seat. */
  grades?: boolean;
}

/** Grading knobs handed through to `@poker/analysis`. */
export interface GradingOptions {
  /** Fixed Monte Carlo trials per postflop equity estimate. Never time-boxed. */
  trials?: number;
  /** Compute jam-vs-fold EV at push/fold preflop nodes. Default `false`. */
  estimateEv?: boolean;
  /** Tier for hero's own fold-equity estimates. Default `"regular"`. */
  tier?: PolicyTier;
}

/** The whole session, described in JSON-safe data. */
export interface SessionConfig {
  /** Root of the seed hierarchy. Everything else derives from this. */
  sessionSeed: string;
  format: "cash";
  stakes: SessionStakes;
  /** Seat number === index. 2–9 seats; at most one hero. */
  seats: SeatSpec[];
  /** One buy-in for every seat, or a per-seat array. Integer cents. */
  stackCents: number[] | number;
  rake?: RakeConfig;
  dealerOptions?: DealerOptions;
  /** Stable session id. Defaults to a deterministic id derived from the seed. */
  sessionId?: string;
  annotations?: AnnotationOptions;
  grading?: GradingOptions;
}

/** Injections that cannot live in a checkpoint blob. */
export interface SessionRuntime {
  /** Override the shipped 7-card evaluator (lower = stronger). */
  evaluate7?: Evaluate7;
  /** Cash preflop chart set for hero grading. Without one, preflop grades are
   * honest non-answers (`confidence: "unknown"`, no band). */
  chartSet?: ChartSet;
}

// ---------------------------------------------------------------------------
// Hero interaction
// ---------------------------------------------------------------------------

/** What the hero decided. `seat` is implied by the pending decision point. */
export interface HeroAction {
  kind: ActionKind;
  /** Engine semantics: bet size, raise-TO total, exact call amount, else absent. */
  amount?: number;
  /** Observed think time in ms — an input, recorded verbatim on the `act` event. */
  thinkTimeMs?: number;
}

/** Everything the hero (or a scripted driver) needs to choose an action. */
export interface HeroSnapshot {
  handNumber: number;
  seat: number;
  street: Street;
  /** `${street}:${seat}:${n}` — the key this decision's annotation lands on. */
  decisionId: string;
  /** Live engine truth. Carries the injected evaluator, so it is not JSON-safe. */
  state: TableState;
  /** The canonical event log so far. */
  events: readonly HandEvent[];
  holeCards: readonly [Card, Card] | null;
  board: readonly Card[];
  /** Total chips in the middle (every seat's total commitment), cents. */
  pot: number;
  /** Chips hero must add to continue, cents. 0 when checking is legal. */
  toCall: number;
  /** Hero's stack before acting, cents. */
  stack: number;
  /** Seats still live, hero included. */
  livePlayers: number;
}

/** The rake ledger for one hand — the `sim/rake` annotation's value shape. */
export interface RakeLedger {
  v: 1;
  pct: number;
  capCents: number;
  noFlopNoDrop: boolean;
  /** Σ committed = Σ pot awards, cents. */
  potCents: number;
  /** Returned-to-bettor portion, excluded from the base. */
  uncalledCents: number;
  baseCents: number;
  /** Σ `bySeat` — chips that left the table. */
  totalCents: number;
  /** Charged to winners pro-rata on their awards. Keys are seat numbers. */
  bySeat: Record<string, number>;
  applied: boolean;
  /** Why nothing was taken, when `applied` is false. */
  reason?: string;
}

/** The value stored at `record.annotations[decisionId]`. */
export interface DecisionAnnotation {
  /** The bot's nine-stage trace. Present on bot decisions when traces are on. */
  trace?: DecisionTrace;
  /** The hero's grade. Present on hero decisions when grading is on. */
  grade?: DecisionGrade;
}

/** One finished hand. */
export interface HandOutcome {
  handNumber: number;
  button: number;
  /** Seats dealt into this hand, ascending. */
  seats: readonly number[];
  record: HandRecord;
  /** Engine net per seat (rake-free), cents. Keys are seat numbers. */
  netBySeat: Record<string, number>;
  rake: RakeLedger;
  /** Net after rake, cents. Keys are seat numbers. */
  netAfterRakeBySeat: Record<string, number>;
  /** Stacks for every configured seat after settlement and rake, cents. */
  stacksAfter: number[];
  /** Bot tilt after `observeHandEnd`, keyed by seat. Hero seats are absent. */
  tiltBySeat: Record<string, number>;
  /** Seats whose tilt rose this hand — the tilt-event counter's numerator. */
  tiltEvents: readonly number[];
  /** Decisions taken this hand (bot + hero). */
  decisionCount: number;
}

/** `nextHand()` / `act()` either pause on the hero or hand back a finished hand. */
export type SessionStep =
  | { awaitingHero: true; legalActions: LegalActions; snapshot: HeroSnapshot }
  | { awaitingHero: false; legalActions?: undefined; snapshot?: undefined; outcome: HandOutcome };

/** Session lifecycle. */
export type SessionStatus =
  /** Between hands; `nextHand()` will deal. */
  | "ready"
  /** A hero decision is pending; `act()` is the only legal call. */
  | "awaiting-hero"
  /** No further hand can be dealt (bust-out or `maxHands`). */
  | "finished";

/** A read-only view of where the session stands. */
export interface SessionView {
  sessionId: string;
  status: SessionStatus;
  /** Hands completed so far. */
  handsPlayed: number;
  /** Number the next hand will carry (1-based). */
  nextHandNumber: number;
  /** Stacks by seat, cents. */
  stacks: readonly number[];
  /** Cumulative rake taken from the table, cents. */
  rakeTotalCents: number;
  /** Cumulative chips bought in (initial buy-ins + rebuys), cents. */
  buyInTotalCents: number;
  /** Hero's seat, or `null` in a self-play lineup. */
  heroSeat: number | null;
}
