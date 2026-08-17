import { describe, expect, it } from "vitest";
import { applyAction, type TableState } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { personaById } from "./cast/index";
import { buildContext, type DecisionContext } from "./context";
import { buildCandidates, type Candidate } from "./candidates";
import { buildRangeState } from "./rangeState";
import { estimateStrength } from "./strength";
import { applySizingTells, type TellFacts } from "./tells";
import { holdingFeatures } from "./handclass";
import { initialBotState } from "./state";
import { decide } from "./pipeline";
import { cards, hole, playHand, startHand, stackedDeck, streamsFor } from "./test-helpers";
import type { PersonaConfig } from "./persona";
import { streamFor } from "@poker/rng";

/**
 * Drive a heads-up hand to the turn with a stacked deck, so the acting seat
 * faces a known board holding known cards. Seat 0 is the button (and small
 * blind, per the engine's heads-up contract) and is the seat under test.
 */
function turnSpot(opts: {
  heroCards: string;
  villainCards: string;
  board: string;
  /** When set, the villain leads the turn for this many cents instead of checking. */
  villainLeadsTurn?: number;
}): {
  state: TableState;
  events: HandEvent[];
  seat: number;
} {
  const board = cards(opts.board);
  const deckOrder = stackedDeck({
    seats: [0, 1],
    button: 0,
    holes: { 0: hole(opts.heroCards), 1: hole(opts.villainCards) },
    board,
  });
  const started = startHand({ seed: "turn-spot", stacks: [20000, 20000], button: 0, deckOrder });
  let state = started.state;
  const events: HandEvent[] = [...started.events];
  const step = (input: { seat: number; kind: Candidate["kind"]; amount?: number }): void => {
    const result = applyAction(state, input);
    state = result.state;
    for (const ev of result.events) events.push(ev);
  };
  step({ seat: 0, kind: "raise", amount: 300 });
  step({ seat: 1, kind: "call", amount: 200 });
  step({ seat: 1, kind: "check" });
  step({ seat: 0, kind: "check" });
  if (opts.villainLeadsTurn === undefined) step({ seat: 1, kind: "check" });
  else step({ seat: 1, kind: "bet", amount: opts.villainLeadsTurn });
  return { state, events, seat: 0 };
}

interface Spot {
  ctx: DecisionContext;
  candidates: Candidate[];
  percentile: number;
}

function analyze(persona: PersonaConfig, spot: ReturnType<typeof turnSpot>): Spot {
  const ctx = buildContext({ state: spot.state, seat: spot.seat, persona, events: spot.events });
  const botState = initialBotState(persona);
  const rangeState = buildRangeState(ctx, persona, botState);
  const strength = estimateStrength(ctx, persona, rangeState, streamFor("tells", "mc/tells"));
  const { candidates } = buildCandidates(ctx, persona, rangeState, strength, 0);
  return { ctx, candidates, percentile: strength.strengthPercentile };
}

function sizedByTell(persona: PersonaConfig, spot: Spot, candidate: Candidate, percentile: number): number {
  const facts: TellFacts = {
    ctx: spot.ctx,
    candidate,
    strengthPercentile: percentile,
    tilt: 0,
    features: holdingFeatures(spot.ctx.hole, spot.ctx.board),
    handsObserved: 0,
    handNumber: 1,
    handsSinceFlop: 0,
    suited: false,
    oneCardFlushInterest: false,
    opponentConsecutiveChecks: 0,
    adaptationShift: 0,
    opponent: null,
  };
  const result = applySizingTells(persona, facts, initialBotState(persona));
  expect(result.fired.length).toBeGreaterThan(0);
  return result.sizeFraction;
}

describe("Rocco — the shrinking bet (sizes DOWN when weak)", () => {
  const rocco = personaById("rocco");
  const strongSpot = turnSpot({ heroCards: "Kh Kd", villainCards: "7c 6d", board: "Ks 9d 4c 2h" });
  const weakSpot = turnSpot({ heroCards: "7h 6d", villainCards: "Kc Qd", board: "Ks 9d 4c 2h" });

  it("draws value bets from the 80-130% band and bluffs from 30-45%, never overlapping", () => {
    const strong = analyze(rocco, strongSpot);
    const weak = analyze(rocco, weakSpot);
    expect(strong.percentile).toBeGreaterThan(0.9);
    expect(weak.percentile).toBeLessThan(0.5);

    const strongBet = strong.candidates.find((c) => c.kind === "bet");
    const weakBet = weak.candidates.find((c) => c.kind === "bet");
    expect(strongBet).toBeDefined();
    expect(weakBet).toBeDefined();

    const valueSize = sizedByTell(
      rocco,
      strong,
      { ...(strongBet as Candidate), intent: "value" },
      strong.percentile,
    );
    const bluffSize = sizedByTell(
      rocco,
      weak,
      { ...(weakBet as Candidate), intent: "bluff" },
      weak.percentile,
    );

    expect(valueSize).toBeGreaterThanOrEqual(0.8);
    expect(valueSize).toBeLessThanOrEqual(1.35);
    expect(bluffSize).toBeGreaterThanOrEqual(0.29);
    expect(bluffSize).toBeLessThanOrEqual(0.46);
    expect(bluffSize).toBeLessThan(valueSize);
  });

  it("keeps the tell intact on tilt — the one honest thing about him is load-bearing", () => {
    const strong = analyze(rocco, strongSpot);
    const strongBet = strong.candidates.find((c) => c.kind === "bet") as Candidate;
    const facts = (tilt: number): TellFacts => ({
      ctx: strong.ctx,
      candidate: { ...strongBet, intent: "value" },
      strengthPercentile: strong.percentile,
      tilt,
      features: holdingFeatures(strong.ctx.hole, strong.ctx.board),
      handsObserved: 0,
      handNumber: 1,
      handsSinceFlop: 0,
      suited: false,
      oneCardFlushInterest: false,
      opponentConsecutiveChecks: 0,
      adaptationShift: 0,
      opponent: null,
    });
    const calm = applySizingTells(rocco, facts(0), initialBotState(rocco));
    const steaming = applySizingTells(rocco, facts(1), initialBotState(rocco));
    expect(steaming.sizeFraction).toBeCloseTo(calm.sizeFraction, 10);
    expect(steaming.fired.map((f) => f.id)).toEqual(calm.fired.map((f) => f.id));
  });

  it("declares the two bands as non-overlapping in the persona itself", () => {
    const sizing = rocco.sizing;
    expect(sizing?.valueBand).toEqual([0.8, 1.3]);
    expect(sizing?.bluffBand).toEqual([0.3, 0.45]);
    expect((sizing?.bluffBand ?? [0, 0])[1]).toBeLessThan((sizing?.valueBand ?? [0, 0])[0]);
  });
});

describe("Doris — the raise IS the tell", () => {
  const doris = personaById("doris");

  it("has no raise or bet branch at all below her strength gate", () => {
    const weak = analyze(doris, turnSpot({ heroCards: "7h 6d", villainCards: "Kc Qd", board: "Ks 9d 4c 2h" }));
    expect(weak.percentile).toBeLessThan(0.9);
    expect(weak.candidates.some((c) => c.kind === "bet" || c.kind === "raise")).toBe(false);
    expect(weak.candidates.some((c) => c.kind === "check")).toBe(true);
  });

  it("opens the branch once she is nuts-adjacent", () => {
    const strong = analyze(doris, turnSpot({ heroCards: "Kh Kd", villainCards: "7c 6d", board: "Ks 9d 4c 2h" }));
    expect(strong.percentile).toBeGreaterThanOrEqual(0.95);
    expect(strong.candidates.some((c) => c.kind === "bet")).toBe(true);
  });

  it("sizes every aggressive action at 75-100% pot", () => {
    const strong = analyze(doris, turnSpot({ heroCards: "Kh Kd", villainCards: "7c 6d", board: "Ks 9d 4c 2h" }));
    const bet = strong.candidates.find((c) => c.kind === "bet") as Candidate;
    const size = sizedByTell(doris, strong, bet, strong.percentile);
    expect(size).toBeGreaterThanOrEqual(0.74);
    expect(size).toBeLessThanOrEqual(1.01);
  });

  it("never raises below the gate across whole seeded sessions", () => {
    let raises = 0;
    for (let i = 0; i < 30; i++) {
      const played = playHand({ seed: `doris-gate-${i}`, stacks: [20000, 20000, 20000, 20000] }, () => doris);
      for (const { decision } of played.decisions) {
        if (decision.action !== "raise" && decision.action !== "bet") continue;
        raises++;
        const gate = decision.action === "raise" ? 0.95 : 0.9;
        expect(decision.trace.strength.strengthPercentile).toBeGreaterThanOrEqual(gate);
      }
    }
    expect(raises).toBeGreaterThan(0);
  });
});

describe("Barry — snap-calls draws, tanks folds", () => {
  const barry = personaById("barry");

  it("snap-calls in 300-700ms when facing a bet with a draw", () => {
    // Hero holds two hearts on a two-heart board: a flush draw, no made hand.
    const spot = turnSpot({
      heroCards: "Th 8h",
      villainCards: "Kc Qd",
      board: "Ah 5h 2c 9s",
      villainLeadsTurn: 300,
    });
    const decision = decide(
      { state: spot.state, seat: 0, persona: barry, events: spot.events },
      initialBotState(barry),
      streamsFor("barry-draw", 0, "turn", 0),
    );
    expect(decision.action).toBe("call");
    expect(decision.trace.strength.flushDraw).toBe(true);
    expect(decision.thinkTimeMs).toBeGreaterThanOrEqual(300);
    expect(decision.thinkTimeMs).toBeLessThanOrEqual(700);
    expect(decision.trace.tells.map((t) => t.id)).toContain("snap-call-draw");
  });

  it("tanks 5-9s whenever he does fold to a bet", () => {
    let folds = 0;
    for (let i = 0; i < 40 && folds < 3; i++) {
      const played = playHand({ seed: `barry-fold-${i}`, stacks: [20000, 20000, 20000, 20000] }, () => barry);
      for (const { decision } of played.decisions) {
        if (decision.action !== "fold") continue;
        if (decision.trace.context.toCall === 0) continue;
        folds++;
        expect(decision.thinkTimeMs).toBeGreaterThanOrEqual(5000);
        expect(decision.thinkTimeMs).toBeLessThanOrEqual(9000);
      }
    }
    expect(folds).toBeGreaterThan(0);
  });
});

describe("Hank — the honest ruler", () => {
  const hank = personaById("hank");

  it("maps strength percentile onto exactly the authored five-rung ladder", () => {
    const spot = analyze(hank, turnSpot({ heroCards: "Kh Kd", villainCards: "7c 6d", board: "Ks 9d 4c 2h" }));
    const bet = spot.candidates.find((c) => c.kind === "bet") as Candidate;
    expect(bet).toBeDefined();
    const ladder = [0.3, 0.45, 0.6, 0.75, 0.95];
    const sizes = [0.05, 0.25, 0.45, 0.65, 0.99].map((pct) => sizedByTell(hank, spot, bet, pct));
    for (let i = 0; i < sizes.length; i++) {
      expect(sizes[i]).toBeCloseTo(ladder[i] as number, 1);
    }
    // Monotone: a bigger bet is always a better hand.
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1] as number);
    }
  });
});

describe("Luna — suits are destiny", () => {
  it("removes the preflop fold branch entirely when she is dealt two suited cards", () => {
    const luna = personaById("luna");
    const deckOrder = stackedDeck({
      seats: [0, 1],
      button: 0,
      holes: { 0: hole("7h 2h"), 1: hole("Ac Ad") },
    });
    const { state, events } = startHand({ seed: "luna-suited", stacks: [20000, 20000], button: 0, deckOrder });
    const raised = applyAction(state, { seat: 0, kind: "fold" });
    expect(raised.state.handOver).toBe(true); // sanity: seat 0 acts first heads-up

    const decision = decide(
      { state, seat: 0, persona: luna, events },
      initialBotState(luna),
      streamsFor("luna-suited", 0, "preflop", 0),
    );
    expect(decision.action).not.toBe("fold");
    expect(decision.trace.tells.map((t) => t.id)).toContain("suits-are-destiny");
    const foldRow = decision.trace.candidates.rows.find((r) => r.kind === "fold");
    expect(foldRow?.gatedOut).toBe(true);
  });
});

describe("Vera — the false tell is gated exactly as the bible specifies", () => {
  const vera = personaById("vera");

  it("cannot fire without the hero, the history, the pot and the strength", () => {
    // A fresh table: no shared history, no hero flagged. Nothing should fire.
    for (let i = 0; i < 20; i++) {
      const played = playHand({ seed: `vera-${i}`, stacks: [20000, 20000, 20000, 20000] }, () => vera);
      for (const { decision } of played.decisions) {
        const ids = decision.trace.tells.map((t) => t.id);
        expect(ids).not.toContain("false-tell-tank");
        expect(ids).not.toContain("false-tell-size");
      }
    }
  });

  it("declares every gate the doctrine requires", () => {
    for (const id of ["false-tell-tank", "false-tell-size"]) {
      const tell = vera.tells.find((t) => t.id === id);
      expect(tell).toBeDefined();
      expect(tell?.trigger.streets).toEqual(["river"]);
      expect(tell?.trigger.vsHero).toBe(true);
      expect(tell?.trigger.minStrength).toBe(0.95);
      expect(tell?.trigger.minPotBb).toBe(40);
      expect(tell?.trigger.minHandsObserved).toBe(120);
      expect(tell?.trigger.cooldownHands).toBe(200);
    }
  });
});
