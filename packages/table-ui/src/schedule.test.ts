import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { HandEvent } from "@poker/history";
import type { Beat, BeatKind, BeatOf } from "./beats";
import { hasTranslation } from "./beats";
import { schedule, scheduleBadgeGlint, scheduleBanter, scheduleMoodShift, scheduleThink, thinkDuration } from "./schedule";
import {
  DURATION,
  SPEEDS,
  THINK_FLOOR_MS,
  compressionTier,
  isInstant,
  nextSpeedTier,
  resolveDuration,
  resolveStagger,
  type Speed,
} from "./tokens";
import { SCRIPTED_HAND, SCRIPTED_HERO, card, randomHand } from "./test-helpers";

function opts(speed: Speed, reduceMotion = false): { speed: Speed; reduceMotion: boolean; heroSeat: number } {
  return { speed, reduceMotion, heroSeat: SCRIPTED_HERO };
}

function of<K extends BeatKind>(beats: readonly Beat[], kind: K): BeatOf<K>[] {
  return beats.filter((b): b is BeatOf<K> => b.kind === kind);
}

const DEAL_ONLY: readonly HandEvent[] = [
  {
    t: "start",
    handNumber: 1,
    button: 0,
    seats: [0, 1, 2].map((seat) => ({ seat, stack: 10_000 })),
    blinds: { sb: 25, bb: 50, ante: 0 },
  },
  { t: "hole", seat: 0, cards: [card("As"), card("Ks")] },
  { t: "hole", seat: 1, cards: [card("2c"), card("3c")] },
  { t: "hole", seat: 2, cards: [card("7d"), card("8d")] },
];

describe("token law", () => {
  it("scales PACED durations by 1/S, clamped to [floor, 2x base]", () => {
    const spec = { base: 220, floor: 90 };
    expect(resolveDuration(spec, 0.5, false)).toBe(440); // the clamp ceiling
    expect(resolveDuration(spec, 1, false)).toBe(220);
    expect(resolveDuration(spec, 2, false)).toBe(110);
    expect(resolveDuration(spec, 3, false)).toBe(90); // tier-2 collapses to floor
    expect(resolveDuration(spec, "instant", false)).toBe(0);
  });

  it("keeps staggers but halves/zeroes them per tier", () => {
    expect(SPEEDS.map((s) => resolveStagger(DURATION.stagger, s))).toEqual([80, 40, 20, 0, 0]);
  });

  it("rounds the 2x stagger half-up for an odd base", () => {
    expect(resolveStagger(61, 2)).toBe(31); // 30.5 -> 31
    expect(resolveStagger(63, 2)).toBe(32); // 31.5 -> 32
    expect(resolveStagger(60, 2)).toBe(30); // exact half already
  });

  it("resolveStagger property: 0.5x doubles, 1x is base, 2x halves+rounds, 3x/instant are simultaneous", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (base) => {
        expect(resolveStagger(base, 0.5)).toBe(base * 2);
        expect(resolveStagger(base, 1)).toBe(base);
        expect(resolveStagger(base, 2)).toBe(Math.round(base / 2));
        expect(resolveStagger(base, 3)).toBe(0);
        expect(resolveStagger(base, "instant")).toBe(0);
      }),
    );
  });

  it("swaps in rmBase under reduce-motion, and the clamp ceiling follows rmBase too", () => {
    const spec = { base: 220, floor: 90, rmBase: 150 };
    expect(resolveDuration(spec, 1, true)).toBe(150); // rmBase, not base
    expect(resolveDuration(spec, 0.5, true)).toBe(300); // ceiling is 2x *rmBase*
    expect(resolveDuration(spec, 0.5, false)).toBe(440); // non-RM ceiling is 2x base, unaffected
  });

  it("falls back to base under reduce-motion when no rmBase is declared", () => {
    const spec = { base: 220, floor: 90 };
    expect(resolveDuration(spec, 1, true)).toBe(220);
  });

  it("ignores an explicit at2x override under reduce-motion, using the rmBase clamp instead", () => {
    const spec = { base: 400, floor: 90, at2x: 160, rmBase: 200 };
    expect(resolveDuration(spec, 2, false)).toBe(160); // the override applies without RM
    expect(resolveDuration(spec, 2, true)).toBe(100); // RM: round(rmBase / 2), override skipped
  });

  it("collapse3x (default true) floors at 3x regardless of reduce-motion or rmBase", () => {
    const spec = { base: 220, floor: 90, rmBase: 150 };
    expect(resolveDuration(spec, 3, false)).toBe(90);
    expect(resolveDuration(spec, 3, true)).toBe(90);
  });

  it("collapse3x: false clamps at 3x from (rm)base/3 instead of flooring", () => {
    const spec = { base: 220, floor: 20, rmBase: 150, collapse3x: false };
    expect(resolveDuration(spec, 3, false)).toBe(73); // round(220 / 3)
    expect(resolveDuration(spec, 3, true)).toBe(50); // round(150 / 3), rmBase applies here too
  });

  it("atInstant is the same with or without reduce-motion — instant resolves before the RM branch", () => {
    const spec = { base: 220, floor: 90, rmBase: 150, atInstant: 120 };
    expect(resolveDuration(spec, "instant", true)).toBe(120);
    expect(resolveDuration(spec, "instant", false)).toBe(120);
  });

  it("maps speed to its compression tier (beats.md §3)", () => {
    expect(SPEEDS.map(compressionTier)).toEqual([0, 0, 1, 2, 3]);
  });

  it("walks the speed ladder one rung at a time, terminating at instant", () => {
    expect(nextSpeedTier(0.5)).toBe(1);
    expect(nextSpeedTier(1)).toBe(2);
    expect(nextSpeedTier(2)).toBe(3);
    expect(nextSpeedTier(3)).toBe("instant");
    expect(nextSpeedTier("instant")).toBe("instant"); // terminal
  });

  it("isInstant is true only for the instant speed", () => {
    expect(SPEEDS.map(isInstant)).toEqual([false, false, false, false, true]);
  });
});

describe("deal hole", () => {
  it("deals two passes, one beat per card, staggered 40ms at 1x", () => {
    const beats = of(schedule(DEAL_ONLY, opts(1)), "deal-hole");
    expect(beats).toHaveLength(6);
    expect(beats.map((b) => b.at)).toEqual([0, 40, 80, 120, 160, 200]);
    expect(beats.map((b) => b.meta.pass)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(beats.every((b) => b.duration === 220)).toBe(true);
    expect(beats.every((b) => b.meta.deliveries[0]?.cards.length === 1)).toBe(true);
  });

  it("doubles the stagger and hits the clamp ceiling at 0.5x", () => {
    const beats = of(schedule(DEAL_ONLY, opts(0.5)), "deal-hole");
    expect(beats).toHaveLength(6);
    expect(beats.map((b) => b.at)).toEqual([0, 80, 160, 240, 320, 400]); // 40ms stagger doubled
    expect(beats.every((b) => b.duration === 440)).toBe(true); // the clamp ceiling (2x base)
  });

  it("merges to one two-card sprite per seat at 2x (tier 1)", () => {
    const beats = of(schedule(DEAL_ONLY, opts(2)), "deal-hole");
    expect(beats).toHaveLength(3);
    expect(beats.map((b) => b.at)).toEqual([0, 20, 40]);
    expect(beats.every((b) => b.meta.pass === "merged")).toBe(true);
    expect(beats.every((b) => b.meta.deliveries[0]?.cards.length === 2)).toBe(true);
  });

  it("becomes one group beat at 3x and instant (tier 2+)", () => {
    for (const speed of [3, "instant"] as const) {
      const beats = of(schedule(DEAL_ONLY, opts(speed)), "deal-hole");
      expect(beats).toHaveLength(1);
      expect(beats[0]?.meta.grouped).toBe(true);
      expect(beats[0]?.meta.deliveries).toHaveLength(3);
      expect(beats[0]?.duration).toBe(speed === 3 ? 90 : 0);
    }
  });

  it("flattens the travel arc from tier 1 up", () => {
    expect(of(schedule(DEAL_ONLY, opts(1)), "deal-hole")[0]?.meta.arcPx).toBe(12);
    expect(of(schedule(DEAL_ONLY, opts(2)), "deal-hole")[0]?.meta.arcPx).toBe(0);
  });

  it("flips hero's cards only after hero's second card lands", () => {
    const beats = schedule(DEAL_ONLY, { speed: 1, reduceMotion: false, heroSeat: 1 });
    const holes = of(beats, "deal-hole");
    const heroSecond = holes.find((b) => b.meta.pass === 2 && b.meta.deliveries[0]?.seat === 1);
    const flips = of(beats, "reveal").filter((b) => b.meta.source === "hero");
    expect(heroSecond).toBeDefined();
    expect(flips).toHaveLength(2);
    expect(flips[0]?.at).toBe((heroSecond?.at ?? 0) + (heroSecond?.duration ?? 0));
    expect(flips[1]?.at).toBe((flips[0]?.at ?? 0) + DURATION.micro);
    expect(flips.every((f) => f.duration === DURATION.fast)).toBe(true);
  });

  it("emits no hero flip when hero is not seated in the burst", () => {
    const beats = schedule(DEAL_ONLY, { speed: 1, reduceMotion: false });
    expect(of(beats, "reveal")).toHaveLength(0);
  });
});

describe("deal board", () => {
  const flop: readonly HandEvent[] = [{ t: "board", street: "flop", cards: [card("Kc"), card("9d"), card("2h")] }];
  const river: readonly HandEvent[] = [{ t: "board", street: "river", cards: [card("Js")] }];

  it("slides then flips at 1x, landing the flop at ~700ms", () => {
    const beats = schedule(flop, opts(1));
    const slides = of(beats, "deal-board");
    const flips = of(beats, "reveal");
    expect(slides.map((b) => b.at)).toEqual([0, 60, 120]);
    expect(slides.every((b) => b.duration === 200 && b.meta.form === "slide")).toBe(true);
    expect(flips.map((b) => b.at)).toEqual([320, 400, 480]);
    expect(flips.every((b) => b.duration === 250)).toBe(true);
    const total = Math.max(...beats.map((b) => b.at + b.duration));
    expect(total).toBe(730);
  });

  it("gives the river flip its extra 40ms of gravitas", () => {
    const flips = of(schedule(river, opts(1)), "reveal");
    expect(flips[0]?.duration).toBe(250 + 40);
  });

  it("merges slide and flip into one 160ms beat at 2x", () => {
    const beats = schedule(flop, opts(2));
    const slides = of(beats, "deal-board");
    expect(of(beats, "reveal")).toHaveLength(0);
    expect(slides.map((b) => b.at)).toEqual([0, 30, 60]);
    expect(slides.every((b) => b.duration === 160 && b.meta.form === "slide+flip")).toBe(true);
  });

  it("deals the flop as one 90ms unit at 3x and snaps at instant", () => {
    const at3x = of(schedule(flop, opts(3)), "deal-board");
    expect(at3x).toHaveLength(1);
    expect(at3x[0]?.duration).toBe(90);
    expect(at3x[0]?.meta.grouped).toBe(true);

    const atInstant = schedule(flop, opts("instant"));
    expect(atInstant).toHaveLength(1);
    expect(atInstant[0]?.duration).toBe(0);
    expect(atInstant[0]?.sounds).toEqual([]); // street sounds don't exist at instant
  });
});

describe("actions", () => {
  it("scales the chip beat and keeps the ladder honest", () => {
    const beats = schedule(SCRIPTED_HAND, opts(1));
    const open = of(beats, "chips-out").find(
      (b) => b.meta.aggression === "raise" && b.event?.t === "act" && b.event.seat === 3,
    );
    expect(open?.duration).toBe(440);
    if (open?.meta.aggression === "raise") {
      expect(open.meta.amount).toBe(150);
      expect(open.meta.toAmount).toBe(150);
      expect(open.meta.potBefore).toBe(75);
      expect(open.meta.tier).toBe(4); // 150 into 75 is an overbet
      expect(open.meta.spawnPop).toBe(true);
    }
    expect(open?.sounds[0]?.cue).toBe("chip_allin");
  });

  it("plays calls at -3dB and gives them no spawn pop", () => {
    const call = of(schedule(SCRIPTED_HAND, opts(1)), "chips-out").find((b) => b.meta.aggression === "call");
    expect(call?.duration).toBe(280);
    expect(call?.sounds[0]?.gainDb).toBe(-3);
    if (call?.meta.aggression === "call") expect(call.meta.spawnPop).toBe(false);
  });

  it("raps twice at 1x, once from 2x up", () => {
    const knock = (speed: Speed): BeatOf<"check-knock"> | undefined => of(schedule(SCRIPTED_HAND, opts(speed)), "check-knock")[0];
    expect(knock(1)?.meta.dips).toBe(2);
    expect(knock(1)?.duration).toBe(180);
    expect(knock(2)?.meta.dips).toBe(1);
    expect(knock(2)?.duration).toBe(90);
    expect(knock(3)?.duration).toBe(90);
  });

  it("mucks with travel until tier 2 fades it in place", () => {
    expect(of(schedule(SCRIPTED_HAND, opts(1)), "fold-muck")[0]?.meta.travel).toBe(true);
    expect(of(schedule(SCRIPTED_HAND, opts(2)), "fold-muck")[0]?.duration).toBe(140);
    const at3x = of(schedule(SCRIPTED_HAND, opts(3)), "fold-muck")[0];
    expect(at3x?.meta.travel).toBe(false);
    expect(at3x?.duration).toBe(90);
    expect(hasTranslation(at3x as Beat)).toBe(false);
  });

  it("flags hero's own fold so the table can recede", () => {
    const events: HandEvent[] = [{ t: "act", seat: SCRIPTED_HERO, kind: "fold" }];
    expect(of(schedule(events, opts(1)), "fold-muck")[0]?.meta.tableRecede).toBe(true);
  });

  it("waits for the previous action's settle window before the next actor", () => {
    const beats = schedule(SCRIPTED_HAND, opts(1));
    const actions = beats.filter((b) => b.blocking && b.lane === "actor");
    for (let i = 1; i < actions.length; i++) {
      const prev = actions[i - 1];
      const next = actions[i];
      if (prev === undefined || next === undefined) continue;
      expect(next.at).toBeGreaterThanOrEqual(prev.at + prev.duration * 0.7);
    }
  });
});

describe("pot mechanics", () => {
  it("merges the felt into the pot when a street ends with chips on it", () => {
    // The turn checks through, so there is nothing to sweep — three merges, not four.
    const merges = of(schedule(SCRIPTED_HAND, opts(1)), "chips-collect");
    expect(merges.map((m) => m.meta.street)).toEqual(["preflop", "flop", "river"]);
    expect(merges.map((m) => m.meta.potAfter)).toEqual([325, 675, 3075]);
    expect(merges.map((m) => m.meta.total)).toEqual([325, 350, 2400]);
    expect(merges.every((m) => m.duration === 400 && m.sounds.length === 1)).toBe(true);
  });

  it("never merges an empty felt", () => {
    const events: HandEvent[] = [
      { t: "board", street: "flop", cards: [0, 1, 2] },
      { t: "board", street: "turn", cards: [3] },
    ];
    expect(of(schedule(events, opts(1)), "chips-collect")).toHaveLength(0);
  });

  it("takes a 250ms breath before the pot moves, and none at instant", () => {
    const award = of(schedule(SCRIPTED_HAND, opts(1)), "pot-award")[0];
    const merge = of(schedule(SCRIPTED_HAND, opts(1)), "chips-collect").at(-1);
    expect(award?.meta.breathMs).toBe(250);
    expect(award?.duration).toBe(450);
    expect(award?.at).toBeGreaterThanOrEqual((merge?.at ?? 0) + (merge?.duration ?? 0) + 250);

    const instant = of(schedule(SCRIPTED_HAND, opts("instant")), "pot-award")[0];
    expect(instant?.meta.breathMs).toBe(0);
    expect(instant?.duration).toBe(120); // keeps a trace
    expect(instant?.keepsTrace).toBe(true);
  });

  it("holds the 150ms award floor at 3x", () => {
    expect(of(schedule(SCRIPTED_HAND, opts(3)), "pot-award")[0]?.duration).toBe(150);
  });

  it("splits pots 60ms apart", () => {
    const events: HandEvent[] = [
      { t: "pot", potIndex: 0, seat: 2, amount: 500 },
      { t: "pot", potIndex: 0, seat: 4, amount: 500 },
    ];
    const awards = of(schedule(events, opts(1)), "pot-award");
    expect(awards).toHaveLength(2);
    expect((awards[1]?.at ?? 0) - (awards[0]?.at ?? 0)).toBe(60);
    expect(awards.map((a) => a.meta.splitIndex)).toEqual([0, 1]);
    expect(awards.every((a) => a.meta.splitCount === 2)).toBe(true);
  });

  it("chimes only when hero wins at least 15bb", () => {
    const cues = (amount: number, seat: number): string[] => {
      const events: HandEvent[] = [
        {
          t: "start",
          handNumber: 1,
          button: 0,
          seats: [{ seat: 2, stack: 10_000 }, { seat: SCRIPTED_HERO, stack: 10_000 }],
          blinds: { sb: 25, bb: 50, ante: 0 },
        },
        { t: "pot", potIndex: 0, seat, amount },
      ];
      return of(schedule(events, opts(1)), "pot-award")[0]?.sounds.map((s) => s.cue) ?? [];
    };
    expect(cues(1000, SCRIPTED_HERO)).toEqual(["pot_slide", "win_chime"]);
    expect(cues(700, SCRIPTED_HERO)).toEqual(["pot_slide"]); // 14bb: under the bar
    expect(cues(1000, 2)).toEqual(["pot_slide"]); // hero lost: no comment
  });

  it("trims pot_slide when hero loses a big pot — losing is unscored", () => {
    const events: HandEvent[] = [
      {
        t: "start",
        handNumber: 1,
        button: 0,
        seats: [{ seat: 2, stack: 10_000 }, { seat: SCRIPTED_HERO, stack: 10_000 }],
        blinds: { sb: 25, bb: 50, ante: 0 },
      },
      { t: "pot", potIndex: 0, seat: 2, amount: 4000 },
    ];
    expect(of(schedule(events, opts(1)), "pot-award")[0]?.sounds[0]?.gainDb).toBe(-6);
  });
});

describe("showdown", () => {
  it("reads seat by seat at 1x and as one unit at 3x", () => {
    const perSeat = of(schedule(SCRIPTED_HAND, opts(1)), "reveal").filter((b) => b.meta.source === "showdown");
    expect(perSeat).toHaveLength(2);
    expect((perSeat[1]?.at ?? 0) - (perSeat[0]?.at ?? 0)).toBe(150);
    expect(perSeat.every((b) => b.duration === 250 && b.keepsTrace)).toBe(true);
    expect(perSeat[1]?.sounds[0]?.gainDb).toBe(-3);

    const grouped = of(schedule(SCRIPTED_HAND, opts(3)), "reveal").filter((b) => b.meta.source === "showdown");
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.meta.grouped).toBe(true);
    expect(grouped[0]?.duration).toBe(120);
  });

  it("keeps a 120ms trace at instant", () => {
    const reveal = of(schedule(SCRIPTED_HAND, opts("instant")), "reveal").filter((b) => b.meta.source === "showdown");
    expect(reveal[0]?.duration).toBe(120);
  });

  it("doubles the seat stagger and hits the clamp ceiling at 0.5x", () => {
    const perSeat = of(schedule(SCRIPTED_HAND, opts(0.5)), "reveal").filter((b) => b.meta.source === "showdown");
    expect(perSeat).toHaveLength(2);
    expect((perSeat[1]?.at ?? 0) - (perSeat[0]?.at ?? 0)).toBe(300); // 150ms stagger doubled
    expect(perSeat.every((b) => b.duration === 500)).toBe(true); // clamp ceiling: 2x the 250ms base
  });

  it("glows the winner 300ms after the last flip and dims the rest", () => {
    const beats = schedule(SCRIPTED_HAND, opts(1));
    const flips = of(beats, "reveal").filter((b) => b.meta.source === "showdown");
    const glow = of(beats, "winner-glow")[0];
    const lastFlipEnd = (flips.at(-1)?.at ?? 0) + (flips.at(-1)?.duration ?? 0);
    expect(glow?.at).toBe(lastFlipEnd + 300);
    expect(glow?.meta.winners).toEqual([3]);
    expect(glow?.meta.dimmed).toEqual([2]);
  });

  it("offers the mind-reveal affordance to villains only, after the showdown settles", () => {
    const beats = schedule(SCRIPTED_HAND, opts(1));
    const flips = of(beats, "reveal").filter((b) => b.meta.source === "showdown");
    const lastFlipEnd = (flips.at(-1)?.at ?? 0) + (flips.at(-1)?.duration ?? 0);
    const affordances = of(beats, "mind-affordance");
    expect(affordances.map((a) => a.meta.seat)).toEqual([2]);
    expect(affordances[0]?.at).toBe(lastFlipEnd + 250);
    expect(affordances[0]?.lane).toBe("ambient");
    expect(affordances[0]?.blocking).toBe(false);
    expect(affordances[0]?.meta.target).toBe("felt");
  });

  it("moves the affordance to the tray chip once auto-deal outruns the felt", () => {
    expect(of(schedule(SCRIPTED_HAND, opts(3)), "mind-affordance")[0]?.meta.target).toBe("tray");
  });
});

describe("turn indicator and think time", () => {
  it("glides at 0.5x/1x, fades at 2x+, and disappears at instant", () => {
    const form = (speed: Speed): string | undefined => of(schedule(SCRIPTED_HAND, opts(speed)), "turn-indicator")[0]?.meta.form;
    expect(form(0.5)).toBe("glide");
    expect(form(1)).toBe("glide");
    expect(form(2)).toBe("fade");
    expect(form(3)).toBe("fade");
    expect(of(schedule(SCRIPTED_HAND, opts("instant")), "turn-indicator")).toHaveLength(0);
  });

  it("never scales (FEEDBACK) and blips for hero only", () => {
    const at1x = of(schedule(SCRIPTED_HAND, opts(1)), "turn-indicator");
    expect(at1x.every((b) => b.duration === 200)).toBe(true);
    expect(of(schedule(SCRIPTED_HAND, opts(0.5)), "turn-indicator").every((b) => b.duration === 200)).toBe(true);
    expect(of(schedule(SCRIPTED_HAND, opts(2)), "turn-indicator").every((b) => b.duration === 90)).toBe(true);
    const blips = at1x.filter((b) => b.sounds.some((s) => s.cue === "turn_blip"));
    expect(blips.every((b) => b.meta.seat === SCRIPTED_HERO && b.meta.arms)).toBe(true);
    expect(blips.length).toBeGreaterThan(0);
  });

  it("scales think time by 1/S with a 250ms floor and nothing at instant", () => {
    expect(thinkDuration(2000, 0.5)).toBe(4000);
    expect(thinkDuration(2000, 1)).toBe(2000);
    expect(thinkDuration(2000, 2)).toBe(1000);
    expect(thinkDuration(2000, 3)).toBe(667);
    expect(thinkDuration(300, 3)).toBe(THINK_FLOOR_MS); // the floor holds
    expect(thinkDuration(2000, "instant")).toBe(0);
    expect(thinkDuration(0, 1)).toBe(0);
  });

  it("schedules a think pause as a non-blocking actor beat", () => {
    const [beat, ...rest] = scheduleThink(4, 1200, { speed: 1, reduceMotion: false, startAt: 500 });
    expect(rest).toHaveLength(0);
    expect(beat?.kind).toBe("think-pause");
    expect(beat?.at).toBe(500);
    expect(beat?.duration).toBe(1200);
    expect(beat?.blocking).toBe(false);
    expect(beat?.lane).toBe("actor");
    expect(scheduleThink(4, 1200, { speed: "instant", reduceMotion: false })).toEqual([]);
    expect(scheduleThink(4, 0, { speed: 1, reduceMotion: false })).toEqual([]);
  });

  it("honours thinkTimeMs from the event log, and can be told not to", () => {
    const withThink = of(schedule(SCRIPTED_HAND, opts(1)), "think-pause");
    expect(withThink.length).toBeGreaterThan(0);
    expect(withThink[0]?.meta.requestedMs).toBe(1200);
    const without = of(schedule(SCRIPTED_HAND, { ...opts(1), thinkPauses: false }), "think-pause");
    expect(without).toHaveLength(0);
  });

  it("delays the action beat by the think pause", () => {
    const events: HandEvent[] = [{ t: "act", seat: 4, kind: "call", amount: 100, thinkTimeMs: 1000 }];
    const beats = schedule(events, opts(1));
    const think = of(beats, "think-pause")[0];
    const chips = of(beats, "chips-out")[0];
    expect(think?.at).toBe(0);
    expect(chips?.at).toBe((think?.at ?? 0) + (think?.duration ?? 0));
  });
});

describe("rest", () => {
  it("rests 600ms ÷ S after the award, and not at all at instant", () => {
    const rest = (speed: Speed): number | undefined => schedule(SCRIPTED_HAND, opts(speed)).find((b) => b.kind === "rest")?.duration;
    expect(rest(0.5)).toBe(1200);
    expect(rest(1)).toBe(600);
    expect(rest(2)).toBe(300);
    expect(rest(3)).toBe(200);
    expect(rest("instant")).toBe(0);
  });
});

describe("reduce motion", () => {
  it("never moves anything through space", () => {
    for (const speed of SPEEDS) {
      const beats = schedule(SCRIPTED_HAND, opts(speed, true));
      const moving = beats.filter(hasTranslation);
      expect(moving.map((b) => `${b.kind}:${b.transforms.join("+")}`)).toEqual([]);
    }
  });

  it("caps blur at 2px and declares a variant for every beat", () => {
    const beats = schedule(SCRIPTED_HAND, opts(1, true));
    expect(beats.every((b) => b.transforms.every((t) => t === "opacity" || t === "blur2px"))).toBe(true);
    expect(beats.every((b) => b.reduceMotion.length > 0)).toBe(true);
  });

  it("keeps staggers — rhythm without motion", () => {
    const beats = schedule(DEAL_ONLY, opts(1, true));
    expect(beats.filter((b) => b.kind === "deal-hole").map((b) => b.at)).toEqual([0, 40, 80, 120, 160, 200]);
  });

  it("silences nothing — every cue family still speaks", () => {
    // Multiplicity may differ (reduce-motion compresses the board deal, so the
    // dedupe windows thin it further), but no cue may disappear.
    const cues = (rm: boolean): Set<string> =>
      new Set(schedule(SCRIPTED_HAND, opts(1, rm)).flatMap((b) => b.sounds.map((s) => s.cue)));
    expect([...cues(true)].sort()).toEqual([...cues(false)].sort());
  });

  it("swaps the board deal for a single face-up fade per card", () => {
    const beats = schedule([{ t: "board", street: "flop", cards: [0, 1, 2] }], opts(1, true));
    expect(beats.every((b) => b.kind === "deal-board")).toBe(true);
    expect(beats).toHaveLength(3);
    expect(beats.every((b) => b.kind === "deal-board" && b.meta.form === "fade")).toBe(true);
    expect(beats.every((b) => b.duration === DURATION.quick)).toBe(true);
  });

  it("turns the check knock into a pulse", () => {
    const knock = of(schedule(SCRIPTED_HAND, opts(1, true)), "check-knock")[0];
    expect(knock?.reduceMotion).toBe("pulse");
    expect(knock?.duration).toBe(120);
  });
});

describe("instant", () => {
  it("snaps everything except the traces", () => {
    const beats = schedule(SCRIPTED_HAND, opts("instant"));
    for (const beat of beats) {
      if (beat.keepsTrace) expect(beat.duration).toBeGreaterThan(0);
      else if (beat.lane !== "ambient") expect(beat.duration).toBe(0);
    }
  });

  it("keeps exactly three cues per hand: deal, showdown, award", () => {
    const cues = schedule(SCRIPTED_HAND, opts("instant")).flatMap((b) => b.sounds.map((s) => s.cue));
    expect(cues).toEqual(["card_slide", "card_flip", "pot_slide"]);
  });

  it("names exactly which kinds survive instant, and why (keepsTrace vs. ambient lane)", () => {
    const beats = schedule(SCRIPTED_HAND, opts("instant"));
    const survivors = beats.filter((b) => b.duration > 0);
    // Every survivor in this hand is either a keeps-a-trace beat (showdown
    // reveal, pot award) or the ambient mind-reveal affordance — nothing else.
    expect(survivors.map((b) => `${b.kind}:${b.keepsTrace ? "trace" : b.lane}`).sort()).toEqual(
      ["mind-affordance:ambient", "pot-award:trace", "reveal:trace"].sort(),
    );
    // Every non-survivor is neither a trace beat nor ambient.
    const snapped = beats.filter((b) => b.duration === 0);
    expect(snapped.every((b) => !b.keepsTrace && b.lane !== "ambient")).toBe(true);
    expect(snapped.length).toBeGreaterThan(0);
  });

  it("property: at instant, a beat has nonzero duration iff it keeps a trace or lives in the ambient lane", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (seed) => {
        const beats = schedule(randomHand(seed), { speed: "instant", reduceMotion: false, heroSeat: 0 });
        for (const beat of beats) {
          const survives = beat.keepsTrace || beat.lane === "ambient";
          expect(beat.duration > 0 ? survives : true).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("sound policy", () => {
  it("thins the deal riffle to a descending ladder", () => {
    const deal = of(schedule(SCRIPTED_HAND, opts(1)), "deal-hole");
    const audible = deal.filter((b) => b.sounds.length > 0);
    expect(deal).toHaveLength(12);
    expect(audible).toHaveLength(6); // 40ms stagger against a 50ms window
    expect(audible.map((b) => b.sounds[0]?.gainDb)).toEqual([0, -1, -2, -3, -4, -5]);
  });

  it("plays the flop's first flip full and the rest at -4dB", () => {
    const flips = of(schedule([{ t: "board", street: "flop", cards: [0, 1, 2] }], opts(1)), "reveal");
    expect(flips.map((b) => b.sounds[0]?.gainDb)).toEqual([0, -4, -4]);
  });
});

describe("ambient helpers", () => {
  it("gives banter one slot, a scaled hold, and silence at instant", () => {
    const beats = scheduleBanter({ seat: 5, text: "nice call" }, { speed: 1, reduceMotion: false });
    expect(beats.map((b) => b.kind)).toEqual(["banter", "banter"]);
    expect(beats.every((b) => b.sounds.length === 0 && b.lane === "ambient")).toBe(true);
    expect(beats[1]?.at).toBe(250 + 4000);
    const fast = scheduleBanter({ seat: 5, text: "x" }, { speed: 3, reduceMotion: false });
    expect(fast[0]?.kind === "banter" && fast[0].meta.holdMs).toBe(2000); // the 2s minimum
    expect(scheduleBanter({ seat: 5, text: "x" }, { speed: "instant", reduceMotion: false })).toEqual([]);
  });

  it("cross-fades moods silently, shortening only at instant", () => {
    const shift = scheduleMoodShift(2, "neutral", "heated", { speed: 3, reduceMotion: false });
    expect(shift[0]?.duration).toBe(800);
    expect(shift[0]?.sounds).toEqual([]);
    expect(shift[0]?.transforms).toEqual(["opacity", "blur2px"]);
    expect(scheduleMoodShift(2, "neutral", "heated", { speed: "instant", reduceMotion: false })[0]?.duration).toBe(300);
    expect(scheduleMoodShift(2, "heated", "heated", { speed: 1, reduceMotion: false })).toEqual([]);
  });

  it("keeps the badge glint at every speed and mutes it mid-decision", () => {
    for (const speed of SPEEDS) {
      const glint = scheduleBadgeGlint({ speed, reduceMotion: false });
      expect(glint.map((b) => b.duration)).toEqual([250, 600]);
      expect(glint.every((b) => b.speedClass === "feedback" && b.keepsTrace)).toBe(true);
    }
    const silent = scheduleBadgeGlint({ speed: 1, reduceMotion: false, heroPending: true });
    expect(silent.every((b) => b.sounds.length === 0)).toBe(true);
    expect(scheduleBadgeGlint({ speed: 1, reduceMotion: false })[0]?.sounds[0]?.cue).toBe("badge_tick");
  });
});

describe("purity", () => {
  it("is deterministic and offsets cleanly by startAt", () => {
    const a = schedule(SCRIPTED_HAND, opts(1));
    const b = schedule(SCRIPTED_HAND, opts(1));
    expect(b).toEqual(a);
    const shifted = schedule(SCRIPTED_HAND, { ...opts(1), startAt: 1234 });
    expect(shifted.map((x) => x.at)).toEqual(a.map((x) => x.at + 1234));
    expect(shifted.map((x) => x.duration)).toEqual(a.map((x) => x.duration));
  });

  it("returns beats sorted by start time", () => {
    for (const speed of SPEEDS) {
      const ats = schedule(SCRIPTED_HAND, opts(speed)).map((b) => b.at);
      expect(ats).toEqual([...ats].sort((x, y) => x - y));
    }
  });

  it("survives an empty burst", () => {
    expect(schedule([], opts(1))).toEqual([]);
  });
});
