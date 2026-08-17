import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { HandEvent } from "@poker/history";
import type { Beat } from "./beats";
import { beatEnd } from "./beats";
import type { BeatEvent } from "./presenter";
import { createPresenter } from "./presenter";
import { schedule, scheduleBadgeGlint, scheduleThink } from "./schedule";
import type { Speed } from "./tokens";
import { SCRIPTED_HAND, SCRIPTED_HERO, applySettled, emptyProjection, lcg, projectionRecorder, randomHand } from "./test-helpers";

const OPTS = { speed: 1 as Speed, reduceMotion: false, heroSeat: SCRIPTED_HERO };

function recorder(): { events: BeatEvent[]; onBeat: (event: BeatEvent) => void } {
  const events: BeatEvent[] = [];
  return { events, onBeat: (event) => events.push(event) };
}

/** A presenter driven purely by `tick(dt)`; `now` is never consulted. */
function harness(config: { onBeat: (event: BeatEvent) => void; guard?: number }) {
  return createPresenter({
    onBeat: config.onBeat,
    now: () => 0,
    ...(config.guard === undefined ? {} : { backlogGuardMs: config.guard }),
  });
}

describe("playback", () => {
  it("emits start → cue → settle per beat, in time order", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.enqueue(SCRIPTED_HAND, OPTS);
    presenter.tick(1_000_000);

    const beats = schedule(SCRIPTED_HAND, { ...OPTS, startAt: 0 });
    expect(rec.events.filter((e) => e.phase === "start")).toHaveLength(beats.length);
    expect(rec.events.filter((e) => e.phase === "settle")).toHaveLength(beats.length);
    expect(rec.events.filter((e) => e.phase === "cue")).toHaveLength(
      beats.reduce((n, b) => n + b.sounds.length, 0),
    );
    // Each beat's own phases stay ordered.
    const seen = new Map<Beat, string[]>();
    for (const event of rec.events) seen.set(event.beat, [...(seen.get(event.beat) ?? []), event.phase]);
    for (const phases of seen.values()) {
      expect(phases[0]).toBe("start");
      expect(phases.at(-1)).toBe("settle");
    }
    expect(presenter.pending()).toBe(0);
  });

  it("holds a beat until its start time and settles it at its end", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const [beat] = presenter.enqueueBeats(scheduleThink(4, 1000, { speed: 1, reduceMotion: false }));
    expect(beat?.at).toBe(0);
    expect(presenter.pending()).toBe(1);

    presenter.tick(0);
    expect(rec.events.map((e) => e.phase)).toEqual(["start"]);
    presenter.tick(999);
    expect(rec.events.map((e) => e.phase)).toEqual(["start"]);
    presenter.tick(1);
    expect(rec.events.map((e) => e.phase)).toEqual(["start", "settle"]);
    expect(presenter.pending()).toBe(0);
  });

  it("fires cues at their progress point, not at launch", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const events: HandEvent[] = [{ t: "act", seat: 2, kind: "bet", amount: 300 }];
    const beat = presenter.enqueue(events, OPTS).find((b) => b.kind === "chips-out");
    // The chip cue lands at 70% of travel — impact timing, not launch.
    const cueAt = (beat?.at ?? 0) + (beat?.duration ?? 0) * 0.7;

    presenter.tick(Math.floor(cueAt) - 1);
    expect(rec.events.some((e) => e.phase === "cue")).toBe(false);
    presenter.tick(2);
    // A bet into an empty pot is the overbet tier by the ladder's own ratio.
    expect(rec.events.filter((e) => e.phase === "cue").map((e) => e.cue?.cue)).toEqual(["chip_allin"]);
  });

  it("samples the injected clock when tick() is called with no delta", () => {
    let now = 0;
    const rec = recorder();
    const presenter = createPresenter({ onBeat: rec.onBeat, now: () => now });
    presenter.enqueueBeats(scheduleThink(1, 500, { speed: 1, reduceMotion: false }));
    presenter.tick();
    expect(rec.events).toHaveLength(1);
    now = 600;
    presenter.tick();
    expect(rec.events.map((e) => e.phase)).toEqual(["start", "settle"]);
    expect(presenter.time()).toBe(600);
  });

  it("seeks forward through whole phases at once", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.enqueue(SCRIPTED_HAND, OPTS);
    const end = presenter.horizon();
    presenter.seek(end);
    expect(presenter.pending()).toBe(0);
    expect(presenter.time()).toBe(end);
  });

  it("never rewinds", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.tick(1000);
    presenter.seek(10);
    expect(presenter.time()).toBe(1000);
  });
});

describe("flush — the interrupt policy (beats.md §5.3)", () => {
  it("settles everything pending, synchronously, and empties the queue", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const beats = presenter.enqueue(SCRIPTED_HAND, OPTS);
    presenter.tick(2000);
    const before = rec.events.filter((e) => e.phase === "settle").length;
    presenter.flush();
    const after = rec.events.filter((e) => e.phase === "settle").length;
    expect(after).toBe(beats.length);
    expect(after).toBeGreaterThan(before);
    expect(presenter.pending()).toBe(0);
    expect(rec.events.filter((e) => e.flushed).every((e) => e.phase !== "cue")).toBe(true);
  });

  it("drops unfired cues but keeps the ones already heard", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const events: HandEvent[] = [
      { t: "act", seat: 2, kind: "bet", amount: 300 },
      { t: "act", seat: 4, kind: "call", amount: 300 },
    ];
    const beats = presenter.enqueue(events, OPTS);
    const first = beats.find((b) => b.kind === "chips-out");
    presenter.tick((first?.at ?? 0) + (first?.duration ?? 0)); // cue 1 heard, cue 2 not
    const heard = rec.events.filter((e) => e.phase === "cue").length;
    expect(heard).toBe(1);
    presenter.flush();
    expect(rec.events.filter((e) => e.phase === "cue")).toHaveLength(heard);
  });

  it("starts beats that never began before settling them", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.enqueue(SCRIPTED_HAND, OPTS);
    presenter.flush();
    const starts = rec.events.filter((e) => e.phase === "start");
    const settles = rec.events.filter((e) => e.phase === "settle");
    expect(starts).toHaveLength(settles.length);
    expect(starts.every((e) => e.flushed)).toBe(true);
  });

  it("lands on the same settled state as full playback, from any frame (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fffffff }),
        fc.constantFrom<Speed>(0.5, 1, 2, 3, "instant"),
        fc.boolean(),
        fc.integer({ min: 0, max: 0x7fffffff }),
        (seed, speed, reduceMotion, interruptSeed) => {
          const events = randomHand(seed);
          const opts = { speed, reduceMotion, heroSeat: 0 };

          // Uninterrupted playback.
          const full = projectionRecorder();
          const a = harness({ onBeat: full.onBeat });
          a.enqueue(events, opts);
          a.tick(a.horizon() + 1);

          // Interrupted at a random frame, then flushed.
          const cut = projectionRecorder();
          const b = harness({ onBeat: cut.onBeat });
          const beats = b.enqueue(events, opts);
          const span = Math.max(1, ...beats.map(beatEnd));
          const t = Math.floor(lcg(interruptSeed)() * span);
          b.tick(t);
          b.flush();

          expect(cut.projection).toEqual(full.projection);
          expect(b.pending()).toBe(0);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("matches the settle order of a schedule applied directly (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (seed) => {
        const events = randomHand(seed);
        const opts = { speed: 1 as Speed, reduceMotion: false, heroSeat: 0 };
        const rec = projectionRecorder();
        const presenter = harness({ onBeat: rec.onBeat });
        presenter.enqueue(events, opts);
        presenter.flush();

        const direct = emptyProjection();
        for (const beat of [...schedule(events, opts)].sort((x, y) => beatEnd(x) - beatEnd(y))) {
          applySettled(direct, beat);
        }
        expect(rec.projection).toEqual(direct);
      }),
      { numRuns: 150 },
    );
  });

  it("flushing an empty queue is a no-op", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.flush();
    expect(rec.events).toEqual([]);
    expect(presenter.pending()).toBe(0);
  });
});

describe("enqueue during playback", () => {
  it("appends after the tail without reordering committed beats", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const first = presenter.enqueue(SCRIPTED_HAND, OPTS);
    const firstTimes = first.map((b) => b.at);
    presenter.tick(1500);

    const second = presenter.enqueue(SCRIPTED_HAND, OPTS);
    expect(first.map((b) => b.at)).toEqual(firstTimes); // committed beats untouched
    const firstEnd = Math.max(...first.map(beatEnd));
    expect(Math.min(...second.map((b) => b.at))).toBeGreaterThanOrEqual(firstEnd);

    presenter.tick(1_000_000);
    const settles = rec.events.filter((e) => e.phase === "settle").map((e) => e.beat);
    expect(settles).toHaveLength(first.length + second.length);
    // Every beat of hand 1 settles before every beat of hand 2.
    const lastOfFirst = settles.findLastIndex((b) => first.includes(b));
    const firstOfSecond = settles.findIndex((b) => second.includes(b));
    expect(lastOfFirst).toBeLessThan(firstOfSecond);
  });

  it("anchors ad-hoc beats to now, the tail, or their own times", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.enqueue(SCRIPTED_HAND, OPTS);
    presenter.tick(500);
    const tail = presenter.horizon();

    const [now] = presenter.enqueueBeats(scheduleBadgeGlint({ speed: 1, reduceMotion: false }), "now");
    expect(now?.at).toBe(500);
    const [atTail] = presenter.enqueueBeats(scheduleBadgeGlint({ speed: 1, reduceMotion: false }), "tail");
    expect(atTail?.at).toBe(tail);
    const [asIs] = presenter.enqueueBeats(scheduleThink(2, 900, { speed: 1, reduceMotion: false, startAt: 42 }), "as-is");
    expect(asIs?.at).toBe(42);
    const [fixed] = presenter.enqueueBeats(scheduleThink(2, 900, { speed: 1, reduceMotion: false }), 12_345);
    expect(fixed?.at).toBe(12_345);
  });

  it("keeps ambient beats from delaying anything", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const hand = presenter.enqueue(SCRIPTED_HAND, OPTS);
    const before = Math.max(...hand.map(beatEnd));
    presenter.enqueueBeats(scheduleBadgeGlint({ speed: 1, reduceMotion: false }), "now");
    const next = presenter.enqueue(SCRIPTED_HAND, OPTS);
    expect(Math.min(...next.map((b) => b.at))).toBeGreaterThanOrEqual(before);
  });

  it("escalates a compression tier when the backlog runs away (beats.md §3)", () => {
    const rec = recorder();
    const presenter = harness({ onBeat: rec.onBeat, guard: 1500 });
    presenter.enqueue(SCRIPTED_HAND, OPTS); // many seconds of beats at 1x
    expect(presenter.horizon()).toBeGreaterThan(1500);

    const second = presenter.enqueue(SCRIPTED_HAND, OPTS);
    // Tier 1+ merges the two-card deal into one sprite per seat.
    const deal = second.filter((b) => b.kind === "deal-hole");
    expect(deal.every((b) => b.kind === "deal-hole" && b.meta.pass === "merged")).toBe(true);
    expect(deal.length).toBeLessThan(12);
  });

  it("leaves the schedule alone when the guard is disabled", () => {
    const rec = recorder();
    const presenter = harness({ onBeat: rec.onBeat, guard: Number.POSITIVE_INFINITY });
    presenter.enqueue(SCRIPTED_HAND, OPTS);
    const second = presenter.enqueue(SCRIPTED_HAND, OPTS);
    expect(second.filter((b) => b.kind === "deal-hole")).toHaveLength(12);
  });
});

describe("bookkeeping", () => {
  it("counts pending beats down to zero", () => {
    const rec = recorder();
    const presenter = harness(rec);
    const beats = presenter.enqueue(SCRIPTED_HAND, OPTS);
    expect(presenter.pending()).toBe(beats.length);
    expect(presenter.queued()).toHaveLength(beats.length);
    presenter.tick(presenter.horizon());
    expect(presenter.pending()).toBe(0);
    expect(presenter.queued()).toEqual([]);
  });

  it("reports a horizon of `now` when idle", () => {
    const rec = recorder();
    const presenter = harness(rec);
    presenter.tick(750);
    expect(presenter.horizon()).toBe(750);
  });

  it("accepts an empty enqueue", () => {
    const rec = recorder();
    const presenter = harness(rec);
    expect(presenter.enqueue([], OPTS)).toEqual([]);
    expect(presenter.enqueueBeats([])).toEqual([]);
    expect(presenter.pending()).toBe(0);
  });
});
