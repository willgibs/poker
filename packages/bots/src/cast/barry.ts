/**
 * Barry — tier 1 whale. "Retired dentist, warm chatter, allergic to folding."
 *
 * Transcribed from `content/characters/barry.md`. Barry's leak is passive by
 * construction: the bluff branch is effectively off, his raise branch is gated
 * behind two pair or better, and his call node has no price sensitivity — he
 * loses one cheerful call at a time, never in a spew.
 */

import type { PersonaConfig } from "../persona";

export const BARRY: PersonaConfig = {
  id: "barry",
  name: "Barry",
  sketch: "Retired dentist and price-blind calling station; folding feels like leaving the party early.",

  tier: 1,
  biasUnits: "envelope-normalized",
  vpipBias: 0.9, // near the loosest a tier-1 whale can be
  pfrBias: -0.5, // limps and calls; almost never raises
  aggression: 0.12,
  tightness: 0.05,
  bluffFrequency: 0.03,
  sizingStyle: "small",
  errorRate: 0.55,
  tiltSusceptibility: 0.15,
  adaptationRate: 0.05,
  callDownTendency: 0.97,

  sizing: {
    potFractions: [0.25, 0.35, 0.5],
    preflopMultipliers: [2, 2.2, 2.5],
    valueBand: [0.25, 0.45],
  },

  // "Raise actions gated to strength class two-pair+ (postflop) and QQ+/AK
  // (preflop). Bluff branch effectively disabled."
  gates: {
    raiseMinStrength: 0.9,
    aggressionMinStrength: 0.72,
    nonValueMaxSizeFraction: 0.5,
  },

  tells: [
    {
      id: "snap-call-draw",
      kind: "timing",
      signature: true,
      trigger: { actions: ["call"], facing: "bet", requiresDraw: "either", maxStrength: 0.85 },
      behavior: { thinkTimeMs: { minMs: 300, maxMs: 700 } },
      read: "A snap-call from Barry is a draw — he never thinks about a price he was always going to pay.",
    },
    {
      id: "honest-raise",
      kind: "sizing",
      trigger: { actions: ["raise"], streets: ["flop", "turn", "river"] },
      behavior: { sizeBand: [0.25, 0.45] },
      read: "A raise from Barry is two pair or better, always, and it comes small.",
    },
    {
      id: "painful-fold",
      kind: "timing",
      trigger: { actions: ["fold"], facing: "bet" },
      behavior: { thinkTimeMs: { minMs: 5000, maxMs: 9000 } },
      read: "Barry tanks every fold. If he acts fast, he isn't folding.",
    },
  ],

  timing: {
    trivial: { minMs: 800, maxMs: 2000 },
    base: { minMs: 1500, maxMs: 3000 },
    close: { minMs: 2000, maxMs: 4000 },
    streets: { preflop: { minMs: 800, maxMs: 2000 } },
    check: { minMs: 500, maxMs: 1500 },
    fold: { minMs: 5000, maxMs: 9000 },
    aggression: { minMs: 2000, maxMs: 4000 },
    tiltScale: 1,
    jitter: 0.9,
    floorMs: 250,
  },

  mistake: {
    id: "pathological-calling",
    label: "Pathological calling (price-blind station)",
    bias: "call",
    when: { facingBet: true },
    maxEvSacrificeBb: 9,
  },

  // "Barry's steam is a drizzle": fast decay, a won pot ends it.
  tilt: {
    badBeatSpike: 0.3,
    bigLossSpike: 0.15,
    bigLossBb: 40,
    decayPerHand: 0.4,
    resetOnWinBb: 8,
    aggressionGain: 1,
    callDownGain: 1.05,
    errorGain: 1.15,
  },
};
