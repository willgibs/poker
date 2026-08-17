/**
 * Handler side of the RPC layer.
 *
 * ```ts
 * const server = new RpcServer<EngineTopics>(port, { maxConcurrent: 1 });
 * server.define("equity/estimate", async function* (spot, ctx) {
 *   let acc = init(spot);
 *   for (let batch = 0; batch < 64; batch++) {
 *     if (ctx.signal.aborted) break;
 *     acc = refine(acc);
 *     yield snapshot(acc);      // progress event + chunk boundary
 *   }
 *   return finish(acc);
 * });
 * ```
 *
 * Handlers may be plain (async) functions or async generators. Generators are
 * the interesting case: each `yield` both emits a progress event and gives the
 * {@link Scheduler} a chance to hand the slot to something more urgent.
 */

import type { Clock } from "./clock";
import { noop } from "./defer";
import { CancelledError, UnknownTopicError, serializeError } from "./errors";
import type { Port, Unsubscribe } from "./port";
import type { JobContext, JobGenerator, JobHandle } from "./scheduler";
import { Scheduler } from "./scheduler";
import type { Message, RequestMessage, TopicSchema, TopicShape } from "./protocol";
import { TopicRegistry, isMessage, makeErrorResponse, makeEvent, makeResponse } from "./protocol";

/** What a handler is given alongside its payload. */
export type HandlerContext = JobContext;

/** Return forms a handler may take. */
export type HandlerReturn<Res, Evt> = Res | Promise<Res> | AsyncGenerator<Evt | undefined, Res, void>;

/** A topic handler. */
export type Handler<Sh extends TopicShape> = (
  payload: Sh["request"],
  ctx: HandlerContext,
) => HandlerReturn<Sh["response"], Sh["event"]>;

/** Erased handler shape for storage (request payloads are contravariant). */
type AnyHandler = (payload: never, ctx: HandlerContext) => HandlerReturn<unknown, unknown>;

/** Options for {@link RpcServer}. */
export interface RpcServerOptions {
  /** Share one scheduler across several servers/ports. Created if omitted. */
  readonly scheduler?: Scheduler;
  /** Per-topic transfer declarations. */
  readonly registry?: TopicRegistry;
  /** Slots for the scheduler this server creates. Default 1. Ignored when `scheduler` is given. */
  readonly maxConcurrent?: number;
  /** Slice length for the scheduler this server creates. Ignored when `scheduler` is given. */
  readonly sliceMs?: number;
  /** Clock for the scheduler this server creates. Ignored when `scheduler` is given. */
  readonly clock?: Clock;
  /** Include stack traces in error responses. Default `true`. */
  readonly includeStack?: boolean;
  /** Reports protocol violations and post failures. */
  readonly onError?: (error: unknown) => void;
}

/** Dispatches requests to handlers through a priority {@link Scheduler}. */
export class RpcServer<S extends TopicSchema = TopicSchema> {
  readonly #port: Port;
  readonly #scheduler: Scheduler;
  readonly #registry: TopicRegistry;
  readonly #handlers = new Map<string, AnyHandler>();
  readonly #inflight = new Map<string, JobHandle<unknown>>();
  readonly #includeStack: boolean;
  readonly #onError: (error: unknown) => void;
  readonly #unsubscribe: Unsubscribe;
  #closed = false;

  constructor(port: Port, options: RpcServerOptions = {}) {
    this.#port = port;
    this.#scheduler =
      options.scheduler ??
      new Scheduler({
        maxConcurrent: options.maxConcurrent ?? 1,
        sliceMs: options.sliceMs,
        clock: options.clock,
        onError: options.onError,
      });
    this.#registry = options.registry ?? new TopicRegistry();
    this.#includeStack = options.includeStack ?? true;
    this.#onError = options.onError ?? noop;
    this.#unsubscribe = port.onMessage((message) => this.#receive(message));
  }

  /** The scheduler this server dispatches through. */
  get scheduler(): Scheduler {
    return this.#scheduler;
  }

  /** Requests currently queued or running for this server. */
  get inflightCount(): number {
    return this.#inflight.size;
  }

  /** True once {@link close} has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Register the handler for a topic. Replaces any existing handler. */
  define<K extends keyof S & string>(topic: K, handler: Handler<S[K]>): this {
    this.#handlers.set(topic, handler as AnyHandler);
    return this;
  }

  /** Remove a handler. Requests for the topic then fail with `UnknownTopicError`. */
  undefine(topic: string): boolean {
    return this.#handlers.delete(topic);
  }

  /** True when a handler exists for `topic`. */
  handles(topic: string): boolean {
    return this.#handlers.has(topic);
  }

  /**
   * Stop accepting requests and cancel everything in flight. In-flight calls
   * still get their terminal cancelled response, so clients never hang. Does
   * not close the port — whoever created the transport owns its lifetime.
   */
  close(reason = "server closed"): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const handle of [...this.#inflight.values()]) handle.cancel(reason);
    this.#unsubscribe();
  }

  #receive(message: Message): void {
    if (!isMessage(message)) return;
    switch (message.kind) {
      case "request":
        this.#onRequest(message);
        return;
      case "cancel": {
        const handle = this.#inflight.get(message.id);
        handle?.cancel(message.payload.reason);
        return;
      }
      // Responses and events are client-bound.
      default:
        return;
    }
  }

  #onRequest(request: RequestMessage): void {
    if (this.#closed) return;
    const handler = this.#handlers.get(request.topic);
    if (handler === undefined) {
      this.#respondError(request, new UnknownTopicError(request.topic));
      return;
    }
    if (this.#inflight.has(request.id)) {
      this.#respondError(request, new Error(`duplicate request id "${request.id}"`));
      return;
    }

    let handle: JobHandle<unknown>;
    try {
      handle = this.#scheduler.submit<unknown, unknown>(
        (ctx) => invoke(handler, request.payload, ctx),
        {
          id: request.id,
          topic: request.topic,
          priority: request.priority,
          onProgress: (value) => this.#emit(request, value),
        },
      );
    } catch (error) {
      this.#respondError(request, error);
      return;
    }

    this.#inflight.set(request.id, handle);
    handle.result.then(
      (value) => {
        this.#inflight.delete(request.id);
        this.#respondOk(request, value);
      },
      (error: unknown) => {
        this.#inflight.delete(request.id);
        this.#respondError(request, error);
      },
    );
  }

  #emit(request: RequestMessage, value: unknown): void {
    try {
      this.#port.post(
        makeEvent(request.id, request.topic, value, request.priority),
        this.#registry.transferListFor("event", request.topic, value),
      );
    } catch (error) {
      this.#onError(error);
    }
  }

  #respondOk(request: RequestMessage, value: unknown): void {
    try {
      this.#port.post(
        makeResponse(request.id, request.topic, value, request.priority),
        this.#registry.transferListFor("response", request.topic, value),
      );
    } catch (error) {
      this.#onError(error);
    }
  }

  #respondError(request: RequestMessage, error: unknown): void {
    // Cancelled work still gets a terminal response: the client may have been
    // cancelled by a third party (or not at all), and a pending entry with no
    // terminal message would leak. A client that already settled drops it.
    const serialized = serializeError(error, {
      includeStack: this.#includeStack && !(error instanceof CancelledError),
    });
    try {
      this.#port.post(makeErrorResponse(request.id, request.topic, serialized, request.priority));
    } catch (postError) {
      this.#onError(postError);
    }
  }
}

/**
 * Adapt any handler return form to the scheduler's job shape.
 *
 * A generator is delegated to (`yield*`), so its yields stay chunk boundaries;
 * a plain value or promise becomes a single-chunk job.
 */
async function* invoke(
  handler: AnyHandler,
  payload: unknown,
  ctx: HandlerContext,
): JobGenerator<unknown, unknown> {
  // The registry erases request payload types; this is the one place they meet.
  const result = handler(payload as never, ctx);
  if (isAsyncGenerator(result)) {
    return yield* result;
  }
  return await result;
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { [Symbol.asyncIterator]?: unknown; next?: unknown };
  return typeof candidate[Symbol.asyncIterator] === "function" && typeof candidate.next === "function";
}
