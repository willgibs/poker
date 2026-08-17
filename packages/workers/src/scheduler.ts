/**
 * Priority scheduler with cooperative preemption.
 *
 * A job is an async generator. Every `yield` is a chunk boundary: the point
 * where the scheduler is allowed to take the slot away. Chunks should be
 * ~10ms of work (docs/architecture.md) — small enough that a P0 job never
 * waits long, large enough that the per-chunk overhead disappears.
 *
 * ```ts
 * async function* grade(hands: Hand[]): JobGenerator<number, Report> {
 *   for (let i = 0; i < hands.length; i++) {
 *     gradeOne(hands[i]);
 *     if (i % 32 === 31) yield i / hands.length;  // progress + chunk boundary
 *   }
 *   return report();
 * }
 * scheduler.submit(() => grade(hands), { priority: P2, topic: "grade" });
 * ```
 *
 * Rules, in order:
 *
 * 1. **Priority first.** A free slot always goes to the lowest priority number
 *    available; FIFO within a class.
 * 2. **Preemption at yields.** When a running job yields and a strictly
 *    higher-priority job is waiting, the runner is pushed back to the *front*
 *    of its class (it keeps its place) and the slot is handed over.
 * 3. **Rotation on slice expiry.** When a running job yields, another job of
 *    the same class is waiting, and the injected clock says the job has used
 *    more than `sliceMs`, it goes to the *back* of its class. With the default
 *    {@link ZERO_CLOCK} slices never expire, so scheduling stays purely
 *    priority-driven and deterministic.
 * 4. **Slots.** `maxConcurrent` jobs run at once (default 1 — one worker is
 *    one thread). Concurrency here is interleaving, not parallelism.
 *
 * Cancellation is cooperative too: `cancel()` aborts the job's signal
 * immediately and takes effect at the next chunk boundary, where the generator
 * is finalized via `return()` so its `finally` blocks run.
 */

import type { Clock } from "./clock";
import { ZERO_CLOCK } from "./clock";
import type { Deferred } from "./defer";
import { createDeferred, noop } from "./defer";
import { CancelledError } from "./errors";
import type { Priority } from "./protocol";
import { P1 } from "./protocol";

/**
 * A job body. Yield `undefined` for a bare chunk boundary, or a progress value
 * to also emit it; return the result.
 */
export type JobGenerator<TProgress = never, TResult = void> = AsyncGenerator<
  TProgress | undefined,
  TResult,
  void
>;

/** What a job body is handed when it starts. */
export interface JobContext {
  readonly id: string;
  readonly topic: string;
  readonly priority: Priority;
  /** Aborted the moment the job is cancelled, before the next chunk boundary. */
  readonly signal: AbortSignal;
}

/** Builds the job body once the scheduler is ready to start it. */
export type JobFactory<TProgress, TResult> = (ctx: JobContext) => JobGenerator<TProgress, TResult>;

/** Either a ready-made generator or a factory that makes one. */
export type JobSource<TProgress, TResult> =
  | JobGenerator<TProgress, TResult>
  | JobFactory<TProgress, TResult>;

/** Lifecycle state of a submitted job. A preempted job is back in `"queued"`. */
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

/** Options for {@link Scheduler.submit}. */
export interface SubmitOptions<TProgress> {
  /** Explicit id (the RPC server passes the request id). Must be unique among live jobs. */
  readonly id?: string;
  /** Group label; `cancel(topic)` cancels every job carrying it. */
  readonly topic?: string;
  /** Priority class. Default {@link P1}. */
  readonly priority?: Priority;
  /** Called for each non-`undefined` yielded value, in order. */
  readonly onProgress?: (value: TProgress) => void;
}

/** Handle on a submitted job. */
export interface JobHandle<T> {
  readonly id: string;
  readonly topic: string;
  readonly priority: Priority;
  /** Resolves with the return value; rejects with {@link CancelledError} when cancelled. */
  readonly result: Promise<T>;
  /** Current lifecycle state. */
  readonly state: JobState;
  /** Number of chunk boundaries crossed so far. */
  readonly chunks: number;
  /** Request cancellation. Idempotent. */
  cancel(reason?: string): void;
}

/** Options for {@link Scheduler}. */
export interface SchedulerOptions {
  /** Jobs allowed to hold a slot at once. Default 1. */
  readonly maxConcurrent?: number;
  /** Time slice before same-priority rotation, in ms. Default 10. */
  readonly sliceMs?: number;
  /** Time source. Default {@link ZERO_CLOCK} (slices never expire). */
  readonly clock?: Clock;
  /** Prefix for generated job ids. Default `"job"`. */
  readonly idPrefix?: string;
  /** Reports errors thrown by `onProgress` callbacks or generator finalization. */
  readonly onError?: (error: unknown) => void;
}

/** Counters, for tests and for the dev overlay. */
export interface SchedulerStats {
  readonly running: number;
  readonly queued: number;
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Times a running job handed its slot to a higher-priority job. */
  readonly preemptions: number;
  /** Times a running job rotated out on slice expiry. */
  readonly rotations: number;
  /** Total chunk boundaries crossed. */
  readonly chunks: number;
}

interface JobRecord {
  readonly id: string;
  readonly topic: string;
  readonly priority: Priority;
  readonly source: JobSource<unknown, unknown>;
  readonly onProgress: ((value: unknown) => void) | undefined;
  readonly controller: AbortController;
  readonly deferred: Deferred<unknown>;
  generator: AsyncGenerator<unknown, unknown, void> | null;
  state: JobState;
  cancelRequested: boolean;
  cancelReason: string | undefined;
  sliceStart: number;
  chunks: number;
}

type YieldDecision = "continue" | "preempt" | "rotate";

/** Priority scheduler over cooperative async-generator jobs. */
export class Scheduler {
  readonly #queues: readonly [JobRecord[], JobRecord[], JobRecord[]] = [[], [], []];
  readonly #running = new Set<JobRecord>();
  readonly #live = new Map<string, JobRecord>();
  readonly #maxConcurrent: number;
  readonly #sliceMs: number;
  readonly #clock: Clock;
  readonly #idPrefix: string;
  readonly #onError: (error: unknown) => void;

  #idCounter = 0;
  #started = 0;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #preemptions = 0;
  #rotations = 0;
  #chunks = 0;

  constructor(options: SchedulerOptions = {}) {
    const maxConcurrent = options.maxConcurrent ?? 1;
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("Scheduler: maxConcurrent must be a positive integer");
    }
    this.#maxConcurrent = maxConcurrent;
    this.#sliceMs = options.sliceMs ?? 10;
    this.#clock = options.clock ?? ZERO_CLOCK;
    this.#idPrefix = options.idPrefix ?? "job";
    this.#onError = options.onError ?? noop;
  }

  /** Slots configured for this scheduler. */
  get maxConcurrent(): number {
    return this.#maxConcurrent;
  }

  /** Live counters. */
  get stats(): SchedulerStats {
    return {
      running: this.#running.size,
      queued: this.#queues[0].length + this.#queues[1].length + this.#queues[2].length,
      started: this.#started,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
      preemptions: this.#preemptions,
      rotations: this.#rotations,
      chunks: this.#chunks,
    };
  }

  /** True while a job with this id is queued or running. */
  has(id: string): boolean {
    return this.#live.has(id);
  }

  /**
   * Queue a job. Returns immediately; the body does not start until a slot is
   * free and no higher-priority work is waiting.
   */
  submit<TProgress = never, TResult = void>(
    source: JobSource<TProgress, TResult>,
    options: SubmitOptions<TProgress> = {},
  ): JobHandle<TResult> {
    const id = options.id ?? `${this.#idPrefix}-${++this.#idCounter}`;
    if (this.#live.has(id)) {
      throw new Error(`Scheduler: job id "${id}" is already in flight`);
    }
    const deferred = createDeferred<unknown>();
    // Always observed: a cancelled or failed job whose handle nobody awaits
    // must not surface as an unhandled rejection.
    deferred.promise.catch(noop);

    const record: JobRecord = {
      id,
      topic: options.topic ?? id,
      priority: options.priority ?? P1,
      source: source as JobSource<unknown, unknown>,
      onProgress: options.onProgress as ((value: unknown) => void) | undefined,
      controller: new AbortController(),
      deferred,
      generator: null,
      state: "queued",
      cancelRequested: false,
      cancelReason: undefined,
      sliceStart: 0,
      chunks: 0,
    };

    this.#live.set(id, record);
    this.#queues[record.priority].push(record);
    this.#pump();
    return this.#makeHandle<TResult>(record);
  }

  /**
   * Cancel every live job whose id **or** topic equals `topicOrId`.
   * Returns how many were affected.
   */
  cancel(topicOrId: string, reason?: string): number {
    let count = 0;
    for (const record of [...this.#live.values()]) {
      if (record.id === topicOrId || record.topic === topicOrId) {
        if (this.#cancelRecord(record, reason)) count++;
      }
    }
    return count;
  }

  /** Cancel everything queued or running. Returns how many were affected. */
  cancelAll(reason?: string): number {
    let count = 0;
    for (const record of [...this.#live.values()]) {
      if (this.#cancelRecord(record, reason)) count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #makeHandle<T>(record: JobRecord): JobHandle<T> {
    return {
      id: record.id,
      topic: record.topic,
      priority: record.priority,
      result: record.deferred.promise as Promise<T>,
      get state(): JobState {
        return record.state;
      },
      get chunks(): number {
        return record.chunks;
      },
      cancel: (reason?: string): void => {
        this.#cancelRecord(record, reason);
      },
    };
  }

  #cancelRecord(record: JobRecord, reason?: string): boolean {
    if (record.cancelRequested) return false;
    record.cancelRequested = true;
    record.cancelReason = reason;
    const error = new CancelledError(reason);
    try {
      record.controller.abort(error);
    } catch (abortError) {
      this.#onError(abortError);
    }

    if (record.state === "queued") {
      // Never started: drop it from the queue and settle now. No slot to free,
      // so no pump is needed.
      this.#removeFromQueue(record);
      const generator = record.generator;
      if (generator !== null) void this.#finalize(generator);
      this.#settleCancelled(record, error);
      return true;
    }
    // Running: the driver picks this up at the next chunk boundary.
    return true;
  }

  #removeFromQueue(record: JobRecord): void {
    const queue = this.#queues[record.priority];
    const index = queue.indexOf(record);
    if (index >= 0) queue.splice(index, 1);
  }

  #pump(): void {
    while (this.#running.size < this.#maxConcurrent) {
      const record = this.#takeNext();
      if (record === undefined) return;

      this.#running.add(record);
      record.state = "running";
      record.sliceStart = this.#clock.now();

      if (record.generator === null) {
        this.#started++;
        try {
          record.generator = instantiate(record);
        } catch (error) {
          // Factory threw before producing a generator.
          this.#running.delete(record);
          this.#settleFailed(record, error);
          continue;
        }
      }
      void this.#drive(record);
    }
  }

  #takeNext(): JobRecord | undefined {
    for (const queue of this.#queues) {
      const record = queue.shift();
      if (record !== undefined) return record;
    }
    return undefined;
  }

  #peekNext(): JobRecord | undefined {
    for (const queue of this.#queues) {
      const record = queue[0];
      if (record !== undefined) return record;
    }
    return undefined;
  }

  /**
   * Run one job until it finishes, fails, is cancelled, or gives up its slot.
   * Never rejects: every exit path settles the record and re-pumps.
   */
  async #drive(record: JobRecord): Promise<void> {
    const generator = record.generator;
    try {
      if (generator === null) return;
      for (;;) {
        if (record.cancelRequested) {
          await this.#finalize(generator);
          this.#settleCancelled(record);
          return;
        }

        let step: IteratorResult<unknown, unknown>;
        try {
          step = await generator.next();
        } catch (error) {
          if (record.cancelRequested) this.#settleCancelled(record);
          else this.#settleFailed(record, error);
          return;
        }

        if (step.done) {
          if (record.cancelRequested) this.#settleCancelled(record);
          else this.#settleDone(record, step.value);
          return;
        }

        // --- chunk boundary ---
        this.#chunks++;
        record.chunks++;
        if (step.value !== undefined && record.onProgress !== undefined) {
          try {
            record.onProgress(step.value);
          } catch (error) {
            this.#onError(error);
          }
        }

        if (record.cancelRequested) {
          await this.#finalize(generator);
          this.#settleCancelled(record);
          return;
        }

        const decision = this.#decide(record);
        if (decision !== "continue") {
          this.#requeue(record, decision);
          return;
        }
      }
    } finally {
      this.#running.delete(record);
      this.#pump();
    }
  }

  #decide(record: JobRecord): YieldDecision {
    const next = this.#peekNext();
    if (next === undefined) return "continue";
    if (next.priority < record.priority) return "preempt";
    if (next.priority === record.priority && this.#clock.now() - record.sliceStart >= this.#sliceMs) {
      return "rotate";
    }
    return "continue";
  }

  #requeue(record: JobRecord, decision: Exclude<YieldDecision, "continue">): void {
    record.state = "queued";
    if (decision === "preempt") {
      this.#preemptions++;
      // Keeps its place in its own class: it was interrupted, not overdue.
      this.#queues[record.priority].unshift(record);
    } else {
      this.#rotations++;
      this.#queues[record.priority].push(record);
    }
  }

  async #finalize(generator: AsyncGenerator<unknown, unknown, void>): Promise<void> {
    try {
      await generator.return(undefined);
    } catch (error) {
      this.#onError(error);
    }
  }

  #settleDone(record: JobRecord, value: unknown): void {
    record.state = "done";
    this.#completed++;
    this.#live.delete(record.id);
    record.deferred.resolve(value);
  }

  #settleFailed(record: JobRecord, error: unknown): void {
    record.state = "failed";
    this.#failed++;
    this.#live.delete(record.id);
    record.deferred.reject(error);
  }

  #settleCancelled(record: JobRecord, error?: CancelledError): void {
    record.state = "cancelled";
    this.#cancelled++;
    this.#live.delete(record.id);
    record.deferred.reject(error ?? new CancelledError(record.cancelReason));
  }
}

function instantiate(record: JobRecord): AsyncGenerator<unknown, unknown, void> {
  const source = record.source;
  if (typeof source === "function") {
    return source({
      id: record.id,
      topic: record.topic,
      priority: record.priority,
      signal: record.controller.signal,
    });
  }
  return source;
}

