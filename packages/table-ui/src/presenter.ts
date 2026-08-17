/**
 * The Presenter — a small stateful driver that plays schedules against an
 * injected clock.
 *
 * No real timers live here: the app layer supplies rAF (`tick()` samples the
 * injected `now`), and tests supply their own time (`tick(dt)` advances the
 * presenter's clock directly). The package never reads `Date.now`.
 *
 * Interrupt policy (beats.md §5.3) is `flush()`: every pending beat jumps to
 * its settled end-state, synchronously, in settle order — exactly the order
 * uninterrupted playback would have produced, so a projection built from
 * settles is identical either way. Cues that had not fired are dropped
 * (never play a sound for motion nobody saw); already-fired cues are left to
 * ring out in the audio layer.
 */

import type { HandEvent } from "@poker/history";
import type { Beat, BeatSound } from "./beats";
import { beatEnd, cueTime, shiftBeat } from "./beats";
import type { ScheduleOptions } from "./schedule";
import { schedule } from "./schedule";
import type { Speed } from "./tokens";
import { BACKLOG_GUARD_MS, nextSpeedTier } from "./tokens";

export type BeatPhase = "start" | "cue" | "settle";

export interface BeatEvent {
  readonly phase: BeatPhase;
  readonly beat: Beat;
  /** Presenter clock time at which the phase was emitted. */
  readonly at: number;
  /** Produced by `flush()` — the beat jumped rather than played. */
  readonly flushed: boolean;
  /** Present iff `phase === "cue"`. */
  readonly cue?: BeatSound;
}

export interface PresenterConfig {
  readonly onBeat: (event: BeatEvent) => void;
  /** Monotonic clock in ms (rAF timestamp / `performance.now` in the app). */
  readonly now: () => number;
  /**
   * Queued-but-unplayed backlog above which an enqueue escalates a compression
   * tier (beats.md §3). `Infinity` disables the guard. Default 1500ms.
   */
  readonly backlogGuardMs?: number;
}

/** Where an ad-hoc beat list is anchored on the presenter's timeline. */
export type BeatAnchor = "now" | "tail" | "as-is" | number;

export interface Presenter {
  /** Schedule an event burst after everything already queued. */
  enqueue(events: readonly HandEvent[], opts: ScheduleOptions): readonly Beat[];
  /** Queue pre-built beats (think pauses, banter, badges, mood shifts). */
  enqueueBeats(beats: readonly Beat[], anchor?: BeatAnchor): readonly Beat[];
  /** Advance: `tick()` samples `now()`, `tick(dt)` advances the clock by `dt`. */
  tick(dt?: number): void;
  /** Advance to an absolute presenter time (forward only). */
  seek(to: number): void;
  /** Interrupt: jump every pending beat to its settled end-state, in order. */
  flush(): void;
  /** Beats not yet settled. */
  pending(): number;
  /** Current presenter clock. */
  time(): number;
  /** Settle time of the last queued beat; `time()` when idle. */
  horizon(): number;
  /** Queued beats in schedule order — inspection for tests and devtools. */
  queued(): readonly Beat[];
}

interface Entry {
  readonly beat: Beat;
  readonly seq: number;
  readonly settleAt: number;
  started: boolean;
  settled: boolean;
  readonly cued: boolean[];
}

interface Due {
  readonly time: number;
  readonly seq: number;
  /** start = 0, cue = 1, settle = 2 — resolves ties on zero-length beats. */
  readonly rank: 0 | 1 | 2;
  readonly entry: Entry;
  readonly cueIndex?: number;
}

export function createPresenter(config: PresenterConfig): Presenter {
  const guard = config.backlogGuardMs ?? BACKLOG_GUARD_MS;
  let queue: Entry[] = [];
  let clock = config.now();
  let seq = 0;

  const emit = (phase: BeatPhase, entry: Entry, flushed: boolean, cue?: BeatSound): void => {
    config.onBeat(cue === undefined ? { phase, beat: entry.beat, at: clock, flushed } : { phase, beat: entry.beat, at: clock, flushed, cue });
  };

  const horizon = (): number => {
    let end = clock;
    for (const entry of queue) end = Math.max(end, entry.settleAt);
    return end;
  };

  const push = (beats: readonly Beat[]): void => {
    for (const beat of beats) {
      queue.push({
        beat,
        seq: seq++,
        settleAt: beatEnd(beat),
        started: false,
        settled: false,
        cued: beat.sounds.map(() => false),
      });
    }
    queue.sort((a, b) => a.beat.at - b.beat.at || a.seq - b.seq);
  };

  const advanceTo = (t: number): void => {
    clock = Math.max(clock, t);
    const due: Due[] = [];
    for (const entry of queue) {
      if (entry.settled) continue;
      if (!entry.started && entry.beat.at <= clock) {
        due.push({ time: entry.beat.at, seq: entry.seq, rank: 0, entry });
      }
      for (let k = 0; k < entry.beat.sounds.length; k++) {
        const sound = entry.beat.sounds[k];
        if (sound === undefined || entry.cued[k] === true) continue;
        const time = cueTime(entry.beat, sound);
        if (time <= clock) due.push({ time, seq: entry.seq, rank: 1, entry, cueIndex: k });
      }
      if (entry.settleAt <= clock) {
        due.push({ time: entry.settleAt, seq: entry.seq, rank: 2, entry });
      }
    }
    if (due.length === 0) return;
    due.sort((a, b) => a.time - b.time || a.seq - b.seq || a.rank - b.rank);
    for (const item of due) {
      const entry = item.entry;
      if (item.rank === 0) {
        entry.started = true;
        emit("start", entry, false);
      } else if (item.rank === 1) {
        const index = item.cueIndex ?? 0;
        const sound = entry.beat.sounds[index];
        entry.cued[index] = true;
        if (sound !== undefined) emit("cue", entry, false, sound);
      } else {
        entry.settled = true;
        emit("settle", entry, false);
      }
    }
    queue = queue.filter((entry) => !entry.settled);
  };

  return {
    enqueue(events, opts) {
      let speed: Speed = opts.speed;
      if (Number.isFinite(guard)) {
        // Backlog guard: never let animation debt accumulate (beats.md §3).
        while (horizon() - clock > guard && speed !== "instant") speed = nextSpeedTier(speed);
      }
      const beats = schedule(events, { ...opts, speed, startAt: horizon() });
      push(beats);
      return beats;
    },

    enqueueBeats(beats, anchor = "now") {
      if (beats.length === 0) return [];
      let offset = 0;
      if (anchor !== "as-is") {
        let earliest = Number.POSITIVE_INFINITY;
        for (const beat of beats) earliest = Math.min(earliest, beat.at);
        const target = anchor === "now" ? clock : anchor === "tail" ? horizon() : anchor;
        offset = target - earliest;
      }
      const placed = offset === 0 ? [...beats] : beats.map((beat) => shiftBeat(beat, offset));
      push(placed);
      return placed;
    },

    tick(dt) {
      advanceTo(dt === undefined ? config.now() : clock + dt);
    },

    seek(to) {
      advanceTo(to);
    },

    flush() {
      // Settle order matches uninterrupted playback exactly: (settleAt, seq).
      const remaining = [...queue].sort((a, b) => a.settleAt - b.settleAt || a.seq - b.seq);
      queue = [];
      for (const entry of remaining) {
        if (!entry.started) {
          entry.started = true;
          emit("start", entry, true);
        }
        entry.settled = true;
        emit("settle", entry, true);
      }
    },

    pending() {
      return queue.length;
    },

    time() {
      return clock;
    },

    horizon,

    queued() {
      return queue.map((entry) => entry.beat);
    },
  };
}
