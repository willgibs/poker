/**
 * Ingrid — tier 5 reg. "Exploitative shark, highest adaptation — she finds YOUR leaks."
 *
 * Transcribed from `content/characters/ingrid.md`. Every one of her tells has
 * the same shape: when she leaves her baseline, she is telling you what she
 * believes about you. Her bet size is a diagnosis — read the size, learn which
 * leak she thinks you have. None of it is deception; false tells are Vera-only.
 */

import type { PersonaConfig } from "../persona";

export const INGRID: PersonaConfig = {
  id: "ingrid",
  name: "Ingrid",
  sketch: "Exploitative shark with the cast's highest adaptation; she plays your leaks, not her cards.",

  tier: 5,
  biasUnits: "probability-points",
  vpipBias: 0.02, // she buys information
  pfrBias: 0.02, // and she'd rather raise for it than call
  aggression: 0.68,
  tightness: 0.55,
  bluffFrequency: 0.38,
  sizingStyle: "standard",
  errorRate: 0.07, // exploit attempts can misfire
  tiltSusceptibility: 0.22,
  adaptationRate: 0.95, // locked: highest in the cast
  callDownTendency: 0.5,

  tells: [
    {
      id: "premade-plan",
      kind: "timing",
      signature: true,
      trigger: { minAdaptationShift: 0.08 },
      behavior: { thinkTimeScale: 0.6 },
      read: "Fast Ingrid means the read is driving, not the hand — she decided how to play you before the cards came.",
    },
    {
      id: "sized-to-your-leak-bluff",
      kind: "sizing",
      trigger: { actions: ["bet", "raise"], intent: "bluff", vsOverfolder: true, minHandsObserved: 25 },
      behavior: { sizeBand: [0.33, 0.33] },
      read: "A cheap bluff means she has tagged you as an over-folder — why pay more for a fold that's cheap?",
    },
    {
      id: "sized-to-your-leak-value",
      kind: "sizing",
      trigger: { actions: ["bet", "raise"], intent: "value", vsStation: true, minHandsObserved: 25 },
      behavior: { sizeBand: [0.75, 1] },
      read: "A big value bet means she has tagged you as a station. She is usually right.",
    },
    {
      id: "no-blind-bluffs",
      kind: "behavior",
      trigger: { streets: ["river"], maxOpponentHands: 25 },
      behavior: { bluffFrequencyScale: 0.5 },
      read: "Ingrid does not bluff strangers — a big river bet early in your relationship is disproportionately real.",
    },
  ],

  timing: {
    trivial: { minMs: 500, maxMs: 1000 },
    base: { minMs: 1300, maxMs: 2400 },
    close: { minMs: 7000, maxMs: 11000 }, // read and hand disagree
    streets: {
      preflop: { minMs: 1000, maxMs: 2000 },
      turn: { minMs: 1600, maxMs: 3000 },
      river: { minMs: 2000, maxMs: 4500 },
    },
    tiltScale: 0.9,
    jitter: 0.7,
    floorMs: 300,
  },

  mistake: {
    id: "overfitting",
    label: "Overfitting (she trusts her model too much)",
    bias: "raise",
    when: { maxOpponentHands: 25, maxStrength: 0.6 },
    maxEvSacrificeBb: 8,
  },

  // "Moderate — 3-4 orbits, accelerated when an exploit lands."
  tilt: {
    badBeatSpike: 0.25,
    bigLossSpike: 0.4, // being out-read is the injury
    bigLossBb: 40,
    decayPerHand: 0.14,
    resetOnWinBb: 20,
    aggressionGain: 1.2,
    callDownGain: 1.05,
    errorGain: 1.5, // she overfits harder
  },
};
