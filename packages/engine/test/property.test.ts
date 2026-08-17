/**
 * Property tests: random legal action sequences driven by legalActions with
 * a seeded LCG, across 2–9 seats and random stacks. After EVERY reducer step:
 * chip conservation (auditChips), no negative stacks, purity. Every game
 * terminates, ends with Σ stacks == initial, and emits a structurally valid
 * hand log. Illegal probes taken mid-game never change the state.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateEvents } from "@poker/history";
import {
  applyAction,
  auditChips,
  initHand,
  legalActions,
  EngineError,
  type ActionInput,
  type TableState,
} from "../src/index";
import { evaluate7Naive, lcg, shuffledDeck, type Lcg } from "./helpers";

const MAX_STEPS = 2000;

function snapshot(state: TableState): string {
  return JSON.stringify({ ...state, evaluate7: undefined });
}

/** Pick a random action from the exact legal menu (weighted toward passivity). */
function chooseAction(state: TableState, rng: Lcg): ActionInput {
  const menu = legalActions(state);
  const seat = state.actionSeat!;
  const options: ActionInput[] = [];
  const push = (input: ActionInput, weight: number): void => {
    for (let i = 0; i < weight; i++) options.push(input);
  };

  if (menu.check !== undefined) push({ seat, kind: "check" }, 5);
  if (menu.call !== undefined) push({ seat, kind: "call" }, 5);
  if (menu.fold !== undefined) push({ seat, kind: "fold" }, menu.check !== undefined ? 1 : 3);
  if (menu.bet !== undefined) {
    const { min, max } = menu.bet;
    const amounts = [min, max, min + rng.int(max - min + 1)];
    push({ seat, kind: "bet", amount: amounts[rng.int(amounts.length)]! }, 3);
  }
  if (menu.raise !== undefined) {
    const { minTo, maxTo } = menu.raise;
    const amounts = [minTo, maxTo, minTo + rng.int(maxTo - minTo + 1)];
    push({ seat, kind: "raise", amount: amounts[rng.int(amounts.length)]! }, 2);
  }
  return options[rng.int(options.length)]!;
}

/** An action that the menu forbids right now, or null if all kinds are legal. */
function illegalProbe(state: TableState, rng: Lcg): ActionInput | null {
  const menu = legalActions(state);
  const seat = state.actionSeat!;
  const probes: ActionInput[] = [];
  if (menu.check === undefined) probes.push({ seat, kind: "check" });
  if (menu.call === undefined) probes.push({ seat, kind: "call" });
  if (menu.bet === undefined) probes.push({ seat, kind: "bet", amount: 100 });
  if (menu.raise === undefined) probes.push({ seat, kind: "raise", amount: state.currentBet * 2 + 100 });
  if (menu.raise !== undefined && menu.raise.minTo > state.currentBet + 1) {
    // Between a call and the min raise, not an all-in → always illegal.
    if (menu.raise.minTo < menu.raise.maxTo) {
      probes.push({ seat, kind: "raise", amount: menu.raise.minTo - 1 });
    }
  }
  // Out-of-turn probe: some other live seat.
  const other = state.seats.find((s) => s.seat !== seat && !s.folded && !s.allIn);
  if (other !== undefined) probes.push({ seat: other.seat, kind: "fold" });
  if (probes.length === 0) return null;
  return probes[rng.int(probes.length)]!;
}

interface GameSetup {
  seatCount: number;
  stacks: number[];
  button: number;
  ante: number;
  deck: number[];
}

function setup(seed: number): GameSetup {
  const rng = lcg(seed);
  const seatCount = 2 + rng.int(8); // 2..9
  const stacks = Array.from({ length: seatCount }, () => 1 + rng.int(40000)); // 1¢..400bb
  const button = rng.int(seatCount);
  const ante = rng.int(3) === 0 ? 5 + rng.int(30) : 0;
  return { seatCount, stacks, button, ante, deck: shuffledDeck(rng) };
}

function runGame(seed: number): void {
  const { stacks, button, ante, deck } = setup(seed);
  const rng = lcg(seed ^ 0x9e3779b9);
  const initialTotal = stacks.reduce((a, b) => a + b, 0);

  const init = initHand({
    handNumber: 1 + (seed % 1000),
    button,
    seats: stacks.map((stack, seat) => ({ seat, stack })),
    blinds: { sb: 50, bb: 100, ante },
    deckOrder: deck,
    evaluate7: evaluate7Naive,
  });
  let state = init.state;
  const log = [...init.events];
  auditChips(state, initialTotal);

  let steps = 0;
  while (!state.handOver) {
    expect(steps).toBeLessThan(MAX_STEPS); // termination
    steps++;

    // Illegal probe: must throw and leave the state untouched.
    if (rng.int(4) === 0) {
      const probe = illegalProbe(state, rng);
      if (probe !== null) {
        const before = snapshot(state);
        expect(() => applyAction(state, probe)).toThrow(EngineError);
        expect(snapshot(state)).toBe(before);
      }
    }

    const input = chooseAction(state, rng);
    const before = snapshot(state);
    const r = applyAction(state, input);
    expect(snapshot(state)).toBe(before); // purity
    state = r.state;
    log.push(...r.events);

    auditChips(state, initialTotal); // conservation after every step
    for (const s of state.seats) {
      expect(s.stack).toBeGreaterThanOrEqual(0); // no negative stacks
    }
  }

  // Terminal invariants.
  expect(state.seats.reduce((a, s) => a + s.stack, 0)).toBe(initialTotal);
  const validation = validateEvents(log);
  expect(validation.errors).toEqual([]);
  expect(validation.ok).toBe(true);

  // The final event is `end` and its nets match the state.
  const last = log[log.length - 1]!;
  expect(last.t).toBe("end");
  if (last.t === "end") {
    for (const { seat, net } of last.net) {
      const s = state.seats.find((x) => x.seat === seat)!;
      expect(net).toBe(s.stack - s.startingStack);
    }
  }
}

describe("random legal games (seeded)", () => {
  it("conserve chips, terminate, and emit valid logs across 2-9 seats", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        runGame(seed);
      }),
      // FC_RUNS lets CI or a local stress pass crank the sample count.
      { numRuns: Number(process.env["FC_RUNS"] ?? 120) },
    );
  });

  it("replays deterministically: same seed, same log", () => {
    const seed = 123456789;
    const collect = (): string => {
      const { stacks, button, ante, deck } = setup(seed);
      const rng = lcg(seed ^ 0x9e3779b9);
      const init = initHand({
        handNumber: 1,
        button,
        seats: stacks.map((stack, seat) => ({ seat, stack })),
        blinds: { sb: 50, bb: 100, ante },
        deckOrder: deck,
        evaluate7: evaluate7Naive,
      });
      let state = init.state;
      const log = [...init.events];
      while (!state.handOver) {
        const r = applyAction(state, chooseAction(state, rng));
        state = r.state;
        log.push(...r.events);
      }
      return JSON.stringify(log);
    };
    expect(collect()).toBe(collect());
  });
});
