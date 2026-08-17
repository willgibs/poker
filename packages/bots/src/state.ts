/**
 * BotState — the only thing a bot carries between decisions.
 *
 * `decide` is pure: `(snapshot, botState, streams) → { …, nextBotState }`.
 * Everything a character remembers therefore lives in this one serializable
 * record: tilt, the opponent models that make adaptation possible, the
 * counters a few tells key off, and the tell cooldown ledger.
 *
 * The shape is JSON-safe by construction (numbers and string-keyed records
 * only) so the app can write it through a repository at hand boundaries;
 * {@link snapshotBotState} / {@link restoreBotState} are the validated
 * round-trip.
 */

import type { PersonaConfig } from "./persona";

/** Exponential-weighting factor for opponent statistics. */
export const OPPONENT_EW_ALPHA = 0.05;

/** Hands of shared history at which adaptation reaches full strength. */
export const ADAPTATION_RAMP_HANDS = 60;

/** Everything a bot remembers about one opponent. */
export interface OpponentStats {
  /** Hands observed with this opponent at the table. */
  hands: number;
  /** EW-decayed rate of voluntarily entering the pot, [0, 1]. */
  vpip: number;
  /** EW-decayed rate of raising preflop, [0, 1]. */
  pfr: number;
  /** EW-decayed rate of folding when facing a bet or raise, [0, 1]. */
  foldToBet: number;
  /** EW-decayed rate of calling when facing a bet or raise, [0, 1]. */
  callDown: number;
  /** EW-decayed rate of betting/raising when given the chance, [0, 1]. */
  aggression: number;
  /** Count of bets faced — the confidence denominator behind `foldToBet`. */
  betsFaced: number;
  /** Count of decisions observed. */
  decisions: number;
}

/** A fresh, assumption-free opponent model (all rates at the population mean). */
export function initialOpponentStats(): OpponentStats {
  return {
    hands: 0,
    vpip: 0.35,
    pfr: 0.2,
    foldToBet: 0.5,
    callDown: 0.4,
    aggression: 0.35,
    betsFaced: 0,
    decisions: 0,
  };
}

/** The bot's serializable memory. */
export interface BotState {
  /** Schema version. */
  v: 1;
  /** Persona this state belongs to; restoring onto another persona is a bug. */
  personaId: string;
  /** Current tilt, [0, 1]. Mood arcs, not switches — never surfaced as a meter. */
  tilt: number;
  /** Hands observed at this table (drives adaptation ramp and tell gates). */
  handsObserved: number;
  /** Hands since the bot last saw a flop (Luna's boredom fuse). */
  handsSinceFlop: number;
  /** Hand number of the most recent tilt event, 0 when none. */
  lastTiltHand: number;
  /** Significant pots lost recently — the accumulation trigger (Silas). */
  recentBigLosses: number;
  /** Net result against the hero in big blinds (Vera's pressure addiction). */
  netVsHeroBb: number;
  /** Opponent models keyed by seat number as a string. */
  opponents: Record<string, OpponentStats>;
  /** Hand number each tell last fired on, keyed by tell id. */
  tellLastFired: Record<string, number>;
}

/** A fresh state for a persona. */
export function initialBotState(persona: PersonaConfig): BotState {
  return {
    v: 1,
    personaId: persona.id,
    tilt: 0,
    handsObserved: 0,
    handsSinceFlop: 0,
    lastTiltHand: 0,
    recentBigLosses: 0,
    netVsHeroBb: 0,
    opponents: {},
    tellLastFired: {},
  };
}

/** Opponent model for a seat, creating a neutral one on first sight. */
export function opponentOf(state: BotState, seat: number): OpponentStats {
  return state.opponents[String(seat)] ?? initialOpponentStats();
}

/** A shallow structural copy — cheap, and enough for the pipeline's updates. */
export function cloneBotState(state: BotState): BotState {
  const opponents: Record<string, OpponentStats> = {};
  for (const [k, v] of Object.entries(state.opponents)) opponents[k] = { ...v };
  return { ...state, opponents, tellLastFired: { ...state.tellLastFired } };
}

/** Adaptation confidence for an opponent: 0 at first sight, 1 by ~60 hands. */
export function adaptationRamp(stats: OpponentStats): number {
  return Math.min(1, stats.hands / ADAPTATION_RAMP_HANDS);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * A JSON-safe snapshot. Structurally identical to {@link BotState} — the type
 * exists so persistence code can name what it is storing, and so the
 * round-trip has an asserted contract rather than an assumed one.
 */
export type BotStateSnapshot = BotState;

/** Deep, JSON-safe copy for persistence. Never returns a live reference. */
export function snapshotBotState(state: BotState): BotStateSnapshot {
  return cloneBotState(state);
}

function num(v: unknown, name: string, lo: number, hi: number, errors: string[]): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
    errors.push(`${name} must be a finite number in [${lo}, ${hi}], got ${String(v)}`);
    return lo;
  }
  return v;
}

/**
 * Validate and restore a persisted snapshot. Throws `RangeError` listing every
 * problem rather than silently producing a bot with impossible memory.
 */
export function restoreBotState(raw: unknown): BotState {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object") {
    throw new RangeError("bot state snapshot must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r["v"] !== 1) errors.push(`unsupported bot state version: ${String(r["v"])}`);
  const personaId = typeof r["personaId"] === "string" ? r["personaId"] : "";
  if (personaId.length === 0) errors.push("personaId must be a non-empty string");

  const tilt = num(r["tilt"], "tilt", 0, 1, errors);
  const handsObserved = num(r["handsObserved"], "handsObserved", 0, Number.MAX_SAFE_INTEGER, errors);
  const handsSinceFlop = num(r["handsSinceFlop"], "handsSinceFlop", 0, Number.MAX_SAFE_INTEGER, errors);
  const lastTiltHand = num(r["lastTiltHand"], "lastTiltHand", 0, Number.MAX_SAFE_INTEGER, errors);
  const recentBigLosses = num(r["recentBigLosses"], "recentBigLosses", 0, Number.MAX_SAFE_INTEGER, errors);
  const netVsHeroBb =
    typeof r["netVsHeroBb"] === "number" && Number.isFinite(r["netVsHeroBb"]) ? r["netVsHeroBb"] : 0;
  if (typeof r["netVsHeroBb"] !== "number") errors.push("netVsHeroBb must be a finite number");

  const opponents: Record<string, OpponentStats> = {};
  const rawOpponents = r["opponents"];
  if (rawOpponents !== undefined) {
    if (rawOpponents === null || typeof rawOpponents !== "object") {
      errors.push("opponents must be an object");
    } else {
      for (const [seat, v] of Object.entries(rawOpponents as Record<string, unknown>)) {
        if (v === null || typeof v !== "object") {
          errors.push(`opponents[${seat}] must be an object`);
          continue;
        }
        const o = v as Record<string, unknown>;
        opponents[seat] = {
          hands: num(o["hands"], `opponents[${seat}].hands`, 0, Number.MAX_SAFE_INTEGER, errors),
          vpip: num(o["vpip"], `opponents[${seat}].vpip`, 0, 1, errors),
          pfr: num(o["pfr"], `opponents[${seat}].pfr`, 0, 1, errors),
          foldToBet: num(o["foldToBet"], `opponents[${seat}].foldToBet`, 0, 1, errors),
          callDown: num(o["callDown"], `opponents[${seat}].callDown`, 0, 1, errors),
          aggression: num(o["aggression"], `opponents[${seat}].aggression`, 0, 1, errors),
          betsFaced: num(o["betsFaced"], `opponents[${seat}].betsFaced`, 0, Number.MAX_SAFE_INTEGER, errors),
          decisions: num(o["decisions"], `opponents[${seat}].decisions`, 0, Number.MAX_SAFE_INTEGER, errors),
        };
      }
    }
  }

  const tellLastFired: Record<string, number> = {};
  const rawTells = r["tellLastFired"];
  if (rawTells !== undefined) {
    if (rawTells === null || typeof rawTells !== "object") {
      errors.push("tellLastFired must be an object");
    } else {
      for (const [id, v] of Object.entries(rawTells as Record<string, unknown>)) {
        tellLastFired[id] = num(v, `tellLastFired[${id}]`, 0, Number.MAX_SAFE_INTEGER, errors);
      }
    }
  }

  if (errors.length > 0) {
    throw new RangeError(`invalid bot state snapshot:\n  ${errors.join("\n  ")}`);
  }
  return {
    v: 1,
    personaId,
    tilt,
    handsObserved,
    handsSinceFlop,
    lastTiltHand,
    recentBigLosses,
    netVsHeroBb,
    opponents,
    tellLastFired,
  };
}
