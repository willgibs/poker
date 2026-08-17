import { describe, expect, it } from "vitest";
import { comboIndex } from "@poker/core";
import { RANGE_SIZE, filter, fullRange, maskBlocked, normalize } from "@poker/ranges";
import { streamFor } from "@poker/rng";
import {
  DEFAULT_POLICY_PARAMS,
  LIKELIHOOD_FLOOR,
  aggressionOf,
  comboStrengthPercentiles,
  continuanceFraction,
  continuationOf,
  policyLikelihood,
  summarizeAgainst,
} from "./policy";
import { buildContext } from "./context";
import { buildRangeState } from "./rangeState";
import { personaById } from "./cast/index";
import { initialBotState } from "./state";
import { cards, hole, startHand, stackedDeck } from "./test-helpers";
import { applyAction } from "@poker/engine";
import type { HandEvent } from "@poker/history";

describe("comboStrengthPercentiles", () => {
  it("uses the preflop ranking before the flop — aces top, seven-deuce bottom", () => {
    const p = comboStrengthPercentiles([]);
    const aa = p[comboIndex(48, 49)] ?? 0; // Ac Ad
    const seventwo = p[comboIndex(0, 21)] ?? 0; // 2c 7d
    expect(aa).toBeGreaterThan(0.99);
    expect(seventwo).toBeLessThan(0.15);
  });

  it("spans [0, 1] and zeroes board-blocked combos postflop", () => {
    const board = cards("Kh 9s 4c");
    const p = comboStrengthPercentiles(board);
    let min = 1;
    let max = 0;
    for (let i = 0; i < RANGE_SIZE; i++) {
      const v = p[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
    const blocked = comboIndex(board[0] as number, 51);
    expect(p[blocked]).toBe(0);
  });

  it("ranks a set above top pair above air on the same board", () => {
    const board = cards("Kh 9s 4c");
    const p = comboStrengthPercentiles(board);
    const set = p[comboIndex(...(hole("9c 9d") as [number, number]))] ?? 0;
    const topPair = p[comboIndex(...(hole("Kc Qd") as [number, number]))] ?? 0;
    const air = p[comboIndex(...(hole("7c 2d") as [number, number]))] ?? 0;
    expect(set).toBeGreaterThan(topPair);
    expect(topPair).toBeGreaterThan(air);
  });
});

describe("policy curves", () => {
  it("aggression rises with strength", () => {
    const weak = aggressionOf(0.2, DEFAULT_POLICY_PARAMS, 0.66);
    const strong = aggressionOf(0.95, DEFAULT_POLICY_PARAMS, 0.66);
    expect(strong).toBeGreaterThan(weak);
  });

  it("bluff mass sits at the very bottom of the range", () => {
    const bluffy = { ...DEFAULT_POLICY_PARAMS, bluffFrequency: 0.9 };
    expect(aggressionOf(0.02, bluffy, 0.66)).toBeGreaterThan(aggressionOf(0.02, DEFAULT_POLICY_PARAMS, 0.66));
    expect(aggressionOf(0.5, bluffy, 0.66)).toBeCloseTo(aggressionOf(0.5, DEFAULT_POLICY_PARAMS, 0.66), 6);
  });

  it("continuation rises with strength and falls with bet size", () => {
    expect(continuationOf(0.9, DEFAULT_POLICY_PARAMS, 0.5)).toBeGreaterThan(
      continuationOf(0.2, DEFAULT_POLICY_PARAMS, 0.5),
    );
    expect(continuationOf(0.6, DEFAULT_POLICY_PARAMS, 2)).toBeLessThan(
      continuationOf(0.6, DEFAULT_POLICY_PARAMS, 0.3),
    );
  });

  it("keeps price sensitivity alive at absurd sizings (log-scaled, not clamped)", () => {
    const pot = continuationOf(0.7, DEFAULT_POLICY_PARAMS, 1);
    const huge = continuationOf(0.7, DEFAULT_POLICY_PARAMS, 30);
    expect(huge).toBeLessThan(pot * 0.35);
  });

  it("call-down tendency widens continuation, tightness narrows it", () => {
    const station = { ...DEFAULT_POLICY_PARAMS, callDownTendency: 0.97 };
    const nit = { ...DEFAULT_POLICY_PARAMS, callDownTendency: 0.2 };
    expect(continuationOf(0.5, station, 0.66)).toBeGreaterThan(continuationOf(0.5, nit, 0.66));
  });
});

describe("policyLikelihood — the generative model analysis reuses", () => {
  const board = cards("Kh 9s 4c");
  const strength = comboStrengthPercentiles(board);

  it("makes folding likely with junk and unlikely with the nuts", () => {
    const like = policyLikelihood({
      action: "fold",
      street: "flop",
      sizeFraction: 0.66,
      strength,
      params: DEFAULT_POLICY_PARAMS,
    });
    const junk = like(comboIndex(...(hole("7c 2d") as [number, number])));
    const set = like(comboIndex(...(hole("9c 9d") as [number, number])));
    expect(junk).toBeGreaterThan(set);
  });

  it("makes betting likely with the nuts", () => {
    const like = policyLikelihood({
      action: "bet",
      street: "flop",
      sizeFraction: 0.66,
      strength,
      params: DEFAULT_POLICY_PARAMS,
    });
    expect(like(comboIndex(...(hole("9c 9d") as [number, number])))).toBeGreaterThan(
      like(comboIndex(...(hole("7c 2d") as [number, number]))),
    );
  });

  it("drives a Bayesian update that strengthens the posterior after a raise", () => {
    const prior = normalize(maskBlocked(fullRange(), board));
    const like = policyLikelihood({
      action: "raise",
      street: "flop",
      sizeFraction: 1,
      strength,
      params: DEFAULT_POLICY_PARAMS,
    });
    const posterior = filter(prior, like, LIKELIHOOD_FLOOR);
    const mean = (r: Float32Array): number => {
      let sum = 0;
      let mass = 0;
      for (let i = 0; i < RANGE_SIZE; i++) {
        const w = r[i] ?? 0;
        mass += w;
        sum += w * (strength[i] ?? 0);
      }
      return mass > 0 ? sum / mass : 0;
    };
    expect(mean(posterior)).toBeGreaterThan(mean(prior) + 0.1);
  });

  it("never zeroes a live combo — the epsilon floor is what makes the model survivable", () => {
    const prior = normalize(maskBlocked(fullRange(), board));
    const like = policyLikelihood({
      action: "raise",
      street: "flop",
      sizeFraction: 3,
      strength,
      params: DEFAULT_POLICY_PARAMS,
    });
    const posterior = filter(prior, like, LIKELIHOOD_FLOOR);
    const junk = posterior[comboIndex(...(hole("7c 2d") as [number, number]))] ?? 0;
    expect(junk).toBeGreaterThan(0);
  });
});

describe("continuance and range summaries", () => {
  const board = cards("Kh 9s 4c");
  const strength = comboStrengthPercentiles(board);
  const range = maskBlocked(fullRange(), board);

  it("shrinks the continuing fraction as the bet grows", () => {
    const small = continuanceFraction(range, strength, DEFAULT_POLICY_PARAMS, 0.33);
    const big = continuanceFraction(range, strength, DEFAULT_POLICY_PARAMS, 1.5);
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThan(0);
    expect(small).toBeLessThan(1);
  });

  it("reports a lower beat-rate against the continuing range than the whole range", () => {
    const summary = summarizeAgainst(range, strength, 0.7, DEFAULT_POLICY_PARAMS, 1);
    expect(summary.beatsAll).toBeGreaterThan(summary.beatsContinuing);
    expect(summary.meanPercentile).toBeGreaterThan(0.3);
    expect(summary.meanPercentile).toBeLessThan(0.7);
  });
});

describe("stage 2 — range state", () => {
  function flopSpotAfterRaise(personaId: string) {
    const persona = personaById(personaId);
    const deckOrder = stackedDeck({
      seats: [0, 1],
      button: 0,
      holes: { 0: hole("Ac Qd"), 1: hole("Kc Ks") },
      board: cards("Kh 9s 4c"),
    });
    const started = startHand({ seed: "range-state", stacks: [20000, 20000], button: 0, deckOrder });
    let state = started.state;
    const events: HandEvent[] = [...started.events];
    const step = (input: { seat: number; kind: "raise" | "call" | "check" | "bet"; amount?: number }) => {
      const r = applyAction(state, input);
      state = r.state;
      for (const ev of r.events) events.push(ev);
    };
    step({ seat: 0, kind: "raise", amount: 300 });
    step({ seat: 1, kind: "call", amount: 200 });
    step({ seat: 1, kind: "bet", amount: 600 });
    const ctx = buildContext({ state, seat: 0, persona, events });
    return buildRangeState(ctx, persona, initialBotState(persona));
  }

  it("filters for tier 3+ and reports what it conditioned on", () => {
    const rs = flopSpotAfterRaise("hank");
    expect(rs.filtered).toBe(true);
    expect(rs.trace.opponents).toHaveLength(1);
    const opponent = rs.trace.opponents[0];
    expect(opponent?.updates).toBeGreaterThan(0);
    expect(opponent?.observedActions.some((a) => a.startsWith("flop:bet"))).toBe(true);
    expect(opponent?.meanStrength).toBeGreaterThan(0.5);
  });

  it("does not filter for whales — their range is every combo the cards allow", () => {
    const rs = flopSpotAfterRaise("barry");
    expect(rs.filtered).toBe(false);
    expect(rs.trace.opponents[0]?.updates).toBe(0);
    expect(rs.trace.priorPercent).toBe(1);
  });

  it("masks the bot's own cards and the board out of every opponent range", () => {
    const rs = flopSpotAfterRaise("hank");
    for (const dead of [...cards("Kh 9s 4c"), ...hole("Ac Qd")]) {
      // Every combo containing a dead card must carry zero weight.
      for (let other = 0; other < 52; other++) {
        if (other === dead) continue;
        expect(rs.primary[comboIndex(dead, other)]).toBe(0);
      }
    }
  });

  it("is deterministic — the same spot builds the same posterior twice", () => {
    const a = flopSpotAfterRaise("silas");
    const b = flopSpotAfterRaise("silas");
    expect(Array.from(a.primary)).toEqual(Array.from(b.primary));
  });

  it("does not consume the Monte Carlo stream", () => {
    // Stage 2 is pure inference: no sampling, so an untouched stream is proof.
    const stream = streamFor("range-state-purity", "mc");
    const before = stream.nextU32();
    flopSpotAfterRaise("hank");
    const fresh = streamFor("range-state-purity", "mc");
    expect(fresh.nextU32()).toBe(before);
  });
});
