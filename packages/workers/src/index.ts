/**
 * @packageDocumentation
 * # @poker/workers — typed RPC + priority scheduling for compute workers
 *
 * The plumbing between the app and the pool of ≤4 stateless compute workers
 * described in `docs/architecture.md`. Zero runtime dependencies, no DOM
 * required, no time or randomness read from the environment.
 *
 * ## Layers
 *
 * 1. **Protocol** ({@link Message}) — one flat envelope
 *    `{ id, kind, topic, payload, priority }` for all four message kinds.
 *    Payloads must be structured-clone-safe; topics may declare transfer lists
 *    via {@link TopicRegistry} so freshly built typed arrays move instead of copy.
 * 2. **Transport** ({@link Port}) — `post` + `onMessage`, nothing else.
 *    {@link createLoopbackPair} runs both ends in one thread (cloning by
 *    default, so tests hit the same serialization wall as the browser);
 *    {@link WebWorkerPort} wraps any `postMessage` endpoint — a `Worker`, a
 *    worker's own `self`, or a `MessagePort`.
 * 3. **Scheduler** ({@link Scheduler}) — P0/P1/P2 classes over async-generator
 *    jobs. Each `yield` is a chunk boundary: the scheduler starts the most
 *    urgent work first, preempts lower-priority jobs at those boundaries, and
 *    caps how many jobs hold a slot at once.
 * 4. **RPC** ({@link RpcClient} / {@link RpcServer}) — request/response with
 *    cancellation and streaming progress events, which is what progressive
 *    equity refinement needs: keep sending better estimates until someone more
 *    urgent needs the thread.
 *
 * ## Typical wiring
 *
 * ```ts
 * // main thread
 * const port = createWebWorkerPort(new Worker(url, { type: "module" }));
 * const client = new RpcClient<EngineTopics>(port);
 * const result = await client.call("equity/estimate", spot, { priority: P0, onProgress });
 *
 * // inside the worker
 * const server = new RpcServer<EngineTopics>(createWebWorkerPort(self));
 * server.define("equity/estimate", async function* (spot, ctx) { ... });
 * ```
 *
 * ## Determinism
 *
 * Time is injected ({@link Clock}); the default {@link ZERO_CLOCK} makes time
 * slices never expire, so job ordering depends only on priority and submission
 * order. Ids are counters, not random. Nothing here reads `Date.now()` or
 * `Math.random()`.
 */

export type { Clock } from "./clock";
export { ManualClock, ZERO_CLOCK } from "./clock";

export {
  CancelledError,
  PortClosedError,
  ProtocolError,
  RpcError,
  UnknownTopicError,
  WorkerError,
  deserializeError,
  reasonText,
  serializeError,
} from "./errors";
export type { SerializeErrorOptions, SerializedError } from "./errors";

export {
  P0,
  P1,
  P2,
  PRIORITIES,
  TopicRegistry,
  autoTransfer,
  collectTransferables,
  defineTopic,
  findUncloneable,
  isCancel,
  isCloneable,
  isEvent,
  isMessage,
  isPriority,
  isRequest,
  isResponse,
  isResponsePayload,
  makeCancel,
  makeErrorResponse,
  makeEvent,
  makeRequest,
  makeResponse,
} from "./protocol";
export type {
  CancelMessage,
  CancelPayload,
  Envelope,
  EventMessage,
  Message,
  MessageId,
  MessageKind,
  Priority,
  RequestMessage,
  ResponseMessage,
  ResponsePayload,
  TopicSchema,
  TopicShape,
  TopicSpec,
  TransferSelector,
} from "./protocol";

export { LoopbackPort, WebWorkerPort, createLoopbackPair, createWebWorkerPort } from "./port";
export type {
  LoopbackDelivery,
  LoopbackOptions,
  MessageEndpoint,
  MessageListener,
  Port,
  Unsubscribe,
  WebWorkerPortOptions,
} from "./port";

export { Scheduler } from "./scheduler";
export type {
  JobContext,
  JobFactory,
  JobGenerator,
  JobHandle,
  JobSource,
  JobState,
  SchedulerOptions,
  SchedulerStats,
  SubmitOptions,
} from "./scheduler";

export { RpcClient } from "./client";
export type { CallOptions, RpcClientOptions } from "./client";

export { RpcServer } from "./server";
export type { Handler, HandlerContext, HandlerReturn, RpcServerOptions } from "./server";
