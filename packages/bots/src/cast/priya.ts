/**
 * Priya — tier 3 ABC. "Studious improver, a touch too tight."
 *
 * Transcribed from `content/characters/priya.md`. Her signature is a TIMING
 * tell driven purely by decision closeness — which the pipeline computes
 * anyway — so her clock is legible without any special-casing: wide EV gap,
 * snap; narrow gap, long tank.
 */

import type { PersonaConfig } from "../persona";

export const PRIYA: PersonaConfig = {
  id: "priya",
  name: "Priya",
  sketch: "Studious improver, chart-solid and shaded one notch too tight everywhere.",

  tier: 3,
  biasUnits: "probability-points",
  vpipBias: -0.05,
  pfrBias: -0.02,
  aggression: 0.35,
  tightness: 0.74,
  bluffFrequency: 0.07,
  sizingStyle: "standard",
  errorRate: 0.28,
  tiltSusceptibility: 0.22,
  adaptationRate: 0.3,
  callDownTendency: 0.22,

  // "Her bluff branch is hard-capped at <= 40% pot"; sizings above 66% are
  // only reachable from the value branch.
  gates: { nonValueMaxSizeFraction: 0.4 },

  tells: [
    {
      id: "closeness-clock",
      kind: "timing",
      signature: true,
      // The band interpolation already keys off closeness; this spec widens the
      // marginal end so her tank is unmistakable.
      trigger: {},
      behavior: { thinkTimeScale: 1 },
      read: "A snap from Priya means her hand is clear; a long tank means it is marginal — and ends in a fold too often.",
    },
    {
      id: "big-means-it",
      kind: "sizing",
      trigger: { actions: ["bet", "raise"], intent: "value", minSizeFraction: 0.66 },
      behavior: { sizeBand: [0.66, 0.85] },
      read: "When Priya bets big, she has it. Every time.",
    },
    {
      id: "the-double-check",
      kind: "behavior",
      trigger: { requiresOneCardFlushInterest: true },
      behavior: { animationCue: "re-peek" },
      read: "The re-peek means one-card flush interest — she is checking whether her card matters.",
    },
  ],

  timing: {
    trivial: { minMs: 800, maxMs: 1500 },
    base: { minMs: 2000, maxMs: 4000 },
    close: { minMs: 6000, maxMs: 12000 },
    streets: { preflop: { minMs: 1000, maxMs: 2000 } },
    tiltScale: 1.5, // "the closeness clock slows globally by ~1.5x"
    jitter: 0.7,
    floorMs: 300,
  },

  mistake: {
    id: "disciplined-overfold",
    label: "The disciplined overfold",
    bias: "fold",
    when: { facingBet: true, minStrength: 0.35, maxStrength: 0.75 },
    maxEvSacrificeBb: 3.5,
  },

  // "Moderate — but one pot played well resets her almost instantly."
  tilt: {
    badBeatSpike: 0.15, // variance has a page in the notebook
    bigLossSpike: 0.45, // her own play is what gets her
    bigLossBb: 35,
    decayPerHand: 0.15,
    resetOnWinBb: 12,
    aggressionGain: 0.8, // she shrinks, never spews
    callDownGain: 0.85,
    errorGain: 1.2,
  },
};
