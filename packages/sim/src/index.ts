/**
 * @packageDocumentation
 * # @poker/sim — the session orchestrator
 *
 * The layer that owns a *session*: the seed hierarchy, the seat/stack ledger,
 * the button, the bots' memory across hands (tilt carries over — that is what
 * makes a session more than a pile of hands), the hero's pause/resume loop, and
 * the assembly of a complete `HandRecord` per docs/hand-format.md.
 *
 * ```ts
 * const session = createSession({
 *   sessionSeed: "s1",
 *   format: "cash",
 *   stakes: { sbCents: 50, bbCents: 100 },
 *   seats: [{ hero: true }, { personaId: "barry" }, { personaId: "doris" }],
 *   stackCents: 20_000,
 *   rake: { pct: 0.05, capCents: 300 },
 * });
 *
 * let step = session.nextHand();
 * while (step.awaitingHero) step = session.act({ kind: "fold" });
 * step.outcome.record; // a validated v1 HandRecord
 * ```
 *
 * Zero runtime dependencies, no clock, no `Math.random`: same config + seed +
 * hero script ⇒ byte-identical event logs, on every platform.
 *
 * ## Seed hierarchy (docs/architecture.md)
 *
 * | Purpose | Stream path |
 * |---|---|
 * | Deck shuffle (runout fixed before any action) | `hand/{N}/deck` |
 * | Bot decision rolls | `hand/{N}/bot/{seat}/{street}/{n}` |
 * | Bot Monte Carlo | `hand/{N}/mc/{seat}/{street}/{n}` |
 * | Hand id | `hand/{N}/id` |
 *
 * ## Rake
 *
 * The engine is rake-free, and a v1 log requires `end` nets to sum to zero — so
 * rake is recorded as a **distinct post-award adjustment** in the record's
 * annotations under `sim/rake` ({@link RAKE_ANNOTATION_KEY}), and applied to the
 * session's stack ledger. `README.md` states the full representation and the
 * exact base (pot minus the uncalled portion, no-flop-no-drop by default).
 * Read it back with {@link rakeOf}.
 *
 * ## Annotations
 *
 * `record.annotations[decisionId]` is a {@link DecisionAnnotation}: the bot's
 * nine-stage `trace` on every bot decision, and a `@poker/analysis`
 * `grade` on every hero decision — graded with the villains' GROUND-TRUTH
 * policy, built from the seated personas' own parameters (see `policy.ts`)
 * rather than the tier-default fallback.
 */

export { createSession, defaultEvaluate7, SessionError } from "./session";
export type { Session } from "./session";

export { serializeSession, restoreSession, CHECKPOINT_VERSION } from "./checkpoint";
export type { SessionCheckpoint } from "./checkpoint";

export { RAKE_ANNOTATION_KEY, computeRake, rakeOf, uncalledPortion, validateRakeConfig } from "./rake";
export type { RakeInput } from "./rake";

export { groundTruthPolicy, likelihoodOf, meanPolicyParams, policyParamsOf } from "./policy";

export { gradeRecord } from "./grade";
export type { GradeRecordOptions } from "./grade";

export { defaultSessionId, handId, handSeed } from "./ids";

export { isHeroSeat } from "./types";
export type {
  AnnotationOptions,
  DealerOptions,
  DecisionAnnotation,
  GradingOptions,
  HandOutcome,
  HeroAction,
  HeroSnapshot,
  RakeConfig,
  RakeLedger,
  RebuyPolicy,
  SeatSpec,
  SessionConfig,
  SessionRuntime,
  SessionStakes,
  SessionStatus,
  SessionStep,
  SessionView,
} from "./types";
