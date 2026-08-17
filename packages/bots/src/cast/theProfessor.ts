/**
 * The Professor — tier 6 crusher. "Near-GTO, mixed strategies, serene."
 *
 * Transcribed from `content/characters/the-professor.md`. Doctrine (locked):
 * he has NO behavioural tells. His three entries are therefore `structural` —
 * properties of his strategy a student can discover and beat with correct
 * math. The pipeline never evaluates structural tells, because a structural
 * read leaks nothing through behaviour; that is the whole point.
 *
 * His clock is a pure function of decision closeness and pot size, which is
 * what the timing stage computes by default — so the "uninformative clock" is
 * not a special case, it is the absence of every special case.
 */

import type { PersonaConfig } from "../persona";

export const THE_PROFESSOR: PersonaConfig = {
  id: "the-professor",
  name: "The Professor",
  sketch: "Serene near-GTO mixer; beating him is a math exam.",

  tier: 6,
  biasUnits: "probability-points",
  vpipBias: 0, // the baseline IS him
  pfrBias: 0,
  aggression: 0.62,
  tightness: 0.6,
  bluffFrequency: 0.33, // equilibrium-proportioned to sizing, by construction
  sizingStyle: "standard",
  errorRate: 0.03, // tiny frequency drift, never blunders
  tiltSusceptibility: 0.02, // locked: serene
  adaptationRate: 0.05, // deliberately near-floor — he plays the equilibrium, not you
  callDownTendency: 0.5, // exactly the price, no more, no less

  sizing: {
    potFractions: [0.3, 0.5, 0.75, 1.25],
    preflopMultipliers: [2.2, 2.5, 3],
  },

  tells: [
    {
      id: "uninformative-clock",
      kind: "behavior",
      signature: true,
      trigger: {},
      behavior: { structural: true },
      read: "His clock is a function of decision difficulty only. Every second spent reading it is wasted.",
    },
    {
      id: "polar-overbet",
      kind: "behavior",
      trigger: { streets: ["river"], minSizeFraction: 1 },
      behavior: { structural: true },
      read: "Over-pot on the river is exactly polarized — top value or air, never a medium hand. Call the math, not the man.",
    },
    {
      id: "range-bet",
      kind: "behavior",
      trigger: { streets: ["flop"], minSizeFraction: 0.25, maxStrength: 1 },
      behavior: { structural: true },
      read: "His 25-33% flop bet is his entire range — the one place theory obliges him to be bluff-heavy. Float and raise it.",
    },
  ],

  timing: {
    trivial: { minMs: 800, maxMs: 1400 },
    base: { minMs: 1600, maxMs: 3000 },
    close: { minMs: 3000, maxMs: 7000 },
    tiltScale: 1.1, // at most a hair of extra deliberation
    jitter: 0.75, // never metronomic, never informative
    floorMs: 400,
  },

  mistake: {
    id: "equilibrium-tax",
    label: "The equilibrium tax (he refuses to exploit)",
    bias: "call",
    when: { facingBet: true },
    maxEvSacrificeBb: 1.2, // expresses only as frequency drift
  },

  // "Immediate; by the next hand he has already filed the anomaly."
  tilt: {
    badBeatSpike: 0.1,
    bigLossSpike: 0.05,
    bigLossBb: 60,
    decayPerHand: 0.8,
    resetOnWinBb: 5,
    aggressionGain: 1, // his frequencies do not move
    callDownGain: 1,
    errorGain: 1,
  },
};
