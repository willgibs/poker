/**
 * Time is an input.
 *
 * Engine-side packages never read the environment clock (see CLAUDE.md), so the
 * scheduler takes a {@link Clock} instead of calling `performance.now()`. The
 * app supplies `{ now: () => performance.now() }` at the composition root; tests
 * supply a {@link ManualClock} and drive it by hand.
 *
 * There is deliberately **no** `systemClock` export here: shipping one would put
 * an environment read inside `packages/*`.
 */

/** Monotonic millisecond source. Only differences between readings matter. */
export interface Clock {
  now(): number;
}

/**
 * A clock frozen at zero.
 *
 * The scheduler's default. With it, time slices never expire, so scheduling is
 * driven purely by priority — fully deterministic, which is what tests and
 * replays want. Inject a real clock to enable time-slice fairness between jobs
 * of equal priority.
 */
export const ZERO_CLOCK: Clock = { now: () => 0 };

/** A clock the caller advances explicitly. */
export class ManualClock implements Clock {
  #t: number;

  constructor(start = 0) {
    this.#t = start;
  }

  now(): number {
    return this.#t;
  }

  /** Move the clock forward by `ms` (must be >= 0). */
  advance(ms: number): number {
    if (ms < 0) throw new RangeError("ManualClock.advance: ms must be >= 0");
    this.#t += ms;
    return this.#t;
  }

  /** Jump to an absolute reading (must not go backwards). */
  set(t: number): void {
    if (t < this.#t) throw new RangeError("ManualClock.set: clock must be monotonic");
    this.#t = t;
  }
}
