/**
 * Stage 7 — adaptation memory.
 *
 * Bots keep exponentially-weighted statistics on the seats around them and let
 * those statistics bend exactly two numbers: the fold frequency stage 4 prices
 * bets against, and the bluff gate stage 5 rolls. Both are narrow and both are
 * visible in the trace — an exploit you cannot see in the candidate table is an
 * exploit the player can never learn to counter.
 *
 * The bluff gate is the one that pays. Bending the price of a bet only changes
 * bets the bot was already going to consider; "this one folds too much, so I
 * bluff them more" is the read a real exploitative player acts on, and it is
 * what makes `adaptationRate` worth authoring.
 *
 * Two safety rails keep it humane:
 *
 * - **Ramp.** The shift scales with `min(1, hands / 60)`, so a character needs
 *   50-100 hands of shared history before they are fully "playing you". Ingrid
 *   arriving with a complete read on hand one would be a cheat, not a shark.
 * - **Cap.** The shift is a clamped FRACTION of the modelled continuing range,
 *   so no persona can talk itself into believing you fold every hand — and no
 *   read can make an all-in look like a steal.
 *
 * The write side lives in `observe.ts`; this module is the read side plus the
 * statistic update rule.
 */

import type { PersonaConfig } from "./persona";
import {
  OPPONENT_EW_ALPHA,
  adaptationRamp,
  initialOpponentStats,
  opponentOf,
  type BotState,
  type OpponentStats,
} from "./state";
import type { HandScan } from "./eventscan";
import type { DecisionContext } from "./context";
import type { AdaptationTrace } from "./trace";

/**
 * Hardest shift adaptation may apply, as a FRACTION of the modelled continuing
 * range — `folds = 1 - continues * (1 - shift)`.
 *
 * Two things changed here after the first calibration pass, and both matter.
 *
 * It is now multiplicative. Added straight onto a fold frequency, a +0.25
 * shift is worth a quarter of the pot on every aggressive row, including the
 * all-in nobody was ever folding to — which is how "I have a read on you"
 * turns into "shove and hope". As a fraction of the continuing range it says
 * the honest thing instead: this opponent's continuing range is narrower than
 * my baseline model thinks, by this much.
 *
 * And it is far smaller. `rangeState.assumedParamsFor` ALREADY blends the same
 * observed statistics into the policy parameters the opponent is modelled
 * with, so the raw shift was the second, uncalibrated application of one
 * signal. Measured heads-up, that double count cost the mid-adaptation
 * characters 40-95 bb/100 — adaptation was a leak wearing an exploit's name.
 */
export const MAX_FOLD_EQUITY_SHIFT = 0.1;

/** Fold-to-bet rate treated as "no information". */
export const NEUTRAL_FOLD_TO_BET = 0.5;

/** Converts a fold-to-bet deviation into a fold-equity shift. */
export const ADAPTATION_GAIN = 0.5;

/**
 * Hardest multiplicative swing adaptation may apply to the bluff gate.
 *
 * The fold-equity shift alone makes adaptation a rounding error: it moves how
 * a bet is PRICED, and the bluff that never got generated cannot be priced.
 * The read a real exploitative player acts on is simpler and much more
 * valuable — "this one folds too much, so I bluff them more; that one never
 * folds, so I stop bluffing and value-bet thinner". Wiring the read to the
 * bluff gate is what makes `adaptationRate` worth having, and it is why Ingrid
 * (0.95) and Vera (0.75) are the characters it pays.
 */
export const MAX_BLUFF_ADAPTATION = 0.6;

export interface AdaptationResult {
  /** Signed shift applied to every modelled fold frequency in stage 4. */
  foldEquityShift: number;
  /** Multiplier on the persona's bluff-gate threshold, [1-MAX, 1+MAX]. */
  bluffScale: number;
  trace: AdaptationTrace;
}

/** One exponentially-weighted update toward `x`. */
function ew(current: number, x: number): number {
  return current + OPPONENT_EW_ALPHA * (x - current);
}

/**
 * Fold-a-bet reads on the primary opponent, converted into the capped,
 * ramped fold-equity shift stage 4 consumes.
 */
export function computeAdaptation(
  ctx: DecisionContext,
  persona: PersonaConfig,
  botState: BotState,
): AdaptationResult {
  const primary = pickPrimary(ctx);
  if (primary === null) {
    return {
      foldEquityShift: 0,
      bluffScale: 1,
      trace: {
        ramp: 0,
        handsObserved: botState.handsObserved,
        foldEquityShift: 0,
        observedFoldToBet: NEUTRAL_FOLD_TO_BET,
        observedCallDown: 0.4,
        primaryOpponent: null,
        capped: false,
      },
    };
  }
  const stats = opponentOf(botState, primary);
  const ramp = adaptationRamp(stats);
  const raw = (stats.foldToBet - NEUTRAL_FOLD_TO_BET) * persona.adaptationRate * ramp * ADAPTATION_GAIN;
  const shift = Math.max(-MAX_FOLD_EQUITY_SHIFT, Math.min(MAX_FOLD_EQUITY_SHIFT, raw));
  const bluffRaw =
    ((stats.foldToBet - NEUTRAL_FOLD_TO_BET) / NEUTRAL_FOLD_TO_BET) * persona.adaptationRate * ramp;
  const bluffScale =
    1 + Math.max(-MAX_BLUFF_ADAPTATION, Math.min(MAX_BLUFF_ADAPTATION, bluffRaw));
  return {
    foldEquityShift: shift,
    bluffScale,
    trace: {
      ramp,
      handsObserved: stats.hands,
      foldEquityShift: shift,
      observedFoldToBet: stats.foldToBet,
      observedCallDown: stats.callDown,
      primaryOpponent: primary,
      capped: shift !== raw,
    },
  };
}

function pickPrimary(ctx: DecisionContext): number | null {
  const live = new Set(ctx.opponents);
  const aggressor = ctx.line.streetAggressor;
  if (aggressor !== null && live.has(aggressor)) return aggressor;
  return ctx.opponents[0] ?? null;
}

/**
 * Fold one completed hand into the opponent models. Every seat that was dealt
 * in (except the bot itself) is updated; seats that never acted still get a
 * `hands` tick, because "they folded a lot of hands" is information too.
 */
export function updateOpponents(
  opponents: Record<string, OpponentStats>,
  scan: HandScan,
  selfSeat: number,
): void {
  for (const seat of scan.seats) {
    if (seat === selfSeat) continue;
    const key = String(seat);
    const stats = { ...(opponents[key] ?? initialOpponentStats()) };
    stats.hands += 1;
    stats.vpip = ew(stats.vpip, scan.vpipSeats.has(seat) ? 1 : 0);
    stats.pfr = ew(stats.pfr, scan.pfrSeats.has(seat) ? 1 : 0);
    for (const act of scan.acts) {
      if (act.seat !== seat) continue;
      stats.decisions += 1;
      stats.aggression = ew(stats.aggression, act.kind === "bet" || act.kind === "raise" ? 1 : 0);
      if (act.facing > 0) {
        stats.betsFaced += 1;
        stats.foldToBet = ew(stats.foldToBet, act.kind === "fold" ? 1 : 0);
        stats.callDown = ew(stats.callDown, act.kind === "call" || act.kind === "raise" ? 1 : 0);
      }
    }
    opponents[key] = stats;
  }
}
