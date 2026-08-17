/**
 * Luna — tier 1 whale. "Vibes-based chaos, plays any two suited."
 *
 * Transcribed from `content/characters/luna.md`. Her signature tell has two
 * halves — fast big bets are air, slow big bets are real — so it is encoded as
 * two specs sharing one trigger shape. The boredom fuse reads
 * `botState.handsSinceFlop`, which `observeHandEnd` maintains.
 */

import type { PersonaConfig } from "../persona";

export const LUNA: PersonaConfig = {
  id: "luna",
  name: "Luna",
  sketch: "Vibes-based chaos who never folds suited cards and overbets when bored.",

  tier: 1,
  biasUnits: "envelope-normalized",
  vpipBias: 0.75, // any two suited, plus whatever feels right
  pfrBias: 0.4, // raises often, sized by mood not hand
  aggression: 0.6, // high for a whale — chaos, not strategy
  tightness: 0.05,
  bluffFrequency: 0.55,
  sizingStyle: "polar",
  errorRate: 0.6,
  tiltSusceptibility: 0.4, // tilts into mania, not anger
  adaptationRate: 0.02,
  callDownTendency: 0.6,

  sizing: {
    potFractions: [0.35, 1, 1.5],
    preflopMultipliers: [2.2, 3, 4.5],
  },

  tells: [
    {
      id: "fast-overbet-is-air",
      kind: "timing",
      signature: true,
      trigger: { actions: ["bet", "raise"], minSizeFraction: 1, maxStrength: 0.5 },
      behavior: { thinkTimeMs: { minMs: 400, maxMs: 800 } },
      read: "Luna's fast pot-plus bet is air roughly four times in five.",
    },
    {
      id: "savoured-overbet-is-value",
      kind: "timing",
      trigger: { actions: ["bet", "raise"], minSizeFraction: 1, minStrength: 0.7 },
      behavior: { thinkTimeMs: { minMs: 2500, maxMs: 4500 } },
      read: "When she pauses before the big one, she is savouring a real hand.",
    },
    {
      id: "boredom-fuse",
      kind: "sizing",
      trigger: { minHandsSinceFlop: 6 },
      behavior: { sizeScale: 1.3 },
      read: "Six folded hands and her sizes jump — you can watch the boredom charging.",
    },
    {
      id: "suits-are-destiny",
      kind: "behavior",
      trigger: { streets: ["preflop"], requiresSuited: true },
      behavior: { disableFold: true },
      read: "Two suited cards and Luna is never folding preflop, whatever the price.",
    },
  ],

  timing: {
    trivial: { minMs: 400, maxMs: 1200 },
    base: { minMs: 700, maxMs: 2000 },
    close: { minMs: 1200, maxMs: 3000 },
    streets: { preflop: { minMs: 500, maxMs: 1500 } },
    fold: { minMs: 400, maxMs: 1200 },
    tiltScale: 0.85,
    jitter: 0.95,
    floorMs: 200,
  },

  mistake: {
    id: "unprovoked-spew",
    label: "Unprovoked spew (impulse aggression)",
    bias: "bet",
    when: { maxStrength: 0.45 },
    maxEvSacrificeBb: 25,
  },

  // "Instant on stimulus — one big pot, won or lost, resets her completely."
  tilt: {
    badBeatSpike: 0.15,
    bigLossSpike: 0.1,
    bigLossBb: 40,
    decayPerHand: 0.5,
    resetOnWinBb: 15,
    aggressionGain: 1.35,
    callDownGain: 1,
    errorGain: 1.25,
  },
};
