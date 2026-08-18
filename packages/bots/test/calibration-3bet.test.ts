/**
 * Fold-to-3bet envelope — a calibration probe in the spirit of
 * `calibration.test.ts`'s adversarial probes, aimed at two personas the rest
 * of that file never exercises directly (`PROBE_TARGETS` there is
 * barry/hank/silas). This is the mirror-image question to the VPIP/PFR
 * envelope: not "does the persona profit against a degenerate strategy" but
 * "when it opens and gets re-raised, does its continuing range look like a
 * real range" — an envelope with two edges:
 *
 * 1. A real re-raise must fold SOME of an opening range (never a station
 *    that defends absolutely everything — that is 3-bet-and-take-it money).
 * 2. A real re-raise must fold NONE of a premium holding (never a persona
 *    that open-folds — or 3-bet-folds — the top of its own range).
 *
 * `@poker/analysis`'s `foldToThreeBet` (`packages/analysis/src/hud.ts`)
 * defines the underlying stat over a hand log: find the seat's opening raise
 * (a raise with no prior raise this hand); find any later raise (the
 * 3-bet); find the seat's next action after that (the response); the stat is
 * how often that response is a fold. `bots` cannot import `analysis`
 * (package map, `CLAUDE.md`), so this constructs that exact shape directly —
 * open, face a real re-raise, observe the response — over a battery of
 * known hands rather than a large-N frequency count.
 *
 * A large-N version (heads-up self-play against a real opponent, folding the
 * raw event log the way `calibration.test.ts` does) was tried first and
 * measured to need thousands of hands per persona for a stable sample —
 * openings that go on to face a real 3-bet are rare even at a few hundred
 * hands — which is why this pins the envelope at its two edges with known
 * holdings instead: deterministic, and it catches exactly the same
 * regression (a persona that stopped folding anything, or started folding
 * its premiums) in milliseconds rather than minutes.
 */

import { describe, expect, it } from "vitest";
import { applyAction, type ActionInput } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { decide } from "../src/pipeline";
import { personaById } from "../src/cast/index";
import { hole, startHand, stackedDeck, streamsFor } from "../src/test-helpers";
import { initialBotState } from "../src/state";
import type { PersonaConfig } from "../src/persona";
import type { TableState } from "@poker/engine";

const BLINDS = { sb: 50, bb: 100, ante: 0 };
/** 200bb — ordinary cash depth, well clear of push/fold territory. */
const STACK = 20_000;
const OPEN_TO = 250; // 2.5x the big blind — a standard open
const THREE_BET_MULTIPLE = 3; // a standard re-raise size

/**
 * Heads-up: seat 0 opens for `OPEN_TO`, seat 1 re-raises to
 * `THREE_BET_MULTIPLE` times that — a real 3-bet, applied directly rather
 * than through a second persona's own `decide`, so the spot is identical
 * regardless of which villain is nominally holding the other two cards.
 */
function threeBetSpot(heroCards: string, villainCards: string): { state: TableState; events: HandEvent[] } {
  const deckOrder = stackedDeck({ seats: [0, 1], button: 0, holes: { 0: hole(heroCards), 1: hole(villainCards) } });
  const started = startHand({ seed: "3bet-spot", stacks: [STACK, STACK], button: 0, blinds: BLINDS, deckOrder });
  let state = started.state;
  const events: HandEvent[] = [...started.events];
  const step = (input: ActionInput): void => {
    const r = applyAction(state, input);
    state = r.state;
    for (const ev of r.events) events.push(ev);
  };
  step({ seat: 0, kind: "raise", amount: OPEN_TO });
  step({ seat: 1, kind: "raise", amount: Math.round(OPEN_TO * THREE_BET_MULTIPLE) });
  return { state, events };
}

/** The response (fold / call / raise) of `persona` in seat 0 to that 3-bet. */
function respondToThreeBet(persona: PersonaConfig, heroCards: string, villainCards: string): string {
  const spot = threeBetSpot(heroCards, villainCards);
  const decision = decide(
    { state: spot.state, seat: 0, persona, events: spot.events },
    initialBotState(persona),
    streamsFor(`3bet/${persona.id}/${heroCards}`, 0, "preflop", 0),
  );
  return decision.action;
}

/** Villain's own hand is irrelevant to the hero's decision — fixed and unremarkable. */
const VILLAIN_CARDS = "4d 9c";

/** Unambiguous trash: none of these beats a coin flip against a random hand. */
const WEAK_HANDS = ["7c 2d", "8d 3h", "Jc 4s", "Th 6c", "9s 2h", "Kc 3d", "6h 2c"] as const;

/** Unambiguous premiums: the top of every persona's opening range. */
const PREMIUM_HANDS = ["Ac Ad", "Kc Kd", "Qc Qd", "Ah Kh"] as const;

describe("fold-to-3bet envelope (personas outside the adversarial-probe roster)", () => {
  // barry, hank and silas are covered by calibration.test.ts's PROBE_TARGETS;
  // vera (tier 6, disciplined) and priya (tier 3, "disciplined-overfold" per
  // her own mistake class) round out the tier spread without repeating that
  // coverage.
  const TARGETS = ["vera", "priya"] as const;

  it.each(TARGETS)("%s never folds a premium to a real re-raise", (id) => {
    const persona = personaById(id);
    for (const hand of PREMIUM_HANDS) {
      const action = respondToThreeBet(persona, hand, VILLAIN_CARDS);
      expect(action, `${id} with ${hand}`).not.toBe("fold");
    }
  });

  it.each(TARGETS)("%s folds at least some of a trash battery to a real re-raise", (id) => {
    const persona = personaById(id);
    let folds = 0;
    for (const hand of WEAK_HANDS) {
      if (respondToThreeBet(persona, hand, VILLAIN_CARDS) === "fold") folds++;
    }
    // A station that defends every single one of seven unrelated garbage
    // hands against a real re-raise is the exploit calibration.test.ts's
    // "pure-station" probe is built to catch on the other side of the
    // table; on THIS side of the table it is the same leak, expressed as
    // "3-bet it and take it forever".
    expect(folds, `${id} folded ${folds}/${WEAK_HANDS.length} of the trash battery`).toBeGreaterThan(0);
  });

  it("responds identically to the same spot across repeated calls (determinism)", () => {
    const persona = personaById("vera");
    const a = respondToThreeBet(persona, "7c 2d", VILLAIN_CARDS);
    const b = respondToThreeBet(persona, "7c 2d", VILLAIN_CARDS);
    expect(a).toBe(b);
  });
});
