/**
 * No persona open-folds a premium at equilibrium stacks.
 *
 * "Equilibrium stacks" here means what it means everywhere else in this
 * package: the heads-up depths `pushfold.ts` reads a solved Nash push/fold
 * chart for (`NASH_HU_DEPTHS_BB` from `@poker/charts`, 2-15bb). Only
 * `balanceAware` (tier-6) personas actually consult that chart —
 * "everyone below tier 6 plays the spot by feel" (`pushfold.ts`) — but
 * folding AA or KK first-to-act at 2-15bb is not a matter of taste at any
 * tier: the equilibrium jam frequency for both hands is ~100% at every
 * charted depth, so an open-fold here is a leak a player finds in one
 * orbit, regardless of which stage of the pipeline produced it.
 *
 * This is deliberately orthogonal to `calibration-3bet.test.ts`: that file
 * pins the response to a re-raise at ordinary 200bb cash depth; this pins
 * the FIRST action at the shallow depths where shoving is simply correct.
 * Neither file previously touched `pushfold.ts` at all.
 */

import { describe, expect, it } from "vitest";
import { NASH_HU_DEPTHS_BB } from "@poker/charts";
import { decide } from "./pipeline";
import { CAST } from "./cast/index";
import { hole, startHand, stackedDeck, streamsFor } from "./test-helpers";
import { initialBotState } from "./state";

const BB = 100;
const BLINDS = { sb: 50, bb: BB, ante: 0 };
/** Villain's hand is irrelevant — the hero acts first, unopened. */
const VILLAIN_CARDS = "4d 9c";

const PREMIUMS = [
  { label: "AA", cards: "Ac Ad" },
  { label: "KK", cards: "Kc Kd" },
] as const;

/** A spread across the charted ladder: shove-only up to the deepest charted depth. */
const SAMPLE_DEPTHS_BB = [2, 5, 10, 15] as const;

describe("no persona open-folds a premium at equilibrium stacks", () => {
  it("samples only depths that are actually on the Nash HU ladder", () => {
    for (const d of SAMPLE_DEPTHS_BB) expect(NASH_HU_DEPTHS_BB).toContain(d);
  });

  for (const persona of CAST) {
    for (const premium of PREMIUMS) {
      it(`${persona.id} never open-folds ${premium.label} from 2bb to 15bb`, () => {
        for (const depthBb of SAMPLE_DEPTHS_BB) {
          const stack = depthBb * BB;
          const seed = `pushfold-premium/${persona.id}/${premium.label}/${depthBb}`;
          const deckOrder = stackedDeck({
            seats: [0, 1],
            button: 0,
            holes: { 0: hole(premium.cards), 1: hole(VILLAIN_CARDS) },
          });
          const { state, events } = startHand({
            seed,
            stacks: [stack, stack],
            button: 0,
            blinds: BLINDS,
            deckOrder,
          });
          const decision = decide(
            { state, seat: 0, persona, events },
            initialBotState(persona),
            streamsFor(seed, 0, "preflop", 0),
          );
          expect(decision.action, `${persona.id} ${premium.label} at ${depthBb}bb`).not.toBe("fold");
        }
      });
    }
  }
});
