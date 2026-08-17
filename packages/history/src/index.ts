/**
 * @poker/history — the canonical hand event log (format v1).
 * Normative spec: docs/hand-format.md.
 */

export { HAND_RECORD_VERSION } from "./types";
export type {
  ActionKind,
  BlindKind,
  BoardStreet,
  Card,
  DealBoard,
  DealHole,
  HandEnd,
  HandEvent,
  HandRecord,
  HandStart,
  PlayerAction,
  PostBlind,
  PotAwarded,
  Showdown,
  Street,
  TableConfig,
} from "./types";

export { decisionId, decisionRefs } from "./decision";
export type { DecisionRef } from "./decision";

export { encodeEvent, decodeEvent, encodeHand, decodeHand, HandDecodeError } from "./codec";
export type { EncodedEvent, EncodedHand } from "./codec";

export { validateEvents } from "./validate";
export type { ValidationResult } from "./validate";

export { exportHandText } from "./export";
export type { ExportOptions } from "./export";
