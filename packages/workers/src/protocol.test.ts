import { describe, expect, it } from "vitest";

import {
  CancelledError,
  RpcError,
  UnknownTopicError,
  deserializeError,
  serializeError,
} from "./errors";
import type { Message } from "./protocol";
import {
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
  makeCancel,
  makeErrorResponse,
  makeEvent,
  makeRequest,
  makeResponse,
} from "./protocol";

describe("priority", () => {
  it("orders P0 before P1 before P2", () => {
    expect(P0).toBeLessThan(P1);
    expect(P1).toBeLessThan(P2);
    expect(PRIORITIES).toEqual([P0, P1, P2]);
  });

  it("guards", () => {
    expect(isPriority(0)).toBe(true);
    expect(isPriority(2)).toBe(true);
    expect(isPriority(3)).toBe(false);
    expect(isPriority("0")).toBe(false);
    expect(isPriority(undefined)).toBe(false);
  });
});

describe("envelopes", () => {
  it("builds each kind with the documented shape", () => {
    const request = makeRequest("r1", "equity/estimate", { spot: 7 }, P0);
    expect(request).toEqual({
      id: "r1",
      kind: "request",
      topic: "equity/estimate",
      payload: { spot: 7 },
      priority: P0,
    });

    const response = makeResponse("r1", "equity/estimate", 0.42, P0);
    expect(response.payload).toEqual({ ok: true, value: 0.42 });

    const failure = makeErrorResponse("r1", "equity/estimate", { name: "Error", message: "no" });
    expect(failure.payload).toEqual({ ok: false, error: { name: "Error", message: "no" } });

    const event = makeEvent("r1", "equity/estimate", { progress: 0.5 }, P0);
    expect(event.kind).toBe("event");

    expect(makeCancel("r1", "equity/estimate").payload).toEqual({});
    expect(makeCancel("r1", "equity/estimate", "superseded").payload).toEqual({
      reason: "superseded",
    });
    expect(makeCancel("r1", "equity/estimate").priority).toBe(P0);
  });

  it("defaults request/response/event priority to P1", () => {
    expect(makeRequest("r1", "t", null).priority).toBe(P1);
    expect(makeResponse("r1", "t", null).priority).toBe(P1);
    expect(makeEvent("r1", "t", null).priority).toBe(P1);
  });

  it("narrows by kind", () => {
    const messages: Message[] = [
      makeRequest("r1", "t", 1),
      makeResponse("r1", "t", 2),
      makeEvent("r1", "t", 3),
      makeCancel("r1", "t"),
    ];
    expect(messages.filter(isRequest)).toHaveLength(1);
    expect(messages.filter(isResponse)).toHaveLength(1);
    expect(messages.filter(isEvent)).toHaveLength(1);
    expect(messages.filter(isCancel)).toHaveLength(1);
  });
});

describe("isMessage", () => {
  it("accepts every well-formed envelope", () => {
    expect(isMessage(makeRequest("r1", "t", { a: 1 }, P2))).toBe(true);
    expect(isMessage(makeResponse("r1", "t", undefined))).toBe(true);
    expect(isMessage(makeErrorResponse("r1", "t", { name: "Error", message: "x" }))).toBe(true);
    expect(isMessage(makeEvent("r1", "t", undefined))).toBe(true);
    expect(isMessage(makeCancel("r1", "t", "why"))).toBe(true);
  });

  it("rejects foreign and malformed traffic", () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage("hello")).toBe(false);
    expect(isMessage({})).toBe(false);
    expect(isMessage({ id: 1, kind: "request", topic: "t", priority: P1, payload: null })).toBe(false);
    expect(isMessage({ id: "r1", kind: "nope", topic: "t", priority: P1, payload: null })).toBe(false);
    expect(isMessage({ id: "r1", kind: "request", topic: "t", priority: 9, payload: null })).toBe(false);
    // response without a usable result payload
    expect(isMessage({ id: "r1", kind: "response", topic: "t", priority: P1, payload: 5 })).toBe(false);
    expect(
      isMessage({ id: "r1", kind: "response", topic: "t", priority: P1, payload: { ok: false } }),
    ).toBe(false);
    // vite HMR-style traffic on a shared worker
    expect(isMessage({ type: "custom", event: "vite:beforeUpdate" })).toBe(false);
  });
});

describe("structuredClone round-trip", () => {
  const cases: ReadonlyArray<readonly [string, Message]> = [
    ["request", makeRequest("r1", "equity/estimate", { board: [1, 2, 3], iters: 20_000 }, P0)],
    ["response", makeResponse("r1", "equity/estimate", { equity: 0.512, iters: 20_000 }, P0)],
    ["error response", makeErrorResponse("r1", "t", { name: "RangeError", message: "bad seat" })],
    ["event", makeEvent("r1", "equity/estimate", { done: 4096, equity: 0.5 }, P1)],
    ["cancel", makeCancel("r1", "equity/estimate", "hero acted")],
  ];

  for (const [label, message] of cases) {
    it(`survives structuredClone: ${label}`, () => {
      const cloned = structuredClone(message);
      expect(cloned).toEqual(message);
      expect(cloned).not.toBe(message);
      expect(isMessage(cloned)).toBe(true);
    });
  }

  it("carries typed arrays through the clone intact", () => {
    const weights = Float32Array.from([0.25, 0.5, 0.75]);
    const message = makeRequest("r1", "ranges/filter", { weights }, P1);
    const cloned = structuredClone(message);
    expect(cloned.payload.weights).toBeInstanceOf(Float32Array);
    expect(Array.from(cloned.payload.weights)).toEqual([0.25, 0.5, 0.75]);
    expect(weights.length).toBe(3); // copied, not transferred
  });

  it("transfers buffers when a transfer list is supplied", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const message = makeResponse("r1", "eval/tables", { bytes }, P2);
    const cloned = structuredClone(message, { transfer: [bytes.buffer as ArrayBuffer] });
    const payload = cloned.payload;
    if (!payload.ok) throw new Error("expected an ok response");
    expect(Array.from(payload.value.bytes)).toEqual([1, 2, 3, 4]);
    expect(bytes.byteLength).toBe(0); // source detached
  });
});

describe("collectTransferables", () => {
  it("finds typed arrays nested in objects, arrays, maps and sets", () => {
    const a = new Uint8Array(4);
    const b = new Float32Array(2);
    const c = new ArrayBuffer(8);
    const payload = {
      nested: { a },
      list: [{ b }],
      map: new Map([["k", c]]),
      set: new Set([new Int16Array(1)]),
      plain: 5,
    };
    const found = collectTransferables(payload);
    expect(found).toContain(a.buffer);
    expect(found).toContain(b.buffer);
    expect(found).toContain(c);
    expect(found).toHaveLength(4);
  });

  it("dedupes views sharing one buffer", () => {
    const buffer = new ArrayBuffer(16);
    const payload = { lo: new Uint8Array(buffer, 0, 8), hi: new Uint8Array(buffer, 8, 8) };
    expect(collectTransferables(payload)).toEqual([buffer]);
  });

  it("is cycle-safe and returns nothing for plain data", () => {
    const cyclic: Record<string, unknown> = { n: 1 };
    cyclic.self = cyclic;
    expect(collectTransferables(cyclic)).toEqual([]);
    expect(collectTransferables({ a: 1, b: "x", c: [true, null] })).toEqual([]);
    expect(collectTransferables(null)).toEqual([]);
  });
});

describe("TopicRegistry", () => {
  const spec = defineTopic<{ deck: Uint8Array }, { equity: Float32Array }, { done: number }>({
    topic: "equity/estimate",
    transferRequest: autoTransfer,
    transferResponse: (payload) => [payload.equity.buffer as ArrayBuffer],
  });

  it("returns per-kind transfer lists", () => {
    const registry = new TopicRegistry().register(spec);
    const deck = new Uint8Array(52);
    const equity = new Float32Array(1326);

    expect(registry.transferListFor("request", "equity/estimate", { deck })).toEqual([deck.buffer]);
    expect(registry.transferListFor("response", "equity/estimate", { equity })).toEqual([
      equity.buffer,
    ]);
    // no event selector declared
    expect(registry.transferListFor("event", "equity/estimate", { done: 1 })).toBeUndefined();
    // unregistered topic
    expect(registry.transferListFor("request", "other", { deck })).toBeUndefined();
  });

  it("treats an empty list as no transfer", () => {
    const registry = new TopicRegistry().register(
      defineTopic<{ n: number }>({ topic: "t", transferRequest: autoTransfer }),
    );
    expect(registry.transferListFor("request", "t", { n: 1 })).toBeUndefined();
  });

  it("exposes registration state", () => {
    const registry = new TopicRegistry().register(spec);
    expect(registry.has("equity/estimate")).toBe(true);
    expect(registry.get("equity/estimate")?.topic).toBe("equity/estimate");
    expect(registry.has("nope")).toBe(false);
    expect(registry.get("nope")).toBeUndefined();
  });
});

describe("findUncloneable", () => {
  class Persona {
    aggression = 0.5;
  }

  it("passes clone-safe payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      1,
      "x",
      null,
      undefined,
      true,
      10n,
      new Date(0),
      /re/g,
      new Uint8Array(2),
      new ArrayBuffer(2),
      { a: [1, { b: new Map([[1, new Set([2])]]) }] },
      cyclic,
    ]) {
      expect(findUncloneable(value)).toBeNull();
      expect(isCloneable(value)).toBe(true);
    }
  });

  it("reports the path of the first offender", () => {
    expect(findUncloneable({ trace: { fn: () => 1 } })).toBe("$.trace.fn");
    expect(findUncloneable({ seats: [{ persona: new Persona() }] })).toBe("$.seats[0].persona");
    expect(findUncloneable([Symbol("s")])).toBe("$[0]");
    expect(findUncloneable(new Map([["k", () => 1]]))).toBe("$.<value 0>");
    expect(findUncloneable(new Set([() => 1]))).toBe("$.<item 0>");
  });

  it("agrees with the platform's structuredClone", () => {
    const bad = { trace: { fn: () => 1 } };
    expect(findUncloneable(bad)).not.toBeNull();
    expect(() => structuredClone(bad)).toThrow();
  });
});

describe("error wire form", () => {
  it("round-trips a plain error into an RpcError", () => {
    const wire = serializeError(new RangeError("seat 9 out of range"));
    expect(wire.name).toBe("RangeError");
    expect(wire.message).toBe("seat 9 out of range");
    expect(typeof wire.stack).toBe("string");
    expect(structuredClone(wire)).toEqual(wire);

    const rebuilt = deserializeError(wire, "engine/act");
    expect(rebuilt).toBeInstanceOf(RpcError);
    expect((rebuilt as RpcError).remote.message).toBe("seat 9 out of range");
    expect(rebuilt.message).toContain("engine/act");
  });

  it("round-trips cancellation and unknown topics into their own classes", () => {
    const cancelled = deserializeError(serializeError(new CancelledError("hero acted")), "t");
    expect(cancelled).toBeInstanceOf(CancelledError);
    expect((cancelled as CancelledError).reason).toBe("hero acted");

    const bare = deserializeError(serializeError(new CancelledError()), "t");
    expect((bare as CancelledError).reason).toBeUndefined();

    const unknown = deserializeError(serializeError(new UnknownTopicError("nope")), "nope");
    expect(unknown).toBeInstanceOf(UnknownTopicError);
  });

  it("serializes non-Error throws and can omit stacks", () => {
    expect(serializeError("boom")).toEqual({ name: "Error", message: "boom" });
    expect(serializeError({ code: 5 })).toEqual({ name: "Error", message: '{"code":5}' });
    expect(serializeError(new Error("x"), { includeStack: false }).stack).toBeUndefined();
  });
});
