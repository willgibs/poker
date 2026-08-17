import { describe, expect, it } from "vitest";
import {
  BAND_QUALITY,
  CONFIDENCE_WEIGHT,
  HISTORY_CAP,
  RATING_MAX,
  RATING_MIN,
  RATING_START,
  TIER_BOUNDARIES,
  conceptTier,
  decisionQuality,
  initialRating,
  qualityToRating,
  ratingGain,
  ratingTier,
  ratingTrend,
  updateRating,
  updateRatingAll,
  weakestConcepts,
} from "./rating";
import { aggregateStats } from "./leaks";
import type { Confidence, DecisionGrade, GradeBand } from "./types";
import { gradePostflop } from "./grade-postflop";
import { hand } from "./test-helpers";

function grade(over: Partial<DecisionGrade> = {}): DecisionGrade {
  return {
    decisionId: "river:0:0",
    street: "river",
    seat: 0,
    kind: "call",
    band: "inline",
    confidence: "high",
    basis: "exact-enumeration",
    note: "test",
    ...over,
  };
}

describe("decisionQuality", () => {
  it("decays exponentially in EV loss when one is available", () => {
    expect(decisionQuality(grade({ evLossBb: 0 }))).toBe(1);
    expect(decisionQuality(grade({ evLossBb: 0.05 }))).toBeGreaterThan(0.9);
    expect(decisionQuality(grade({ evLossBb: 2, band: "significant" }))).toBeLessThan(0.05);
    // Monotone: a bigger mistake is never scored better.
    let prev = 1.1;
    for (const loss of [0, 0.1, 0.25, 0.5, 1, 2, 5]) {
      const q = decisionQuality(grade({ evLossBb: loss })) ?? 0;
      expect(q).toBeLessThan(prev);
      prev = q;
    }
  });

  it("falls back to the band when no EV number exists", () => {
    for (const band of ["inline", "minor", "significant"] as GradeBand[]) {
      expect(decisionQuality(grade({ band, evLossBb: undefined }))).toBe(BAND_QUALITY[band]);
    }
  });

  it("returns undefined for an unassessed spot", () => {
    expect(decisionQuality(grade({ band: undefined, confidence: "unknown" }))).toBeUndefined();
  });
});

describe("updateRating", () => {
  it("rises on inline play and falls on significant mistakes", () => {
    const start = initialRating();
    const good = updateRating(start, [grade({ evLossBb: 0 })]);
    const bad = updateRating(start, [grade({ band: "significant", evLossBb: 3 })]);
    expect(good.rating).toBeGreaterThan(start.rating);
    expect(bad.rating).toBeLessThan(start.rating);
  });

  it("ignores hands with nothing gradable — not evidence of anything", () => {
    const start = initialRating();
    const after = updateRating(start, [
      grade({ band: undefined, confidence: "unknown" }),
      grade({ band: undefined, confidence: "unknown" }),
    ]);
    expect(after).toBe(start);
    expect(after.hands).toBe(0);
  });

  it("moves less for low-confidence grades than for high-confidence ones", () => {
    const start = initialRating();
    const byConfidence = (confidence: Confidence): number =>
      updateRating(start, [grade({ confidence, evLossBb: 0 })]).rating - start.rating;
    const high = byConfidence("high");
    const medium = byConfidence("medium");
    const low = byConfidence("low");
    const unknown = byConfidence("unknown");
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(0);
    expect(CONFIDENCE_WEIGHT.high).toBe(1);
  });

  it("slows down as the sample grows", () => {
    expect(ratingGain(0)).toBeGreaterThan(ratingGain(400));
    expect(ratingGain(400)).toBeGreaterThan(ratingGain(4000));
    expect(ratingGain(100_000)).toBeGreaterThan(0);
  });

  it("stays inside the rating scale", () => {
    let state = initialRating();
    for (let i = 0; i < 3000; i++) state = updateRating(state, [grade({ evLossBb: 0 })]);
    expect(state.rating).toBeLessThanOrEqual(RATING_MAX);
    expect(state.rating).toBeGreaterThan(2000);

    let sinking = initialRating();
    for (let i = 0; i < 3000; i++) {
      sinking = updateRating(sinking, [grade({ band: "significant", evLossBb: 10 })]);
    }
    expect(sinking.rating).toBeGreaterThanOrEqual(RATING_MIN);
    expect(sinking.rating).toBeLessThan(200);
  });

  it("is pure: the previous state is untouched", () => {
    const start = initialRating();
    const snapshot = JSON.parse(JSON.stringify(start)) as typeof start;
    updateRating(start, [grade({ evLossBb: 0 })]);
    expect(start).toEqual(snapshot);
  });

  it("converges toward the rating its quality level implies", () => {
    // A steady diet of "minor" decisions should settle near that quality's
    // target, from either direction.
    const target = qualityToRating(BAND_QUALITY.minor);
    const fromBelow = updateRatingAll(
      initialRating(RATING_MIN + 50),
      Array.from({ length: 4000 }, () => [grade({ band: "minor", evLossBb: undefined })]),
    );
    const fromAbove = updateRatingAll(
      initialRating(RATING_MAX - 50),
      Array.from({ length: 4000 }, () => [grade({ band: "minor", evLossBb: undefined })]),
    );
    expect(Math.abs(fromBelow.rating - target)).toBeLessThan(150);
    expect(Math.abs(fromAbove.rating - target)).toBeLessThan(150);
  });
});

describe("the rating is results-independent by construction", () => {
  it("rises on a rigged corpus where hero loses every single hand", () => {
    // Hero plays perfectly and gets coolered every time: the graded decisions
    // are all inline, and every hand's net is a big loss.
    const rigged = Array.from({ length: 200 }, (_, n) => {
      const record = hand({
        handNumber: n + 1,
        seats: [0, 1],
        button: 0,
        stack: 50_000,
        bb: 100,
        id: `cooler-${n}`,
        board: ["Qc", "9d", "2s", "5h", "3c"],
      })
        .blinds()
        .dealTo(0, "Ah", "Qs")
        .dealTo(1, "9h", "9s")
        .call(0)
        .check(1)
        .flop()
        .bet(1, 200)
        .call(0)
        .turn()
        .bet(1, 600)
        .call(0)
        .river()
        .bet(1, 1800)
        .call(0)
        .showdown(1, 0)
        .award(1)
        .build();
      return record;
    });

    // Results are catastrophic...
    const agg = aggregateStats(rigged, 0);
    expect(agg.netCents).toBeLessThan(0);
    expect(agg.bb100).toBeLessThan(-1000);

    // ...and the rating still climbs, because it never sees a chip.
    const grades: DecisionGrade[][] = rigged.map(() => [
      grade({ evLossBb: 0 }),
      grade({ decisionId: "turn:0:0", street: "turn", evLossBb: 0.01 }),
    ]);
    const rated = updateRatingAll(initialRating(), grades);
    expect(rated.rating).toBeGreaterThan(RATING_START);
    expect(rated.hands).toBe(200);
  });

  it("gives identical ratings to identical grades from opposite results", () => {
    // The API has no channel for a result: the same grades must produce the
    // same state whatever happened at the table.
    const grades = Array.from({ length: 50 }, () => [grade({ evLossBb: 0.02 })]);
    expect(updateRatingAll(initialRating(), grades)).toEqual(
      updateRatingAll(initialRating(), grades),
    );
  });

  it("rates a won cooler and a lost cooler identically when the play matches", () => {
    // Same decision, same grade, opposite outcome — the grader's own output is
    // the only input, so the two are indistinguishable downstream.
    const spot = (heroWins: boolean) =>
      hand({
        handNumber: 1,
        seats: [0, 1],
        button: 0,
        stack: 50_000,
        bb: 100,
        id: heroWins ? "won" : "lost",
        seed: "fixed-seed",
        board: ["Qc", "9d", "2s", "5h", "3c"],
      })
        .blinds()
        .dealTo(0, "Ah", "Qs")
        .dealTo(1, "Kh", "Qd")
        .call(0)
        .check(1)
        .flop()
        .check(1)
        .check(0)
        .turn()
        .check(1)
        .check(0)
        .river()
        .bet(1, 200)
        .call(0)
        .showdown(1, 0)
        .award(heroWins ? 0 : 1)
        .build();

    const ratingFrom = (heroWins: boolean) =>
      updateRating(initialRating(), gradePostflop(spot(heroWins), { heroSeat: 0 })).rating;
    expect(ratingFrom(true)).toBe(ratingFrom(false));
  });
});

describe("rating trend", () => {
  it("reports a rising trend on improving play", () => {
    const state = updateRatingAll(
      initialRating(),
      Array.from({ length: 60 }, () => [grade({ evLossBb: 0 })]),
    );
    const trend = ratingTrend(state, 50);
    expect(trend.direction).toBe("rising");
    expect(trend.delta).toBeGreaterThan(0);
    expect(trend.to).toBe(state.rating);
    expect(trend.spanHands).toBeLessThanOrEqual(60);
    expect(trend.points.length).toBeGreaterThan(1);
  });

  it("reports a falling trend on deteriorating play", () => {
    const state = updateRatingAll(
      initialRating(),
      Array.from({ length: 60 }, () => [grade({ band: "significant", evLossBb: 4 })]),
    );
    expect(ratingTrend(state, 50).direction).toBe("falling");
  });

  it("reports flat when nothing has moved", () => {
    const trend = ratingTrend(initialRating(), 50);
    expect(trend.direction).toBe("flat");
    expect(trend.delta).toBe(0);
  });

  it("falls back to the whole history when the window overshoots", () => {
    const state = updateRatingAll(
      initialRating(),
      Array.from({ length: 5 }, () => [grade({ evLossBb: 0 })]),
    );
    const trend = ratingTrend(state, 500);
    expect(trend.from).toBe(RATING_START);
    expect(trend.spanHands).toBe(5);
  });

  it("caps the stored history", () => {
    const state = updateRatingAll(
      initialRating(),
      Array.from({ length: HISTORY_CAP + 50 }, () => [grade({ evLossBb: 0 })]),
    );
    expect(state.history.length).toBe(HISTORY_CAP);
    expect(state.history[state.history.length - 1]?.hands).toBe(HISTORY_CAP + 50);
  });
});

describe("concept mastery", () => {
  it("accumulates per-concept quality and surfaces the weakest", () => {
    const grades: DecisionGrade[][] = [];
    for (let i = 0; i < 20; i++) {
      grades.push([
        grade({ concept: "bluff-catching", band: "significant", evLossBb: 2 }),
        grade({ concept: "cbet-basics", band: "inline", evLossBb: 0 }),
        grade({ concept: "value-betting", band: "minor", evLossBb: 0.3 }),
      ]);
    }
    const state = updateRatingAll(initialRating(), grades);
    expect(state.concepts["bluff-catching"]?.decisions).toBe(20);
    expect(state.concepts["cbet-basics"]?.quality).toBeCloseTo(1, 6);
    const weakest = weakestConcepts(state, { limit: 2 });
    expect(weakest[0]?.concept).toBe("bluff-catching");
    expect(weakest[1]?.concept).toBe("value-betting");
  });

  it("requires enough evidence before naming a weak concept", () => {
    const state = updateRating(initialRating(), [
      grade({ concept: "blockers", band: "significant", evLossBb: 5 }),
    ]);
    expect(weakestConcepts(state)).toEqual([]);
    expect(weakestConcepts(state, { minDecisions: 1 })[0]?.concept).toBe("blockers");
  });

  it("reports each concept's tier for the coach register", () => {
    expect(conceptTier("hand-selection")).toBe("foundations");
    expect(conceptTier("bluff-catching")).toBe("intermediate");
    expect(conceptTier("blockers")).toBe("advanced");
  });
});

describe("rating tiers select the coach's register", () => {
  it("maps ratings to taxonomy tiers", () => {
    expect(ratingTier(RATING_MIN)).toBe("foundations");
    expect(ratingTier(TIER_BOUNDARIES.intermediate - 1)).toBe("foundations");
    expect(ratingTier(TIER_BOUNDARIES.intermediate)).toBe("intermediate");
    expect(ratingTier(TIER_BOUNDARIES.advanced - 1)).toBe("intermediate");
    expect(ratingTier(TIER_BOUNDARIES.advanced)).toBe("advanced");
    expect(ratingTier(RATING_MAX)).toBe("advanced");
  });
});
