import { describe, expect, it } from "vitest";
import type { HandEvent } from "@poker/history";
import { personaById } from "./cast/index";
import { observeHandEnd } from "./observe";
import { detectBadBeat, tiltAdjust } from "./tilt";
import { scanHand } from "./eventscan";
import { initialBotState } from "./state";
import { decide } from "./pipeline";
import { cards, hole, startHand, streamsFor } from "./test-helpers";

/**
 * A constructed heads-up hand: seat 0 gets it in with aces on a board that
 * gives them two pair, seat 1 rivers the winner. Everything the bad-beat
 * detector reads — showdown reveals, the board, the net result — is explicit.
 */
function badBeatHand(opts: { loser: number; lossCents: number; handNumber?: number }): HandEvent[] {
  const board = cards("Kd 9h 9s 2c 3d");
  const winner = opts.loser === 0 ? 1 : 0;
  const loserHole = hole("Ac Ah");
  const winnerHole = hole("Kc Ks");
  return [
    {
      t: "start",
      handNumber: opts.handNumber ?? 1,
      button: 0,
      seats: [
        { seat: 0, stack: 20000 },
        { seat: 1, stack: 20000 },
      ],
      blinds: { sb: 50, bb: 100, ante: 0 },
    },
    { t: "post", seat: 0, kind: "sb", amount: 50 },
    { t: "post", seat: 1, kind: "bb", amount: 100 },
    { t: "hole", seat: opts.loser, cards: loserHole },
    { t: "hole", seat: winner, cards: winnerHole },
    { t: "act", seat: 0, kind: "raise", toAmount: 300 },
    { t: "act", seat: 1, kind: "call", amount: 200 },
    { t: "board", street: "flop", cards: board.slice(0, 3) },
    { t: "act", seat: 1, kind: "check" },
    { t: "act", seat: 0, kind: "bet", amount: 400 },
    { t: "act", seat: 1, kind: "call", amount: 400 },
    { t: "board", street: "turn", cards: board.slice(3, 4) },
    { t: "act", seat: 1, kind: "check" },
    { t: "act", seat: 0, kind: "check" },
    { t: "board", street: "river", cards: board.slice(4, 5) },
    { t: "act", seat: 1, kind: "bet", amount: 4300 },
    { t: "act", seat: 0, kind: "call", amount: 4300 },
    {
      t: "showdown",
      reveals: [
        { seat: opts.loser, cards: loserHole },
        { seat: winner, cards: winnerHole },
      ],
    },
    { t: "pot", potIndex: 0, seat: winner, amount: 10000 },
    {
      t: "end",
      net: [
        { seat: opts.loser, net: -opts.lossCents },
        { seat: winner, net: opts.lossCents },
      ],
    },
  ];
}

/** A quiet hand: everyone folds around, nothing to feel. */
function quietHand(handNumber: number): HandEvent[] {
  return [
    {
      t: "start",
      handNumber,
      button: 0,
      seats: [
        { seat: 0, stack: 20000 },
        { seat: 1, stack: 20000 },
      ],
      blinds: { sb: 50, bb: 100, ante: 0 },
    },
    { t: "post", seat: 0, kind: "sb", amount: 50 },
    { t: "post", seat: 1, kind: "bb", amount: 100 },
    { t: "act", seat: 0, kind: "fold" },
    { t: "pot", potIndex: 0, seat: 1, amount: 150 },
    {
      t: "end",
      net: [
        { seat: 0, net: -50 },
        { seat: 1, net: 50 },
      ],
    },
  ];
}

describe("bad-beat detection", () => {
  it("fires when a strong showdown hand loses", () => {
    const scan = scanHand(badBeatHand({ loser: 0, lossCents: 5000 }));
    expect(detectBadBeat(scan, 0)).toBe(true);
  });

  it("does not fire for the winner, or for a hand that never got to showdown", () => {
    const scan = scanHand(badBeatHand({ loser: 0, lossCents: 5000 }));
    expect(detectBadBeat(scan, 1)).toBe(false);
    expect(detectBadBeat(scanHand(quietHand(2)), 0)).toBe(false);
  });
});

describe("tilt — spike and decay", () => {
  it("spikes on a constructed bad beat, scaled by susceptibility", () => {
    const events = badBeatHand({ loser: 0, lossCents: 5000 });
    const chip = personaById("chip"); // tiltSusceptibility 0.9
    const doris = personaById("doris"); // tiltSusceptibility 0.1
    const professor = personaById("the-professor"); // 0.02, the control group

    const chipAfter = observeHandEnd(initialBotState(chip), chip, events, { seat: 0 });
    const dorisAfter = observeHandEnd(initialBotState(doris), doris, events, { seat: 0 });
    const professorAfter = observeHandEnd(initialBotState(professor), professor, events, { seat: 0 });

    expect(chipAfter.tilt).toBeGreaterThan(0.5);
    expect(dorisAfter.tilt).toBeGreaterThan(0);
    expect(dorisAfter.tilt).toBeLessThan(chipAfter.tilt);
    expect(professorAfter.tilt).toBeLessThan(0.05);
    expect(chipAfter.lastTiltHand).toBe(1);
  });

  it("never leaves [0, 1] even under repeated beats", () => {
    const chip = personaById("chip");
    let state = initialBotState(chip);
    for (let i = 1; i <= 20; i++) {
      state = observeHandEnd(state, chip, badBeatHand({ loser: 0, lossCents: 9000, handNumber: i }), {
        seat: 0,
      });
      expect(state.tilt).toBeGreaterThanOrEqual(0);
      expect(state.tilt).toBeLessThanOrEqual(1);
    }
    expect(state.tilt).toBeCloseTo(1, 5);
  });

  it("decays monotonically over quiet hands", () => {
    const chip = personaById("chip");
    let state = observeHandEnd(initialBotState(chip), chip, badBeatHand({ loser: 0, lossCents: 5000 }), {
      seat: 0,
    });
    const spiked = state.tilt;
    expect(spiked).toBeGreaterThan(0.5);

    const trace: number[] = [];
    for (let i = 2; i <= 30; i++) {
      state = observeHandEnd(state, chip, quietHand(i), { seat: 0 });
      trace.push(state.tilt);
    }
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBeLessThan(trace[i - 1] as number);
    }
    expect(trace[trace.length - 1]).toBeLessThan(spiked * 0.35);
  });

  it("clears outright on a big won pot for the characters whose bibles say so", () => {
    const chip = personaById("chip");
    const spiked = observeHandEnd(initialBotState(chip), chip, badBeatHand({ loser: 0, lossCents: 5000 }), {
      seat: 0,
    });
    expect(spiked.tilt).toBeGreaterThan(0.5);
    const won = badBeatHand({ loser: 1, lossCents: 5000, handNumber: 2 });
    const cured = observeHandEnd(spiked, chip, won, { seat: 0 });
    expect(cured.tilt).toBe(0);
  });

  it("counts hands since the last flop (Luna's boredom fuse)", () => {
    const luna = personaById("luna");
    let state = initialBotState(luna);
    for (let i = 1; i <= 4; i++) state = observeHandEnd(state, luna, quietHand(i), { seat: 0 });
    expect(state.handsSinceFlop).toBe(4);
    state = observeHandEnd(state, luna, badBeatHand({ loser: 0, lossCents: 300, handNumber: 5 }), { seat: 0 });
    expect(state.handsSinceFlop).toBe(0);
  });

  it("tracks the rival ledger against the hero only", () => {
    const vera = personaById("vera");
    const state = observeHandEnd(initialBotState(vera), vera, badBeatHand({ loser: 0, lossCents: 5000 }), {
      seat: 0,
      heroSeat: 1,
    });
    expect(state.netVsHeroBb).toBeCloseTo(-50, 5);
  });
});

describe("tilt — effect on play", () => {
  it("amplifies aggression, call-down and error rate by the persona's gains", () => {
    const rocco = personaById("rocco");
    const calm = tiltAdjust(rocco, 0);
    const steaming = tiltAdjust(rocco, 1);
    expect(calm.aggression).toBeCloseTo(rocco.aggression, 10);
    expect(steaming.aggression).toBeGreaterThan(calm.aggression);
    expect(steaming.callDownTendency).toBeGreaterThan(calm.callDownTendency);
    expect(steaming.errorRate).toBeGreaterThan(calm.errorRate);
    expect(steaming.tightness).toBeLessThan(calm.tightness);
  });

  it("barely moves the serene ones", () => {
    const professor = personaById("the-professor");
    const steaming = tiltAdjust(professor, 1);
    expect(steaming.aggression).toBeCloseTo(professor.aggression, 6);
    expect(steaming.errorRate).toBeCloseTo(professor.errorRate, 6);
  });

  it("surfaces the tilt state and error flag in the trace", () => {
    const rocco = personaById("rocco");
    const { state, events } = startHand({ seed: "tilt-trace", stacks: [20000, 20000, 20000, 20000] });
    const seat = state.actionSeat as number;
    const tilted = { ...initialBotState(rocco), tilt: 1 };
    const decision = decide({ state, seat, persona: rocco, events }, tilted, streamsFor("tilt-trace", seat, "preflop", 0));
    expect(decision.trace.tiltError.tilt).toBe(1);
    expect(decision.trace.tiltError.effectiveAggression).toBeGreaterThan(rocco.aggression);
    expect(typeof decision.trace.tiltError.deliberateError).toBe("boolean");
    expect(decision.trace.tiltError.evSacrificed).toBeGreaterThanOrEqual(0);
  });
});

describe("deliberate error", () => {
  it("records the persona's own mistake class and the EV it cost, when it fires", () => {
    const barry = personaById("barry"); // errorRate 0.55, class = pathological calling
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      const { state, events } = startHand({ seed: `err-${i}`, stacks: [20000, 20000, 20000, 20000] });
      const seat = state.actionSeat as number;
      const decision = decide(
        { state, seat, persona: barry, events },
        initialBotState(barry),
        streamsFor(`err-${i}`, seat, "preflop", 0),
      );
      const t = decision.trace.tiltError;
      if (!t.deliberateError) continue;
      fired++;
      expect(t.errorClass).toBe("pathological-calling");
      expect(t.errorLabel).toBeDefined();
      expect(t.evSacrificed).toBeGreaterThan(0);
      // Never more than the authored budget.
      expect(t.evSacrificed).toBeLessThanOrEqual(barry.mistake.maxEvSacrificeBb * 100 + 1e-6);
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("never fires for a persona whose error rate is a rounding error", () => {
    const vera = personaById("vera"); // errorRate 0.02
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      const { state, events } = startHand({ seed: `vera-err-${i}`, stacks: [20000, 20000, 20000, 20000] });
      const seat = state.actionSeat as number;
      const decision = decide(
        { state, seat, persona: vera, events },
        initialBotState(vera),
        streamsFor(`vera-err-${i}`, seat, "preflop", 0),
      );
      if (decision.trace.tiltError.deliberateError) fired++;
    }
    expect(fired).toBeLessThanOrEqual(2);
  });
});
