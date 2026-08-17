/**
 * Stat aggregation and leak detection.
 *
 * PRD Q22: "Auto leak reports — named leaks w/ evidence, cost in bb/100,
 * example hands, linked drills." That shape drives this module:
 *
 * - {@link aggregateStats} folds hand records into counter pairs
 *   (numerator / opportunities) plus an evidence accumulator of example hand
 *   ids, so a report can always show its work.
 * - {@link detectLeaks} runs a core set of detectors, each keyed to a concept
 *   id from `concepts.ts`, each with a healthy band, a minimum-sample gate,
 *   and an estimated cost in bb/100.
 *
 * ## The sample gate is a law, not a preference
 *
 * The taxonomy fixes minimum hands per stat family (200 / 500 / 750 / 2000).
 * Below the gate a detector does not fire — not "fires with a caveat".
 * Telling a player they have a WTSD leak off 40 hands is worse than saying
 * nothing, because they will act on it. {@link detectLeaks} returns only
 * findings that cleared their gate; {@link evaluateDetectors} exposes the
 * gated ones too, for a "keep playing to unlock" surface.
 *
 * ## Cost estimates are estimates
 *
 * `costBb100` is a linear coefficient per point of deviation, hand-tuned and
 * capped. It is an ORDERING device — which leak to work on first — not a
 * measurement. The graded-decision ledger is the taxonomy's primary evidence
 * for actual bb/100 cost; these numbers exist so a report can rank concepts
 * before enough graded decisions have accumulated.
 */

import type { HandRecord } from "@poker/history";
import {
  type ConceptId,
  type ConceptTier,
  type StatId,
  CONCEPTS,
  MIN_SAMPLE_HANDS,
  STATS,
  minSampleHands,
} from "./concepts";
import { type HandView, buildHandView, preflopAggressor, seatView } from "./replay";

/** Numerator / opportunity pair for one stat. */
export interface StatCounter {
  /** Times the behaviour happened. */
  n: number;
  /** Times it could have happened. */
  d: number;
}

/** Maximum example hand ids retained per stat. */
export const MAX_EVIDENCE_HANDS = 8;

/** Aggregated hero stats across a corpus of hands. */
export interface StatAggregate {
  /** Seat the stats were computed for. */
  heroSeat: number;
  /** Hands the hero was dealt into. */
  hands: number;
  /** Hands where hero was live when the flop came. */
  flopsSeen: number;
  /** Net chips across the corpus, cents (results — never fed to the rating). */
  netCents: number;
  /** Big blinds won per 100 hands (results measure, for reporting only). */
  bb100: number;
  counters: Readonly<Record<StatId, StatCounter>>;
  /** Example hand ids where each stat's numerator fired, capped. */
  evidence: Readonly<Record<StatId, readonly string[]>>;
}

function emptyCounters(): Record<StatId, StatCounter> {
  const out = {} as Record<StatId, StatCounter>;
  for (const id of Object.keys(STATS) as StatId[]) out[id] = { n: 0, d: 0 };
  return out;
}

function emptyEvidence(): Record<StatId, string[]> {
  const out = {} as Record<StatId, string[]>;
  for (const id of Object.keys(STATS) as StatId[]) out[id] = [];
  return out;
}

/**
 * Value of a stat in its declared unit, or undefined when there is nothing to
 * compute it from. `percent` stats return 0-100; `af` returns a ratio;
 * `vpipPfrGap` is derived from vpip and pfr.
 *
 * A zero denominator yields `undefined`, never 0 and never Infinity — "no
 * opportunities yet" and "never did it" are different facts, and a report that
 * conflates them tells the player something false.
 */
export function statValue(agg: StatAggregate, stat: StatId): number | undefined {
  if (stat === "vpipPfrGap") {
    const vpip = statValue(agg, "vpip");
    const pfr = statValue(agg, "pfr");
    return vpip === undefined || pfr === undefined ? undefined : vpip - pfr;
  }
  const c = agg.counters[stat];
  if (c.d === 0) return undefined;
  return STATS[stat].unit === "ratio" ? c.n / c.d : (100 * c.n) / c.d;
}

/** Opportunities behind a stat (the denominator). Derived stats use vpip's. */
export function statOpportunities(agg: StatAggregate, stat: StatId): number {
  if (stat === "vpipPfrGap") return agg.counters.vpip.d;
  return agg.counters[stat].d;
}

const STEAL_POSITIONS = new Set(["CO", "BTN", "SB"]);

/**
 * Fold a corpus of hand records into hero stats.
 *
 * `heroSeat` is a session-stable seat number. Records where that seat was not
 * dealt in are skipped. Every stat is counted from the public action sequence
 * plus hero's own cards; nothing here needs villain hole cards.
 */
export function aggregateStats(
  records: readonly HandRecord[],
  heroSeat: number,
): StatAggregate {
  const counters = emptyCounters();
  const evidence = emptyEvidence();
  let hands = 0;
  let flopsSeen = 0;
  let netCents = 0;
  let bbSum = 0;

  const note = (stat: StatId, handId: string): void => {
    const ev = evidence[stat];
    if (ev.length < MAX_EVIDENCE_HANDS && !ev.includes(handId)) ev.push(handId);
  };
  const bump: Bump = (stat, hit, handId) => {
    const c = counters[stat];
    c.d += 1;
    if (!hit) return;
    c.n += 1;
    note(stat, handId);
  };
  /** Raw counter addition, for ratio stats whose denominator is not an opportunity. */
  const add: Add = (stat, n, d, handId) => {
    const c = counters[stat];
    c.n += n;
    c.d += d;
    if (n > 0) note(stat, handId);
  };

  for (const record of records) {
    let view: HandView;
    try {
      view = buildHandView(record);
    } catch {
      continue; // a record we cannot reconstruct contributes nothing
    }
    const hero = seatView(view, heroSeat);
    if (hero === undefined) continue;
    hands += 1;
    netCents += hero.net;
    if (view.bb > 0) bbSum += hero.net / view.bb;
    if (hero.sawFlop) flopsSeen += 1;

    accumulateHand(view, heroSeat, hero.position, bump, add, record.id);
  }

  return {
    heroSeat,
    hands,
    flopsSeen,
    netCents,
    bb100: hands === 0 ? 0 : (bbSum / hands) * 100,
    counters,
    evidence,
  };
}

type Bump = (stat: StatId, hit: boolean, handId: string) => void;
type Add = (stat: StatId, n: number, d: number, handId: string) => void;

function accumulateHand(
  view: HandView,
  heroSeat: number,
  position: string,
  bump: Bump,
  add: Add,
  handId: string,
): void {
  const pre = view.actions.filter((a) => a.street === "preflop");
  const heroPre = pre.filter((a) => a.seat === heroSeat);

  // ---- Preflop frequencies ------------------------------------------------
  const voluntary = heroPre.some(
    (a) => a.kind === "call" || a.kind === "bet" || a.kind === "raise",
  );
  bump("vpip", voluntary, handId);
  bump("pfr", heroPre.some((a) => a.kind === "raise"), handId);

  const first = heroPre[0];
  if (first !== undefined) {
    const before = pre.filter((a) => a.eventIndex < first.eventIndex);
    const raisesBefore = before.filter((a) => a.kind === "raise");
    const limpsBefore = before.filter((a) => a.kind === "call" && a.toCall > 0);

    // First-in: nobody has raised or limped, and hero is not the big blind.
    if (raisesBefore.length === 0 && limpsBefore.length === 0 && position !== "BB") {
      bump("openLimp", first.kind === "call", handId);
      if (STEAL_POSITIONS.has(position)) bump("steal", first.kind === "raise", handId);
    }
    // Limpers ahead, no raise: an isolation spot.
    if (raisesBefore.length === 0 && limpsBefore.length > 0) {
      bump("isoRaise", first.kind === "raise", handId);
      bump("overLimp", first.kind === "call", handId);
    }
    // Facing exactly one raise: 3-bet / cold-call / blind-defence spot.
    if (raisesBefore.length === 1) {
      bump("threeBet", first.kind === "raise", handId);
      bump("coldCall", first.kind === "call", handId);
      const openerSeat = raisesBefore[0]?.seat;
      const openerPos = openerSeat === undefined ? undefined : seatView(view, openerSeat)?.position;
      if (position === "BB" && openerPos !== undefined && STEAL_POSITIONS.has(openerPos)) {
        bump("bbFoldVsSteal", first.kind === "fold", handId);
      }
    }
    // Facing exactly two raises: a 4-bet spot.
    if (raisesBefore.length === 2) bump("fourBet", first.kind === "raise", handId);
  }

  // Hero opened, then faced a re-raise.
  const heroOpen = heroPre.find(
    (a) =>
      a.kind === "raise" &&
      pre.filter((p) => p.kind === "raise" && p.eventIndex < a.eventIndex).length === 0,
  );
  if (heroOpen !== undefined) {
    const threeBet = pre.find((a) => a.kind === "raise" && a.eventIndex > heroOpen.eventIndex);
    if (threeBet !== undefined) {
      const response = heroPre.find((a) => a.eventIndex > threeBet.eventIndex);
      if (response !== undefined) bump("foldToThreeBet", response.kind === "fold", handId);
    }
  }

  // ---- Postflop -----------------------------------------------------------
  const aggressor = preflopAggressor(view);
  const flop = view.actions.filter((a) => a.street === "flop");
  const turn = view.actions.filter((a) => a.street === "turn");
  const river = view.actions.filter((a) => a.street === "river");
  const heroFlop = flop.filter((a) => a.seat === heroSeat);
  const heroSawFlop = seatView(view, heroSeat)?.sawFlop ?? false;

  let heroCbetFlop = false;
  if (heroSawFlop && aggressor === heroSeat) {
    // C-bet opportunity: hero's first flop action with no flop bet in front.
    const firstFlopAction = heroFlop[0];
    if (firstFlopAction !== undefined && firstFlopAction.aggressionIndex === 0) {
      heroCbetFlop = firstFlopAction.kind === "bet";
      const multiway = firstFlopAction.livePlayers > 2;
      bump(multiway ? "cbetFlopMultiway" : "cbetFlop", heroCbetFlop, handId);
    }
  }
  if (heroSawFlop && aggressor !== undefined && aggressor !== heroSeat) {
    // Facing the preflop aggressor's flop c-bet.
    const cbet = flop.find((a) => a.seat === aggressor && a.kind === "bet" && a.aggressionIndex === 0);
    if (cbet !== undefined) {
      const response = heroFlop.find((a) => a.eventIndex > cbet.eventIndex);
      if (response !== undefined) bump("foldToCbetFlop", response.kind === "fold", handId);
    }
    // Check-raise: hero checked, then raised the same street.
    const checked = heroFlop.some((a) => a.kind === "check");
    const raised = heroFlop.some((a) => a.kind === "raise");
    if (checked) bump("flopCheckRaise", raised, handId);
  }
  if (heroCbetFlop && turn.length > 0) {
    const heroTurnFirst = turn.filter((a) => a.seat === heroSeat)[0];
    if (heroTurnFirst !== undefined && heroTurnFirst.aggressionIndex === 0) {
      bump("turnBarrel", heroTurnFirst.kind === "bet", handId);
    }
  }

  // Aggression factor is a ratio of counts, not a rate over opportunities:
  // numerator = postflop bets + raises, denominator = postflop calls.
  const postflop = view.actions.filter((a) => a.street !== "preflop" && a.seat === heroSeat);
  const aggressiveActs = postflop.filter((a) => a.kind === "bet" || a.kind === "raise").length;
  const callActs = postflop.filter((a) => a.kind === "call").length;
  if (aggressiveActs > 0 || callActs > 0) add("af", aggressiveActs, callActs, handId);

  // River aggression: share of hero's river actions that were bets or raises.
  const heroRiver = river.filter((a) => a.seat === heroSeat);
  for (const a of heroRiver) bump("riverAggression", a.kind === "bet" || a.kind === "raise", handId);

  // ---- Showdown -----------------------------------------------------------
  const hero = seatView(view, heroSeat);
  if (hero !== undefined && hero.sawFlop) {
    bump("wtsd", hero.wentToShowdown, handId);
    bump("wwsf", hero.awarded > 0, handId);
  }
  if (hero !== undefined && hero.wentToShowdown) {
    bump("wsd", hero.awarded > 0, handId);
  }
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** Which side of the healthy band a detector watches. */
export type LeakDirection = "above" | "below";

/** A named leak detector keyed to a concept. */
export interface LeakDetector {
  id: string;
  /** Player-facing name. */
  name: string;
  concept: ConceptId;
  /** Stat that triggers the detector. */
  stat: StatId;
  direction: LeakDirection;
  /** Edge of healthy, in the stat's unit. */
  threshold: number;
  /** Extra stats that must ALSO be off for the detector to fire. */
  corroborate?: readonly { stat: StatId; direction: LeakDirection; threshold: number }[];
  /** Estimated bb/100 cost per unit of deviation past the threshold. */
  costPerUnitBb100: number;
  /** Cap on the estimated cost, bb/100. */
  costCapBb100: number;
  /** Minimum opportunities (denominator) on top of the family hand gate. */
  minOpportunities: number;
  /** One-line description of what the number means. */
  description: string;
}

/**
 * The core detector set. Twelve detectors across nine concepts — enough to
 * cover the common intermediate leaks the taxonomy names, few enough that a
 * report never becomes a wall.
 *
 * Thresholds come from each stat's healthy band in `concepts.ts` (the taxonomy
 * where it prints one, a house baseline where it does not). Costs are
 * hand-tuned ordering coefficients — see the module note.
 */
export const LEAK_DETECTORS: readonly LeakDetector[] = [
  {
    id: "loose-preflop",
    name: "Playing too many hands",
    concept: "hand-selection",
    stat: "vpip",
    direction: "above",
    threshold: 32,
    costPerUnitBb100: 0.35,
    costCapBb100: 9,
    minOpportunities: 50,
    description: "VPIP above 32% — hands that are behind before the flop even arrives.",
  },
  {
    id: "tight-preflop",
    name: "Playing too few hands",
    concept: "hand-selection",
    stat: "vpip",
    direction: "below",
    threshold: 18,
    costPerUnitBb100: 0.2,
    costCapBb100: 4,
    minOpportunities: 50,
    description: "VPIP under 18% — folding away profitable spots, especially in late seats.",
  },
  {
    id: "open-limping",
    name: "Open-limping",
    concept: "open-vs-limp",
    stat: "openLimp",
    direction: "above",
    threshold: 2,
    costPerUnitBb100: 0.25,
    costCapBb100: 6,
    minOpportunities: 40,
    description: "Limping in first — forfeiting the lead and inviting the field.",
  },
  {
    id: "passive-preflop",
    name: "Calling too much preflop",
    concept: "open-vs-limp",
    stat: "vpipPfrGap",
    direction: "above",
    threshold: 6,
    costPerUnitBb100: 0.3,
    costCapBb100: 7,
    minOpportunities: 50,
    description: "A wide VPIP−PFR gap — entering pots without the initiative.",
  },
  {
    id: "three-bet-too-rare",
    name: "Not 3-betting enough",
    concept: "3betting",
    stat: "threeBet",
    direction: "below",
    threshold: 4,
    costPerUnitBb100: 0.5,
    costCapBb100: 5,
    minOpportunities: 60,
    description: "3-betting under 4% — only aces, and everyone folds to you.",
  },
  {
    id: "over-folds-to-three-bet",
    name: "Folding too much to 3-bets",
    concept: "3bet-defense",
    stat: "foldToThreeBet",
    direction: "above",
    threshold: 60,
    costPerUnitBb100: 0.12,
    costCapBb100: 6,
    minOpportunities: 30,
    description: "Folding over 60% to 3-bets — every good player will 3-bet you forever.",
  },
  {
    id: "auto-cbet",
    name: "Auto-c-betting",
    concept: "cbet-basics",
    stat: "cbetFlop",
    direction: "above",
    threshold: 80,
    costPerUnitBb100: 0.15,
    costCapBb100: 5,
    minOpportunities: 40,
    description: "C-betting over 80% heads-up — check-raises will find you.",
  },
  {
    id: "cbet-too-rare",
    name: "Giving up the flop",
    concept: "cbet-basics",
    stat: "cbetFlop",
    direction: "below",
    threshold: 45,
    costPerUnitBb100: 0.12,
    costCapBb100: 5,
    minOpportunities: 40,
    description: "C-betting under 45% — passing on the pots the initiative wins for free.",
  },
  {
    id: "over-folds-to-cbet",
    name: "Folding too much to c-bets",
    concept: "bluff-catching",
    stat: "foldToCbetFlop",
    direction: "above",
    threshold: 60,
    costPerUnitBb100: 0.12,
    costCapBb100: 6,
    minOpportunities: 40,
    description: "Folding over 60% to flop c-bets — a range bet prints against you.",
  },
  {
    id: "one-and-done",
    name: "One-and-done bluffing",
    concept: "double-barreling",
    stat: "turnBarrel",
    direction: "below",
    threshold: 40,
    costPerUnitBb100: 0.15,
    costCapBb100: 5,
    minOpportunities: 30,
    description: "Barrelling the turn under 40% after a flop c-bet — most flop calls are one-street calls.",
  },
  {
    id: "showdown-chasing",
    name: "Chasing at bad prices",
    concept: "pot-odds",
    stat: "wtsd",
    direction: "above",
    threshold: 32,
    corroborate: [{ stat: "wsd", direction: "below", threshold: 48 }],
    costPerUnitBb100: 0.6,
    costCapBb100: 10,
    minOpportunities: 100,
    description: "A high WTSD with a weak W$SD — showing down too many hands you paid to lose.",
  },
  {
    id: "passive-postflop",
    name: "Winning too few flops",
    concept: "value-betting",
    stat: "wwsf",
    direction: "below",
    threshold: 42,
    costPerUnitBb100: 0.4,
    costCapBb100: 8,
    minOpportunities: 100,
    description: "WWSF under 42% — the pots nobody wanted are going to someone else.",
  },
];

/** One detector's verdict against an aggregate. */
export interface LeakFinding {
  detector: LeakDetector;
  concept: ConceptId;
  /** Concept tier, for coach-register selection. */
  tier: ConceptTier;
  /** Whether the detector fired. */
  fired: boolean;
  /** Whether the minimum-sample gate was met (false ⇒ `fired` is meaningless). */
  gateMet: boolean;
  /** Hands required by the stat's family gate. */
  minHands: number;
  /** Hands actually in the corpus. */
  hands: number;
  /** Opportunities behind the stat. */
  opportunities: number;
  /** Observed value in the stat's unit, or undefined when uncomputable. */
  observed?: number;
  /** How far past the threshold, in the stat's unit (0 when not fired). */
  deviation: number;
  /** Estimated cost, bb/100. 0 when not fired. */
  costBb100: number;
  /** Example hand ids where the behaviour occurred. */
  evidenceHandIds: readonly string[];
  /** The concept's drill hook, for the report's "linked drills" slot. */
  drillHook: string;
}

function offBy(value: number, direction: LeakDirection, threshold: number): number {
  return direction === "above" ? value - threshold : threshold - value;
}

/**
 * Evaluate every detector, gated and ungated alike. Use this when a surface
 * wants to show "not enough hands yet"; use {@link detectLeaks} for a report.
 */
export function evaluateDetectors(
  agg: StatAggregate,
  detectors: readonly LeakDetector[] = LEAK_DETECTORS,
): LeakFinding[] {
  const out: LeakFinding[] = [];
  for (const d of detectors) {
    const concept = CONCEPTS[d.concept];
    const observed = statValue(agg, d.stat);
    const opportunities = statOpportunities(agg, d.stat);
    const minHands = minSampleHands(d.stat);
    const gateMet = agg.hands >= minHands && opportunities >= d.minOpportunities;

    let fired = false;
    let deviation = 0;
    if (observed !== undefined) {
      const by = offBy(observed, d.direction, d.threshold);
      if (by > 0) {
        fired = true;
        deviation = by;
      }
    }
    if (fired && d.corroborate !== undefined) {
      for (const c of d.corroborate) {
        const v = statValue(agg, c.stat);
        const cGate = agg.hands >= minSampleHands(c.stat);
        if (v === undefined || !cGate || offBy(v, c.direction, c.threshold) <= 0) {
          fired = false;
          deviation = 0;
          break;
        }
      }
    }

    const finding: LeakFinding = {
      detector: d,
      concept: d.concept,
      tier: concept.tier,
      fired: fired && gateMet,
      gateMet,
      minHands,
      hands: agg.hands,
      opportunities,
      deviation,
      costBb100: fired && gateMet ? Math.min(d.costCapBb100, deviation * d.costPerUnitBb100) : 0,
      evidenceHandIds: agg.evidence[d.stat].slice(0, MAX_EVIDENCE_HANDS),
      drillHook: concept.drillHook,
    };
    if (observed !== undefined) finding.observed = observed;
    out.push(finding);
  }
  return out;
}

/**
 * Leaks worth reporting: detectors that fired AND cleared their sample gate,
 * ranked by estimated bb/100 cost, most expensive first.
 */
export function detectLeaks(
  agg: StatAggregate,
  detectors: readonly LeakDetector[] = LEAK_DETECTORS,
): LeakFinding[] {
  return evaluateDetectors(agg, detectors)
    .filter((f) => f.fired)
    .sort((a, b) => b.costBb100 - a.costBb100 || a.detector.id.localeCompare(b.detector.id));
}

/** Family gates, re-exported so a UI can render "unlocks at N hands". */
export { MIN_SAMPLE_HANDS };
