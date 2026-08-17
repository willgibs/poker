/**
 * EngineError — thrown for every illegal input to the engine: malformed
 * config, out-of-turn actions, illegal action kinds or sizings, and internal
 * invariant violations. `code` is a stable machine-readable discriminant.
 */

export type EngineErrorCode =
  | "bad_config"
  | "hand_over"
  | "out_of_turn"
  | "unknown_seat"
  | "illegal_action"
  | "illegal_amount"
  | "invariant";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}
