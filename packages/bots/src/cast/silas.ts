/**
 * Silas — tier 5 reg. "Quiet grinder, near-balanced, barely tilts."
 *
 * Transcribed from `content/characters/silas.md`. Almost telless by design:
 * the primary read is a NARROW river band (2.3-2.7s for value) versus a wider,
 * later one for bluffs (3.4-4.6s). The gap is deliberately subtle — nobody
 * spots this in one orbit, which is exactly what makes spotting it an earned
 * read.
 */

import type { PersonaConfig } from "../persona";

export const SILAS: PersonaConfig = {
  id: "silas",
  name: "Silas",
  sketch: "Quiet near-balanced grinder who barely tilts; the profit lives in a thousand small folds.",

  tier: 5,
  biasUnits: "probability-points",
  vpipBias: -0.015, // ~1.5 hands/100 tighter than tier baseline
  pfrBias: 0,
  aggression: 0.58,
  tightness: 0.62,
  bluffFrequency: 0.3, // near-balanced; slightly under equilibrium
  sizingStyle: "standard",
  errorRate: 0.06,
  tiltSusceptibility: 0.08, // locked: barely tilts
  adaptationRate: 0.35,
  callDownTendency: 0.45,

  sizing: {
    potFractions: [0.33, 0.5, 0.66, 0.9],
    preflopMultipliers: [2.3, 2.5, 3],
  },

  tells: [
    {
      id: "metronome-band-river-value",
      kind: "timing",
      signature: true,
      trigger: { streets: ["river"], actions: ["bet", "raise"], intent: "value", minStrength: 0.8 },
      behavior: { thinkTimeMs: { minMs: 2300, maxMs: 2700 } },
      read: "River aggression inside his narrow band is value; outside it, disproportionately a bluff.",
    },
    {
      id: "metronome-band-river-bluff",
      kind: "timing",
      trigger: { streets: ["river"], actions: ["bet", "raise"], intent: "bluff" },
      behavior: { thinkTimeMs: { minMs: 3400, maxMs: 4600 } },
      read: "The band he cannot quite keep — a slower river bet is the one to raise.",
    },
    {
      id: "quiet-monster",
      kind: "sizing",
      trigger: { streets: ["flop"], actions: ["bet"], position: "ip", headsUp: true, minStrength: 0.9 },
      behavior: { sizeBand: [0.33, 0.33] },
      read: "An undersized flop bet from Silas skews heavily toward a monster keeping you in.",
    },
    {
      id: "honest-snap-check",
      kind: "timing",
      trigger: { streets: ["turn"], actions: ["check"], position: "ip", minStrength: 0.4, maxStrength: 0.65 },
      behavior: { thinkTimeMs: { minMs: 500, maxMs: 900 } },
      read: "A snap check-back from Silas is a medium hand wanting showdown — never a trap.",
    },
  ],

  timing: {
    trivial: { minMs: 600, maxMs: 1100 },
    base: { minMs: 1400, maxMs: 2400 },
    close: { minMs: 2500, maxMs: 5000 },
    streets: { preflop: { minMs: 900, maxMs: 1700 } },
    tiltScale: 1.05,
    jitter: 0.45, // "his variance is the smallest at the table"
    floorMs: 300,
  },

  mistake: {
    id: "standard-line-tax",
    label: "The standard-line tax",
    bias: "fold",
    when: { facingBet: true, streets: ["river"], minStrength: 0.4, maxStrength: 0.82 },
    maxEvSacrificeBb: 2.5,
  },

  // "Fastest in the cast — tilt decays within 1-2 orbits."
  tilt: {
    badBeatSpike: 0.3,
    bigLossSpike: 0.25,
    bigLossBb: 45,
    decayPerHand: 0.35,
    resetOnWinBb: 5, // "a single won pot at any size resets him almost completely"
    aggressionGain: 1.05,
    callDownGain: 1.15, // "he stops giving that extra respect"
    errorGain: 1.2,
  },
};
