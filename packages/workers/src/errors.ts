/**
 * Error types for the worker RPC layer, plus the structured-clone-safe error
 * shape that crosses the wire.
 *
 * Errors are *not* posted as `Error` instances. Although modern engines can
 * clone them, subclass identity and custom fields are lost, and the behaviour
 * differs across browsers. We serialize to a plain object and rebuild on the
 * far side, so `instanceof CancelledError` works for callers.
 */

/** Plain, structured-clone-safe representation of a thrown value. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Base class for every error this package throws. */
export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

/**
 * A job or call was cancelled (via `signal`, `cancel(topicOrId)` or
 * `close()`). Cancellation is a normal control-flow outcome, not a bug: it
 * rejects rather than resolves so `await` sites cannot silently continue with
 * a half-finished result.
 */
export class CancelledError extends WorkerError {
  /** Human-readable cancellation reason, when one was supplied. */
  readonly reason: string | undefined;

  constructor(reason?: string) {
    super(reason === undefined ? "cancelled" : `cancelled: ${reason}`);
    this.name = "CancelledError";
    this.reason = reason;
  }
}

/** A request named a topic the server has no handler for. */
export class UnknownTopicError extends WorkerError {
  readonly topic: string;

  constructor(topic: string) {
    super(`no handler registered for topic "${topic}"`);
    this.name = "UnknownTopicError";
    this.topic = topic;
  }
}

/** A malformed or unexpected message arrived on a port. */
export class ProtocolError extends WorkerError {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** The port was closed (locally or by the peer) while it was still in use. */
export class PortClosedError extends WorkerError {
  constructor(message = "port is closed") {
    super(message);
    this.name = "PortClosedError";
  }
}

/**
 * Error raised on the client for a failure that happened inside the handler on
 * the far side. `remote` carries the original name/message/stack.
 */
export class RpcError extends WorkerError {
  readonly topic: string;
  readonly remote: SerializedError;

  constructor(topic: string, remote: SerializedError) {
    super(`${topic}: ${remote.name}: ${remote.message}`);
    this.name = "RpcError";
    this.topic = topic;
    this.remote = remote;
  }
}

/** Options for {@link serializeError}. */
export interface SerializeErrorOptions {
  /** Include `stack` in the wire form. Default `true`. */
  readonly includeStack?: boolean;
}

/** Reduce any thrown value to a structured-clone-safe {@link SerializedError}. */
export function serializeError(value: unknown, options: SerializeErrorOptions = {}): SerializedError {
  const includeStack = options.includeStack ?? true;
  if (value instanceof Error) {
    const stack = includeStack && typeof value.stack === "string" ? value.stack : undefined;
    return stack === undefined
      ? { name: value.name, message: value.message }
      : { name: value.name, message: value.message, stack };
  }
  return { name: "Error", message: safeString(value) };
}

/**
 * Rebuild a throwable from its wire form. Cancellation is reconstructed as a
 * real {@link CancelledError} (callers branch on it); everything else becomes
 * an {@link RpcError} that keeps the remote details attached.
 */
export function deserializeError(error: SerializedError, topic: string): Error {
  if (error.name === "CancelledError") {
    const reason = error.message.startsWith("cancelled: ")
      ? error.message.slice("cancelled: ".length)
      : undefined;
    return new CancelledError(reason);
  }
  if (error.name === "UnknownTopicError") return new UnknownTopicError(topic);
  return new RpcError(topic, error);
}

/** Best-effort string form of a non-Error thrown value. */
function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return "[unserializable thrown value]";
    }
  }
  return String(value);
}

/** Normalize an `AbortSignal.reason` (typed `any` by the DOM lib) to text. */
export function reasonText(reason: unknown): string | undefined {
  if (reason === undefined || reason === null) return undefined;
  if (reason instanceof CancelledError) return reason.reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return safeString(reason);
}
