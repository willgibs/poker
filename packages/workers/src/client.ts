/**
 * Request side of the RPC layer.
 *
 * ```ts
 * const client = new RpcClient<EngineTopics>(port);
 * const equity = await client.call("equity/estimate", spot, {
 *   priority: P0,
 *   onProgress: (p) => store.setEstimate(p),
 *   signal: controller.signal,
 * });
 * ```
 *
 * The client owns correlation ids and pending state, nothing else. It never
 * times out — time is an input in this codebase, so deadlines belong to the
 * caller, who passes an `AbortSignal`.
 */

import type { Deferred } from "./defer";
import { createDeferred, noop } from "./defer";
import { CancelledError, PortClosedError, ProtocolError, deserializeError, reasonText } from "./errors";
import type { Port, Unsubscribe } from "./port";
import type { Message, Priority, TopicSchema } from "./protocol";
import { P1, TopicRegistry, isMessage, makeCancel, makeRequest } from "./protocol";

/** Per-call options. */
export interface CallOptions<Evt = unknown> {
  /**
   * Correlation id. Supply one to make the call cancellable by name later
   * (`client.cancel("hero-equity")`); otherwise a counter is used. Must not
   * collide with another in-flight call.
   */
  readonly id?: string;
  /** Priority class carried on the request envelope. Default {@link P1}. */
  readonly priority?: Priority;
  /** Receives streaming progress events for this call, in the order sent. */
  readonly onProgress?: (event: Evt) => void;
  /** Abort to cancel: the client posts a cancel message and rejects with {@link CancelledError}. */
  readonly signal?: AbortSignal;
}

/** Options for {@link RpcClient}. */
export interface RpcClientOptions {
  /** Per-topic transfer declarations. Defaults to an empty registry (copy everything). */
  readonly registry?: TopicRegistry;
  /** Prefix for generated correlation ids. Distinguish clients sharing one server. */
  readonly idPrefix?: string;
  /** Priority used when a call does not specify one. Default {@link P1}. */
  readonly defaultPriority?: Priority;
  /** Reports protocol violations and exceptions thrown by `onProgress`. */
  readonly onError?: (error: unknown) => void;
}

interface PendingCall {
  readonly topic: string;
  readonly deferred: Deferred<unknown>;
  readonly onProgress: ((event: unknown) => void) | undefined;
  readonly priority: Priority;
  detach(): void;
}

/** Typed request/response/progress client over a {@link Port}. */
export class RpcClient<S extends TopicSchema = TopicSchema> {
  readonly #port: Port;
  readonly #registry: TopicRegistry;
  readonly #idPrefix: string;
  readonly #defaultPriority: Priority;
  readonly #onError: (error: unknown) => void;
  readonly #pending = new Map<string, PendingCall>();
  readonly #unsubscribe: Unsubscribe;
  #idCounter = 0;
  #closed = false;

  constructor(port: Port, options: RpcClientOptions = {}) {
    this.#port = port;
    this.#registry = options.registry ?? new TopicRegistry();
    this.#idPrefix = options.idPrefix ?? "call";
    this.#defaultPriority = options.defaultPriority ?? P1;
    this.#onError = options.onError ?? noop;
    this.#unsubscribe = port.onMessage((message) => this.#receive(message));
  }

  /** Calls awaiting a response. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** True once {@link close} has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Send a request and await its result.
   *
   * Rejects with {@link CancelledError} if `signal` aborts, with an
   * {@link RpcError} carrying the remote name/message/stack if the handler
   * throws, and with {@link UnknownTopicError} if the far side has no handler.
   */
  call<K extends keyof S & string>(
    topic: K,
    payload: S[K]["request"],
    options: CallOptions<S[K]["event"]> = {},
  ): Promise<S[K]["response"]> {
    if (this.#closed) return Promise.reject(new PortClosedError("RpcClient is closed"));

    const signal = options.signal;
    if (signal?.aborted === true) {
      return Promise.reject(new CancelledError(reasonText(signal.reason)));
    }

    const id = options.id ?? `${this.#idPrefix}-${++this.#idCounter}`;
    if (this.#pending.has(id)) {
      return Promise.reject(new ProtocolError(`RpcClient: call id "${id}" is already in flight`));
    }
    const priority = options.priority ?? this.#defaultPriority;
    const deferred = createDeferred<unknown>();

    let onAbort: (() => void) | undefined;
    const pending: PendingCall = {
      topic,
      deferred,
      onProgress: options.onProgress as ((event: unknown) => void) | undefined,
      priority,
      detach: () => {
        if (onAbort !== undefined && signal !== undefined) {
          signal.removeEventListener("abort", onAbort);
        }
      },
    };
    this.#pending.set(id, pending);

    if (signal !== undefined) {
      onAbort = () => {
        const entry = this.#pending.get(id);
        if (entry === undefined) return;
        this.#pending.delete(id);
        entry.detach();
        // Tell the far side to free its slot, then settle locally. A late
        // response for this id is dropped by #receive.
        try {
          this.#port.post(makeCancel(id, topic, reasonText(signal.reason)));
        } catch (error) {
          this.#onError(error);
        }
        entry.deferred.reject(new CancelledError(reasonText(signal.reason)));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const request = makeRequest(id, topic, payload, priority);
      this.#port.post(request, this.#registry.transferListFor("request", topic, payload));
    } catch (error) {
      this.#pending.delete(id);
      pending.detach();
      deferred.reject(error);
    }

    return deferred.promise as Promise<S[K]["response"]>;
  }

  /**
   * Cancel an in-flight call by correlation id. Prefer an `AbortSignal`; this
   * exists for callers holding ids (e.g. a "cancel all analysis" button).
   */
  cancel(id: string, reason?: string): boolean {
    const pending = this.#pending.get(id);
    if (pending === undefined) return false;
    this.#pending.delete(id);
    pending.detach();
    try {
      this.#port.post(makeCancel(id, pending.topic, reason));
    } catch (error) {
      this.#onError(error);
    }
    pending.deferred.reject(new CancelledError(reason));
    return true;
  }

  /** Cancel every in-flight call. Returns how many were cancelled. */
  cancelAll(reason?: string): number {
    let count = 0;
    for (const id of [...this.#pending.keys()]) {
      if (this.cancel(id, reason)) count++;
    }
    return count;
  }

  /**
   * Detach from the port and reject anything still in flight. Does not close
   * the port itself — whoever created the transport owns its lifetime.
   */
  close(reason = "client closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.cancelAll(reason);
    this.#unsubscribe();
  }

  #receive(message: Message): void {
    if (!isMessage(message)) {
      this.#onError(new ProtocolError("RpcClient received a non-protocol message"));
      return;
    }
    switch (message.kind) {
      case "response": {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return; // already settled (typically cancelled)
        this.#pending.delete(message.id);
        pending.detach();
        const payload = message.payload;
        if (payload.ok) pending.deferred.resolve(payload.value);
        else pending.deferred.reject(deserializeError(payload.error, message.topic));
        return;
      }
      case "event": {
        const pending = this.#pending.get(message.id);
        if (pending?.onProgress === undefined) return;
        try {
          pending.onProgress(message.payload);
        } catch (error) {
          this.#onError(error);
        }
        return;
      }
      // Requests and cancels are server-bound; ignoring them lets a client and
      // a server share one port pair in both directions.
      default:
        return;
    }
  }
}
