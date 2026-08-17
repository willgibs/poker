import { describe, expect, it, vi } from "vitest";

import { PortClosedError } from "./errors";
import type { MessageEndpoint, MessageListener } from "./port";
import { LoopbackPort, WebWorkerPort, createLoopbackPair, createWebWorkerPort } from "./port";
import type { Message } from "./protocol";
import { P0, P1, makeEvent, makeRequest, makeResponse } from "./protocol";

/**
 * A `Worker` must satisfy {@link MessageEndpoint} without any adapter code —
 * this is the compile-time half of "it will work in the browser". The runtime
 * half is exercised below with a fake endpoint.
 */
export type WorkerIsAnEndpoint = Worker extends MessageEndpoint ? true : never;
export type MessagePortIsAnEndpoint = MessagePort extends MessageEndpoint ? true : never;

const inbox = (): { readonly messages: Message[]; readonly listener: MessageListener } => {
  const messages: Message[] = [];
  return { messages, listener: (message) => messages.push(message) };
};

describe("LoopbackPort", () => {
  it("delivers on a microtask by default, never synchronously", async () => {
    const [client, server] = createLoopbackPair();
    const received = inbox();
    server.onMessage(received.listener);

    client.post(makeRequest("r1", "t", { n: 1 }));
    expect(received.messages).toHaveLength(0);

    await Promise.resolve();
    expect(received.messages).toHaveLength(1);
    expect(received.messages[0]?.id).toBe("r1");
  });

  it("delivers synchronously when asked", () => {
    const [client, server] = createLoopbackPair({ delivery: "sync" });
    const received = inbox();
    server.onMessage(received.listener);

    client.post(makeRequest("r1", "t", 1));
    expect(received.messages).toHaveLength(1);
  });

  it("preserves order in both directions", async () => {
    const [client, server] = createLoopbackPair();
    const atServer = inbox();
    const atClient = inbox();
    server.onMessage(atServer.listener);
    client.onMessage(atClient.listener);

    for (let i = 0; i < 5; i++) client.post(makeRequest(`r${i}`, "t", i));
    for (let i = 0; i < 3; i++) server.post(makeEvent("r0", "t", i));

    await Promise.resolve();
    expect(atServer.messages.map((m) => m.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    expect(atClient.messages.map((m) => m.payload)).toEqual([0, 1, 2]);
  });

  it("buffers messages that arrive before a listener attaches", async () => {
    const [client, server] = createLoopbackPair();
    client.post(makeRequest("r1", "t", 1));
    client.post(makeRequest("r2", "t", 2));
    await Promise.resolve();
    expect(server.bufferedCount).toBe(2);

    const received = inbox();
    server.onMessage(received.listener);
    await Promise.resolve();
    expect(received.messages.map((m) => m.id)).toEqual(["r1", "r2"]);
    expect(server.bufferedCount).toBe(0);
  });

  it("stops delivering after unsubscribe", async () => {
    const [client, server] = createLoopbackPair();
    const received = inbox();
    const off = server.onMessage(received.listener);

    client.post(makeRequest("r1", "t", 1));
    await Promise.resolve();
    off();
    client.post(makeRequest("r2", "t", 2));
    await Promise.resolve();
    expect(received.messages.map((m) => m.id)).toEqual(["r1"]);
  });

  it("clones by default, so the receiver cannot observe later mutations", async () => {
    const [client, server] = createLoopbackPair();
    const received = inbox();
    server.onMessage(received.listener);

    const payload = { seats: [1, 2, 3] };
    client.post(makeRequest("r1", "t", payload));
    payload.seats.push(4);

    await Promise.resolve();
    const delivered = received.messages[0];
    expect(delivered?.payload).toEqual({ seats: [1, 2, 3] });
    expect(delivered?.payload).not.toBe(payload);
  });

  it("rejects payloads that would not survive the real boundary", () => {
    const [client] = createLoopbackPair();
    expect(() => client.post(makeRequest("r1", "t", { fn: () => 1 }))).toThrow();
  });

  it("shares objects when cloning is disabled", async () => {
    const [client, server] = createLoopbackPair({ clone: false });
    const received = inbox();
    server.onMessage(received.listener);

    const message = makeRequest("r1", "t", { seats: [1] });
    client.post(message);
    await Promise.resolve();
    expect(received.messages[0]).toBe(message);
  });

  it("honours transfer lists by detaching the sender's buffer", async () => {
    const [client, server] = createLoopbackPair();
    const received = inbox();
    server.onMessage(received.listener);

    const bytes = Uint8Array.from([9, 8, 7]);
    client.post(makeResponse("r1", "eval/tables", { bytes }), [bytes.buffer as ArrayBuffer]);
    await Promise.resolve();

    const payload = received.messages[0]?.payload as { ok: true; value: { bytes: Uint8Array } };
    expect(Array.from(payload.value.bytes)).toEqual([9, 8, 7]);
    expect(bytes.byteLength).toBe(0);
  });

  it("reports listener exceptions instead of breaking the pump", async () => {
    const onError = vi.fn();
    const [client, server] = createLoopbackPair({ onError });
    const received = inbox();
    server.onMessage(() => {
      throw new Error("bad listener");
    });
    server.onMessage(received.listener);

    client.post(makeRequest("r1", "t", 1));
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(received.messages).toHaveLength(1);
  });

  it("closes both ends and refuses further posts", () => {
    const [client, server] = createLoopbackPair();
    client.close();
    expect(client.closed).toBe(true);
    expect(server.closed).toBe(true);
    expect(() => client.post(makeRequest("r1", "t", 1))).toThrow(PortClosedError);
  });

  it("refuses to post when unconnected", () => {
    const orphan = new LoopbackPort();
    expect(() => orphan.post(makeRequest("r1", "t", 1))).toThrow(/not connected/);
  });
});

/** Minimal stand-in for `Worker` / `self` / `MessagePort`. */
class FakeEndpoint implements MessageEndpoint {
  peer: FakeEndpoint | null = null;
  readonly listeners = new Set<(event: { data: unknown }) => void>();
  readonly posted: Array<{ message: unknown; transfer: Transferable[] | undefined }> = [];

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
    const peer = this.peer;
    if (peer !== null) queueMicrotask(() => peer.deliver(message));
  }

  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }

  /** Simulate an inbound message from the other side. */
  deliver(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data });
  }
}

describe("WebWorkerPort", () => {
  it("forwards posts to the endpoint, with and without a transfer list", () => {
    const endpoint = new FakeEndpoint();
    const port = createWebWorkerPort(endpoint);

    const plain = makeRequest("r1", "t", { n: 1 }, P0);
    port.post(plain);
    expect(endpoint.posted[0]).toEqual({ message: plain, transfer: undefined });

    const bytes = new Uint8Array(4);
    const withBuffer = makeRequest("r2", "t", { bytes }, P1);
    port.post(withBuffer, [bytes.buffer as ArrayBuffer]);
    expect(endpoint.posted[1]?.transfer).toEqual([bytes.buffer]);
    // an empty list is elided rather than posted
    port.post(plain, []);
    expect(endpoint.posted[2]?.transfer).toBeUndefined();
  });

  it("dispatches inbound protocol messages to every listener", () => {
    const endpoint = new FakeEndpoint();
    const port = new WebWorkerPort(endpoint);
    const a = inbox();
    const b = inbox();
    port.onMessage(a.listener);
    const offB = port.onMessage(b.listener);

    endpoint.deliver(makeResponse("r1", "t", 42));
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(1);

    offB();
    endpoint.deliver(makeResponse("r2", "t", 43));
    expect(a.messages).toHaveLength(2);
    expect(b.messages).toHaveLength(1);
  });

  it("routes foreign traffic aside instead of to listeners", () => {
    const onForeign = vi.fn();
    const endpoint = new FakeEndpoint();
    const port = new WebWorkerPort(endpoint, { onForeign });
    const received = inbox();
    port.onMessage(received.listener);

    endpoint.deliver({ type: "vite:beforeUpdate" });
    endpoint.deliver("hello");
    expect(received.messages).toHaveLength(0);
    expect(onForeign).toHaveBeenCalledTimes(2);
  });

  it("reports listener exceptions", () => {
    const onError = vi.fn();
    const endpoint = new FakeEndpoint();
    const port = new WebWorkerPort(endpoint, { onError });
    port.onMessage(() => {
      throw new Error("bad listener");
    });
    endpoint.deliver(makeResponse("r1", "t", 1));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("detaches from the endpoint on close without terminating it", () => {
    const endpoint = new FakeEndpoint();
    const port = new WebWorkerPort(endpoint);
    const received = inbox();
    port.onMessage(received.listener);
    expect(endpoint.listeners.size).toBe(1);

    port.close();
    expect(port.closed).toBe(true);
    expect(endpoint.listeners.size).toBe(0);
    endpoint.deliver(makeResponse("r1", "t", 1));
    expect(received.messages).toHaveLength(0);
    expect(() => port.post(makeRequest("r1", "t", 1))).toThrow(PortClosedError);
  });

  it("carries a full exchange between two wired endpoints", async () => {
    const left = new FakeEndpoint();
    const right = new FakeEndpoint();
    left.peer = right;
    right.peer = left;

    const leftPort = new WebWorkerPort(left);
    const rightPort = new WebWorkerPort(right);
    const atRight = inbox();
    const atLeft = inbox();
    rightPort.onMessage((message) => {
      atRight.listener(message);
      rightPort.post(makeResponse(message.id, message.topic, "pong"));
    });
    leftPort.onMessage(atLeft.listener);

    leftPort.post(makeRequest("r1", "ping", null));
    await Promise.resolve();
    await Promise.resolve();

    expect(atRight.messages.map((m) => m.kind)).toEqual(["request"]);
    expect(atLeft.messages[0]?.payload).toEqual({ ok: true, value: "pong" });
  });
});
