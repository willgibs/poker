/**
 * Rocco — tier 4 aggressive. "Table bully, loves 3-bets and barrels, spews on tilt."
 *
 * Transcribed from `content/characters/rocco.md`. The signature is an INVERTED
 * sizing tell: value draws from the 80-130% band, bluffs and give-ups from the
 * 30-45% band, and the two never overlap (the schema validates that). His
 * sizing tell stays intact even on tilt — the one honest thing about him is
 * load-bearing, which makes tilted Rocco exploitable in two directions at once.
 */

import type { PersonaConfig } from "../persona";

export const ROCCO: PersonaConfig = {
  id: "rocco",
  name: "Rocco",
  sketch: "Table bully who 3-bets, barrels, and keeps firing until somebody proves they have it.",

  tier: 4,
  biasUnits: "probability-points",
  vpipBias: 0.07,
  pfrBias: 0.08,
  aggression: 0.85,
  tightness: 0.3,
  bluffFrequency: 0.45,
  sizingStyle: "large",
  errorRate: 0.26, // baseline below tier 3 — the spew lives in tilt windows
  tiltSusceptibility: 0.85,
  adaptationRate: 0.18,
  callDownTendency: 0.6,

  sizing: {
    potFractions: [0.35, 0.8, 1.05, 1.3],
    preflopMultipliers: [2.5, 3, 4],
    valueBand: [0.8, 1.3],
    bluffBand: [0.3, 0.45],
  },

  tells: [
    {
      id: "shrinking-bet-value",
      kind: "sizing",
      signature: true,
      trigger: { actions: ["bet", "raise"], streets: ["turn", "river"], intent: "value" },
      behavior: { sizeBand: [0.8, 1.3] },
      read: "Rocco's value bets live in the 80-130% band. Nothing else does.",
    },
    {
      id: "shrinking-bet-bluff",
      kind: "sizing",
      trigger: { actions: ["bet", "raise"], streets: ["turn", "river"], intent: "bluff" },
      behavior: { sizeBand: [0.3, 0.45] },
      read: "A small bet from Rocco is a white flag flown loudly.",
    },
    {
      id: "tilt-throttle",
      kind: "timing",
      trigger: { minTilt: 0.35, actions: ["bet", "raise"], streets: ["preflop"] },
      behavior: { thinkTimeMs: { minMs: 400, maxMs: 950 } },
      read: "The instant raise-storm means the tilt range is open — wider, angrier, and payable.",
    },
    {
      id: "loud-when-light",
      kind: "banter",
      trigger: { actions: ["bet", "raise"], intent: "bluff", vsHero: true },
      behavior: { banterChanceScale: 2 },
      read: "The talking is the shove's bodyguard. When he is quiet behind a big bet, worry.",
    },
  ],

  timing: {
    trivial: { minMs: 600, maxMs: 1400 },
    base: { minMs: 1000, maxMs: 2500 },
    close: { minMs: 2500, maxMs: 6000 },
    streets: { preflop: { minMs: 800, maxMs: 2000 } },
    aggression: { minMs: 1000, maxMs: 2500 },
    tiltScale: 0.55, // "all bands compress toward instant"
    jitter: 0.85,
    floorMs: 250,
  },

  mistake: {
    id: "third-barrel-into-a-wall",
    label: "The third barrel into a wall",
    bias: "bet",
    when: { streets: ["turn", "river"], vsStation: true },
    maxEvSacrificeBb: 20,
  },

  // "Longest tilt decay of the launch cast below tier 5"; felting somebody
  // resets him completely.
  tilt: {
    badBeatSpike: 0.75,
    bigLossSpike: 0.7,
    bigLossBb: 40, // the bible's explicit tilt event threshold
    decayPerHand: 0.05,
    resetOnWinBb: 60,
    aggressionGain: 1.4,
    callDownGain: 1.35,
    errorGain: 1.9,
  },
};
