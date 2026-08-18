/**
 * Adversarial probes — scripted deciders, deliberately NOT personas.
 *
 * A persona is a character with a bible, a tier envelope and a mood arc; these
 * are none of those. They are degenerate strategies whose only job is to press
 * one axis of a persona's decision surface until something breaks:
 *
 * | probe | presses |
 * |---|---|
 * | `always-min-raise` | can the target ever fold to relentless small aggression? |
 * | `always-jam` | does the target call off, or fold every hand, at stack depth? |
 * | `always-fold` | does the target harvest the free money, or pass it up? |
 * | `pure-station` | does the target value-bet thin, or bluff into a calling wall? |
 *
 * A persona that loses money to `always-fold`, or wins nothing from
 * `pure-station`, has a bug — not a personality. They are seated in the HERO
 * seat and driven purely from the engine's `legalActions` menu, so a probe can
 * never take an action the engine would reject and never needs a rules model of
 * its own.
 */

import type { LegalActions } from "../../packages/engine/src/index";
import type { HeroAction, HeroSnapshot } from "../../packages/sim/src/index";

/** A scripted decider: the legal menu in, one legal action out. */
export type Probe = (legal: LegalActions, snapshot: HeroSnapshot) => HeroAction;

export interface ProbeSpec {
  id: string;
  label: string;
  /** What a healthy persona should do about it, in one line. */
  expectation: string;
  decide: Probe;
}

/** Raise the minimum every time it can; otherwise call, check, or fold. */
const alwaysMinRaise: Probe = (legal) => {
  if (legal.raise !== undefined) return { kind: "raise", amount: legal.raise.minTo };
  if (legal.bet !== undefined) return { kind: "bet", amount: legal.bet.min };
  if (legal.check !== undefined) return { kind: "check" };
  if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
  return { kind: "fold" };
};

/** Get all the chips in at the first opportunity, every hand. */
const alwaysJam: Probe = (legal) => {
  if (legal.raise !== undefined) return { kind: "raise", amount: legal.raise.maxTo };
  if (legal.bet !== undefined) return { kind: "bet", amount: legal.bet.max };
  if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
  if (legal.check !== undefined) return { kind: "check" };
  return { kind: "fold" };
};

/** Fold whenever folding is legal; check when it is not (nothing to fold to). */
const alwaysFold: Probe = (legal) => {
  if (legal.fold !== undefined) return { kind: "fold" };
  if (legal.check !== undefined) return { kind: "check" };
  if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
  return { kind: "fold" };
};

/** Never folds, never raises: calls any price, checks when free. */
const pureStation: Probe = (legal) => {
  if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
  if (legal.check !== undefined) return { kind: "check" };
  return { kind: "fold" };
};

/** The probe roster, in report order. */
export const PROBES: readonly ProbeSpec[] = [
  {
    id: "always-min-raise",
    label: "always min-raise",
    expectation: "a competent persona 3-bets or calls down and prints",
    decide: alwaysMinRaise,
  },
  {
    id: "always-jam",
    label: "always jam",
    expectation: "the target should profit by calling only its strong range",
    decide: alwaysJam,
  },
  {
    id: "always-fold",
    label: "always fold",
    expectation: "free blinds: the target must win roughly +50bb/100",
    decide: alwaysFold,
  },
  {
    id: "pure-station",
    label: "pure station",
    expectation: "value-bet relentlessly, never bluff: the target should print",
    decide: pureStation,
  },
];

/** Look a probe up by id, or `undefined`. */
export function probeById(id: string): ProbeSpec | undefined {
  return PROBES.find((p) => p.id === id);
}
