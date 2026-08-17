import { describe, expect, it, vi } from "vitest";

import { ManualClock } from "./clock";
import { CancelledError } from "./errors";
import type { JobGenerator, JobHandle } from "./scheduler";
import { Scheduler } from "./scheduler";
import { P0, P1, P2 } from "./protocol";

/**
 * Spin the microtask queue until `predicate` holds. No timers are involved —
 * jobs here never sleep, so this always converges or fails loudly.
 */
async function until(predicate: () => boolean, maxTicks = 500): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not met within the tick budget");
}

/**
 * A job that logs `${tag}${chunk}` per chunk and yields at every boundary.
 * `onChunk` runs *inside* the chunk, which is how tests submit work at an
 * exact point in the interleaving without counting microtasks.
 */
function chunked(
  log: string[],
  tag: string,
  chunks: number,
  onChunk?: (index: number) => void,
): () => JobGenerator<number, string> {
  return async function* job(): JobGenerator<number, string> {
    for (let i = 0; i < chunks; i++) {
      log.push(`${tag}${i}`);
      onChunk?.(i);
      yield i;
    }
    return tag;
  };
}

describe("Scheduler ordering", () => {
  it("runs one job at a time by default and resolves with its return value", async () => {
    const scheduler = new Scheduler();
    const log: string[] = [];
    const a = scheduler.submit(chunked(log, "A", 3), { topic: "a" });
    const b = scheduler.submit(chunked(log, "B", 2), { topic: "b" });

    expect(scheduler.stats.running).toBe(1);
    expect(scheduler.stats.queued).toBe(1);

    await expect(a.result).resolves.toBe("A");
    await expect(b.result).resolves.toBe("B");
    expect(log).toEqual(["A0", "A1", "A2", "B0", "B1"]);
    expect(scheduler.stats.completed).toBe(2);
    expect(scheduler.stats.preemptions).toBe(0);
  });

  it("starts the highest-priority job first, FIFO within a class", async () => {
    const scheduler = new Scheduler();
    const order: string[] = [];
    const done = [
      scheduler.submit(chunked(order, "p2", 1), { priority: P2 }),
      scheduler.submit(chunked(order, "p1a", 1), { priority: P1 }),
      scheduler.submit(chunked(order, "p0", 1), { priority: P0 }),
      scheduler.submit(chunked(order, "p1b", 1), { priority: P1 }),
    ];
    await Promise.all(done.map((h) => h.result));
    // p2 was already running when the rest arrived; the queue then drains by
    // priority, oldest first within a class.
    expect(order).toEqual(["p20", "p00", "p1a0", "p1b0"]);
  });

  it("interleaves when more than one slot is configured", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 2 });
    const log: string[] = [];
    const a = scheduler.submit(chunked(log, "A", 3));
    const b = scheduler.submit(chunked(log, "B", 3));
    expect(scheduler.stats.running).toBe(2);

    await Promise.all([a.result, b.result]);
    expect(log).toEqual(["A0", "B0", "A1", "B1", "A2", "B2"]);
  });
});

describe("Scheduler preemption", () => {
  it("hands the slot to a P0 job at the running P1 job's next yield", async () => {
    const clock = new ManualClock();
    const scheduler = new Scheduler({ maxConcurrent: 1, clock });
    const log: string[] = [];

    let p0: JobHandle<string> | undefined;
    const p1 = scheduler.submit(
      chunked(log, "P1:", 4, (index) => {
        // Mid-chunk, a live decision arrives: hero is acting.
        if (index === 1) p0 = scheduler.submit(chunked(log, "P0:", 2), { priority: P0 });
      }),
      { priority: P1 },
    );

    await p1.result;
    await p0?.result;

    expect(log).toEqual(["P1:0", "P1:1", "P0:0", "P0:1", "P1:2", "P1:3"]);
    expect(scheduler.stats.preemptions).toBe(1);
    expect(scheduler.stats.rotations).toBe(0);
    expect(scheduler.stats.running).toBe(0);
    // The manual clock never moved: ordering came from priority alone.
    expect(clock.now()).toBe(0);
  });

  it("does not preempt for equal or lower priority", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const log: string[] = [];
    const running = scheduler.submit(
      chunked(log, "P1:", 3, (index) => {
        if (index === 0) {
          scheduler.submit(chunked(log, "peer:", 1), { priority: P1 });
          scheduler.submit(chunked(log, "bg:", 1), { priority: P2 });
        }
      }),
      { priority: P1 },
    );
    await running.result;
    await until(() => scheduler.stats.completed === 3);
    expect(log).toEqual(["P1:0", "P1:1", "P1:2", "peer:0", "bg:0"]);
    expect(scheduler.stats.preemptions).toBe(0);
  });

  it("rotates equal-priority jobs once the injected clock passes the slice", async () => {
    const clock = new ManualClock();
    const scheduler = new Scheduler({ maxConcurrent: 1, sliceMs: 10, clock });
    const log: string[] = [];

    // Each chunk of A costs 6ms of wall clock; B is queued from the start.
    const a = scheduler.submit(
      chunked(log, "A", 4, () => {
        clock.advance(6);
      }),
      { priority: P1 },
    );
    const b = scheduler.submit(chunked(log, "B", 2), { priority: P1 });

    await Promise.all([a.result, b.result]);
    // A yields at 6ms (under slice, keeps going), then at 12ms (over slice,
    // rotates). B then runs its two chunks; A finishes last.
    expect(log).toEqual(["A0", "A1", "B0", "B1", "A2", "A3"]);
    expect(scheduler.stats.rotations).toBe(1);
    expect(scheduler.stats.preemptions).toBe(0);
  });

  it("never rotates under the default frozen clock", async () => {
    // No injected clock: slices cannot expire, so equal-priority jobs run to
    // completion in submission order. This is the determinism guarantee.
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const log: string[] = [];
    const a = scheduler.submit(chunked(log, "A", 3), { priority: P1 });
    const b = scheduler.submit(chunked(log, "B", 1), { priority: P1 });
    await Promise.all([a.result, b.result]);
    expect(scheduler.stats.rotations).toBe(0);
    expect(log).toEqual(["A0", "A1", "A2", "B0"]);
  });
});

describe("Scheduler progress", () => {
  it("delivers yielded values in order and skips bare boundaries", async () => {
    const scheduler = new Scheduler();
    const seen: number[] = [];
    const handle = scheduler.submit<number, string>(
      async function* job(): JobGenerator<number, string> {
        yield 1;
        yield; // chunk boundary only, no progress event
        yield 2;
        yield 3;
        return "done";
      },
      { onProgress: (value) => seen.push(value) },
    );

    await expect(handle.result).resolves.toBe("done");
    expect(seen).toEqual([1, 2, 3]);
    expect(handle.chunks).toBe(4);
  });

  it("survives a throwing progress callback", async () => {
    const onError = vi.fn();
    const scheduler = new Scheduler({ onError });
    const handle = scheduler.submit<number, string>(
      async function* job(): JobGenerator<number, string> {
        yield 1;
        return "done";
      },
      {
        onProgress: () => {
          throw new Error("bad subscriber");
        },
      },
    );
    await expect(handle.result).resolves.toBe("done");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("Scheduler cancellation", () => {
  it("stops a streaming job, runs its finally, and frees the slot", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    let cleanedUp = false;
    let chunksRun = 0;

    const streaming = scheduler.submit<number, string>(
      async function* job(): JobGenerator<number, string> {
        try {
          for (let i = 0; i < 10_000; i++) {
            chunksRun++;
            yield i;
          }
          return "finished";
        } finally {
          cleanedUp = true;
        }
      },
      { topic: "equity/estimate" },
    );

    const queued = scheduler.submit(chunked([], "next", 1));
    await until(() => streaming.chunks >= 2);

    expect(scheduler.cancel("equity/estimate", "hero acted")).toBe(1);
    await expect(streaming.result).rejects.toBeInstanceOf(CancelledError);
    await expect(streaming.result).rejects.toThrow(/hero acted/);

    expect(cleanedUp).toBe(true);
    expect(streaming.state).toBe("cancelled");
    expect(chunksRun).toBeLessThan(10_000);

    // The slot is free: the job behind it runs to completion.
    await expect(queued.result).resolves.toBe("next");
    expect(scheduler.stats.running).toBe(0);
    expect(scheduler.stats.queued).toBe(0);
    expect(scheduler.stats.cancelled).toBe(1);
  });

  it("aborts the job signal immediately, before the next chunk boundary", async () => {
    const scheduler = new Scheduler();
    const seen: boolean[] = [];
    const handle = scheduler.submit<number, string>(
      async function* job(ctx): JobGenerator<number, string> {
        for (let i = 0; i < 100; i++) {
          seen.push(ctx.signal.aborted);
          yield i;
        }
        return "finished";
      },
    );

    await until(() => handle.chunks >= 1);
    handle.cancel("superseded");
    await expect(handle.result).rejects.toBeInstanceOf(CancelledError);
    expect(seen.some((aborted) => aborted === false)).toBe(true);
  });

  it("cancels a queued job without ever starting it", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const log: string[] = [];
    const running = scheduler.submit(chunked(log, "A", 2));
    const queued = scheduler.submit(chunked(log, "B", 2), { topic: "b" });

    expect(queued.state).toBe("queued");
    expect(scheduler.cancel("b")).toBe(1);
    await expect(queued.result).rejects.toBeInstanceOf(CancelledError);

    await expect(running.result).resolves.toBe("A");
    expect(log).toEqual(["A0", "A1"]);
    expect(scheduler.stats.started).toBe(1);
  });

  it("cancels by id or by topic, and reports how many were hit", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const make = (): (() => JobGenerator<number, string>) => chunked([], "x", 5);
    const first = scheduler.submit(make(), { id: "job-a", topic: "analysis" });
    const second = scheduler.submit(make(), { id: "job-b", topic: "analysis" });
    const other = scheduler.submit(make(), { id: "job-c", topic: "other" });

    expect(scheduler.cancel("analysis")).toBe(2);
    expect(scheduler.cancel("analysis")).toBe(0);
    await expect(first.result).rejects.toBeInstanceOf(CancelledError);
    await expect(second.result).rejects.toBeInstanceOf(CancelledError);

    expect(scheduler.cancel("job-c")).toBe(1);
    await expect(other.result).rejects.toBeInstanceOf(CancelledError);
    expect(scheduler.stats.running).toBe(0);
  });

  it("cancelAll drains queued and running work", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const first = scheduler.submit(chunked([], "a", 50));
    const handles = [first, scheduler.submit(chunked([], "b", 50)), scheduler.submit(chunked([], "c", 50))];
    await until(() => first.chunks >= 1);

    expect(scheduler.cancelAll("session ended")).toBe(3);
    for (const handle of handles) {
      await expect(handle.result).rejects.toBeInstanceOf(CancelledError);
    }
    expect(scheduler.stats.running).toBe(0);
    expect(scheduler.has("job-1")).toBe(false);
  });

  it("does not raise unhandled rejections for cancelled or failed jobs nobody awaits", async () => {
    const seen: unknown[] = [];
    const capture = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", capture);
    try {
      const scheduler = new Scheduler({ maxConcurrent: 1 });
      // A job that fails and a job that gets cancelled, neither of them awaited.
      scheduler.submit(
        async function* boom(): JobGenerator<never, void> {
          throw new Error("handler exploded");
        },
        { topic: "boom" },
      );
      scheduler.submit(chunked([], "a", 100), { topic: "doomed" });
      await until(() => scheduler.stats.failed === 1 && scheduler.stats.chunks >= 1);
      scheduler.cancelAll("bye");
      await until(() => scheduler.stats.running === 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", capture);
    }
  });
});

describe("Scheduler failure and misuse", () => {
  it("rejects with whatever the job threw", async () => {
    const scheduler = new Scheduler();
    const handle = scheduler.submit(async function* boom(): JobGenerator<never, void> {
      yield;
      throw new RangeError("seat 9");
    });
    await expect(handle.result).rejects.toThrow(RangeError);
    expect(handle.state).toBe("failed");
    expect(scheduler.stats.failed).toBe(1);
    expect(scheduler.stats.running).toBe(0);
  });

  it("rejects when the job factory throws", async () => {
    const scheduler = new Scheduler();
    const handle = scheduler.submit(() => {
      throw new Error("could not build job");
    });
    await expect(handle.result).rejects.toThrow(/could not build job/);
    expect(scheduler.stats.running).toBe(0);
  });

  it("accepts a bare generator as well as a factory", async () => {
    const scheduler = new Scheduler();
    async function* job(): JobGenerator<never, number> {
      yield;
      return 7;
    }
    await expect(scheduler.submit(job()).result).resolves.toBe(7);
  });

  it("refuses duplicate in-flight ids and reuses them once settled", async () => {
    const scheduler = new Scheduler();
    const first = scheduler.submit(chunked([], "a", 2), { id: "same" });
    expect(() => scheduler.submit(chunked([], "b", 1), { id: "same" })).toThrow(/already in flight/);
    await first.result;
    await expect(scheduler.submit(chunked([], "b", 1), { id: "same" }).result).resolves.toBe("b");
  });

  it("validates maxConcurrent", () => {
    expect(() => new Scheduler({ maxConcurrent: 0 })).toThrow(RangeError);
    expect(() => new Scheduler({ maxConcurrent: 1.5 })).toThrow(RangeError);
  });

  it("exposes handle metadata", async () => {
    const scheduler = new Scheduler({ idPrefix: "compute" });
    const handle = scheduler.submit(chunked([], "a", 1), { priority: P2 });
    expect(handle.id).toBe("compute-1");
    expect(handle.topic).toBe("compute-1");
    expect(handle.priority).toBe(P2);
    expect(handle.state).toBe("running");
    await handle.result;
    expect(handle.state).toBe("done");
  });
});
