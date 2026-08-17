/**
 * Public inputs and outputs of {@link decide}.
 *
 * Purity contract (CLAUDE.md): a bot is
 * `decide(snapshot, botState, streams) → { action, amount?, thinkTimeMs, trace,
 * nextBotState }`. There is no hidden state, no clock and no ambient
 * randomness — the snapshot is the whole world, the streams are the whole
 * luck, and everything the character remembers travels in `botState`.
 */

import type { LegalActions, TableState } from "@poker/engine";
import type { ActionKind, HandEvent } from "@poker/history";
import type { RngStream } from "@poker/rng";
import type { PersonaConfig } from "./persona";
import type { BotState } from "./state";
import type { DecisionTrace } from "./trace";

/** The bot's complete view of the table at its turn. */
export interface DecisionSnapshot {
  /** Engine truth. `state.actionSeat` must equal `seat`. */
  state: TableState;
  /** The acting bot's seat. */
  seat: number;
  /** The character in that seat. */
  persona: PersonaConfig;
  /**
   * The hand's canonical event log so far. Line features, the Bayesian range
   * updates and every "what has this table done to me" read come from here —
   * a bot knows nothing it did not observe (PRD realism doctrine #1).
   */
  events: readonly HandEvent[];
  /** The hero's seat when one is at the table; used by hero-targeted tells. */
  heroSeat?: number;
  /**
   * Precomputed legal action menu. Optional — `decide` computes it from the
   * engine when absent; passing it saves a redundant call in hot loops.
   */
  legal?: LegalActions;
}

/**
 * The named RNG streams a decision may draw from. Both are derived by the
 * caller from the session seed hierarchy (docs/architecture.md): `decision`
 * from `bot/{seat}/{street}/{n}` so what-if branches re-decide with identical
 * luck, `mc` from `mc/{decisionKey}`.
 */
export interface BotStreams {
  /** Personality rolls: bluff gate, softmax selection, error injection, jitter. */
  decision: RngStream;
  /** Monte Carlo equity sampling only. */
  mc: RngStream;
}

/** The result of one decision. */
export interface BotDecision {
  /** The chosen action; always present in the engine's legal menu. */
  action: ActionKind;
  /**
   * Engine `ActionInput.amount` semantics: bet size for `bet`, total street
   * commitment for `raise`, the exact call amount for `call`, absent for
   * `fold` and `check`.
   */
  amount?: number;
  /**
   * Raw think time in milliseconds at 1x. The Presenter applies the player's
   * speed control; nothing here ever reads a clock or a speed setting.
   */
  thinkTimeMs: number;
  /** The full nine-stage trace — the bot-mind-reveal payload. */
  trace: DecisionTrace;
  /** The bot's memory after this decision. */
  nextBotState: BotState;
}

/** Convenience: the engine action input the decision maps to. */
export interface ChosenAction {
  seat: number;
  kind: ActionKind;
  amount?: number;
}
