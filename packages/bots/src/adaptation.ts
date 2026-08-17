/**
 * Stage 7 — adaptation memory.
 *
 * Bots keep exponentially-weighted statistics on the seats around them and let
 * those statistics bend one number: the fold frequency stage 4 prices bets
 * against. That is the whole mechanism, and it is deliberately narrow — an
 * exploit you cannot see in the candidate table is an exploit the player can
 * never learn to counter.
 *
 * Two safety rails keep it humane:
 *
 * - **Ramp.** The shift scales with `min(1, hands / 60)`, so a character needs
 *   50-100 hands of shared history before they are fully "playing you". Ingrid
 *   arriving with a complete read on hand one would be a cheat, not a shark.
 * - **Cap.** The total shift is clamped to ±0.25 regardless of adaptation rate,
 *   so no persona can talk itself into believing you fold every hand.
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

/** Hardest shift adaptation may apply to a modelled fold frequency. */
export const MAX_FOLD_EQUITY_SHIFT = 0.25;

/** Fold-to-bet rate treated as "no information". */
export const NEUTRAL_FOLD_TO_BET = 0.5;

/** Converts a fold-to-bet deviation into a fold-equity shift. */
export const ADAPTATION_GAIN = 1.5;

export interface AdaptationResult {
  /** Signed shift applied to every modelled fold frequency in stage 4. */
  foldEquityShift: number;
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
  return {
    foldEquityShift: shift,
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
