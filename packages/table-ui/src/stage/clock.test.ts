// @vitest-environment jsdom
/**
 * The clock seam.
 *
 * Two properties matter and neither is obvious from the type: unsubscribing
 * *stops time* (that is what pause is, and it is why the stage needs no
 * separate pause machinery), and a frame gap is clamped rather than honoured
 * (a backgrounded tab must not teleport a hand to the river when it returns).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FRAME_MS, manualClock, rafClock } from "./clock";

/** Drive `requestAnimationFrame` by hand, one timestamp at a time. */
function fakeRaf(): { frame(at: number): void; pending(): number } {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callbacks.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    callbacks.delete(handle);
  });
  return {
    frame(at) {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of due) cb(at);
    },
    pending: () => callbacks.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("manualClock", () => {
  it("starts where it is told and only moves forward", () => {
    const clock = manualClock(500);
    expect(clock.now()).toBe(500);
    clock.advance(120);
    expect(clock.now()).toBe(620);
    clock.advance(-999);
    expect(clock.now()).toBe(620);
  });

  it("notifies every live subscriber, once per advance", () => {
    const clock = manualClock();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = clock.subscribe(a);
    clock.subscribe(b);

    clock.advance(16);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    stopA();
    clock.advance(16);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe("rafClock", () => {
  it("counts elapsed time from frame timestamps, starting at zero", () => {
    const raf = fakeRaf();
    const clock = rafClock();
    clock.subscribe(() => {});

    expect(clock.now()).toBe(0);
    raf.frame(1000); // the first frame establishes the baseline
    expect(clock.now()).toBe(0);
    raf.frame(1016);
    expect(clock.now()).toBe(16);
    raf.frame(1032);
    expect(clock.now()).toBe(32);
  });

  it("clamps a frame gap — a backgrounded tab costs one long frame, not a hand", () => {
    const raf = fakeRaf();
    const clock = rafClock();
    clock.subscribe(() => {});

    raf.frame(0);
    raf.frame(4000);
    expect(clock.now()).toBe(MAX_FRAME_MS);
  });

  it("freezes while nobody is listening — pause needs nothing else", () => {
    const raf = fakeRaf();
    const clock = rafClock();
    const stop = clock.subscribe(() => {});

    raf.frame(0);
    raf.frame(50);
    expect(clock.now()).toBe(50);

    stop();
    expect(raf.pending()).toBe(0);

    // Resuming charges nothing for the time spent paused: the first frame of a
    // fresh run is the new baseline.
    clock.subscribe(() => {});
    raf.frame(9000);
    expect(clock.now()).toBe(50);
    raf.frame(9016);
    expect(clock.now()).toBe(66);
  });
});
