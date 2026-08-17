/**
 * Heads-up Nash jam/fold charts, assembled from generated equilibrium data.
 *
 * Positions follow the core heads-up contract: the button posts the small
 * blind, so the jammer's chart is a BTN chart and the caller's is a BB chart.
 * Data provenance and regeneration commands: see nashHU.gen.ts and the
 * package README.
 */

import type { Chart, ChartSet } from "./model";
import {
  NASH_HU_VERSION,
  NASH_HU_DEPTHS_BB,
  NASH_HU_JAM_WEIGHTS,
  NASH_HU_CALL_WEIGHTS,
} from "./nashHU.gen";

/** Chart id of the SB (button) jam range at a given depth. */
export function nashHuJamChartId(depthBb: number): string {
  return `hu-nash-sb-jam-${depthBb}bb`;
}

/** Chart id of the BB call-vs-jam range at a given depth. */
export function nashHuCallChartId(depthBb: number): string {
  return `hu-nash-bb-call-${depthBb}bb`;
}

function buildNashHu(): ChartSet {
  const charts: Chart[] = [];
  for (let k = 0; k < NASH_HU_DEPTHS_BB.length; k++) {
    const depthBb = NASH_HU_DEPTHS_BB[k];
    const jam = NASH_HU_JAM_WEIGHTS[k];
    const call = NASH_HU_CALL_WEIGHTS[k];
    if (depthBb === undefined || jam === undefined || call === undefined) {
      throw new Error(`nashHU.gen data malformed at depth index ${k}`);
    }
    charts.push({
      id: nashHuJamChartId(depthBb),
      format: "hu",
      positions: ["BTN"],
      depthBb,
      node: "sb-jam",
      weights: jam,
    });
    charts.push({
      id: nashHuCallChartId(depthBb),
      format: "hu",
      positions: ["BB"],
      depthBb,
      node: "bb-call-vs-jam",
      weights: call,
    });
  }
  return { version: NASH_HU_VERSION, charts };
}

/** The generated heads-up Nash push/fold chart set (depths 2-15bb). */
export const NASH_HU: ChartSet = buildNashHu();
