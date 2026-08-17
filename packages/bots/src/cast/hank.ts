/**
 * Hank — tier 3 ABC. "Home-game hero, fit-or-fold, honest."
 *
 * Transcribed from `content/characters/hank.md`. The "honest ruler" is a
 * five-rung sizing ladder mapped straight off his strength percentile — the
 * bet size IS the hand. His error is directional: he loses by folding and by
 * not extracting, never by spewing.
 */

import type { PersonaConfig } from "../persona";

export const HANK: PersonaConfig = {
  id: "hank",
  name: "Hank",
  sketch: "Home-game hero: fit-or-fold, honest at the register and on the river.",

  tier: 3,
  biasUnits: "probability-points",
  vpipBias: -0.02,
  pfrBias: 0,
  aggression: 0.38,
  tightness: 0.62,
  bluffFrequency: 0.1,
  sizingStyle: "standard",
  errorRate: 0.32,
  tiltSusceptibility: 0.35,
  adaptationRate: 0.15,
  callDownTendency: 0.4,

  sizing: {
    potFractions: [0.3, 0.45, 0.6, 0.75, 0.95],
    preflopMultipliers: [2.5, 3],
  },

  // "He never overbets without the effective nuts."
  gates: { nonValueMaxSizeFraction: 0.8 },

  tells: [
    {
      id: "honest-ruler",
      kind: "sizing",
      signature: true,
      trigger: { actions: ["bet", "raise"], streets: ["flop", "turn", "river"] },
      behavior: { sizeLadder: [0.3, 0.45, 0.6, 0.75, 0.95] },
      read: "Bucket the bet size and you have bucketed the hand — Hank's ruler is honest.",
    },
    {
      id: "given-up-check",
      kind: "timing",
      trigger: { actions: ["check"], maxStrength: 0.35 },
      behavior: { thinkTimeMs: { minMs: 500, maxMs: 1200 } },
      read: "A snap-check from Hank means the hand is over for him.",
    },
    {
      id: "neat-when-proud",
      kind: "behavior",
      trigger: { actions: ["bet", "raise"], minSizeFraction: 0.6, intent: "value" },
      behavior: { animationCue: "tidy-stack" },
      read: "Tidy stack, tidy hand. His loose splash is a loose holding.",
    },
  ],

  timing: {
    trivial: { minMs: 900, maxMs: 2000 },
    base: { minMs: 2500, maxMs: 5000 },
    close: { minMs: 6000, maxMs: 10000 },
    streets: { preflop: { minMs: 1000, maxMs: 2500 } },
    tiltScale: 1.1,
    jitter: 0.6, // "+/-30% jitter on all bands"
    floorMs: 300,
  },

  mistake: {
    id: "fit-or-fold-overfold",
    label: "The fit-or-fold overfold",
    bias: "fold",
    when: { facingBet: true, maxStrength: 0.7 },
    maxEvSacrificeBb: 4,
  },

  // "Fast. One quiet orbit, or one pot won at showdown."
  tilt: {
    badBeatSpike: 0.6,
    bigLossSpike: 0.25,
    bigLossBb: 40,
    decayPerHand: 0.25,
    resetOnWinBb: 15,
    aggressionGain: 0.95, // deflation, not anger
    callDownGain: 1.35, // "I know you've got it, but I've gotta see it"
    errorGain: 1.2,
  },
};
