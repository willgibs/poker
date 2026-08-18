/**
 * The stage's clock seam.
 *
 * The Presenter is headless and takes time as an input (`presenter.ts`); this
 * is the one place in the package that a real frame loop is allowed to exist,
 * and it is injectable so tests never wait for one. Two adapters ship:
 *
 *   - `rafClock()` — production. Drives from `requestAnimationFrame`'s own
 *     timestamp, never `Date.now()` / `performance.now()`, and accumulates a
 *     *virtual* elapsed time. Two consequences fall out for free: unsubscribing
 *     freezes the clock (that is what pause is), and a backgrounded tab that
 *     resumes with a 4-second frame gap advances by one clamped frame instead
 *     of teleporting the hand to the river.
 *   - `manualClock()` — tests. `advance(dt)` is the whole API.
 */

/** What `TableStage` needs from a clock: a reading, and a heartbeat. */
export interface StageClock {
  /** Monotonic elapsed ms. Starts at 0 and only ever moves forward. */
  now(): number;
  /** Subscribe to frames. Returns the unsubscribe. */
  subscribe(onFrame: () => void): () => void;
}

/** A clock a test drives by hand. */
export interface ManualClock extends StageClock {
  /** Move time forward by `dt` ms and notify every subscriber once. */
  advance(dt: number): void;
}

/**
 * The longest single frame the clock will admit, ms.
 *
 * A backgrounded tab hands back a frame delta of seconds. Honouring it would
 * flush a hand's worth of beats into one paint; clamping turns the gap into a
 * long frame, and the Presenter's own backlog guard (beats.md §3) handles the
 * rest by compressing.
 */
export const MAX_FRAME_MS = 100;

export function rafClock(): StageClock {
  let elapsed = 0;
  let last: number | null = null;
  let frame: number | null = null;
  const subscribers = new Set<() => void>();

  const step = (timestamp: number): void => {
    frame = null;
    const previous = last;
    last = timestamp;
    if (previous !== null) {
      elapsed += Math.min(Math.max(0, timestamp - previous), MAX_FRAME_MS);
    }
    // Snapshot: a subscriber may unsubscribe from inside its own callback.
    for (const onFrame of [...subscribers]) onFrame();
    if (subscribers.size > 0) frame = requestAnimationFrame(step);
  };

  return {
    now: () => elapsed,
    subscribe(onFrame) {
      subscribers.add(onFrame);
      if (frame === null) {
        // A fresh run of frames: the first delta is 0, so resuming after a
        // pause never charges the hand for the time it spent paused.
        last = null;
        frame = requestAnimationFrame(step);
      }
      return () => {
        subscribers.delete(onFrame);
        if (subscribers.size === 0 && frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
          last = null;
        }
      };
    },
  };
}

export function manualClock(start = 0): ManualClock {
  let elapsed = start;
  const subscribers = new Set<() => void>();

  return {
    now: () => elapsed,
    subscribe(onFrame) {
      subscribers.add(onFrame);
      return () => {
        subscribers.delete(onFrame);
      };
    },
    advance(dt) {
      elapsed += Math.max(0, dt);
      for (const onFrame of [...subscribers]) onFrame();
    },
  };
}
