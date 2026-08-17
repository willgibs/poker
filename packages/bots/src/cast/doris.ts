/**
 * Doris — tier 2 loose-passive. "Bingo-hall legend, station until she has it."
 *
 * Transcribed from `content/characters/doris.md`. The roster's teaching anchor:
 * her raise branch is UNREACHABLE below a nuts-adjacent strength gate, so
 * "a raise from Doris is the nuts — always" is a structural fact, not a
 * frequency. The metronome exists to make the one deviation deafening.
 */

import type { PersonaConfig } from "../persona";

export const DORIS: PersonaConfig = {
  id: "doris",
  name: "Doris",
  sketch: "Bingo-hall legend who calls everything at the same unhurried rhythm and never bluffs.",

  tier: 2,
  biasUnits: "envelope-normalized",
  vpipBias: 0.45, // comfortable and wide, a notch under Chip
  pfrBias: -0.6, // the lowest PFR on the roster; AA/KK only
  aggression: 0.08,
  tightness: 0.25,
  bluffFrequency: 0.01,
  sizingStyle: "large", // when she finally bets, she bets properly
  errorRate: 0.38,
  tiltSusceptibility: 0.1,
  adaptationRate: 0.03,
  callDownTendency: 0.9,

  sizing: {
    potFractions: [0.75, 0.9, 1],
    preflopMultipliers: [3, 3.5, 4],
    valueBand: [0.75, 1],
  },

  // "Raise branch unreachable below the strength gate."
  gates: {
    raiseMinStrength: 0.95,
    aggressionMinStrength: 0.9,
  },

  tells: [
    {
      id: "the-raise-is-the-tell",
      kind: "sizing",
      signature: true,
      trigger: { actions: ["raise", "bet"] },
      behavior: { sizeBand: [0.75, 1] },
      read: "Fold to Doris's raise and you are printing; call it and you deserve what happens.",
    },
    {
      id: "chip-stacking-pause",
      kind: "timing",
      trigger: { actions: ["raise", "bet"] },
      behavior: { thinkTimeMs: { minMs: 6000, maxMs: 9000 } },
      read: "The long pause while she tidies her chips arrives before the size does.",
    },
    {
      id: "the-metronome",
      kind: "timing",
      trigger: { actions: ["call", "check"] },
      behavior: { thinkTimeMs: { minMs: 2200, maxMs: 3200 } },
      read: "Her calls and checks never vary — which is exactly why the one deviation is deafening.",
    },
  ],

  timing: {
    trivial: { minMs: 2200, maxMs: 3200 },
    base: { minMs: 2200, maxMs: 3200 },
    close: { minMs: 2500, maxMs: 3200 },
    fold: { minMs: 2500, maxMs: 4000 },
    tiltScale: 1.1,
    jitter: 0.9,
    floorMs: 400,
  },

  mistake: {
    id: "missed-value",
    label: "Monumental missed value + rhythm calling",
    bias: "call",
    when: { minStrength: 0.7 },
    maxEvSacrificeBb: 10,
  },

  // "Quick — 3-5 hands of knitting rhythm and she's a lighthouse again."
  tilt: {
    badBeatSpike: 0.7,
    bigLossSpike: 0.2,
    bigLossBb: 50,
    decayPerHand: 0.3,
    resetOnWinBb: 20,
    aggressionGain: 1,
    callDownGain: 1.15,
    errorGain: 1.05,
  },
};
