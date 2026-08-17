/**
 * EV helpers.
 *
 * Inputs that are chip amounts (`pot`, `toCall`, `betSize`) are integer
 * cents, validated with core's `assertChips`. The *returned* values are
 * expectations — plain floats, possibly fractional cents — analysis numbers,
 * not chip amounts, so the no-float-chip-math rule does not apply to them.
 */

import { assertChips } from "@poker/core";
import { assertFraction } from "./common";

/**
 * Required equity to break even on a call: `toCall / (pot + toCall)`.
 *
 * `pot` is the pot as it stands when facing the bet (including the bet).
 * Returns 0 when there is nothing to call. Result is a fraction in [0, 1).
 */
export function potOdds(pot: number, toCall: number): number {
  assertChips(pot, "pot");
  assertChips(toCall, "toCall");
  const denom = pot + toCall;
  return denom === 0 ? 0 : toCall / denom;
}

/**
 * EV of calling `toCall` into `pot` with the given equity, relative to
 * folding (folding EV = 0):
 *
 *   callEV = equity * (pot + toCall) - toCall
 *          = equity * pot - (1 - equity) * toCall
 *
 * Zero exactly when `equity === potOdds(pot, toCall)`. Assumes the call
 * closes the action (no future betting).
 */
export function callEV(equity: number, pot: number, toCall: number): number {
  assertFraction(equity, "equity");
  assertChips(pot, "pot");
  assertChips(toCall, "toCall");
  return equity * (pot + toCall) - toCall;
}

/**
 * Simple fold-equity EV of betting `betSize` into `pot`:
 *
 *   foldFreq * pot + (1 - foldFreq) * (equityWhenCalled * (pot + 2*betSize) - betSize)
 *
 * Model: the villain either folds (hero wins the current pot) or calls
 * exactly `betSize` and the hand goes to showdown for `pot + 2 * betSize`
 * with hero having invested `betSize`. No raises, no future streets —
 * deliberately simple, for the beginner-facing layer.
 */
export function foldEquityEV(
  betSize: number,
  pot: number,
  foldFreq: number,
  equityWhenCalled: number,
): number {
  assertChips(betSize, "betSize");
  assertChips(pot, "pot");
  assertFraction(foldFreq, "foldFreq");
  assertFraction(equityWhenCalled, "equityWhenCalled");
  const evWhenCalled = equityWhenCalled * (pot + 2 * betSize) - betSize;
  return foldFreq * pot + (1 - foldFreq) * evWhenCalled;
}
