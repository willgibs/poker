/**
 * Transport abstraction.
 *
 * Everything above this file (scheduler, RPC) only knows {@link Port}: post a
 * message, get messages back, in order. That is the whole contract, and it is
 * why the same RPC code runs inside a real `Worker` in the browser and
 * in-process in Node tests.
 *
 * Two implementations ship here:
 *
 * - {@link LoopbackPort} — a connected pair in one thread. Clones by default
 *   (via `structuredClone`, honouring transfer lists) so tests hit the same
 *   serialization wall the real boundary imposes.
 * - {@link WebWorkerPort} — a thin adapter over anything with
 *   `postMessage`/`addEventListener`: a `Worker`, a worker's own `self`, or a
 *   `MessagePort`. No DOM types are required to construct it, so it is
 *   unit-testable with a fake endpoint.
 */

import { PortClosedError, ProtocolError } from "./errors";
import type { Message } from "./protocol";
import { isMessage } from "./protocol";

/** Called for each protocol message that arrives. */
export type MessageListener = (message: Message) => void;

/** Detaches a listener registered with {@link Port.onMessage}. */
export type Unsubscribe = () => void;

/** A bidirectional, ordered, message-passing endpoint. */
export interface Port {
  /**
   * Send one message. `transfer` lists buffers to move rather than copy; the
   * caller must not touch them afterwards.
   */
  post(message: Message, transfer?: readonly Transferable[]): void;
  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(listener: MessageListener): Unsubscribe;
  /** Detach from the underlying transport. Does not terminate a Worker. */
  close(): void;
}

/** How a {@link LoopbackPort} hands messages to its peer. */
export type LoopbackDelivery = "sync" | "microtask";

/** Options for {@link createLoopbackPair}. */
export interface LoopbackOptions {
  /**
   * `"microtask"` (default) mirrors the real boundary: the peer never observes
   * a message during the `post` call. `"sync"` is for tests that want to
   * assert without awaiting.
   */
  readonly delivery?: LoopbackDelivery;
  /**
   * Run `structuredClone` on every message (default `true`). Keeps in-process
   * tests honest: uncloneable payloads throw here exactly as they would when
   * crossing into a Worker, and receivers cannot mutate the sender's objects.
   */
  readonly clone?: boolean;
  /** Reports listener exceptions. Default: swallow (a bad listener must not kill the pump). */
  readonly onError?: (error: unknown) => void;
}

/**
 * `structuredClone` with a transfer list.
 *
 * Typed locally because the DOM lib and `@types/node` each declare the global
 * with their own transfer-item type; this keeps the call site independent of
 * which declaration wins.
 */
type CloneWithTransfer = <T>(value: T, options?: { transfer?: unknown[] }) => T;

/** In-process {@link Port}. Always created in connected pairs. */
export class LoopbackPort implements Port {
  #peer: LoopbackPort | null = null;
  readonly #listeners = new Set<MessageListener>();
  readonly #pending: Message[] = [];
  readonly #delivery: LoopbackDelivery;
  readonly #clone: boolean;
  readonly #onError: (error: unknown) => void;
  #closed = false;

  constructor(options: LoopbackOptions = {}) {
    this.#delivery = options.delivery ?? "microtask";
    this.#clone = options.clone ?? true;
    this.#onError = options.onError ?? (() => {});
  }

  /** True once {@link close} has been called on either end. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Messages received before any listener was attached. */
  get bufferedCount(): number {
    return this.#pending.length;
  }

  /** @internal — used by {@link createLoopbackPair}. */
  _connect(peer: LoopbackPort): void {
    this.#peer = peer;
  }

  post(message: Message, transfer?: readonly Transferable[]): void {
    if (this.#closed) throw new PortClosedError("cannot post on a closed port");
    const peer = this.#peer;
    if (peer === null) throw new ProtocolError("LoopbackPort is not connected to a peer");

    let delivered = message;
    if (this.#clone) {
      const clone = structuredClone as CloneWithTransfer;
      delivered =
        transfer === undefined || transfer.length === 0
          ? clone(message)
          : clone(message, { transfer: [...transfer] });
    }

    if (this.#delivery === "sync") {
      peer.#receive(delivered);
    } else {
      queueMicrotask(() => peer.#receive(delivered));
    }
  }

  onMessage(listener: MessageListener): Unsubscribe {
    this.#listeners.add(listener);
    if (this.#pending.length > 0) {
      if (this.#delivery === "sync") this.#flush();
      else queueMicrotask(() => this.#flush());
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
    this.#pending.length = 0;
    const peer = this.#peer;
    this.#peer = null;
    if (peer !== null && !peer.#closed) peer.close();
  }

  #receive(message: Message): void {
    if (this.#closed) return;
    if (this.#listeners.size === 0) {
      this.#pending.push(message);
      return;
    }
    this.#dispatch(message);
  }

  #flush(): void {
    if (this.#closed || this.#listeners.size === 0) return;
    const queued = this.#pending.splice(0, this.#pending.length);
    for (const message of queued) this.#dispatch(message);
  }

  #dispatch(message: Message): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(message);
      } catch (error) {
        this.#onError(error);
      }
    }
  }
}

/**
 * Create two connected {@link LoopbackPort}s. Convention: `[client, server]`.
 */
export function createLoopbackPair(options: LoopbackOptions = {}): readonly [LoopbackPort, LoopbackPort] {
  const a = new LoopbackPort(options);
  const b = new LoopbackPort(options);
  a._connect(b);
  b._connect(a);
  return [a, b] as const;
}

/**
 * Minimal structural view of a postMessage endpoint.
 *
 * `Worker`, `MessagePort` and a worker's own `self` all satisfy it, and so does
 * a two-line fake — which is how the wiring is unit-tested without a browser.
 */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** Options for {@link WebWorkerPort}. */
export interface WebWorkerPortOptions {
  /**
   * Called for inbound messages that are not protocol messages. A shared
   * `Worker` may carry other traffic; by default it is ignored.
   */
  readonly onForeign?: (data: unknown) => void;
  /** Reports listener exceptions. Default: swallow. */
  readonly onError?: (error: unknown) => void;
}

/**
 * {@link Port} over a `postMessage` endpoint.
 *
 * Deliberately thin: one endpoint listener, a set of subscribers, and message
 * validation. No reconnection, no queueing, no framing — the browser already
 * guarantees ordered delivery, and anything cleverer belongs above the port.
 */
export class WebWorkerPort implements Port {
  readonly #endpoint: MessageEndpoint;
  readonly #listeners = new Set<MessageListener>();
  readonly #onForeign: (data: unknown) => void;
  readonly #onError: (error: unknown) => void;
  readonly #handler: (event: { data: unknown }) => void;
  #closed = false;

  constructor(endpoint: MessageEndpoint, options: WebWorkerPortOptions = {}) {
    this.#endpoint = endpoint;
    this.#onForeign = options.onForeign ?? (() => {});
    this.#onError = options.onError ?? (() => {});
    this.#handler = (event) => this.#receive(event.data);
    endpoint.addEventListener("message", this.#handler);
  }

  /** True once {@link close} has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  post(message: Message, transfer?: readonly Transferable[]): void {
    if (this.#closed) throw new PortClosedError("cannot post on a closed port");
    if (transfer === undefined || transfer.length === 0) {
      this.#endpoint.postMessage(message);
    } else {
      this.#endpoint.postMessage(message, [...transfer]);
    }
  }

  onMessage(listener: MessageListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#endpoint.removeEventListener("message", this.#handler);
    this.#listeners.clear();
  }

  #receive(data: unknown): void {
    if (this.#closed) return;
    if (!isMessage(data)) {
      this.#onForeign(data);
      return;
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(data);
      } catch (error) {
        this.#onError(error);
      }
    }
  }
}

/** Convenience constructor for {@link WebWorkerPort}. */
export function createWebWorkerPort(
  endpoint: MessageEndpoint,
  options: WebWorkerPortOptions = {},
): WebWorkerPort {
  return new WebWorkerPort(endpoint, options);
}
