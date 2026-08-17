/**
 * Maxine — tier 4 aggressive. "Creative polar bluffer, hunts weakness."
 *
 * Transcribed from `content/characters/maxine.md`. Two structural signatures:
 * the rhythm leak (quick aggression skews air, slow aggression is value) and
 * "no middle" — the 50-75% pot band carries literally zero weight, enforced by
 * a gate rather than a frequency.
 */

import type { PersonaConfig } from "../persona";

export const MAXINE: PersonaConfig = {
  id: "maxine",
  name: "Maxine",
  sketch: "Polar artist who hunts hesitation and bets big or not at all.",

  tier: 4,
  biasUnits: "probability-points",
  vpipBias: 0.04,
  pfrBias: 0.04,
  aggression: 0.72,
  tightness: 0.42,
  bluffFrequency: 0.55,
  sizingStyle: "polar",
  errorRate: 0.24, // her losses are authored, not blundered
  tiltSusceptibility: 0.4,
  adaptationRate: 0.45,
  callDownTendency: 0.35,

  sizing: {
    potFractions: [0.33, 1, 1.25, 1.5],
    preflopMultipliers: [2.5, 3, 4],
  },

  // "The mid band (50-75%) has weight zero."
  gates: { forbiddenSizeBand: [0.45, 0.8] },

  tells: [
    {
      id: "rhythm-leak-bluff",
      kind: "timing",
      signature: true,
      trigger: { actions: ["bet", "raise"], intent: "bluff" },
      behavior: { thinkTimeMs: { minMs: 800, maxMs: 2000 } },
      read: "Quick aggression from Maxine skews air — her one leak, and she does not know she has it.",
    },
    {
      id: "rhythm-leak-value",
      kind: "timing",
      trigger: { actions: ["bet", "raise"], intent: "value" },
      behavior: { thinkTimeMs: { minMs: 4000, maxMs: 8000 } },
      read: "The long deliberate pause before the chips means she has it.",
    },
    {
      id: "no-middle-probe",
      kind: "sizing",
      trigger: { actions: ["bet"], intent: "neutral", streets: ["flop", "turn", "river"] },
      behavior: { sizeBand: [0.33, 0.33] },
      read: "The small bet is honestly medium; the big bet is a question with only two answers.",
    },
    {
      id: "huntress-stab",
      kind: "behavior",
      trigger: { position: "ip", minOpponentConsecutiveChecks: 2 },
      behavior: { aggressionBias: 0.6 },
      read: "Checking twice in front of Maxine is an invitation she has never once declined.",
    },
  ],

  timing: {
    trivial: { minMs: 1500, maxMs: 2600 },
    base: { minMs: 2000, maxMs: 4000 },
    close: { minMs: 2500, maxMs: 5000 },
    tiltScale: 0.85, // "her tilted bluffs come even faster"
    jitter: 0.8,
    floorMs: 300,
  },

  mistake: {
    id: "encore-bluff",
    label: "The encore bluff",
    bias: "bet",
    when: { vsStation: true, maxStrength: 0.5 },
    maxEvSacrificeBb: 16,
  },

  // "Medium, with a distinctive reset: one successful bluff or one well-built
  // winning hand restores her completely and instantly."
  tilt: {
    badBeatSpike: 0.25,
    bigLossSpike: 0.5, // being predicted is the injury
    bigLossBb: 35,
    decayPerHand: 0.12,
    resetOnWinBb: 18,
    aggressionGain: 1.3,
    callDownGain: 1,
    errorGain: 1.6,
  },
};
