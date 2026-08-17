/**
 * Preflop grading against charts.
 *
 * Preflop is the one street where a true baseline exists (PRD Q23: "preflop
 * solver charts — true grading"), so this grader is chart-driven rather than
 * simulation-driven:
 *
 * 1. Classify hero's decision into a NODE — what kind of preflop spot it is
 *    (`rfi`, `vs-limp`, `vs-rfi`, `vs-3bet`, push/fold jam or call) with the
 *    position, effective depth, and hero's 169-class.
 * 2. Resolve the node to chart ids, and read the weight of the line hero took.
 * 3. Band the weight, tag the concept, and record chart provenance so a report
 *    can say *which* chart said so.
 *
 * ## Honesty rules
 *
 * - **No chart, no grade.** Every node maps to deterministic chart ids; if the
 *   set lacks them, the grade comes back with no band and
 *   `confidence: "unknown"`. We would rather say nothing than invent a
 *   baseline. The id convention ({@link cashChartId}) is fixed so a chart pack
 *   drops in without touching this file.
 * - **Off-chart lines that are still known mistakes** — open-limping,
 *   min-raising at push/fold depth — are reported as deviations with `unknown`
 *   confidence and no EV number.
 * - **EV loss only where it is computable.** The heads-up Nash charts ship the
 *   opponent's equilibrium calling range, which makes jam-vs-fold EV a real
 *   calculation; it runs when `estimateEv` is on. Nowhere else is an EV number
 *   reported, because nowhere else is one available.
 *
 * ## How a single-action chart covers a three-way node
 *
 * `@poker/charts` models a node as ONE action's weights, remainder passive.
 * A `vs-rfi` spot has three branches, so it resolves to two charts: a DEFEND
 * chart (weights = continue frequency; fold is the complement) and an optional
 * RAISE chart (weights = 3-bet frequency). `call` is then
 * `defend − raise`. When only the defend chart exists, a raise has no branch
 * and is reported ungraded rather than guessed.
 */

import { type Card, type PositionLabel, comboFromIndex, hand169 } from "@poker/core";
import {
  type Chart,
  type ChartSet,
  NASH_HU,
  NASH_HU_DEPTHS_BB,
  actionWeights,
  getChart,
  nashHuCallChartId,
  nashHuJamChartId,
} from "@poker/charts";
import { type Evaluate7, equityVsRangeMC } from "@poker/equity";
import type { HandRecord } from "@poker/history";
import { GRID_SIZE, RANGE_SIZE, fromGrid169 } from "@poker/ranges";
import { streamFor } from "@poker/rng";
import type { ConceptId } from "./concepts";
import { defaultEvaluate7 } from "./evaluator";
import { type ActionView, type HandView, buildHandView, effectiveStack, seatView } from "./replay";
import {
  type ChartProvenance,
  type DecisionGrade,
  bandForChartWeight,
  quantizeEvBb,
} from "./types";

/** The kind of preflop decision node. */
export type PreflopNodeKind =
  | "rfi"
  | "vs-limp"
  | "vs-rfi"
  | "vs-3bet"
  | "vs-4bet"
  | "push-fold-jam"
  | "push-fold-call"
  | "other";

/** The line hero took, normalized for chart lookup. */
export type PreflopLine = "fold" | "limp" | "call" | "raise" | "jam" | "check";

/** A classified preflop decision. */
export interface PreflopNode {
  kind: PreflopNodeKind;
  position: PositionLabel;
  /** Position of the player hero is responding to, when there is one. */
  vsPosition?: PositionLabel;
  tableSize: number;
  /** Effective stack in big blinds at hand start (fractional). */
  depthBb: number;
  /** Canonical 169 index of hero's holding. */
  hand: number;
  handLabel: string;
  line: PreflopLine;
  /** True when hero's action committed their whole stack. */
  allIn: boolean;
}

export interface PreflopGradeOptions {
  heroSeat: number;
  /** Cash/MTT chart set, looked up by {@link cashChartId}. */
  chartSet?: ChartSet;
  /** Push/fold chart set. Defaults to the shipped heads-up Nash charts. */
  nashSet?: ChartSet;
  /** At or below this effective depth, heads-up play is graded push/fold. */
  pushFoldMaxBb?: number;
  /** Depth buckets cash chart ids round to. */
  depthBuckets?: readonly number[];
  /** Compute jam-vs-fold EV loss at push/fold nodes (one fixed-trial MC each). */
  estimateEv?: boolean;
  /** Fixed MC trials. Never time-boxed. */
  trials?: number;
  evaluate7?: Evaluate7;
  /** Override chart resolution (e.g. an app-supplied chart registry). */
  resolveChartId?: (node: PreflopNode, role: ChartRole) => string | undefined;
}

/** Which branch a chart's weights describe at a node. */
export type ChartRole = "primary" | "raise";

/** Default depth buckets for cash chart ids. */
export const DEFAULT_DEPTH_BUCKETS: readonly number[] = [20, 40, 60, 100, 150, 200];

/** Default heads-up depth at or below which play is graded push/fold. */
export const DEFAULT_PUSH_FOLD_MAX_BB = 15;

/** Default fixed MC trial count for push/fold EV estimates. */
export const DEFAULT_PUSH_FOLD_TRIALS = 20_000;

/** Nearest value in `buckets` to `depthBb` (ties round up). */
export function nearestBucket(depthBb: number, buckets: readonly number[]): number {
  let best = buckets[0] ?? 100;
  let bestDist = Math.abs(depthBb - best);
  for (const b of buckets) {
    const d = Math.abs(depthBb - b);
    if (d < bestDist || (d === bestDist && b > best)) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

/** Nearest depth covered by the shipped Nash charts (2-15bb). */
export function nearestNashDepth(depthBb: number): number {
  return nearestBucket(depthBb, NASH_HU_DEPTHS_BB);
}

/**
 * Chart id convention for cash/MTT nodes. Stable and mechanical, so a chart
 * pack can be authored against it without touching code:
 *
 * ```text
 * cash-6max-100bb-rfi-CO                       primary: P(open raise)
 * cash-6max-100bb-vs-rfi-BB-vs-BTN             primary: P(continue)
 * cash-6max-100bb-vs-rfi-BB-vs-BTN-3bet        raise:   P(3-bet)
 * cash-6max-100bb-vs-3bet-CO-vs-BB             primary: P(continue)
 * cash-6max-100bb-vs-3bet-CO-vs-BB-4bet        raise:   P(4-bet)
 * cash-6max-100bb-vs-limp-BTN                  primary: P(iso raise)
 * ```
 */
export function cashChartId(
  node: PreflopNode,
  role: ChartRole = "primary",
  buckets = DEFAULT_DEPTH_BUCKETS,
): string | undefined {
  const depth = nearestBucket(node.depthBb, buckets);
  const base = `cash-${node.tableSize}max-${depth}bb`;
  const vs = node.vsPosition;
  switch (node.kind) {
    case "rfi":
      return role === "primary" ? `${base}-rfi-${node.position}` : undefined;
    case "vs-limp":
      return role === "primary" ? `${base}-vs-limp-${node.position}` : undefined;
    case "vs-rfi":
      if (vs === undefined) return undefined;
      return role === "primary"
        ? `${base}-vs-rfi-${node.position}-vs-${vs}`
        : `${base}-vs-rfi-${node.position}-vs-${vs}-3bet`;
    case "vs-3bet":
      if (vs === undefined) return undefined;
      return role === "primary"
        ? `${base}-vs-3bet-${node.position}-vs-${vs}`
        : `${base}-vs-3bet-${node.position}-vs-${vs}-4bet`;
    case "vs-4bet":
      if (vs === undefined) return undefined;
      return role === "primary"
        ? `${base}-vs-4bet-${node.position}-vs-${vs}`
        : `${base}-vs-4bet-${node.position}-vs-${vs}-5bet`;
    default:
      return undefined;
  }
}

/**
 * Whether a node's primary chart describes an AGGRESSIVE action (raise-or-fold
 * alphabet, so calling has no branch) or a DEFEND action (continue-or-fold, so
 * calling is `continue − raise`).
 */
function primaryRole(kind: PreflopNodeKind): "aggressive" | "defend" {
  switch (kind) {
    case "rfi":
    case "vs-limp":
    case "push-fold-jam":
      return "aggressive";
    default:
      return "defend";
  }
}

/** Primary concept tag for a node (at most one, per the taxonomy). */
function conceptFor(node: PreflopNode): ConceptId {
  switch (node.kind) {
    case "push-fold-jam":
    case "push-fold-call":
      return "push-fold";
    case "vs-limp":
      return "iso-raising";
    case "vs-rfi":
      return node.position === "BB" || node.position === "SB" ? "blind-defense" : "3betting";
    case "vs-3bet":
    case "vs-4bet":
      return "3bet-defense";
    case "rfi":
      return node.line === "limp" ? "open-vs-limp" : "hand-selection";
    default:
      return "hand-selection";
  }
}

/**
 * Classify one preflop hero action into a node. `view` is the reconstruction
 * of the hand; `action` one of hero's preflop actions in it. Returns undefined
 * when hero's hole cards are absent from the record.
 */
export function preflopNodeOf(
  view: HandView,
  action: ActionView,
  opts: { pushFoldMaxBb?: number } = {},
): PreflopNode | undefined {
  const me = seatView(view, action.seat);
  if (me === undefined || me.holeCards === null) return undefined;
  const h = hand169(me.holeCards[0], me.holeCards[1]);
  const depthBb = view.bb > 0 ? effectiveStack(view, action.seat) / view.bb : 0;
  const pushFoldMaxBb = opts.pushFoldMaxBb ?? DEFAULT_PUSH_FOLD_MAX_BB;

  const prior = view.actions.filter(
    (a) => a.street === "preflop" && a.eventIndex < action.eventIndex,
  );
  const raises = prior.filter((a) => a.kind === "raise");
  const limps = raises.length === 0 ? prior.filter((a) => a.kind === "call" && a.toCall > 0) : [];
  const lastRaise = raises[raises.length - 1];

  const line: PreflopLine =
    action.kind === "fold"
      ? "fold"
      : action.kind === "check"
        ? "check"
        : action.kind === "call"
          ? raises.length === 0
            ? "limp"
            : "call"
          : action.allIn
            ? "jam"
            : "raise";

  const heads = view.tableSize === 2;
  const shallow = depthBb <= pushFoldMaxBb;

  let kind: PreflopNodeKind;
  if (heads && shallow && raises.length === 0) kind = "push-fold-jam";
  else if (heads && shallow && raises.length === 1 && (lastRaise?.allIn ?? false)) {
    kind = "push-fold-call";
  } else if (raises.length === 0) kind = limps.length > 0 ? "vs-limp" : "rfi";
  else if (raises.length === 1) kind = "vs-rfi";
  else if (raises.length === 2) kind = "vs-3bet";
  else if (raises.length === 3) kind = "vs-4bet";
  else kind = "other";

  const node: PreflopNode = {
    kind,
    position: me.position,
    tableSize: view.tableSize,
    depthBb,
    hand: h.index,
    handLabel: h.label,
    line,
    allIn: action.allIn,
  };
  const responder = lastRaise ?? limps[0];
  const vsPosition = responder === undefined ? undefined : seatView(view, responder.seat)?.position;
  if (vsPosition !== undefined) node.vsPosition = vsPosition;
  return node;
}

interface WeightResult {
  weight: number;
  chart: Chart;
  set: ChartSet;
  /** Why the weight is what it is, for the grade note. */
  explain: string;
}

/**
 * Weight (0-100) of the line hero took at a chart-backed node.
 * Returns undefined when the charts present have no branch for that line.
 */
function weightOfLine(
  node: PreflopNode,
  set: ChartSet,
  primary: Chart,
  raise: Chart | undefined,
): WeightResult | undefined {
  const primaryWeight = actionWeights(set, primary.id, node.hand);
  const raiseWeight = raise === undefined ? undefined : actionWeights(set, raise.id, node.hand);
  const aggressive = primaryRole(node.kind) === "aggressive";
  const line = node.line === "jam" && node.kind !== "push-fold-jam" ? "raise" : node.line;

  if (line === "fold") {
    return {
      weight: 100 - primaryWeight,
      chart: primary,
      set,
      explain: `folds ${100 - primaryWeight}%`,
    };
  }
  if (line === "raise" || line === "jam") {
    if (aggressive) {
      return { weight: primaryWeight, chart: primary, set, explain: `takes this line ${primaryWeight}%` };
    }
    if (raise !== undefined && raiseWeight !== undefined) {
      return { weight: raiseWeight, chart: raise, set, explain: `raises ${raiseWeight}%` };
    }
    return undefined;
  }
  if (line === "call" || line === "check") {
    if (aggressive) return undefined; // raise-or-fold alphabet: calling has no branch
    const call = raiseWeight === undefined ? primaryWeight : Math.max(0, primaryWeight - raiseWeight);
    return {
      weight: call,
      chart: primary,
      set,
      explain:
        raiseWeight === undefined
          ? `continues ${call}%`
          : `continues ${primaryWeight}% and raises ${raiseWeight}%, so calls ${call}%`,
    };
  }
  return undefined;
}

function provenanceOf(r: WeightResult, node: PreflopNode): ChartProvenance {
  return {
    chartSetVersion: r.set.version,
    chartId: r.chart.id,
    node: r.chart.node,
    depthBb: r.chart.depthBb,
    hand: node.handLabel,
    weight: r.weight,
  };
}

/**
 * Heads-up jam-vs-fold EV in big blinds, from the small blind's seat, against
 * the Nash calling range at this depth:
 *
 * ```text
 * EV(jam)  = (1 − f) · 1        // BB folds: hero takes the big blind
 *          + f · S · (2e − 1)   // BB calls: an S-deep all-in at equity e
 * EV(fold) = −0.5               // hero forfeits the small blind
 * ```
 *
 * `f` is the Nash call range's mass after removing hero's cards; `e` is hero's
 * all-in equity against that range from fixed-trial Monte Carlo on a stream
 * derived from the hand seed and the decisionId — so a hand always grades to
 * the same number.
 */
function pushFoldEv(
  hole: readonly [Card, Card],
  depth: number,
  nashSet: ChartSet,
  seed: string,
  decisionId: string,
  evaluate7: Evaluate7,
  trials: number,
): { evJamBb: number; evFoldBb: number; callFrequency: number } | undefined {
  const callChart = getChart(nashSet, nashHuCallChartId(depth));
  if (callChart === undefined) return undefined;

  const grid = new Float64Array(GRID_SIZE);
  for (let i = 0; i < GRID_SIZE; i++) grid[i] = (callChart.weights[i] ?? 0) / 100;
  const callRange = fromGrid169(grid);

  let callMass = 0;
  let liveCombos = 0;
  const [h0, h1] = hole;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const [a, b] = comboFromIndex(i);
    if (a === h0 || a === h1 || b === h0 || b === h1) continue;
    liveCombos += 1;
    callMass += callRange[i] ?? 0;
  }
  if (liveCombos <= 0) return undefined;
  const f = callMass / liveCombos;

  let equity = 0.5;
  if (callMass > 0) {
    const stream = streamFor(seed, `analysis/preflop/${decisionId}/pushfold`);
    equity = equityVsRangeMC([h0, h1], callRange, [], evaluate7, stream, trials).equity;
  }
  return { evJamBb: (1 - f) * 1 + f * depth * (2 * equity - 1), evFoldBb: -0.5, callFrequency: f };
}

interface ResolvedOptions {
  heroSeat: number;
  chartSet: ChartSet | undefined;
  nashSet: ChartSet;
  pushFoldMaxBb: number;
  buckets: readonly number[];
  estimateEv: boolean;
  trials: number;
  evaluate7: Evaluate7;
  resolveChartId: ((node: PreflopNode, role: ChartRole) => string | undefined) | undefined;
}

/**
 * Grade every preflop decision hero made in `record`.
 *
 * One {@link DecisionGrade} per hero preflop action, keyed by the `decisionId`
 * scheme in docs/hand-format.md. A grade with no `band` is a spot this package
 * declined to assess.
 */
export function gradePreflop(record: HandRecord, opts: PreflopGradeOptions): DecisionGrade[] {
  const view = buildHandView(record);
  const resolved: ResolvedOptions = {
    heroSeat: opts.heroSeat,
    chartSet: opts.chartSet,
    nashSet: opts.nashSet ?? NASH_HU,
    pushFoldMaxBb: opts.pushFoldMaxBb ?? DEFAULT_PUSH_FOLD_MAX_BB,
    buckets: opts.depthBuckets ?? DEFAULT_DEPTH_BUCKETS,
    estimateEv: opts.estimateEv ?? false,
    trials: opts.trials ?? DEFAULT_PUSH_FOLD_TRIALS,
    evaluate7: opts.evaluate7 ?? defaultEvaluate7,
    resolveChartId: opts.resolveChartId,
  };

  const out: DecisionGrade[] = [];
  for (const action of view.actions) {
    if (action.street !== "preflop" || action.seat !== resolved.heroSeat) continue;
    const node = preflopNodeOf(view, action, { pushFoldMaxBb: resolved.pushFoldMaxBb });
    if (node === undefined) {
      out.push({
        decisionId: action.decisionId,
        street: "preflop",
        seat: action.seat,
        kind: action.kind,
        confidence: "unknown",
        basis: "none",
        note: "hero hole cards are absent from this record — nothing to grade against",
      });
      continue;
    }
    out.push(gradeNode(view, action, node, resolved));
  }
  return out;
}

function gradeNode(
  view: HandView,
  action: ActionView,
  node: PreflopNode,
  opts: ResolvedOptions,
): DecisionGrade {
  const base = {
    decisionId: action.decisionId,
    street: "preflop" as const,
    seat: action.seat,
    kind: action.kind,
    concept: conceptFor(node),
  };

  // --- Push/fold: the shipped Nash charts are a real equilibrium baseline. --
  if (node.kind === "push-fold-jam" || node.kind === "push-fold-call") {
    const depth = nearestNashDepth(node.depthBb);
    const chartId =
      node.kind === "push-fold-jam" ? nashHuJamChartId(depth) : nashHuCallChartId(depth);
    const chart = getChart(opts.nashSet, chartId);
    if (chart === undefined) {
      return { ...base, confidence: "unknown", basis: "none", note: `no push/fold chart at ${depth}bb` };
    }
    // The chart's alphabet at this depth is jam or fold; anything else is
    // off-chart by construction (the taxonomy's canonical push/fold mistake).
    if (node.line === "raise" || node.line === "limp") {
      const jamWeight = actionWeights(opts.nashSet, chartId, node.hand);
      return {
        ...base,
        band: jamWeight >= 50 ? "significant" : "minor",
        confidence: "unknown",
        basis: "none",
        chart: provenanceOf({ weight: jamWeight, chart, set: opts.nashSet, explain: "" }, node),
        note: `at ${node.depthBb.toFixed(1)}bb the alphabet is jam or fold — ${node.handLabel} jams ${jamWeight}% at equilibrium, so a non-all-in raise is off-chart and not priced`,
      };
    }
    const r = weightOfLine(node, opts.nashSet, chart, undefined);
    if (r === undefined) {
      return { ...base, confidence: "unknown", basis: "none", note: `${chart.id} has no branch for a ${node.line}` };
    }
    const grade: DecisionGrade = {
      ...base,
      band: bandForChartWeight(r.weight),
      confidence: "medium",
      basis: "chart-weight",
      chart: provenanceOf(r, node),
      note: `${node.handLabel} ${r.explain} at ${depth}bb Nash equilibrium`,
    };

    const hole = seatView(view, action.seat)?.holeCards;
    if (opts.estimateEv && node.kind === "push-fold-jam" && hole != null) {
      const ev = pushFoldEv(
        hole,
        depth,
        opts.nashSet,
        view.seed,
        action.decisionId,
        opts.evaluate7,
        opts.trials,
      );
      if (ev !== undefined) {
        const taken = node.line === "jam" ? ev.evJamBb : ev.evFoldBb;
        const best = Math.max(ev.evJamBb, ev.evFoldBb);
        const loss = Math.max(0, best - taken);
        grade.evLossBb = quantizeEvBb(loss, "monte-carlo");
        grade.basis = "monte-carlo";
        grade.ev = {
          basis: "monte-carlo",
          trials: opts.trials,
          rangeSource: "given",
          livePlayers: action.livePlayers,
          takenEvBb: quantizeEvBb(taken, "monte-carlo"),
          bestEvBb: quantizeEvBb(best, "monte-carlo"),
          bestAction: ev.evJamBb >= ev.evFoldBb ? "jam" : "fold",
          alternatives: [
            { action: "jam", evBb: quantizeEvBb(ev.evJamBb, "monte-carlo") },
            { action: "fold", evBb: quantizeEvBb(ev.evFoldBb, "monte-carlo") },
          ],
        };
        grade.note = `${grade.note}; against the ${(ev.callFrequency * 100).toFixed(0)}% Nash call range this line costs ${grade.evLossBb.toFixed(2)}bb`;
      }
    }
    return grade;
  }

  // --- Known off-chart deviations ------------------------------------------
  if (node.line === "limp") {
    const openLimp = node.kind === "rfi";
    return {
      ...base,
      concept: openLimp ? "open-vs-limp" : "iso-raising",
      band: "minor",
      confidence: "unknown",
      basis: "none",
      note: openLimp
        ? `open-limping ${node.handLabel} from ${node.position}: no chart plays a limp-first strategy, so this is a deviation we can name but not price`
        : `over-limping ${node.handLabel} from ${node.position}: off-chart, graded as a deviation`,
    };
  }

  // --- Chart-backed nodes ---------------------------------------------------
  const resolve = (role: ChartRole): string | undefined =>
    opts.resolveChartId !== undefined
      ? opts.resolveChartId(node, role)
      : cashChartId(node, role, opts.buckets);

  const set = opts.chartSet;
  const primaryId = resolve("primary");
  const primary = set !== undefined && primaryId !== undefined ? getChart(set, primaryId) : undefined;
  if (set === undefined || primary === undefined) {
    return {
      ...base,
      confidence: "unknown",
      basis: "none",
      note: `no chart for ${node.kind} at ${node.position}${node.vsPosition === undefined ? "" : ` vs ${node.vsPosition}`} at ${Math.round(node.depthBb)}bb — left ungraded rather than guessed`,
    };
  }
  const raiseId = resolve("raise");
  const raiseChart = raiseId === undefined ? undefined : getChart(set, raiseId);

  const r = weightOfLine(node, set, primary, raiseChart);
  if (r === undefined) {
    return {
      ...base,
      confidence: "unknown",
      basis: "none",
      note: `${primary.id} has no branch for a ${node.line}${raiseChart === undefined ? " and no raise chart is present" : ""}`,
    };
  }
  return {
    ...base,
    band: bandForChartWeight(r.weight),
    confidence: "medium",
    basis: "chart-weight",
    chart: provenanceOf(r, node),
    note: `${r.chart.id}: ${node.handLabel} ${r.explain}`,
  };
}
