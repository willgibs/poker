/**
 * Hand-boundary observation — the write side of a bot's memory.
 *
 * `decide` is called many times per hand and must stay cheap and pure; the
 * expensive, once-per-hand bookkeeping (tilt decay and spikes, opponent
 * statistics, the counters a few tells key off) happens here, from the same
 * canonical event log everything else reads. A bot learns only from events it
 * could actually have observed — PRD realism doctrine #1.
 */

import type { HandEvent } from "@poker/history";
import { scanHand } from "./eventscan";
import type { PersonaConfig } from "./persona";
import { cloneBotState, type BotState } from "./state";
import { updateOpponents } from "./adaptation";
import { detectBadBeat } from "./tilt";

export interface ObserveOptions {
  /** The bot's own seat in the completed hand. */
  seat: number;
  /** The hero's seat, when the hero was at the table. */
  heroSeat?: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Fold one completed hand into the bot's memory and return the new state.
 *
 * Ordering matters and is deliberate: **decay first, then spike**. A hand that
 * delivers a bad beat shows the full spike rather than a spike already eroded
 * by its own hand's decay, and a quiet hand simply sheds tilt. A big enough
 * won pot clears tilt outright for the characters whose bibles say so
 * (`resetOnWinBb` — Chip's cured flip, Maxine's good scene, Silas's single
 * pot).
 */
export function observeHandEnd(
  state: BotState,
  persona: PersonaConfig,
  events: readonly HandEvent[],
  opts: ObserveOptions,
): BotState {
  const scan = scanHand(events);
  const next = cloneBotState(state);
  const bb = scan.bb > 0 ? scan.bb : 1;
  const net = scan.netBySeat.get(opts.seat) ?? 0;
  const netBb = net / bb;

  next.handsObserved += 1;

  // 1. decay
  next.tilt = clamp01(next.tilt * (1 - persona.tilt.decayPerHand));

  // 2. spikes
  const before = next.tilt;
  if (detectBadBeat(scan, opts.seat)) {
    next.tilt = clamp01(next.tilt + persona.tiltSusceptibility * persona.tilt.badBeatSpike);
  }
  if (netBb <= -persona.tilt.bigLossBb) {
    next.tilt = clamp01(next.tilt + persona.tiltSusceptibility * persona.tilt.bigLossSpike);
    next.recentBigLosses += 1;
  }
  if (next.tilt > before) next.lastTiltHand = scan.handNumber;

  // 3. the off-switch
  if (persona.tilt.resetOnWinBb > 0 && netBb >= persona.tilt.resetOnWinBb) {
    next.tilt = 0;
    next.recentBigLosses = 0;
  }

  // Boredom fuse / flop counter (Luna).
  const sawFlopHerself = scan.sawFlop && !scan.foldedSeats.has(opts.seat);
  next.handsSinceFlop = sawFlopHerself ? 0 : next.handsSinceFlop + 1;

  // Rival ledger (Vera's pressure addiction reads this).
  if (opts.heroSeat !== undefined && scan.seats.includes(opts.heroSeat)) {
    next.netVsHeroBb += netBb;
  }

  updateOpponents(next.opponents, scan, opts.seat);
  return next;
}
