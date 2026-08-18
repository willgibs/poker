/**
 * Calibration — the committed statistical gate on product risk #1, "the bots
 * feel robotic or are trivially exploitable".
 *
 * Three claims are pinned here, all seeded and therefore reproducible:
 *
 * 1. **Every character plays inside its authored envelope.** VPIP and PFR come
 *    from the bibles through `resolveFrequencies`; AF and WTSD come from the
 *    authored `aggression` and `callDownTendency` through the documented
 *    formulas below. `packages/bots/CALIBRATION.md` derives all four.
 * 2. **The tier ladder orders.** Each tier beats the tier below heads-up, at a
 *    positive margin, pooled over all four pairings.
 * 3. **No degenerate strategy prints money.** Four adversarial probes play the
 *    cast heads-up; a persona that loses to `always-fold`, or fails to punish
 *    `pure-station`, is exploitable in the way a player would actually find.
 *
 * ## Two sizes
 *
 * The default run is a CI smoke: small samples, assertions loosened to what
 * those samples can actually support, a few seconds. It catches a pipeline
 * change that moves the cast, not a two-point drift.
 *
 * `FULL_CAL=1 pnpm vitest run packages/bots/test/calibration.test.ts` runs the
 * real thing — the sample sizes the thresholds were derived at (3000+ hands per
 * character in six-max rotation, 5000+ per heads-up pairing). Expect ~20
 * minutes. That is the run the numbers in CALIBRATION.md come from, and the
 * one to re-run before changing any shaping constant.
 */

import { describe, expect, it } from "vitest";
import { CAST, castOfTier, personaById, resolveFrequencies, type Tier } from "../src/index";
import type { PersonaConfig } from "../src/persona";
import {
  PROBES,
  emptyCounters,
  foldHand,
  measure,
  mergeCounters,
  playMatch,
  playProbeMatch,
  type SeatCounters,
  type SeatMeasurement,
} from "./harness";
import { cards, hole } from "../src/test-helpers";

const FULL = process.env["FULL_CAL"] === "1";

/** Hands per six-max rotation seating. 24 seatings; each persona sits in 12. */
const ROTATION_HANDS = FULL ? 260 : 12;
/** Hands per heads-up tier-ladder pairing. */
const LADDER_HANDS = FULL ? 5000 : 300;
/** Hands per probe match. */
const PROBE_HANDS = FULL ? 3000 : 100;

/**
 * Which rungs the run is allowed to assert. At smoke sample sizes the
 * confidence interval on a pooled rung is +/-200 bb/100, and only the tier-3
 * rung has a margin large enough to survive that; asserting the rest would be
 * asserting noise, which is worse than not asserting at all. The full run
 * asserts all five.
 */
const ASSERTED_RUNGS: readonly Tier[] = FULL ? [2, 3, 4, 5, 6] : [3];

const MINUTES = 60_000;
const SLOW = FULL ? 40 * MINUTES : 2 * MINUTES;

// ---------------------------------------------------------------------------
// The envelope table
// ---------------------------------------------------------------------------

/**
 * How far a measured frequency may sit from its authored target, in points.
 *
 * The anchor in stage 5 is a soft gate, not a rule, and two structural effects
 * pull the realised number slightly under the target: a big blind that checks
 * a limped pot has entered nothing (no VPIP, by definition), and the EV term
 * plus the tightness bias both break toward folding at the margin. Measured,
 * that is worth three to five points. Eight points of tolerance covers it with
 * room, and is still far tighter than the gap between any two tiers.
 */
export const FREQUENCY_TOLERANCE_PTS = 8;

/**
 * Aggression factor envelope: `(bets + raises) / calls`, postflop.
 *
 * AF is not authored directly, so it is derived from the two parameters that
 * produce it — how often the character turns a holding into aggression, over
 * how often it answers aggression by calling:
 *
 *     centre = initiative[tier] x (0.2 + aggression) / (0.25 + callDownTendency)
 *
 * The per-tier `initiative` constant is the part that is not a property of the
 * character at all: it is how much of the time that tier holds the betting
 * lead against THIS population. A tier-3 reg at a table with two whales in it
 * is the aggressor in most pots it plays and barely ever faces a bet, so its
 * AF denominator is small for reasons that have nothing to do with its
 * personality. Measuring AF against a fixed number instead would flag the
 * table, not the character.
 *
 * The band is multiplicative and generous (half to double) because AF is a
 * ratio of two small counts. What it really pins is ORDER: the passive
 * characters must land under the aggressive ones, and they do.
 */
export const AF_TIER_INITIATIVE: Readonly<Record<Tier, number>> = {
  1: 1.1,
  2: 0.95,
  3: 3.5,
  4: 2.8,
  5: 2.65,
  6: 2.45,
};
export const AF_BAND_LOW = 0.5;
export const AF_BAND_HIGH = 2;

/**
 * Went-to-showdown envelope, in percent.
 *
 *     centre = 30 + 42 x callDownTendency,  +/- 17
 *
 * Call-down tendency is the parameter that decides how many streets a
 * character pays to see, so WTSD is close to linear in it. The intercept is
 * high because these are all-bot tables: two of the twelve characters
 * essentially never fold, which drags every showdown count at the table up.
 * Against a disciplined human field the same personas would show numbers
 * roughly ten points lower, and the intercept is the knob to move if the
 * measurement population ever changes.
 */
export function wtsdCentre(persona: PersonaConfig): number {
  return 30 + 42 * persona.callDownTendency;
}
export const WTSD_TOLERANCE_PTS = 17;

export function afCentre(persona: PersonaConfig): number {
  const initiative = AF_TIER_INITIATIVE[persona.tier];
  return (initiative * (0.2 + persona.aggression)) / (0.25 + persona.callDownTendency);
}

// ---------------------------------------------------------------------------
// Six-max rotation
// ---------------------------------------------------------------------------

/**
 * Two families of seating, stepping through the roster by 5 and by 7 (both
 * coprime with 12), so every character plays exactly twelve of the twenty-four
 * tables and meets every other character in a mixture of tier compositions.
 * A single fixed lineup would measure one table, not one cast.
 */
const ROTATION_STEPS = [5, 7] as const;

function rotationLineup(step: number, offset: number): PersonaConfig[] {
  const out: PersonaConfig[] = [];
  for (let j = 0; j < 6; j++) {
    const p = CAST[(offset + j * step) % CAST.length];
    if (p === undefined) throw new Error("cast is empty");
    out.push(p);
  }
  return out;
}

function runRotation(hands: number): Map<string, SeatMeasurement> {
  const pooled = new Map<string, SeatCounters>();
  for (const step of ROTATION_STEPS) {
    for (let offset = 0; offset < CAST.length; offset++) {
      const lineup = rotationLineup(step, offset);
      const counters = playMatch({ seed: `cal/rotate/${step}/${offset}`, personas: lineup, hands });
      lineup.forEach((persona, seat) => {
        const prev = pooled.get(persona.id) ?? emptyCounters();
        pooled.set(persona.id, mergeCounters(prev, counters[seat] as SeatCounters));
      });
    }
  }
  const out = new Map<string, SeatMeasurement>();
  for (const [id, c] of pooled) out.set(id, measure(0, id, c));
  return out;
}

let rotationCache: Map<string, SeatMeasurement> | null = null;
function rotation(): Map<string, SeatMeasurement> {
  rotationCache ??= runRotation(ROTATION_HANDS);
  return rotationCache;
}

function measured(id: string): SeatMeasurement {
  const m = rotation().get(id);
  if (m === undefined) throw new Error(`no measurement for ${id}`);
  return m;
}

// ---------------------------------------------------------------------------

describe("the statistics are the product's statistics", () => {
  it("counts VPIP, PFR, 3-bet, AF and WTSD exactly as @poker/analysis does", () => {
    // Hand-built log: seat 3 opens, seat 5 three-bets, seat 3 calls, then seat
    // 3 check-calls the flop and shows down.
    const c = emptyCounters();
    foldHand(
      c,
      [
        {
          t: "start",
          handNumber: 1,
          button: 0,
          seats: [
            { seat: 0, stack: 20_000 },
            { seat: 3, stack: 20_000 },
            { seat: 5, stack: 20_000 },
          ],
          blinds: { sb: 50, bb: 100, ante: 0 },
        },
        { t: "post", seat: 3, kind: "sb", amount: 50 },
        { t: "post", seat: 5, kind: "bb", amount: 100 },
        { t: "hole", seat: 3, cards: hole("As Kd") },
        { t: "act", seat: 0, kind: "fold" },
        { t: "act", seat: 3, kind: "raise", toAmount: 300 },
        { t: "act", seat: 5, kind: "raise", toAmount: 900 },
        { t: "act", seat: 3, kind: "call", amount: 600 },
        { t: "board", street: "flop", cards: cards("2c 7d 9h") },
        { t: "act", seat: 5, kind: "bet", amount: 600 },
        { t: "act", seat: 3, kind: "call", amount: 600 },
        { t: "board", street: "turn", cards: cards("Ah") },
        { t: "act", seat: 5, kind: "check" },
        { t: "act", seat: 3, kind: "bet", amount: 800 },
        { t: "act", seat: 5, kind: "fold" },
        { t: "end", net: [{ seat: 0, net: 0 }, { seat: 3, net: 1500 }, { seat: 5, net: -1500 }] },
      ],
      3,
      100,
    );
    expect(c.hands).toBe(1);
    expect(c.vpipN).toBe(1); // raised preflop
    expect(c.pfrN).toBe(1);
    // Seat 3 acted first with NO raise in front of it: that is an open, not a
    // 3-bet, so the hand contributes no 3-bet opportunity at all.
    expect(c.threeBetD).toBe(0);
    expect(c.aggressiveN).toBe(1); // the turn bet
    expect(c.callD).toBe(1); // the flop call (the preflop call is not postflop)
    expect(c.flopsSeen).toBe(1);
    expect(c.showdowns).toBe(0);
    expect(c.netBb).toEqual([15]);
  });

  it("scores the 3-bet only when exactly one raise is already in", () => {
    const c = emptyCounters();
    foldHand(
      c,
      [
        {
          t: "start",
          handNumber: 1,
          button: 0,
          seats: [
            { seat: 0, stack: 20_000 },
            { seat: 1, stack: 20_000 },
          ],
          blinds: { sb: 50, bb: 100, ante: 0 },
        },
        { t: "act", seat: 0, kind: "raise", toAmount: 300 },
        { t: "act", seat: 1, kind: "raise", toAmount: 900 },
        { t: "act", seat: 0, kind: "fold" },
        { t: "end", net: [{ seat: 0, net: -300 }, { seat: 1, net: 300 }] },
      ],
      1,
      100,
    );
    expect(c.threeBetD).toBe(1);
    expect(c.threeBetN).toBe(1);
  });
});

describe("determinism", () => {
  it("replays a seeded match identically", () => {
    const personas = [personaById("barry"), personaById("silas")];
    const a = playMatch({ seed: "cal/determinism", personas, hands: 12 });
    const b = playMatch({ seed: "cal/determinism", personas, hands: 12 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different match from a different seed", () => {
    const personas = [personaById("barry"), personaById("silas")];
    const a = playMatch({ seed: "cal/determinism", personas, hands: 12 });
    const b = playMatch({ seed: "cal/determinism-2", personas, hands: 12 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("every character plays inside its authored envelope", () => {
  it(
    "posts the VPIP and PFR its bible asks for",
    () => {
      const tolerance = FULL ? FREQUENCY_TOLERANCE_PTS : 20;
      const misses: string[] = [];
      for (const persona of CAST) {
        const target = resolveFrequencies(persona);
        const m = measured(persona.id);
        if (Math.abs(m.vpip - 100 * target.vpip) > tolerance) {
          misses.push(`${persona.id} VPIP ${m.vpip.toFixed(1)} vs ${(100 * target.vpip).toFixed(1)}`);
        }
        if (Math.abs(m.pfr - 100 * target.pfr) > tolerance) {
          misses.push(`${persona.id} PFR ${m.pfr.toFixed(1)} vs ${(100 * target.pfr).toFixed(1)}`);
        }
      }
      expect(misses).toEqual([]);
    },
    SLOW,
  );

  it(
    "lands inside its derived AF and WTSD envelope",
    () => {
      const afLow = FULL ? AF_BAND_LOW : 0.3;
      const afHigh = FULL ? AF_BAND_HIGH : 3.5;
      const wtsdTol = FULL ? WTSD_TOLERANCE_PTS : 30;
      const misses: string[] = [];
      for (const persona of CAST) {
        const m = measured(persona.id);
        const af = m.af;
        const centre = afCentre(persona);
        if (af === null || !Number.isFinite(af) || af < centre * afLow || af > centre * afHigh) {
          misses.push(`${persona.id} AF ${String(af)} outside ${(centre * afLow).toFixed(2)}..${(centre * afHigh).toFixed(2)}`);
        }
        const wtsd = m.wtsd;
        if (wtsd === null || Math.abs(wtsd - wtsdCentre(persona)) > wtsdTol) {
          misses.push(`${persona.id} WTSD ${String(wtsd)} vs ${wtsdCentre(persona).toFixed(1)}`);
        }
      }
      expect(misses).toEqual([]);
    },
    SLOW,
  );

  it(
    "keeps the cast's behavioural ORDER, which is what a player actually reads",
    () => {
      const vpip = (id: string): number => measured(id).vpip;
      const af = (id: string): number => measured(id).af ?? 0;
      // Whales enter more pots than regs. Every tier-1/2 character is looser
      // than every tier-3-and-up character; this is the tier ladder as the
      // player sees it, before they know what a tier is.
      const loose = CAST.filter((p) => p.tier <= 2).map((p) => vpip(p.id));
      const tight = CAST.filter((p) => p.tier >= 3).map((p) => vpip(p.id));
      expect(Math.min(...loose)).toBeGreaterThan(Math.max(...tight));

      // The passive characters are passive. Barry and Doris are the two the
      // bibles call stations outright; nobody may be more passive than they are.
      const stations = Math.max(af("barry"), af("doris"));
      for (const p of CAST) {
        if (p.id === "barry" || p.id === "doris") continue;
        expect(af(p.id)).toBeGreaterThan(stations);
      }

      // Doris's raise is the nuts: she raises preflop less than anyone.
      const doris = measured("doris").pfr;
      for (const p of CAST) expect(measured(p.id).pfr).toBeGreaterThanOrEqual(doris);
    },
    SLOW,
  );

  it(
    "never turns into a bot that only bets when strong",
    () => {
      // A character with a real bluff frequency must show a real aggression
      // factor: the failure this guards is the pipeline collapsing to
      // value-bet-or-check, which a player beats forever by folding.
      for (const persona of CAST) {
        if (persona.bluffFrequency < 0.25) continue;
        expect(measured(persona.id).af ?? 0).toBeGreaterThan(1);
      }
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// Tier ladder
// ---------------------------------------------------------------------------

interface Rung {
  tier: Tier;
  bb100: number;
  ci95: number;
  hands: number;
  wins: number;
  matches: number;
}

function ladderRung(tier: Tier, hands: number): Rung {
  const upper = castOfTier(tier);
  const lower = castOfTier((tier - 1) as Tier);
  let pooled = emptyCounters();
  let wins = 0;
  let matches = 0;
  for (const a of upper) {
    for (const b of lower) {
      const counters = playMatch({ seed: `cal/ladder/${a.id}-${b.id}`, personas: [a, b], hands });
      const seat = counters[0] as SeatCounters;
      matches += 1;
      if (measure(0, a.id, seat).bb100 > 0) wins += 1;
      pooled = mergeCounters(pooled, seat);
    }
  }
  const m = measure(0, `tier${tier}`, pooled);
  return { tier, bb100: m.bb100, ci95: m.ci95, hands: m.hands, wins, matches };
}

describe("the tier ladder orders", () => {
  it(
    "has every tier beating the tier below, heads-up, at a positive margin",
    () => {
      const rungs = ASSERTED_RUNGS.map((t) => ladderRung(t, LADDER_HANDS));
      const report = rungs
        .map((r) => `T${r.tier}>T${r.tier - 1} ${r.bb100.toFixed(1)}+-${r.ci95.toFixed(1)} (${r.wins}/${r.matches})`)
        .join("  ");
      for (const r of rungs) {
        expect(r.bb100, `${report}\n  tier ${r.tier} margin`).toBeGreaterThan(0);
        expect(r.hands).toBeGreaterThanOrEqual(4 * LADDER_HANDS);
      }
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** One persona per skill band; the probes are about the pipeline, not the cast. */
const PROBE_TARGETS = ["barry", "hank", "silas"] as const;

describe("no degenerate strategy prints money", () => {
  it(
    "beats every adversarial probe with every probed persona",
    () => {
      const misses: string[] = [];
      for (const id of PROBE_TARGETS) {
        const persona = personaById(id);
        for (const probe of PROBES) {
          const counters = playProbeMatch({
            seed: `cal/probe/${id}/${probe.id}`,
            persona,
            probe,
            hands: PROBE_HANDS,
          });
          const m = measure(1, id, counters);
          if (m.bb100 <= 0) {
            misses.push(`${id} loses ${m.bb100.toFixed(1)} bb/100 to ${probe.id} — ${probe.expectation}`);
          }
        }
      }
      expect(misses).toEqual([]);
    },
    SLOW,
  );

  it(
    "collects the free blinds against a player who folds everything",
    () => {
      // Heads-up, an opponent who folds whenever folding is legal hands over
      // its blind on roughly half the hands. Anything materially under that is
      // a persona folding its own button, which is a leak a player finds in an
      // afternoon.
      const floor = 20;
      const foldProbe = PROBES.find((p) => p.id === "always-fold");
      expect(foldProbe).toBeDefined();
      for (const id of PROBE_TARGETS) {
        const counters = playProbeMatch({
          seed: `cal/probe/${id}/always-fold`,
          persona: personaById(id),
          probe: foldProbe as (typeof PROBES)[number],
          hands: PROBE_HANDS,
        });
        expect(measure(1, id, counters).bb100, `${id} vs always-fold`).toBeGreaterThan(floor);
      }
    },
    SLOW,
  );

  it(
    "punishes a pure calling station rather than bluffing into it",
    () => {
      const station = PROBES.find((p) => p.id === "pure-station");
      expect(station).toBeDefined();
      for (const id of PROBE_TARGETS) {
        const counters = playProbeMatch({
          seed: `cal/probe/${id}/pure-station`,
          persona: personaById(id),
          probe: station as (typeof PROBES)[number],
          hands: PROBE_HANDS,
        });
        const m = measure(1, id, counters);
        // A station that beats a tier-3+ persona means the value logic is
        // broken, not that the station is good.
        expect(m.bb100, `${id} vs pure-station`).toBeGreaterThan(50);
      }
    },
    SLOW,
  );
});
