import { describe, expect, it, vi } from "vitest";

import { RpcClient } from "./client";
import { ManualClock } from "./clock";
import { CancelledError, RpcError, UnknownTopicError } from "./errors";
import type { MessageEndpoint } from "./port";
import { WebWorkerPort, createLoopbackPair } from "./port";
import type { JobGenerator } from "./scheduler";
import { Scheduler } from "./scheduler";
import type { Message, TopicShape } from "./protocol";
import { P0, P1, P2, TopicRegistry, autoTransfer, defineTopic } from "./protocol";
import { RpcServer } from "./server";

/** The topic contract for these tests, in the shape apps will declare. */
type EquityRequest = { trials: number; tag?: string };

type Topics = {
  "math/add": TopicShape<{ a: number; b: number }, number, never>;
  "equity/estimate": TopicShape<EquityRequest, { equity: number }, { done: number }>;
  "fail/boom": TopicShape<null, never, never>;
  "echo/bytes": TopicShape<{ bytes: Uint8Array }, { bytes: Uint8Array }, never>;
};

async function until(predicate: () => boolean, maxTicks = 500): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not met within the tick budget");
}

function pair(options?: { scheduler?: Scheduler; registry?: TopicRegistry }): {
  client: RpcClient<Topics>;
  server: RpcServer<Topics>;
} {
  const [clientPort, serverPort] = createLoopbackPair();
  const client = new RpcClient<Topics>(clientPort, { registry: options?.registry });
  const server = new RpcServer<Topics>(serverPort, {
    scheduler: options?.scheduler,
    registry: options?.registry,
  });
  return { client, server };
}

/** Progressive refinement, the shape `equity` will use for real. */
function estimator(
  onChunk?: (index: number) => void,
): (payload: EquityRequest) => JobGenerator<{ done: number }, { equity: number }> {
  return async function* estimate(payload): JobGenerator<{ done: number }, { equity: number }> {
    for (let done = 1; done <= payload.trials; done++) {
      onChunk?.(done);
      yield { done };
    }
    return { equity: 0.5 };
  };
}

describe("request/response over a LoopbackPort", () => {
  it("round-trips a typed call", async () => {
    const { client, server } = pair();
    server.define("math/add", (payload) => payload.a + payload.b);
    await expect(client.call("math/add", { a: 2, b: 40 })).resolves.toBe(42);
  });

  it("handles async, generator and value-returning handlers alike", async () => {
    const { client, server } = pair();
    server.define("math/add", async (payload) => {
      await Promise.resolve();
      return payload.a + payload.b;
    });
    await expect(client.call("math/add", { a: 1, b: 1 })).resolves.toBe(2);

    server.define("math/add", async function* (payload) {
      yield;
      return payload.a * payload.b;
    });
    await expect(client.call("math/add", { a: 3, b: 4 })).resolves.toBe(12);
  });

  it("keeps concurrent calls distinct", async () => {
    const { client, server } = pair();
    server.define("math/add", (payload) => payload.a + payload.b);
    const results = await Promise.all([
      client.call("math/add", { a: 1, b: 1 }),
      client.call("math/add", { a: 2, b: 2 }),
      client.call("math/add", { a: 3, b: 3 }),
    ]);
    expect(results).toEqual([2, 4, 6]);
    expect(client.pendingCount).toBe(0);
    expect(server.inflightCount).toBe(0);
  });

  it("passes the request priority through to the scheduler", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const { client, server } = pair({ scheduler });
    const order: string[] = [];
    server.define("equity/estimate", async function* (payload) {
      order.push(payload.tag ?? "");
      for (let done = 1; done <= payload.trials; done++) yield { done };
      return { equity: payload.trials };
    });

    // A long P0 job holds the only slot while two lower-priority requests land.
    const blocker = client.call("equity/estimate", { trials: 20, tag: "blocker" }, { priority: P0 });
    await until(() => order.length === 1);
    const background = client.call("equity/estimate", { trials: 1, tag: "background" }, { priority: P2 });
    const live = client.call("equity/estimate", { trials: 1, tag: "live" }, { priority: P1 });

    await Promise.all([blocker, background, live]);
    // Dispatch order follows priority, not arrival order.
    expect(order).toEqual(["blocker", "live", "background"]);
  });

  it("reports unknown topics without a handler ever running", async () => {
    const { client } = pair();
    await expect(client.call("math/add", { a: 1, b: 1 })).rejects.toBeInstanceOf(UnknownTopicError);
  });

  it("reports handler failures as RpcError carrying the remote details", async () => {
    const { client, server } = pair();
    server.define("fail/boom", () => {
      throw new RangeError("seat 9 does not exist");
    });
    const error = await client.call("fail/boom", null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    const rpcError = error as RpcError;
    expect(rpcError.remote.name).toBe("RangeError");
    expect(rpcError.remote.message).toBe("seat 9 does not exist");
    expect(rpcError.remote.stack).toContain("RangeError");
    expect(rpcError.topic).toBe("fail/boom");
  });

  it("gives handlers their id, topic, priority and signal", async () => {
    const { client, server } = pair();
    const seen: Array<{ id: string; topic: string; priority: number; aborted: boolean }> = [];
    server.define("math/add", (payload, ctx) => {
      seen.push({ id: ctx.id, topic: ctx.topic, priority: ctx.priority, aborted: ctx.signal.aborted });
      return payload.a;
    });
    await client.call("math/add", { a: 5, b: 0 }, { priority: P0 });
    expect(seen).toEqual([{ id: "call-1", topic: "math/add", priority: P0, aborted: false }]);
  });
});

describe("streaming progress", () => {
  it("delivers every progress event, in order, before the response", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());

    const timeline: string[] = [];
    const result = await client.call(
      "equity/estimate",
      { trials: 5 },
      {
        onProgress: (event) => timeline.push(`progress:${event.done}`),
      },
    );
    timeline.push("resolved");

    expect(timeline).toEqual([
      "progress:1",
      "progress:2",
      "progress:3",
      "progress:4",
      "progress:5",
      "resolved",
    ]);
    expect(result).toEqual({ equity: 0.5 });
  });

  it("does not deliver progress to unrelated calls", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const mine: number[] = [];
    const theirs: number[] = [];
    await Promise.all([
      client.call("equity/estimate", { trials: 2 }, { onProgress: (e) => mine.push(e.done) }),
      client.call("equity/estimate", { trials: 3 }, { onProgress: (e) => theirs.push(e.done) }),
    ]);
    expect(mine).toEqual([1, 2]);
    expect(theirs).toEqual([1, 2, 3]);
  });

  it("keeps the call alive when a progress subscriber throws", async () => {
    const onError = vi.fn();
    const [clientPort, serverPort] = createLoopbackPair();
    const client = new RpcClient<Topics>(clientPort, { onError });
    const server = new RpcServer<Topics>(serverPort);
    server.define("equity/estimate", estimator());

    await expect(
      client.call(
        "equity/estimate",
        { trials: 2 },
        {
          onProgress: () => {
            throw new Error("bad subscriber");
          },
        },
      ),
    ).resolves.toEqual({ equity: 0.5 });
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe("cancellation", () => {
  it("stops a streaming job, frees the worker slot, and runs the handler's finally", async () => {
    const scheduler = new Scheduler({ maxConcurrent: 1 });
    const { client, server } = pair({ scheduler });

    let cleanedUp = false;
    let chunksRun = 0;
    server.define("equity/estimate", async function* (payload, ctx) {
      try {
        for (let done = 1; done <= payload.trials; done++) {
          chunksRun++;
          expect(ctx.signal.aborted).toBe(false);
          yield { done };
        }
        return { equity: 1 };
      } finally {
        cleanedUp = true;
      }
    });
    server.define("math/add", (payload) => payload.a + payload.b);

    const progress: number[] = [];
    const controller = new AbortController();
    const pending = client.call(
      "equity/estimate",
      { trials: 10_000 },
      { priority: P1, signal: controller.signal, onProgress: (e) => progress.push(e.done) },
    );

    await until(() => progress.length >= 2);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(client.pendingCount).toBe(0);

    // The far side unwinds and releases its slot.
    await until(() => scheduler.stats.running === 0 && server.inflightCount === 0);
    expect(cleanedUp).toBe(true);
    expect(chunksRun).toBeLessThan(10_000);
    expect(scheduler.stats.cancelled).toBe(1);

    // Slot is genuinely free: the next call goes through.
    await expect(client.call("math/add", { a: 1, b: 2 })).resolves.toBe(3);
  });

  it("rejects immediately when the signal is already aborted, sending nothing", async () => {
    const [clientPort, serverPort] = createLoopbackPair();
    const posted: Message[] = [];
    serverPort.onMessage((message) => posted.push(message));
    const client = new RpcClient<Topics>(clientPort);

    const controller = new AbortController();
    controller.abort(new Error("stale"));
    await expect(
      client.call("math/add", { a: 1, b: 1 }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError);
    await Promise.resolve();
    expect(posted).toHaveLength(0);
  });

  it("cancels a named call by id, leaving others alone", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const named = client.call("equity/estimate", { trials: 10_000 }, { id: "hero-equity" });
    const other = client.call("equity/estimate", { trials: 2 });

    expect(client.cancel("hero-equity", "hero acted")).toBe(true);
    expect(client.cancel("hero-equity")).toBe(false);
    await expect(named).rejects.toThrow(/hero acted/);
    await expect(other).resolves.toEqual({ equity: 0.5 });
    await until(() => server.scheduler.stats.running === 0);
  });

  it("refuses to reuse an in-flight call id", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const first = client.call("equity/estimate", { trials: 10_000 }, { id: "dup" });
    await expect(
      client.call("equity/estimate", { trials: 1 }, { id: "dup" }),
    ).rejects.toThrow(/already in flight/);
    client.cancelAll();
    await expect(first).rejects.toBeInstanceOf(CancelledError);
    await until(() => server.scheduler.stats.running === 0);
  });

  it("drains everything on cancelAll", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const first = client.call("equity/estimate", { trials: 10_000 });
    const second = client.call("equity/estimate", { trials: 10_000 });
    expect(client.pendingCount).toBe(2);

    expect(client.cancelAll("session ended")).toBe(2);
    await expect(first).rejects.toThrow(/session ended/);
    await expect(second).rejects.toBeInstanceOf(CancelledError);
    expect(client.pendingCount).toBe(0);
    await until(() => server.scheduler.stats.running === 0);
  });

  it("cancels in-flight work when the server closes", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const pending = client.call("equity/estimate", { trials: 10_000 });
    await until(() => server.inflightCount === 1);

    server.close("worker recycled");
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    await until(() => server.scheduler.stats.running === 0);
  });

  it("rejects pending calls when the client closes", async () => {
    const { client, server } = pair();
    server.define("equity/estimate", estimator());
    const pending = client.call("equity/estimate", { trials: 10_000 });
    client.close();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(client.closed).toBe(true);
    await expect(client.call("math/add", { a: 1, b: 1 })).rejects.toThrow(/closed/);
  });

  it("raises no unhandled rejections around cancelled calls", async () => {
    const seen: unknown[] = [];
    const capture = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", capture);
    try {
      const { client, server } = pair();
      server.define("equity/estimate", estimator());

      const controller = new AbortController();
      const pending = client.call(
        "equity/estimate",
        { trials: 10_000 },
        { signal: controller.signal },
      );
      await until(() => server.inflightCount === 1);
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(CancelledError);

      // The late cancelled-response from the server must be dropped quietly.
      await until(() => server.scheduler.stats.running === 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", capture);
    }
  });
});

describe("scheduling across a live connection", () => {
  it("preempts a running P1 call when a P0 call arrives", async () => {
    const clock = new ManualClock();
    const scheduler = new Scheduler({ maxConcurrent: 1, clock });
    const { client, server } = pair({ scheduler });

    const log: string[] = [];
    server.define("equity/estimate", async function* (payload) {
      for (let done = 1; done <= payload.trials; done++) {
        log.push(`${payload.tag ?? ""}:${done}`);
        yield { done };
      }
      return { equity: payload.trials };
    });

    const settled: string[] = [];
    const prefetch = client
      .call("equity/estimate", { trials: 8, tag: "prefetch" }, { priority: P1 })
      .then((value) => {
        settled.push("prefetch");
        return value;
      });
    await until(() => log.length >= 1);
    const live = client
      .call("equity/estimate", { trials: 2, tag: "live" }, { priority: P0 })
      .then((value) => {
        settled.push("live");
        return value;
      });

    await Promise.all([prefetch, live]);

    // The urgent call jumped the queue mid-stream and finished first...
    expect(settled).toEqual(["live", "prefetch"]);
    expect(scheduler.stats.preemptions).toBe(1);
    // ...running its own chunks back to back, inside the prefetch's run.
    const first = log.indexOf("live:1");
    expect(log[first + 1]).toBe("live:2");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(log.indexOf("prefetch:8"));
    // Ordering came from priority alone: the injected clock never moved.
    expect(clock.now()).toBe(0);
  });
});

describe("transport independence", () => {
  class FakeEndpoint implements MessageEndpoint {
    peer: FakeEndpoint | null = null;
    readonly listeners = new Set<(event: { data: unknown }) => void>();

    postMessage(message: unknown): void {
      const peer = this.peer;
      // Clone at the boundary exactly like a real Worker would.
      const copy: unknown = structuredClone(message);
      if (peer !== null) queueMicrotask(() => peer.deliver(copy));
    }

    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void {
      if (type === "message") this.listeners.add(listener);
    }

    removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void {
      this.listeners.delete(listener);
    }

    deliver(data: unknown): void {
      for (const listener of [...this.listeners]) listener({ data });
    }
  }

  it("runs the same RPC over a postMessage endpoint", async () => {
    const left = new FakeEndpoint();
    const right = new FakeEndpoint();
    left.peer = right;
    right.peer = left;

    const client = new RpcClient<Topics>(new WebWorkerPort(left));
    const server = new RpcServer<Topics>(new WebWorkerPort(right));
    server.define("equity/estimate", estimator());

    const progress: number[] = [];
    await expect(
      client.call("equity/estimate", { trials: 3 }, { onProgress: (e) => progress.push(e.done) }),
    ).resolves.toEqual({ equity: 0.5 });
    expect(progress).toEqual([1, 2, 3]);
  });

  it("applies per-topic transfer lists declared in the registry", async () => {
    const registry = new TopicRegistry().register(
      defineTopic<{ bytes: Uint8Array }, { bytes: Uint8Array }>({
        topic: "echo/bytes",
        transferRequest: autoTransfer,
        transferResponse: autoTransfer,
      }),
    );
    const { client, server } = pair({ registry });
    server.define("echo/bytes", (payload) => ({ bytes: payload.bytes }));

    const bytes = Uint8Array.from([1, 2, 3]);
    const result = await client.call("echo/bytes", { bytes });
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    // The request buffer moved rather than copied.
    expect(bytes.byteLength).toBe(0);
  });
});
