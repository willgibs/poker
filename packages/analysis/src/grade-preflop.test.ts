import { HAND169_COUNT, label169 } from "@poker/core";
import { type Chart, type ChartSet, NASH_HU } from "@poker/charts";
import { describe, expect, it } from "vitest";
import {
  cashChartId,
  gradePreflop,
  nearestBucket,
  nearestNashDepth,
  preflopNodeOf,
} from "./grade-preflop";
import { buildHandView } from "./replay";
import { hand } from "./test-helpers";

// ---------------------------------------------------------------------------
// A synthetic cash chart set. No cash charts ship yet, so these exercise the
// id convention the real pack will be authored against.
// ---------------------------------------------------------------------------

function grid(hands: readonly string[], weight = 100): number[] {
  const labels = new Set(hands);
  const out = new Array<number>(HAND169_COUNT).fill(0);
  for (let i = 0; i < HAND169_COUNT; i++) {
    if (labels.has(label169(i))) out[i] = weight;
  }
  return out;
}

/** A tight-ish UTG opening range, plus a couple of mixed frequencies. */
const UTG_RFI: Chart = {
  id: "cash-6max-100bb-rfi-UTG",
  format: "cash",
  positions: ["UTG"],
  depthBb: 100,
  node: "rfi",
  weights: (() => {
    const w = grid(["AA", "KK", "QQ", "JJ", "TT", "99", "AKs", "AQs", "AJs", "AKo", "KQs"]);
    const at = (label: string): number => {
      for (let i = 0; i < HAND169_COUNT; i++) if (label169(i) === label) return i;
      throw new Error(`no such hand ${label}`);
    };
    w[at("88")] = 55; // a majority-open mixed hand
    w[at("ATs")] = 30; // a minority-open mixed hand
    return w;
  })(),
};

const BB_DEFEND: Chart = {
  id: "cash-6max-100bb-vs-rfi-BB-vs-BTN",
  format: "cash",
  positions: ["BB"],
  depthBb: 100,
  node: "vs-rfi-defend",
  weights: grid([
    "AA", "KK", "QQ", "JJ", "TT", "99", "88", "77",
    "AKs", "AQs", "AJs", "ATs", "KQs", "KJs", "QJs", "JTs", "T9s", "98s", "K8s",
    "AKo", "AQo", "AJo", "KQo",
  ]),
};

const BB_THREE_BET: Chart = {
  id: "cash-6max-100bb-vs-rfi-BB-vs-BTN-3bet",
  format: "cash",
  positions: ["BB"],
  depthBb: 100,
  node: "vs-rfi-3bet",
  weights: grid(["AA", "KK", "QQ", "AKs", "AKo", "K8s"]),
};

const CASH: ChartSet = {
  version: "test-cash-v1",
  charts: [UTG_RFI, BB_DEFEND, BB_THREE_BET],
};

// ---------------------------------------------------------------------------

/** 6-max, 100bb: hero at seat 3 (UTG) is first in and takes `line`. */
function utgOpen(holeA: string, holeB: string, line: "raise" | "fold" | "limp") {
  const b = hand({
    handNumber: 1,
    seats: [0, 1, 2, 3, 4, 5],
    button: 0,
    stack: 10_000,
    bb: 100,
    id: "utg-open",
  })
    .blinds()
    .dealTo(3, holeA, holeB)
    .deal();
  if (line === "raise") b.raise(3, 250);
  else if (line === "limp") b.call(3);
  else b.fold(3);
  for (const seat of [4, 5, 0, 1]) b.fold(seat);
  if (line === "fold") return b.award(2).build();
  return b.fold(2).award(3).build();
}

describe("gradePreflop — chart-backed nodes", () => {
  it("calls a clear chart open inline", () => {
    const grades = gradePreflop(utgOpen("As", "Ad", "raise"), { heroSeat: 3, chartSet: CASH });
    expect(grades).toHaveLength(1);
    const g = grades[0];
    expect(g?.band).toBe("inline");
    expect(g?.concept).toBe("hand-selection");
    expect(g?.chart?.chartId).toBe("cash-6max-100bb-rfi-UTG");
    expect(g?.chart?.chartSetVersion).toBe("test-cash-v1");
    expect(g?.chart?.hand).toBe("AA");
    expect(g?.chart?.weight).toBe(100);
    expect(g?.basis).toBe("chart-weight");
  });

  it("calls opening a clear fold hand significant", () => {
    // 72o: the chart opens it 0% of the time, so folds are 100%.
    const grades = gradePreflop(utgOpen("7s", "2d", "raise"), { heroSeat: 3, chartSet: CASH });
    const g = grades[0];
    expect(g?.chart?.hand).toBe("72o");
    expect(g?.chart?.weight).toBe(0);
    expect(g?.band).toBe("significant");
  });

  it("calls folding a clear fold hand inline", () => {
    const grades = gradePreflop(utgOpen("7s", "2d", "fold"), { heroSeat: 3, chartSet: CASH });
    expect(grades[0]?.band).toBe("inline");
    expect(grades[0]?.chart?.weight).toBe(100);
  });

  it("calls folding a clear open hand significant", () => {
    const grades = gradePreflop(utgOpen("As", "Ad", "fold"), { heroSeat: 3, chartSet: CASH });
    expect(grades[0]?.band).toBe("significant");
  });

  it("treats a chart's mixed frequencies as endorsement, not error", () => {
    // 88 opens 55% — a majority action, plainly inline.
    expect(gradePreflop(utgOpen("8s", "8d", "raise"), { heroSeat: 3, chartSet: CASH })[0]?.band).toBe(
      "inline",
    );
    // ...and folding it 45% of the time is inline too. Both are chart lines.
    expect(gradePreflop(utgOpen("8s", "8d", "fold"), { heroSeat: 3, chartSet: CASH })[0]?.band).toBe(
      "inline",
    );
    // ATs opens only 30%: a minor deviation to open, still not a blunder.
    expect(gradePreflop(utgOpen("As", "Ts", "raise"), { heroSeat: 3, chartSet: CASH })[0]?.band).toBe(
      "minor",
    );
  });

  it("splits a vs-RFI node across the defend and 3-bet charts", () => {
    const bbVsButton = (holeA: string, holeB: string, line: "fold" | "call" | "raise") => {
      const b = hand({
        handNumber: 2,
        seats: [0, 1, 2, 3, 4, 5],
        button: 0,
        stack: 10_000,
        bb: 100,
        id: "bb-vs-btn",
      })
        .blinds()
        .dealTo(2, holeA, holeB)
        .deal();
      for (const seat of [3, 4, 5]) b.fold(seat);
      b.raise(0, 250).fold(1);
      if (line === "fold") return b.fold(2).award(0).build();
      if (line === "call") return b.call(2).fold(0).award(2).build();
      return b.raise(2, 1000).fold(0).award(2).build();
    };
    const opts = { heroSeat: 2, chartSet: CASH };

    // K8s: continues 100%, 3-bets 100% ⇒ calling it is 0% of the chart.
    const threeBet = gradePreflop(bbVsButton("Ks", "8s", "raise"), opts)[0];
    expect(threeBet?.band).toBe("inline");
    expect(threeBet?.chart?.chartId).toBe("cash-6max-100bb-vs-rfi-BB-vs-BTN-3bet");
    expect(threeBet?.concept).toBe("blind-defense");
    expect(gradePreflop(bbVsButton("Ks", "8s", "call"), opts)[0]?.band).toBe("significant");
    expect(gradePreflop(bbVsButton("Ks", "8s", "fold"), opts)[0]?.band).toBe("significant");

    // JTs: continues 100%, never 3-bets ⇒ calling is the whole continue branch.
    expect(gradePreflop(bbVsButton("Js", "Ts", "call"), opts)[0]?.band).toBe("inline");
    expect(gradePreflop(bbVsButton("Js", "Ts", "raise"), opts)[0]?.band).toBe("significant");

    // 32o: off the defend chart entirely, so folding is the chart line.
    expect(gradePreflop(bbVsButton("3s", "2d", "fold"), opts)[0]?.band).toBe("inline");
  });
});

describe("gradePreflop — honest gaps", () => {
  it("leaves a spot ungraded when no chart covers it", () => {
    const grades = gradePreflop(utgOpen("As", "Ad", "raise"), { heroSeat: 3 });
    const g = grades[0];
    expect(g?.band).toBeUndefined();
    expect(g?.confidence).toBe("unknown");
    expect(g?.basis).toBe("none");
    expect(g?.note).toContain("left ungraded rather than guessed");
  });

  it("names an open-limp as a deviation it cannot price", () => {
    const grades = gradePreflop(utgOpen("As", "4s", "limp"), { heroSeat: 3, chartSet: CASH });
    const g = grades[0];
    expect(g?.band).toBe("minor");
    expect(g?.confidence).toBe("unknown");
    expect(g?.concept).toBe("open-vs-limp");
    expect(g?.evLossBb).toBeUndefined();
    expect(g?.note).toContain("no chart plays a limp-first strategy");
  });

  it("names an over-limp behind a limper as an iso-raising deviation", () => {
    const b = hand({ handNumber: 3, seats: [0, 1, 2, 3, 4, 5], button: 0, bb: 100 })
      .blinds()
      .dealTo(5, "Ah", "Ts")
      .deal()
      .call(3) // a limper ahead
      .fold(4)
      .call(5) // hero over-limps
      .fold(0)
      .fold(1)
      .check(2);
    const record = b.flop().check(2).check(3).check(5).award(2).build();
    const grades = gradePreflop(record, { heroSeat: 5, chartSet: CASH });
    expect(grades[0]?.concept).toBe("iso-raising");
    expect(grades[0]?.band).toBe("minor");
    expect(grades[0]?.confidence).toBe("unknown");
  });

  it("says so when the hero's cards are not in the record", () => {
    const record = hand({ seats: [0, 1], button: 0 }).blinds().dealTo(1).fold(0).award(1).build();
    const grades = gradePreflop(record, { heroSeat: 0, chartSet: CASH });
    expect(grades[0]?.band).toBeUndefined();
    expect(grades[0]?.note).toContain("hole cards are absent");
  });
});

// ---------------------------------------------------------------------------
// Push/fold against the shipped Nash charts.
// ---------------------------------------------------------------------------

/** Heads-up at `depthBb`: hero (button/SB) takes `line` first-in. */
function headsUpShort(holeA: string, holeB: string, line: "jam" | "fold" | "raise", depthBb = 10) {
  const stack = depthBb * 100;
  const b = hand({
    handNumber: 4,
    seats: [0, 1],
    button: 0,
    stack,
    bb: 100,
    id: `hu-${line}-${depthBb}`,
  })
    .blinds()
    .dealTo(0, holeA, holeB)
    .dealTo(1);
  if (line === "jam") return b.jam(0).fold(1).award(0).build();
  if (line === "raise") return b.raise(0, 200).fold(1).award(0).build();
  return b.fold(0).award(1).build();
}

describe("gradePreflop — push/fold vs the shipped Nash charts", () => {
  it("calls a clear equilibrium jam inline", () => {
    const g = gradePreflop(headsUpShort("As", "Ad", "jam"), { heroSeat: 0 })[0];
    expect(g?.band).toBe("inline");
    expect(g?.concept).toBe("push-fold");
    expect(g?.chart?.chartId).toBe("hu-nash-sb-jam-10bb");
    expect(g?.chart?.chartSetVersion).toBe(NASH_HU.version);
    expect(g?.chart?.weight).toBe(100);
  });

  it("calls jamming a hand the equilibrium never jams significant", () => {
    const g = gradePreflop(headsUpShort("3s", "2d", "jam"), { heroSeat: 0 })[0];
    expect(g?.chart?.hand).toBe("32o");
    expect(g?.chart?.weight).toBe(0);
    expect(g?.band).toBe("significant");
  });

  it("calls folding a clear jam significant, and folding trash inline", () => {
    expect(gradePreflop(headsUpShort("As", "Ad", "fold"), { heroSeat: 0 })[0]?.band).toBe(
      "significant",
    );
    expect(gradePreflop(headsUpShort("3s", "2d", "fold"), { heroSeat: 0 })[0]?.band).toBe("inline");
  });

  it("flags a min-raise at push/fold depth as off the chart's alphabet", () => {
    const g = gradePreflop(headsUpShort("As", "7d", "raise", 8), { heroSeat: 0 })[0];
    expect(g?.band).toBe("significant"); // A7o is a clear equilibrium jam at 8bb
    expect(g?.confidence).toBe("unknown");
    expect(g?.evLossBb).toBeUndefined();
    expect(g?.note).toContain("the alphabet is jam or fold");
  });

  it("prices a jam against the Nash calling range when asked", () => {
    const opts = { heroSeat: 0, estimateEv: true, trials: 4000 };
    const jam = gradePreflop(headsUpShort("As", "Ad", "jam"), opts)[0];
    expect(jam?.basis).toBe("monte-carlo");
    expect(jam?.evLossBb).toBe(0); // jamming aces is the best line available
    expect(jam?.ev?.bestAction).toBe("jam");
    expect(jam?.ev?.trials).toBe(4000);

    const folded = gradePreflop(headsUpShort("As", "Ad", "fold"), opts)[0];
    expect(folded?.evLossBb).toBeGreaterThan(1);
    expect(folded?.ev?.takenEvBb).toBe(-0.5);
  });

  it("is deterministic: the same record grades to the same number twice", () => {
    const record = headsUpShort("Ks", "Qd", "jam");
    const opts = { heroSeat: 0, estimateEv: true, trials: 2000 };
    const a = gradePreflop(record, opts)[0];
    const b = gradePreflop(record, opts)[0];
    expect(a?.evLossBb).toBe(b?.evLossBb);
    expect(a?.ev?.alternatives).toEqual(b?.ev?.alternatives);
  });

  it("grades deep heads-up play off the push/fold path", () => {
    const g = gradePreflop(headsUpShort("As", "Ad", "raise", 100), { heroSeat: 0 })[0];
    // 100bb heads-up is a cash node, and no cash chart was supplied.
    expect(g?.concept).not.toBe("push-fold");
    expect(g?.band).toBeUndefined();
  });
});

describe("preflop node classification", () => {
  it("classifies rfi, vs-rfi and vs-3bet by the raises in front", () => {
    const record = hand({ handNumber: 5, seats: [0, 1, 2, 3, 4, 5], button: 0, bb: 100 })
      .blinds()
      .dealTo(3, "Ah", "Kd")
      .deal()
      .raise(3, 250) // rfi
      .fold(4)
      .raise(5, 900) // vs-rfi (3-bet)
      .fold(0)
      .fold(1)
      .fold(2)
      .call(3) // vs-3bet
      .flop()
      .check(3)
      .check(5)
      .turn()
      .check(3)
      .check(5)
      .river()
      .check(3)
      .check(5)
      .showdown(3, 5)
      .award(3)
      .build();
    const view = buildHandView(record);
    const heroActions = view.actions.filter((a) => a.street === "preflop" && a.seat === 3);
    expect(preflopNodeOf(view, heroActions[0]!)?.kind).toBe("rfi");
    expect(preflopNodeOf(view, heroActions[1]!)?.kind).toBe("vs-3bet");
    // Classification is per-seat and structural: the 3-bettor's own node is a
    // vs-rfi spot from the cutoff against the UTG open.
    const villain = view.actions.find((a) => a.seat === 5 && a.street === "preflop");
    const villainNode = preflopNodeOf(view, villain!);
    expect(villainNode?.kind).toBe("vs-rfi");
    expect(villainNode?.position).toBe("CO");
    expect(villainNode?.vsPosition).toBe("UTG");
  });

  it("records the position it is responding to", () => {
    const record = hand({ handNumber: 6, seats: [0, 1, 2, 3, 4, 5], button: 0, bb: 100 })
      .blinds()
      .dealTo(2, "Ah", "Kd")
      .deal()
      .fold(3)
      .fold(4)
      .fold(5)
      .raise(0, 250)
      .fold(1)
      .fold(2)
      .award(0)
      .build();
    const view = buildHandView(record);
    const heroAction = view.actions.find((a) => a.seat === 2);
    const node = preflopNodeOf(view, heroAction!);
    expect(node?.kind).toBe("vs-rfi");
    expect(node?.position).toBe("BB");
    expect(node?.vsPosition).toBe("BTN");
    expect(node?.depthBb).toBe(100);
  });
});

describe("chart id convention", () => {
  it("builds ids mechanically from the node", () => {
    const node = {
      kind: "vs-rfi" as const,
      position: "BB" as const,
      vsPosition: "BTN" as const,
      tableSize: 6,
      depthBb: 97,
      hand: 0,
      handLabel: "AA",
      line: "call" as const,
      allIn: false,
    };
    expect(cashChartId(node)).toBe("cash-6max-100bb-vs-rfi-BB-vs-BTN");
    expect(cashChartId(node, "raise")).toBe("cash-6max-100bb-vs-rfi-BB-vs-BTN-3bet");
    expect(cashChartId({ ...node, kind: "rfi" })).toBe("cash-6max-100bb-rfi-BB");
    expect(cashChartId({ ...node, kind: "rfi" }, "raise")).toBeUndefined();
  });

  it("snaps depths to buckets", () => {
    expect(nearestBucket(97, [20, 40, 60, 100, 200])).toBe(100);
    expect(nearestBucket(30, [20, 40])).toBe(40); // ties round up
    expect(nearestNashDepth(9.6)).toBe(10);
    expect(nearestNashDepth(100)).toBe(15); // clamped to the charts we hold
  });
});

// ---------------------------------------------------------------------------
// The existing "is deterministic" test above only exercises the Monte Carlo
// push/fold path. The plain chart-lookup path has no sampling at all, but a
// grader that quietly depended on object/Map iteration order or accumulated
// mutable state would still be able to disagree with itself between calls —
// this pins that it does not, on both a chart-covered and an ungraded spot.
// ---------------------------------------------------------------------------

describe("gradePreflop — determinism off the Monte Carlo path", () => {
  it("is deterministic on the plain chart-lookup path — nothing sampled, nothing to vary", () => {
    const record = utgOpen("As", "Ad", "raise");
    const a = gradePreflop(record, { heroSeat: 3, chartSet: CASH });
    const b = gradePreflop(record, { heroSeat: 3, chartSet: CASH });
    expect(a).toEqual(b);
  });

  it("is deterministic on the honest-gap path too — an ungraded spot stays ungraded identically", () => {
    const record = utgOpen("As", "4s", "limp");
    const a = gradePreflop(record, { heroSeat: 3, chartSet: CASH });
    const b = gradePreflop(record, { heroSeat: 3, chartSet: CASH });
    expect(a).toEqual(b);
  });
});
