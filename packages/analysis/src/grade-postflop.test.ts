import { type Card, comboIndex } from "@poker/core";
import { createRange } from "@poker/ranges";
import { describe, expect, it } from "vitest";
import { PREFLOP_PRIOR_PCT, gradePostflop, preflopPriorPct } from "./grade-postflop";
import { buildHandView } from "./replay";
import { c, cards, hand } from "./test-helpers";

/**
 * A single-combo villain range. With the board complete, hero's equity against
 * it is not an estimate at all — it is a fact, which is what makes these
 * river spots a ground-truth corpus (PRD top risk #2).
 */
function exactly(a: string, b: string): Float32Array {
  const range = createRange();
  range[comboIndex(c(a) as Card, c(b) as Card)] = 1;
  return range;
}

/**
 * Heads-up river spot: seat 1 bets `bet` into a pot built by preflop calls,
 * and hero (seat 0) responds with `line`.
 *
 * Chips are chosen so the arithmetic is checkable by hand: blinds 50/100, both
 * call preflop (pot 200), everyone checks flop and turn, then seat 1 bets.
 */
function riverSpot(opts: {
  heroCards: [string, string];
  villainCards: [string, string];
  board: [string, string, string, string, string];
  bet: number;
  line: "fold" | "call" | "raise";
}) {
  const b = hand({
    handNumber: 11,
    seats: [0, 1],
    button: 0,
    stack: 100_000,
    bb: 100,
    id: "river-spot",
    board: opts.board,
  })
    .blinds()
    .dealTo(0, opts.heroCards[0], opts.heroCards[1])
    .dealTo(1, opts.villainCards[0], opts.villainCards[1])
    .call(0)
    .check(1)
    .flop()
    .check(1)
    .check(0)
    .turn()
    .check(1)
    .check(0)
    .river()
    .bet(1, opts.bet);

  if (opts.line === "fold") return b.fold(0).award(1).build();
  if (opts.line === "call") return b.call(0).showdown(1, 0).award(0).build();
  return b.raise(0, opts.bet * 3).fold(1).award(0).build();
}

const HERO_NUTS = {
  heroCards: ["Ac", "Kc"] as [string, string],
  villainCards: ["7h", "6h"] as [string, string],
  // Hero holds the nut flush; villain holds a busted straight draw.
  board: ["Qc", "9c", "2c", "5d", "3s"] as [string, string, string, string, string],
};

const HERO_DEAD = {
  heroCards: ["8d", "7d"] as [string, string],
  villainCards: ["Ac", "Kc"] as [string, string],
  board: ["Qc", "9c", "2c", "5s", "3h"] as [string, string, string, string, string],
};

describe("gradePostflop — exact river ground truth", () => {
  it("prices a call against a known range by exact enumeration", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    const grades = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("7h", "6h")]]),
    });
    const river = grades.find((g) => g.street === "river");
    expect(river?.decisionId).toBe("river:0:0");
    expect(river?.basis).toBe("exact-enumeration");
    expect(river?.confidence).toBe("high");
    expect(river?.ev?.rangeSource).toBe("given");
    expect(river?.ev?.trials).toBeUndefined();

    // Hero wins 100% of the time. Pot before the call is 200 + 200 = 400
    // cents; calling 200 returns 1.0 · 600 − 200 = 400 cents = 4.0bb.
    const call = river?.ev?.alternatives.find((a) => a.action === "call");
    expect(call?.evBb).toBe(4);
    // Folding is the reference point: exactly zero.
    expect(river?.ev?.alternatives.find((a) => a.action === "fold")?.evBb).toBe(0);
  });

  it("prices a call that is drawing dead at exactly minus the price", () => {
    const record = riverSpot({ ...HERO_DEAD, bet: 200, line: "call" });
    const grades = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("Ac", "Kc")]]),
    });
    const river = grades.find((g) => g.street === "river");
    // Equity 0 ⇒ EV(call) = 0 · 600 − 200 = −200 cents = −2.0bb.
    expect(river?.ev?.alternatives.find((a) => a.action === "call")?.evBb).toBe(-2);
    // Folding is best, so calling loses exactly the price paid.
    expect(river?.ev?.bestAction).toBe("fold");
    expect(river?.evLossBb).toBe(2);
    expect(river?.band).toBe("significant");
  });

  it("prices a chopped pot at half the pot, exactly", () => {
    // Both players play the board: a five-card straight on the board itself.
    const record = riverSpot({
      heroCards: ["2c", "3d"],
      villainCards: ["2h", "3s"],
      board: ["9d", "Th", "Jc", "Qs", "Kh"],
      bet: 200,
      line: "call",
    });
    const grades = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("2h", "3s")]]),
    });
    const river = grades.find((g) => g.street === "river");
    // Equity 0.5 ⇒ EV(call) = 0.5 · 600 − 200 = 100 cents = 1.0bb.
    expect(river?.ev?.alternatives.find((a) => a.action === "call")?.evBb).toBe(1);
  });

  it("grades folding the nuts as a significant loss", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "fold" });
    const river = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("7h", "6h")]]),
    }).find((g) => g.street === "river");
    expect(river?.kind).toBe("fold");
    expect(river?.ev?.takenEvBb).toBe(0);
    expect(river?.evLossBb).toBeGreaterThanOrEqual(4);
    expect(river?.band).toBe("significant");
    expect(river?.concept).toBe("folding-discipline");
  });

  it("grades folding a dead hand as inline", () => {
    const record = riverSpot({ ...HERO_DEAD, bet: 200, line: "fold" });
    const river = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("Ac", "Kc")]]),
    }).find((g) => g.street === "river");
    expect(river?.evLossBb).toBe(0);
    expect(river?.band).toBe("inline");
  });

  it("never reports a negative EV loss", () => {
    for (const line of ["fold", "call", "raise"] as const) {
      const record = riverSpot({ ...HERO_NUTS, bet: 200, line });
      for (const g of gradePostflop(record, {
        heroSeat: 0,
        villainRanges: new Map([[1, exactly("7h", "6h")]]),
      })) {
        if (g.evLossBb !== undefined) expect(g.evLossBb).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("quantizes exact numbers to milli-bb and never further", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 175, line: "call" });
    const river = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("7h", "6h")]]),
    }).find((g) => g.street === "river");
    for (const alt of river?.ev?.alternatives ?? []) {
      expect(Math.round(alt.evBb * 1000)).toBeCloseTo(alt.evBb * 1000, 9);
    }
  });
});

describe("gradePostflop — confidence labelling", () => {
  const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });

  it("is high only for exact EV against a range we were given", () => {
    const g = gradePostflop(record, {
      heroSeat: 0,
      villainRanges: new Map([[1, exactly("7h", "6h")]]),
    }).find((x) => x.street === "river");
    expect(g?.confidence).toBe("high");
  });

  it("drops to medium when the range is only estimated", () => {
    const g = gradePostflop(record, { heroSeat: 0 }).find((x) => x.street === "river");
    expect(g?.confidence).toBe("medium");
    expect(g?.ev?.rangeSource).toBe("prior");
    expect(g?.basis).toBe("exact-enumeration");
  });

  it("drops to low on sampled streets against an estimated range", () => {
    const grades = gradePostflop(record, { heroSeat: 0, trials: 400 });
    const flop = grades.find((g) => g.street === "flop");
    expect(flop?.basis).toBe("monte-carlo");
    expect(flop?.confidence).toBe("low");
    expect(flop?.ev?.trials).toBe(400);
  });

  it("weakens one level further in a multiway pot", () => {
    const record3 = hand({
      handNumber: 12,
      seats: [0, 1, 2],
      button: 0,
      stack: 100_000,
      bb: 100,
      board: ["Qc", "9c", "2c", "5d", "3s"],
    })
      .blinds()
      .dealTo(0, "Ac", "Kc")
      .dealTo(1, "7h", "6h")
      .dealTo(2, "8s", "8d")
      .call(0)
      .call(1)
      .check(2)
      .flop()
      .check(1)
      .check(2)
      .check(0)
      .turn()
      .check(1)
      .check(2)
      .check(0)
      .river()
      .bet(1, 200)
      .call(2)
      .call(0)
      .showdown(1, 2, 0)
      .award(0)
      .build();
    const g = gradePostflop(record3, {
      heroSeat: 0,
      villainRanges: new Map([
        [1, exactly("7h", "6h")],
        [2, exactly("8s", "8d")],
      ]),
      trials: 400,
    }).find((x) => x.street === "river");
    expect(g?.ev?.livePlayers).toBe(3);
    expect(g?.concept).toBe("multiway-adjustments");
    // Given ranges + Monte Carlo would be `medium`; multiway knocks it to low.
    expect(g?.confidence).toBe("low");
  });
});

describe("gradePostflop — determinism and decision keys", () => {
  it("keys grades by the hand-format decisionId scheme", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    const ids = gradePostflop(record, { heroSeat: 0 }).map((g) => g.decisionId);
    expect(ids).toEqual(["flop:0:0", "turn:0:0", "river:0:0"]);
  });

  it("grades only the hero's decisions", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    for (const g of gradePostflop(record, { heroSeat: 0 })) expect(g.seat).toBe(0);
    expect(gradePostflop(record, { heroSeat: 1 }).every((g) => g.seat === 1)).toBe(true);
  });

  it("produces identical numbers on a re-grade — same seed, same stream", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    const a = gradePostflop(record, { heroSeat: 0, trials: 500 });
    const b = gradePostflop(record, { heroSeat: 0, trials: 500 });
    expect(a).toEqual(b);
  });

  it("declines to grade when hero's cards are absent", () => {
    const record = hand({ seats: [0, 1], button: 0, bb: 100, board: ["Qc", "9c", "2c"] })
      .blinds()
      .dealTo(1)
      .call(0)
      .check(1)
      .flop()
      .check(1)
      .check(0)
      .award(1)
      .build();
    const g = gradePostflop(record, { heroSeat: 0 })[0];
    expect(g?.band).toBeUndefined();
    expect(g?.confidence).toBe("unknown");
    expect(g?.note).toContain("hole cards are absent");
  });
});

describe("gradePostflop — range estimation", () => {
  it("narrows an estimated range as the villain keeps betting", () => {
    // The same hero call, once facing a single bet and once facing three
    // barrels: the filtered range should make hero's equity fall.
    const passive = hand({
      handNumber: 13,
      seats: [0, 1],
      button: 0,
      stack: 100_000,
      bb: 100,
      board: ["Qc", "9d", "2s", "5h", "3c"],
      id: "passive",
    })
      .blinds()
      .dealTo(0, "Ah", "Qs")
      .dealTo(1)
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
      .award(1)
      .build();

    const barrels = hand({
      handNumber: 14,
      seats: [0, 1],
      button: 0,
      stack: 100_000,
      bb: 100,
      board: ["Qc", "9d", "2s", "5h", "3c"],
      id: "barrels",
    })
      .blinds()
      .dealTo(0, "Ah", "Qs")
      .dealTo(1)
      .call(0)
      .check(1)
      .flop()
      .bet(1, 150)
      .call(0)
      .turn()
      .bet(1, 400)
      .call(0)
      .river()
      .bet(1, 1200)
      .call(0)
      .showdown(1, 0)
      .award(1)
      .build();

    // The pots differ, so raw EV is not comparable — back the equity out of
    // the call's EV instead: EV = eq · (pot + toCall) − toCall.
    const impliedEquity = (record: Parameters<typeof gradePostflop>[0]): number => {
      const view = buildHandView(record);
      const action = view.actions.find((a) => a.street === "river" && a.seat === 0);
      const g = gradePostflop(record, { heroSeat: 0 }).find((x) => x.street === "river");
      const call = g?.ev?.alternatives.find((a) => a.action === "call");
      const evCents = (call?.evBb ?? 0) * view.bb;
      const pot = action?.potBefore ?? 0;
      const toCall = action?.toCall ?? 0;
      return (evCents + toCall) / (pot + toCall);
    };
    // Top pair holds far less equity against three barrels than one stab.
    expect(impliedEquity(barrels)).toBeLessThan(impliedEquity(passive));
  });

  it("classifies each villain's preflop line into a prior width", () => {
    const record = hand({
      handNumber: 15,
      seats: [0, 1, 2, 3, 4, 5],
      button: 0,
      stack: 100_000,
      bb: 100,
      board: ["Qc", "9d", "2s"],
    })
      .blinds()
      .deal()
      .call(3) // UTG limps
      .fold(4)
      .raise(5, 300) // CO opens
      .fold(0)
      .fold(1)
      .raise(2, 1000) // BB 3-bets
      .call(3)
      .call(5)
      .flop()
      .check(2)
      .check(3)
      .check(5)
      .award(2)
      .build();
    const view = buildHandView(record);
    expect(preflopPriorPct(view, 2)).toBe(PREFLOP_PRIOR_PCT.threeBet);
    expect(preflopPriorPct(view, 5)).toBe(PREFLOP_PRIOR_PCT.coldCall);
    expect(preflopPriorPct(view, 3)).toBe(PREFLOP_PRIOR_PCT.coldCall);
    expect(preflopPriorPct(view, 4)).toBe(PREFLOP_PRIOR_PCT.checkedOption);
  });

  it("starts from the supplied prior, and filtering never resurrects a combo", () => {
    // `filter` multiplies by a floored likelihood, so a combo the prior says
    // is impossible stays impossible however the villain acts. Two priors —
    // one entirely ahead of hero, one entirely behind — pin that down exactly.
    const record = riverSpot({
      heroCards: ["Ah", "Qs"],
      villainCards: ["7h", "6h"],
      board: ["Qc", "9d", "2s", "5h", "3c"],
      bet: 200,
      line: "call",
    });
    const rangeOf = (combos: readonly [string, string][]): Float32Array => {
      const r = createRange();
      for (const [a, b] of combos) r[comboIndex(c(a) as Card, c(b) as Card)] = 1;
      return r;
    };
    const callEvBb = (range: Float32Array): number => {
      const g = gradePostflop(record, { heroSeat: 0, priorFor: () => range }).find(
        (x) => x.street === "river",
      );
      return g?.ev?.alternatives.find((a) => a.action === "call")?.evBb ?? Number.NaN;
    };

    // Sets and overpairs: hero's top pair is drawing dead. EV = −toCall.
    const ahead = rangeOf([
      ["Qd", "Qh"],
      ["9c", "9s"],
      ["Ac", "Ad"],
    ]);
    expect(callEvBb(ahead)).toBe(-2);

    // Busted draws only: hero wins every time. EV = pot + toCall = 6bb.
    const behind = rangeOf([
      ["7h", "6h"],
      ["8h", "7h"],
      ["Jh", "Th"],
    ]);
    expect(callEvBb(behind)).toBe(4);
  });

  it("respects a ground-truth policy when one is injected", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    // A policy that says "I only ever bet the nut flush" collapses the range
    // to hands hero happens to block, which the grader must simply report.
    const nutsOnly = gradePostflop(record, {
      heroSeat: 0,
      policy: (ctx) => (ctx.kind === "bet" ? Math.pow(ctx.strength, 40) : 1),
    }).find((g) => g.street === "river");
    expect(nutsOnly?.ev?.rangeSource).toBe("filtered");
    expect(nutsOnly?.confidence).toBe("medium");
  });
});

describe("gradePostflop — alternatives", () => {
  it("offers check and bets when nobody has bet, fold/call/raise when facing one", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "call" });
    const grades = gradePostflop(record, { heroSeat: 0, trials: 300 });
    const flop = grades.find((g) => g.street === "flop");
    const flopActions = (flop?.ev?.alternatives ?? []).map((a) => a.action);
    expect(flopActions).toContain("check");
    expect(flopActions.some((a) => a.startsWith("bet "))).toBe(true);
    expect(flopActions).not.toContain("fold");

    const river = grades.find((g) => g.street === "river");
    const riverActions = (river?.ev?.alternatives ?? []).map((a) => a.action);
    expect(riverActions).toEqual(expect.arrayContaining(["fold", "call"]));
    expect(riverActions.some((a) => a.startsWith("raise to "))).toBe(true);
  });

  it("puts the taken line among the priced alternatives", () => {
    const record = riverSpot({ ...HERO_NUTS, bet: 200, line: "raise" });
    const river = gradePostflop(record, { heroSeat: 0 }).find((g) => g.street === "river");
    expect(river?.kind).toBe("raise");
    const labels = (river?.ev?.alternatives ?? []).map((a) => a.action);
    // Hero raised to 600 into a 100bb game: 6.0bb.
    expect(labels).toContain("raise to 6.0bb");
    expect(river?.ev?.takenEvBb).toBeDefined();
  });
});

describe("test corpus sanity", () => {
  it("builds structurally valid records", () => {
    // `build()` runs validateEvents, so reaching here at all is the assertion.
    expect(riverSpot({ ...HERO_NUTS, bet: 200, line: "call" }).events.length).toBeGreaterThan(10);
    expect(cards("As", "Kd")).toEqual([51, 45]);
  });
});
