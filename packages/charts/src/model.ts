/**
 * Preflop chart data model.
 *
 * A Chart is one decision node's action weights over the canonical 169-hand
 * grid (see @poker/core combos.ts for the ordering contract: pairs 0-12,
 * suited 13-90, offsuit 91-168). Weights are integers 0-100: the percentage
 * of the time the chart takes its action with that hand; the remainder folds
 * (or takes the node's passive alternative).
 */

import { HAND169_COUNT, label169, type PositionLabel } from "@poker/core";

/** Game format a chart applies to ("hu" = heads-up push/fold family). */
export type ChartFormat = "cash" | "sng" | "mtt" | "hu";

export interface Chart {
  /** Stable unique id, e.g. "hu-nash-sb-jam-10bb". */
  id: string;
  format: ChartFormat;
  /** Positions this chart applies to (heads-up: BTN posts the small blind). */
  positions: readonly PositionLabel[];
  /** Effective stack depth in big blinds. */
  depthBb: number;
  /** Decision-node descriptor, e.g. "sb-jam" or "bb-call-vs-jam". */
  node: string;
  /** weights[h] = 0-100 action weight for canonical hand169 index h (length 169). */
  weights: readonly number[];
}

export interface ChartSet {
  /** Version stamp recorded into hand histories as chartSetVersion. */
  version: string;
  charts: readonly Chart[];
}

/** Look up a chart by id; undefined when absent. */
export function getChart(set: ChartSet, id: string): Chart | undefined {
  return set.charts.find((c) => c.id === id);
}

let labelToIndex: Map<string, number> | undefined;

/** Resolve a hand169 reference (canonical index or label like "AKs") to its index. */
function index169Of(hand: number | string): number {
  if (typeof hand === "number") {
    if (!Number.isInteger(hand) || hand < 0 || hand >= HAND169_COUNT) {
      throw new RangeError(`invalid hand169 index: ${hand} (expected integer 0-${HAND169_COUNT - 1})`);
    }
    return hand;
  }
  if (labelToIndex === undefined) {
    labelToIndex = new Map();
    for (let i = 0; i < HAND169_COUNT; i++) labelToIndex.set(label169(i), i);
  }
  const idx = labelToIndex.get(hand);
  if (idx === undefined) {
    throw new RangeError(`invalid hand169 label: ${JSON.stringify(hand)} (expected e.g. "AA", "AKs", "T9o")`);
  }
  return idx;
}

/**
 * Action weight (0-100) of `hand` in chart `chartId`. `hand` is a canonical
 * 169 index or a canonical label ("AA", "AKs", "T9o"). Throws RangeError on
 * an unknown chart id or invalid hand.
 */
export function actionWeights(set: ChartSet, chartId: string, hand: number | string): number {
  const chart = getChart(set, chartId);
  if (chart === undefined) {
    throw new RangeError(`unknown chart id: ${JSON.stringify(chartId)}`);
  }
  const idx = index169Of(hand);
  const w = chart.weights[idx];
  if (w === undefined) {
    throw new RangeError(`chart ${chartId} has no weight for hand169 index ${idx}`);
  }
  return w;
}
