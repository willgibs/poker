/**
 * @poker/engine — pure NLHE state machine.
 *
 * `initHand(config)` posts blinds/antes and deals; `applyAction(state, a)`
 * validates and applies one action, auto-advancing streets, running out
 * all-in boards, and settling showdowns and uncontested pots. Both return
 * `{ state, events }` where `events` is the canonical @poker/history stream;
 * concatenating the events of a whole hand yields a valid v1 hand log.
 * `legalActions(state)` is the exact action menu applyAction validates
 * against. `auditChips` / `buildPots` are exported for tests and tooling.
 */

export { initHand } from "./init";
export { applyAction } from "./apply";
export { legalActions } from "./legal";
export { auditChips } from "./audit";
export { buildPots, potsOf } from "./pots";
export { EngineError } from "./errors";

export type { Pot, PotEntry } from "./pots";
export type { EngineErrorCode } from "./errors";
export type {
  ActionInput,
  EngineResult,
  Evaluate7,
  HandConfig,
  LegalActions,
  SeatConfig,
  SeatState,
  TableState,
} from "./types";
