/**
 * Chip — tier 2 loose-passive. "Stream-kid energy, limps and chases, tilts fast."
 *
 * Transcribed from `content/characters/chip.md`. Highest tilt susceptibility on
 * the roster (0.9) with the roster's most dramatic tilt expression: sizes
 * inflate a category, think-times compress 40%, and a single won flip cures
 * him completely.
 */

import type { PersonaConfig } from "../persona";

export const CHIP: PersonaConfig = {
  id: "chip",
  name: "Chip",
  sketch: "Stream-kid limper who chases every draw at prices he knows are wrong, and tilts at lightspeed.",

  tier: 2,
  biasUnits: "envelope-normalized",
  vpipBias: 0.5, // loose, draw-hungry
  pfrBias: -0.35, // limper; raises only the obvious stuff
  aggression: 0.3,
  tightness: 0.2,
  bluffFrequency: 0.18,
  sizingStyle: "standard", // stream-copied sizes; inflates to large on tilt
  errorRate: 0.4,
  tiltSusceptibility: 0.9, // the fastest tilt on the roster
  adaptationRate: 0.15,
  callDownTendency: 0.75,

  tells: [
    {
      id: "radio-silence",
      kind: "banter",
      signature: true,
      trigger: { minStrength: 0.85 },
      behavior: { banterSuppressed: true },
      read: "Chip talks constantly. When he goes quiet, he has it — his silence is audible.",
    },
    {
      id: "instant-check-with-air",
      kind: "timing",
      trigger: { actions: ["check"], maxStrength: 0.35 },
      behavior: { thinkTimeMs: { minMs: 200, maxMs: 500 } },
      read: "An instant check from Chip is an auto-check: no pair, no draw, no plan.",
    },
    {
      id: "tilt-sizing-jump",
      kind: "sizing",
      trigger: { minTilt: 0.5, actions: ["bet", "raise"] },
      behavior: { sizeScale: 1.6 },
      read: "Big weird sizes from Chip mean the wound is fresh, not that he is strong.",
    },
  ],

  timing: {
    trivial: { minMs: 500, maxMs: 1500 },
    base: { minMs: 1200, maxMs: 2500 },
    close: { minMs: 2500, maxMs: 5000 },
    streets: { preflop: { minMs: 800, maxMs: 1800 } },
    fold: { minMs: 500, maxMs: 1500 },
    aggression: { minMs: 2500, maxMs: 5000 },
    tiltScale: 0.6, // "everything speeds up 40%"
    jitter: 0.85,
    floorMs: 200,
  },

  mistake: {
    id: "priced-out-chasing",
    label: "Priced-out chasing, then tilt escalation",
    bias: "call",
    when: { facingBet: true, withDraw: true },
    maxEvSacrificeBb: 12,
  },

  // "The spiral runs 15-25 hands if nothing changes — but a won flip cures him."
  tilt: {
    badBeatSpike: 0.85,
    bigLossSpike: 0.6,
    bigLossBb: 30,
    decayPerHand: 0.06,
    resetOnWinBb: 25,
    aggressionGain: 1.5,
    callDownGain: 1.3,
    errorGain: 1.8,
  },
};
