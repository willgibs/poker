/**
 * Vera — tier 6 crusher. "Cold, brilliant, career antagonist; rival-arc anchor."
 *
 * Transcribed from `content/characters/vera.md`. She has no genuine tells —
 * plus the cast's ONLY deliberate false tell, and it is hers alone. Trust in
 * the tell system survives because the false tell is scripted, bounded and
 * discoverable: every gate in the bible is encoded as a trigger condition
 * (river, pot >= 40bb, >= 0.95 strength, vs the hero only, >= 120 shared
 * hands, 200-hand cooldown), so it cannot fire opportunistically and cannot be
 * confused with a real read.
 */

import type { PersonaConfig } from "../persona";

export const VERA: PersonaConfig = {
  id: "vera",
  name: "Vera",
  sketch: "Cold, brilliant career antagonist and rival-arc anchor.",

  tier: 6,
  biasUnits: "probability-points",
  vpipBias: 0.01, // pressure needs raw material
  pfrBias: 0.015, // when theory permits a mix, she takes the aggressive branch
  aggression: 0.72,
  tightness: 0.58,
  bluffFrequency: 0.36,
  sizingStyle: "polar",
  errorRate: 0.02, // the lowest in the cast
  tiltSusceptibility: 0.06, // what tilt exists runs cold, not hot
  adaptationRate: 0.75, // high, patient, precise — second to Ingrid (locked)
  callDownTendency: 0.42,

  sizing: {
    potFractions: [0.33, 0.75, 1.2, 1.6],
    preflopMultipliers: [2.2, 2.8, 4],
  },

  tells: [
    {
      id: "flat-clock",
      kind: "behavior",
      signature: true,
      trigger: {},
      behavior: { structural: true },
      read: "Her ordinary clock carries nothing — quick, even, and faintly unnerving. Its emptiness is the read.",
    },
    {
      id: "false-tell-tank",
      kind: "timing",
      trigger: {
        streets: ["river"],
        actions: ["bet"],
        minStrength: 0.95,
        minPotBb: 40,
        vsHero: true,
        minHandsObserved: 120,
        cooldownHands: 200,
      },
      behavior: { thinkTimeMs: { minMs: 9000, maxMs: 14000 } },
      read: "Vera never tanks — except exactly then. The long tank is a lie, and she has the nuts.",
    },
    {
      id: "false-tell-size",
      kind: "sizing",
      trigger: {
        streets: ["river"],
        actions: ["bet"],
        minStrength: 0.95,
        minPotBb: 40,
        vsHero: true,
        minHandsObserved: 120,
        cooldownHands: 200,
      },
      behavior: { sizeBand: [0.5, 0.5] },
      read: "The hesitant half-pot after the tank is an invitation. Take it and you pay full price.",
    },
  ],

  timing: {
    trivial: { minMs: 700, maxMs: 1200 },
    base: { minMs: 1200, maxMs: 2200 },
    close: { minMs: 2200, maxMs: 5000 },
    streets: { river: { minMs: 2800, maxMs: 5500 } },
    tiltScale: 1, // she runs cold; the clock does not move
    jitter: 0.7,
    floorMs: 400,
  },

  mistake: {
    id: "pressure-addiction",
    label: "Pressure addiction (cold anger expressed as geometry)",
    bias: "bet",
    when: { requiresTilt: 0.2, maxStrength: 0.6 },
    maxEvSacrificeBb: 6,
  },

  // "Slow — 4-6 orbits within a session"; only the hero can move her.
  tilt: {
    badBeatSpike: 0.3,
    bigLossSpike: 0.5,
    bigLossBb: 50,
    decayPerHand: 0.05,
    resetOnWinBb: 40,
    aggressionGain: 1.25, // more polar bluffs, bigger sizings
    callDownGain: 0.95, // no loose calls, ever
    errorGain: 1.5,
  },
};
