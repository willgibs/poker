/**
 * Wire protocol: message envelopes, priority classes, and per-topic transfer
 * declarations.
 *
 * Every message that crosses a {@link Port} is one flat envelope:
 * `{ id, kind, topic, payload, priority }`. Flat because the structured clone
 * algorithm charges for depth, and because a single shape keeps the guards
 * cheap on the hot path.
 *
 * **Payloads must be structured-clone-safe.** No functions, no class
 * instances, no symbols. {@link findUncloneable} is the dev/test check for
 * this; `LoopbackPort` runs a real `structuredClone` by default so violations
 * fail in Node exactly as they would in a browser.
 */

import type { SerializedError } from "./errors";

// ---------------------------------------------------------------------------
// Priority classes (docs/architecture.md)
// ---------------------------------------------------------------------------

/** Acting bot / hero live analysis — blocks a visible beat. */
export const P0 = 0;
/** Speculative prefetch — useful, not yet needed. */
export const P1 = 1;
/** Background grading — must never delay P0/P1. */
export const P2 = 2;

/** Priority class. Lower number = more urgent. */
export type Priority = typeof P0 | typeof P1 | typeof P2;

/** All priority classes, most urgent first. */
export const PRIORITIES: readonly Priority[] = [P0, P1, P2];

/** Runtime guard for {@link Priority}. */
export function isPriority(value: unknown): value is Priority {
  return value === P0 || value === P1 || value === P2;
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** Correlation id. Unique per in-flight request on a given port pair. */
export type MessageId = string;

/** Envelope discriminant. */
export type MessageKind = "request" | "response" | "event" | "cancel";

/** The one envelope shape, parameterized by kind and payload. */
export interface Envelope<K extends MessageKind, P> {
  readonly id: MessageId;
  readonly kind: K;
  readonly topic: string;
  readonly payload: P;
  readonly priority: Priority;
}

/** Client -> server: run `topic` with `payload` at `priority`. */
export type RequestMessage<P = unknown> = Envelope<"request", P>;

/** Server -> client: streaming progress for the request with the same `id`. */
export type EventMessage<P = unknown> = Envelope<"event", P>;

/** Client -> server: abandon the request with the same `id`. */
export type CancelMessage = Envelope<"cancel", CancelPayload>;

/** Payload of a {@link CancelMessage}. */
export interface CancelPayload {
  readonly reason?: string;
}

/** Result payload: success carries a value, failure carries a serialized error. */
export type ResponsePayload<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SerializedError };

/** Server -> client: terminal outcome for the request with the same `id`. */
export type ResponseMessage<P = unknown> = Envelope<"response", ResponsePayload<P>>;

/** Any protocol message. */
export type Message<Req = unknown, Res = unknown, Evt = unknown> =
  | RequestMessage<Req>
  | ResponseMessage<Res>
  | EventMessage<Evt>
  | CancelMessage;

/** Build a request envelope. */
export function makeRequest<P>(
  id: MessageId,
  topic: string,
  payload: P,
  priority: Priority = P1,
): RequestMessage<P> {
  return { id, kind: "request", topic, payload, priority };
}

/** Build a success response envelope. */
export function makeResponse<P>(
  id: MessageId,
  topic: string,
  value: P,
  priority: Priority = P1,
): ResponseMessage<P> {
  return { id, kind: "response", topic, payload: { ok: true, value }, priority };
}

/** Build a failure response envelope. */
export function makeErrorResponse(
  id: MessageId,
  topic: string,
  error: SerializedError,
  priority: Priority = P1,
): ResponseMessage<never> {
  return { id, kind: "response", topic, payload: { ok: false, error }, priority };
}

/** Build a progress event envelope. */
export function makeEvent<P>(
  id: MessageId,
  topic: string,
  payload: P,
  priority: Priority = P1,
): EventMessage<P> {
  return { id, kind: "event", topic, payload, priority };
}

/**
 * Build a cancel envelope. Cancels default to {@link P0}: they are cheap and
 * the sooner they land the sooner the slot frees.
 */
export function makeCancel(
  id: MessageId,
  topic: string,
  reason?: string,
  priority: Priority = P0,
): CancelMessage {
  return { id, kind: "cancel", topic, payload: reason === undefined ? {} : { reason }, priority };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Guard for {@link ResponsePayload}. */
export function isResponsePayload(value: unknown): value is ResponsePayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as { ok?: unknown; value?: unknown; error?: unknown };
  if (p.ok === true) return "value" in p;
  if (p.ok !== false) return false;
  const err = p.error;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; message?: unknown };
  return typeof e.name === "string" && typeof e.message === "string";
}

/**
 * Guard for any protocol message. Ports use this to ignore foreign traffic:
 * a real `Worker` may carry messages this layer knows nothing about.
 */
export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const m = value as { id?: unknown; kind?: unknown; topic?: unknown; priority?: unknown; payload?: unknown };
  if (typeof m.id !== "string" || typeof m.topic !== "string" || !isPriority(m.priority)) return false;
  switch (m.kind) {
    case "request":
    case "event":
      return true;
    case "cancel":
      return typeof m.payload === "object" && m.payload !== null;
    case "response":
      return isResponsePayload(m.payload);
    default:
      return false;
  }
}

/** Narrow a message to a request. */
export function isRequest<Req>(m: Message<Req, unknown, unknown>): m is RequestMessage<Req> {
  return m.kind === "request";
}

/** Narrow a message to a response. */
export function isResponse<Res>(m: Message<unknown, Res, unknown>): m is ResponseMessage<Res> {
  return m.kind === "response";
}

/** Narrow a message to a progress event. */
export function isEvent<Evt>(m: Message<unknown, unknown, Evt>): m is EventMessage<Evt> {
  return m.kind === "event";
}

/** Narrow a message to a cancel. */
export function isCancel(m: Message): m is CancelMessage {
  return m.kind === "cancel";
}

// ---------------------------------------------------------------------------
// Topic typing
// ---------------------------------------------------------------------------

/** The three payload types a topic deals in. */
export interface TopicShape<Req = unknown, Res = unknown, Evt = unknown> {
  readonly request: Req;
  readonly response: Res;
  readonly event: Evt;
}

/**
 * A map of topic name -> {@link TopicShape}. Declare one per port pair and
 * pass it as the type argument to `RpcClient` / `RpcServer` to get typed
 * `call` / `define`:
 *
 * ```ts
 * interface EngineTopics extends TopicSchema {
 *   "equity/estimate": TopicShape<EquityRequest, EquityResult, EquityProgress>;
 * }
 * ```
 */
export type TopicSchema = Record<string, TopicShape>;

/** Derives the transfer list for one payload. */
export type TransferSelector<T> = (payload: T) => readonly Transferable[];

/**
 * Per-topic wire declarations. Today that means transfer lists: which buffers
 * inside a payload should move rather than copy. Transfer is opt-in per topic
 * because it *detaches* the sender's buffers — safe for freshly built result
 * arrays, catastrophic for shared lookup tables.
 */
export interface TopicSpec<Req = unknown, Res = unknown, Evt = unknown> {
  readonly topic: string;
  readonly transferRequest?: TransferSelector<Req>;
  readonly transferResponse?: TransferSelector<Res>;
  readonly transferEvent?: TransferSelector<Evt>;
}

/** Identity helper that pins the payload types of a {@link TopicSpec}. */
export function defineTopic<Req = unknown, Res = unknown, Evt = unknown>(
  spec: TopicSpec<Req, Res, Evt>,
): TopicSpec<Req, Res, Evt> {
  return spec;
}

/**
 * Transfer every typed array / `ArrayBuffer` reachable in the payload.
 * Convenient default for topics whose results are freshly allocated buffers.
 */
export const autoTransfer: TransferSelector<unknown> = (payload) => collectTransferables(payload);

/** Erased spec shape used for storage; see {@link TopicRegistry}. */
type AnyTopicSpec = TopicSpec<never, never, never>;

/** Registry of {@link TopicSpec}s, keyed by topic name. */
export class TopicRegistry {
  readonly #specs = new Map<string, AnyTopicSpec>();

  /** Register (or replace) the spec for a topic. */
  register<Req, Res, Evt>(spec: TopicSpec<Req, Res, Evt>): this {
    this.#specs.set(spec.topic, spec);
    return this;
  }

  /** Look up a spec. */
  get(topic: string): TopicSpec | undefined {
    return this.#specs.get(topic) as TopicSpec | undefined;
  }

  /** True when a spec exists for `topic`. */
  has(topic: string): boolean {
    return this.#specs.has(topic);
  }

  /**
   * Transfer list for one outgoing payload, or `undefined` when the topic
   * declares none (the common case — copying is the safe default).
   */
  transferListFor(
    kind: "request" | "response" | "event",
    topic: string,
    payload: unknown,
  ): readonly Transferable[] | undefined {
    const spec = this.#specs.get(topic);
    if (spec === undefined) return undefined;
    const select =
      kind === "request"
        ? spec.transferRequest
        : kind === "response"
          ? spec.transferResponse
          : spec.transferEvent;
    if (select === undefined) return undefined;
    // Selectors are stored erased (params are contravariant); the registry is
    // the one place that reunites a spec with its payload.
    const list = select(payload as never);
    return list.length === 0 ? undefined : list;
  }
}

// ---------------------------------------------------------------------------
// Structured-clone helpers
// ---------------------------------------------------------------------------

/**
 * Collect every transferable `ArrayBuffer` reachable from `value`.
 *
 * Walks arrays, plain objects, `Map`s and `Set`s; dedupes by buffer identity;
 * cycle-safe. `SharedArrayBuffer`-backed views are skipped — they are not
 * transferable, and the architecture rules SAB out anyway.
 */
export function collectTransferables(value: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seenNodes = new Set<object>();
  const seenBuffers = new Set<ArrayBuffer>();

  const push = (buffer: ArrayBuffer): void => {
    if (seenBuffers.has(buffer)) return;
    seenBuffers.add(buffer);
    out.push(buffer);
  };

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    if (node instanceof ArrayBuffer) {
      push(node);
      return;
    }
    if (ArrayBuffer.isView(node)) {
      const buffer: unknown = node.buffer;
      if (buffer instanceof ArrayBuffer) push(buffer);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node instanceof Map) {
      for (const [k, v] of node) {
        walk(k);
        walk(v);
      }
      return;
    }
    if (node instanceof Set) {
      for (const item of node) walk(item);
      return;
    }
    if (node instanceof Date || node instanceof RegExp) return;
    for (const item of Object.values(node)) walk(item);
  };

  walk(value);
  return out;
}

/**
 * Structural check for clone safety. Returns the path of the first offending
 * value (`"$.trace.fn"`) or `null` when the value is safe.
 *
 * Cheaper and far more diagnosable than catching `DataCloneError`, which tells
 * you only that *something* was wrong. Intended for tests and dev asserts.
 */
export function findUncloneable(value: unknown, path = "$"): string | null {
  return walkClone(value, path, new Set<object>());
}

/** True when {@link findUncloneable} finds nothing. */
export function isCloneable(value: unknown): boolean {
  return findUncloneable(value) === null;
}

function walkClone(node: unknown, path: string, seen: Set<object>): string | null {
  switch (typeof node) {
    case "undefined":
    case "boolean":
    case "number":
    case "string":
    case "bigint":
      return null;
    case "function":
    case "symbol":
      return path;
    default:
      break;
  }
  if (node === null) return null;
  const obj = node as object;
  if (seen.has(obj)) return null; // cycles clone fine
  seen.add(obj);

  if (
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof ArrayBuffer ||
    obj instanceof Error ||
    ArrayBuffer.isView(obj)
  ) {
    return null;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const found = walkClone(obj[i], `${path}[${i}]`, seen);
      if (found !== null) return found;
    }
    return null;
  }
  if (obj instanceof Map) {
    let i = 0;
    for (const [k, v] of obj) {
      const inKey = walkClone(k, `${path}.<key ${i}>`, seen);
      if (inKey !== null) return inKey;
      const inValue = walkClone(v, `${path}.<value ${i}>`, seen);
      if (inValue !== null) return inValue;
      i++;
    }
    return null;
  }
  if (obj instanceof Set) {
    let i = 0;
    for (const item of obj) {
      const found = walkClone(item, `${path}.<item ${i}>`, seen);
      if (found !== null) return found;
      i++;
    }
    return null;
  }
  const proto: unknown = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return path; // class instance
  for (const [key, item] of Object.entries(obj)) {
    const found = walkClone(item, `${path}.${key}`, seen);
    if (found !== null) return found;
  }
  return null;
}
