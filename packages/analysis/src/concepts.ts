/**
 * Concept taxonomy v1 — typed transcription of the content taxonomy
 * (`poker-internal/content/concepts/taxonomy.md`, "Concept Taxonomy v1").
 *
 * **Ids are API.** Kebab-case, stable forever; a rename is a new id plus a
 * migration. Everything downstream keys off these ids: graded decisions carry
 * at most one primary concept tag, leak detectors are keyed to a concept, the
 * skill rating tracks mastery per concept, and the coach picks its vocabulary
 * register from the player's tier.
 *
 * What this module holds is *data*, deliberately: the prose (definition, why
 * it makes money, coach vocabulary) lives in the content repo and is a
 * content-pipeline concern. What the engine needs is the id, the tier, the
 * tracker stats that corroborate a leak in that concept, and the sample gates
 * those stats must clear — so that is exactly what is transcribed here.
 *
 * ## Evidence model
 *
 * The taxonomy is explicit that the PRIMARY evidence for every concept is the
 * graded-decision ledger (EV loss tagged to the concept, reported in bb/100).
 * Tracker stats are *corroborating signals* with healthy bands for **6-max,
 * 100bb cash, vs the app's default pool** — bands, not laws. Concepts the
 * taxonomy gives no tracker stat for are marked {@link Concept.gradedOnly}.
 *
 * Bands carry a {@link BandSource}: `"taxonomy"` bands are quoted from the
 * document; `"house"` bands are this package's own baselines for stats the
 * taxonomy tracks without printing a range. Never present a house band as if
 * it came from the taxonomy.
 */

// ---------------------------------------------------------------------------
// Tiers & ids
// ---------------------------------------------------------------------------

export type ConceptTier = "foundations" | "intermediate" | "advanced";

/** Tiers weakest-first; the player's rating selects the coach register. */
export const CONCEPT_TIERS: readonly ConceptTier[] = ["foundations", "intermediate", "advanced"];

/** All 26 concept ids, in taxonomy index order. */
export const CONCEPT_IDS = [
  // foundations (8)
  "hand-selection",
  "position",
  "pot-odds",
  "value-betting",
  "folding-discipline",
  "cbet-basics",
  "open-vs-limp",
  "stack-awareness",
  // intermediate (10)
  "3bet-defense",
  "3betting",
  "cbet-sizing",
  "double-barreling",
  "bluff-catching",
  "semibluffing",
  "blind-defense",
  "iso-raising",
  "thin-value",
  "pot-control",
  // advanced (8)
  "blockers",
  "polarization",
  "overbetting",
  "exploiting-tendencies",
  "multiway-adjustments",
  "balance",
  "icm-pressure",
  "push-fold",
] as const;

export type ConceptId = (typeof CONCEPT_IDS)[number];

/** True iff `id` is one of the 26 canonical concept ids. */
export function isConceptId(id: string): id is ConceptId {
  return (CONCEPT_IDS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// Tracker stats
// ---------------------------------------------------------------------------

/**
 * Stat families and their minimum-sample gates, transcribed from the
 * taxonomy's "Minimum samples before a stat may evidence a leak" table.
 * Gates are in HANDS observed, not in stat opportunities.
 */
export type StatFamily = "preflop-frequency" | "preflop-response" | "postflop-cbet" | "showdown";

/** Minimum hands before a family's stats may evidence a leak (taxonomy law). */
export const MIN_SAMPLE_HANDS: Readonly<Record<StatFamily, number>> = {
  "preflop-frequency": 200,
  "preflop-response": 500,
  "postflop-cbet": 750,
  showdown: 2000,
};

/** Every tracked stat id. Aggregation lives in `leaks.ts`. */
export const STAT_IDS = [
  // preflop-frequency
  "vpip",
  "pfr",
  "vpipPfrGap",
  "openLimp",
  "overLimp",
  // preflop-response
  "threeBet",
  "foldToThreeBet",
  "fourBet",
  "coldCall",
  "steal",
  "bbFoldVsSteal",
  "isoRaise",
  // postflop-cbet
  "cbetFlop",
  "cbetFlopMultiway",
  "foldToCbetFlop",
  "turnBarrel",
  "flopCheckRaise",
  "af",
  // showdown
  "wtsd",
  "wsd",
  "wwsf",
  "riverAggression",
] as const;

export type StatId = (typeof STAT_IDS)[number];

/** True iff `id` is a tracked stat id. */
export function isStatId(id: string): id is StatId {
  return (STAT_IDS as readonly string[]).includes(id);
}

/**
 * Reporting unit. `percent` values are 0-100, `points` are percentage-point
 * differences (also 0-100 scale), `ratio` is unbounded and non-negative.
 */
export type StatUnit = "percent" | "points" | "ratio";

/** Where a healthy band came from: the content taxonomy, or our own baseline. */
export type BandSource = "taxonomy" | "house";

/** Healthy band for a stat. Open-ended on either side. */
export interface HealthyBand {
  /** Inclusive lower edge of healthy, in the stat's unit. */
  low?: number;
  /** Inclusive upper edge of healthy, in the stat's unit. */
  high?: number;
  source: BandSource;
}

export interface StatSpec {
  id: StatId;
  name: string;
  family: StatFamily;
  unit: StatUnit;
  /** True when the value is computed from other stats rather than counted. */
  derived: boolean;
  /** 6-max 100bb baseline band, when one exists. */
  healthy?: HealthyBand;
}

/** Every tracked stat, keyed by id. */
export const STATS: Readonly<Record<StatId, StatSpec>> = {
  vpip: {
    id: "vpip",
    name: "VPIP",
    family: "preflop-frequency",
    unit: "percent",
    derived: false,
    healthy: { low: 22, high: 28, source: "taxonomy" },
  },
  pfr: {
    id: "pfr",
    name: "PFR",
    family: "preflop-frequency",
    unit: "percent",
    derived: false,
    healthy: { low: 16, high: 26, source: "house" },
  },
  vpipPfrGap: {
    id: "vpipPfrGap",
    name: "VPIP − PFR gap",
    family: "preflop-frequency",
    unit: "points",
    derived: true,
    healthy: { high: 6, source: "taxonomy" },
  },
  openLimp: {
    id: "openLimp",
    name: "Open-limp",
    family: "preflop-frequency",
    unit: "percent",
    derived: false,
    healthy: { high: 2, source: "taxonomy" },
  },
  overLimp: {
    id: "overLimp",
    name: "Over-limp",
    family: "preflop-frequency",
    unit: "percent",
    derived: false,
    healthy: { high: 4, source: "house" },
  },
  threeBet: {
    id: "threeBet",
    name: "3-bet",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 6, high: 9, source: "taxonomy" },
  },
  foldToThreeBet: {
    id: "foldToThreeBet",
    name: "Fold to 3-bet",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 45, high: 55, source: "taxonomy" },
  },
  fourBet: {
    id: "fourBet",
    name: "4-bet",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 6, high: 14, source: "taxonomy" },
  },
  coldCall: {
    id: "coldCall",
    name: "Cold call",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { high: 10, source: "taxonomy" },
  },
  steal: {
    id: "steal",
    name: "Steal attempt",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 35, high: 45, source: "taxonomy" },
  },
  bbFoldVsSteal: {
    id: "bbFoldVsSteal",
    name: "BB fold vs steal",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 55, high: 70, source: "taxonomy" },
  },
  isoRaise: {
    id: "isoRaise",
    name: "Iso-raise vs limper",
    family: "preflop-response",
    unit: "percent",
    derived: false,
    healthy: { low: 35, source: "house" },
  },
  cbetFlop: {
    id: "cbetFlop",
    name: "Flop c-bet (heads-up)",
    family: "postflop-cbet",
    unit: "percent",
    derived: false,
    healthy: { low: 55, high: 70, source: "taxonomy" },
  },
  cbetFlopMultiway: {
    id: "cbetFlopMultiway",
    name: "Flop c-bet (multiway)",
    family: "postflop-cbet",
    unit: "percent",
    derived: false,
    healthy: { low: 25, high: 40, source: "taxonomy" },
  },
  foldToCbetFlop: {
    id: "foldToCbetFlop",
    name: "Fold to flop c-bet",
    family: "postflop-cbet",
    unit: "percent",
    derived: false,
    healthy: { low: 40, high: 60, source: "house" },
  },
  turnBarrel: {
    id: "turnBarrel",
    name: "Turn barrel after flop c-bet",
    family: "postflop-cbet",
    unit: "percent",
    derived: false,
    healthy: { low: 45, high: 60, source: "taxonomy" },
  },
  flopCheckRaise: {
    id: "flopCheckRaise",
    name: "Flop check-raise",
    family: "postflop-cbet",
    unit: "percent",
    derived: false,
    healthy: { low: 6, high: 11, source: "taxonomy" },
  },
  af: {
    id: "af",
    name: "Aggression factor",
    family: "postflop-cbet",
    unit: "ratio",
    derived: false,
    healthy: { low: 2, high: 4, source: "taxonomy" },
  },
  wtsd: {
    id: "wtsd",
    name: "Went to showdown",
    family: "showdown",
    unit: "percent",
    derived: false,
    healthy: { low: 24, high: 30, source: "taxonomy" },
  },
  wsd: {
    id: "wsd",
    name: "Won at showdown",
    family: "showdown",
    unit: "percent",
    derived: false,
    healthy: { low: 49, high: 54, source: "taxonomy" },
  },
  wwsf: {
    id: "wwsf",
    name: "Won when saw flop",
    family: "showdown",
    unit: "percent",
    derived: false,
    healthy: { low: 42, high: 48, source: "taxonomy" },
  },
  riverAggression: {
    id: "riverAggression",
    name: "River aggression",
    family: "showdown",
    unit: "percent",
    derived: false,
    healthy: { low: 25, high: 45, source: "house" },
  },
};

/** Minimum hands before `stat` may evidence a leak. */
export function minSampleHands(stat: StatId): number {
  return MIN_SAMPLE_HANDS[STATS[stat].family];
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

/** One corroborating tracker stat for a concept, with the taxonomy's gloss. */
export interface ConceptStatLink {
  stat: StatId;
  /** Why this stat reveals a leak in this concept (taxonomy "Evidence"). */
  note: string;
}

export interface Concept {
  id: ConceptId;
  name: string;
  tier: ConceptTier;
  /**
   * Corroborating tracker stats. Empty exactly when {@link gradedOnly} — the
   * taxonomy names no single tracker stat and the graded ledger is the only
   * evidence.
   */
  stats: readonly ConceptStatLink[];
  /** True when this concept is evidenced only through the graded ledger. */
  gradedOnly: boolean;
  /** One-line drill shape (feeds drill generators and gauntlet design). */
  drillHook: string;
}

/** The 26 concepts, keyed by id. */
export const CONCEPTS: Readonly<Record<ConceptId, Concept>> = {
  "hand-selection": {
    id: "hand-selection",
    name: "Starting Hand Selection",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "vpip", note: "22-28%; >32 too loose, <18 too tight" },
      { stat: "vpipPfrGap", note: "gap of 6 points or less" },
      { stat: "coldCall", note: "cold-call 10% or less" },
    ],
    drillHook: "Preflop chart trainer — rapid-fire deals by seat, spaced repetition on misses.",
  },
  position: {
    id: "position",
    name: "Position",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "vpip", note: "VPIP by seat should slope steeply UTG→BTN" },
      { stat: "steal", note: "steal attempt 35-45%" },
    ],
    drillHook: "Same hand, six seats — decide from each chair; the reveal shows where it flips.",
  },
  "pot-odds": {
    id: "pot-odds",
    name: "Pot Odds & Price",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "wtsd", note: "WTSD 24-30%; >32 with weak W$SD is chasing at bad prices" },
      { stat: "wsd", note: "W$SD 49-54%; <48 alongside high WTSD is the tell" },
    ],
    drillHook: "Price flashcards, then live draw spots where the price is the whole answer.",
  },
  "value-betting": {
    id: "value-betting",
    name: "Value Betting",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "wwsf", note: "WWSF 42-48%" },
      { stat: "af", note: "aggression factor 2-4" },
      { stat: "wsd", note: ">56% alongside low river aggression = uncharged winners" },
      { stat: "riverAggression", note: "low river aggression with a high W$SD is missed value" },
    ],
    drillHook: "River value trainer — the reveal counts which worse hands would have paid.",
  },
  "folding-discipline": {
    id: "folding-discipline",
    name: "Folding Discipline",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "wtsd", note: "WTSD >32% with W$SD <48% = paying off too often" },
      { stat: "wsd", note: "river call efficiency vs the price offered" },
    ],
    drillHook: "Pay-off audit — fold or call a villain's value line, then see the range shown.",
  },
  "cbet-basics": {
    id: "cbet-basics",
    name: "Continuation Betting",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "cbetFlop", note: "55-70% heads-up; >80 auto-c-bet, <45 giving up the edge" },
    ],
    drillHook: "Texture sort — bet or check a fast cadence of flops, scored by board class.",
  },
  "open-vs-limp": {
    id: "open-vs-limp",
    name: "Open, Don't Limp",
    tier: "foundations",
    gradedOnly: false,
    stats: [
      { stat: "openLimp", note: "open-limp under 2% (effectively zero)" },
      { stat: "vpipPfrGap", note: "PFR within 6 points of VPIP" },
    ],
    drillHook: "First-in decisions with no limp button; then the limp button returns and gets graded.",
  },
  "stack-awareness": {
    id: "stack-awareness",
    name: "Stack Awareness",
    tier: "foundations",
    gradedOnly: true,
    stats: [],
    drillHook: "The same spot at 20/50/100/200bb — the reveal marks the depth where it flips.",
  },
  "3bet-defense": {
    id: "3bet-defense",
    name: "Defending vs 3-Bets",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "foldToThreeBet", note: "45-55%; >60 is the pool's ATM, <40 is defending junk" },
      { stat: "fourBet", note: "roughly one in ten of the times you face a 3-bet" },
    ],
    drillHook: "You open, a 3-bet arrives — vary seat, size and character; fold, call or 4-bet.",
  },
  "3betting": {
    id: "3betting",
    name: "3-Betting",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "threeBet", note: "6-9% overall; <4 means only aces, >12 vs this pool is lighting money" },
      { stat: "coldCall", note: "a low 3-bet with a high cold-call means big hands are flatting" },
    ],
    drillHook: "Face an open: fold / call / 3-bet plus a size, alternating value and light spots.",
  },
  "cbet-sizing": {
    id: "cbet-sizing",
    name: "C-Bet Sizing",
    tier: "intermediate",
    gradedOnly: true,
    stats: [],
    drillHook: "The bet is decided for you — pick only the size (33/50/75/pot) against texture.",
  },
  "double-barreling": {
    id: "double-barreling",
    name: "Double Barreling",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "turnBarrel", note: "turn c-bet after flop c-bet 45-60%; give-up over 60% is the leak" },
      { stat: "wwsf", note: "WWSF sagging under 42% alongside a healthy flop c-bet" },
    ],
    drillHook: "Flop bet called, turn peels — barrel or shut down, sorted by card class.",
  },
  "bluff-catching": {
    id: "bluff-catching",
    name: "Bluff Catching",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "wsd", note: "49-54%; >58 folds too many good catches, <46 is paying off" },
      { stat: "foldToCbetFlop", note: "house baseline: folding far outside 40-60% mishandles catchers" },
    ],
    drillHook: "A hand story replays to a river decision; the reveal shows the whole range.",
  },
  semibluffing: {
    id: "semibluffing",
    name: "Semi-Bluffing",
    tier: "intermediate",
    gradedOnly: false,
    stats: [{ stat: "flopCheckRaise", note: "flop check-raise 6-11%" }],
    drillHook: "Draw spots offering call and raise; both EVs are shown side by side after.",
  },
  "blind-defense": {
    id: "blind-defense",
    name: "Blind Defense",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "bbFoldVsSteal", note: "55-70% by size; >75 overfolds the discount, <45 defends junk" },
    ],
    drillHook: "Big blind vs each seat's open at three sizes, with the price printed after.",
  },
  "iso-raising": {
    id: "iso-raising",
    name: "Iso-Raising",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "isoRaise", note: "raise-vs-limper rate: opportunities taken vs passed" },
      { stat: "overLimp", note: "over-limping behind instead of isolating" },
    ],
    drillHook: "One or two limpers ahead — fold, over-limp, or iso and pick the size.",
  },
  "thin-value": {
    id: "thin-value",
    name: "Thin Value",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "riverAggression", note: "river bet frequency — thin value lives here" },
      { stat: "wsd", note: ">56% with low river aggression = showdowns you never charged" },
    ],
    drillHook: "Marginal river spots — the reveal lists the villain's actual calling hands.",
  },
  "pot-control": {
    id: "pot-control",
    name: "Pot Control",
    tier: "intermediate",
    gradedOnly: false,
    stats: [
      { stat: "af", note: "aggression factor >4.5 alongside a weak W$SD is bloating pots" },
      { stat: "wsd", note: "W$SD <48% while playing big pots with one pair" },
    ],
    drillHook: "Turn spots sorted three ways — grow it, control it, or give up — with EV bands.",
  },
  blockers: {
    id: "blockers",
    name: "Blockers",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "Combo-counting flashcards, then bluff-pick spots with the count behind the answer.",
  },
  polarization: {
    id: "polarization",
    name: "Polarization",
    tier: "advanced",
    gradedOnly: false,
    stats: [{ stat: "wsd", note: "W$SD in big river pots, against your own sizing distribution" }],
    drillHook: "Classify a line-plus-sizing polar or merged before acting; the reveal splits the range.",
  },
  overbetting: {
    id: "overbetting",
    name: "Overbetting",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "Nut-advantage recognition quiz, then size-picker spots where 1.5x pot is on the menu.",
  },
  "exploiting-tendencies": {
    id: "exploiting-tendencies",
    name: "Exploiting Tendencies",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "The identical spot with a rotating villain; score measures the adjustment.",
  },
  "multiway-adjustments": {
    id: "multiway-adjustments",
    name: "Multiway Pots",
    tier: "advanced",
    gradedOnly: false,
    stats: [
      { stat: "cbetFlopMultiway", note: "25-40%, well below the heads-up 55-70%" },
      { stat: "wwsf", note: "multiway WWSF and one-pair showdown losses" },
    ],
    drillHook: "The same hand heads-up and four-way, with a bluff-success meter that divides.",
  },
  balance: {
    id: "balance",
    name: "Balance",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "Range-play drill — value hand and bluff must be played to look identical.",
  },
  "icm-pressure": {
    id: "icm-pressure",
    name: "ICM Pressure",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "The same all-in at three tournament stages, chip answer and money answer side by side.",
  },
  "push-fold": {
    id: "push-fold",
    name: "Push/Fold",
    tier: "advanced",
    gradedOnly: true,
    stats: [],
    drillHook: "Nash flashcards — stack, seat, hand: shove or fold, misses cycling back.",
  },
};

/** Every concept, in taxonomy index order. */
export const ALL_CONCEPTS: readonly Concept[] = CONCEPT_IDS.map((id) => CONCEPTS[id]);

/** Concepts in a tier, in taxonomy index order. */
export function conceptsByTier(tier: ConceptTier): Concept[] {
  return ALL_CONCEPTS.filter((c) => c.tier === tier);
}

/** Concepts a stat corroborates, in taxonomy index order. */
export function conceptsForStat(stat: StatId): Concept[] {
  return ALL_CONCEPTS.filter((c) => c.stats.some((l) => l.stat === stat));
}
