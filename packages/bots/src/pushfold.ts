/**
 * Nash push/fold consultation (`@poker/charts`).
 *
 * Short-stacked heads-up preflop is the one spot in NLHE with a genuinely
 * solved answer, and the crushers know it. When a `balanceAware` persona finds
 * itself heads-up preflop at or below the deepest charted stack, it reads the
 * equilibrium jam/call weight for its exact holding and lets that nudge the
 * shove and call candidates. Everyone below tier 6 plays the spot by feel,
 * which is exactly the difference the ladder is supposed to express.
 */

import { hand169 } from "@poker/core";
import {
  NASH_HU,
  NASH_HU_DEPTHS_BB,
  actionWeights,
  nashHuCallChartId,
  nashHuJamChartId,
} from "@poker/charts";
import type { DecisionContext } from "./context";

export interface NashRead {
  chartId: string;
  depthBb: number;
  /** Equilibrium weight for the relevant action, [0, 1]. */
  weight: number;
  /** Which side of the spot the bot is on. */
  role: "jam" | "call";
}

/** Nearest charted depth at or above `depthBb`, or null when out of range. */
function nearestDepth(depthBb: number): number | null {
  let best: number | null = null;
  for (const d of NASH_HU_DEPTHS_BB) {
    if (best === null || Math.abs(d - depthBb) < Math.abs(best - depthBb)) best = d;
  }
  if (best === null) return null;
  const maxDepth = Math.max(...NASH_HU_DEPTHS_BB);
  return depthBb <= maxDepth + 1 ? best : null;
}

/**
 * Read the Nash chart for this spot, or null when it does not apply
 * (not heads-up, not preflop, too deep, or the bot has already acted).
 */
export function nashRead(ctx: DecisionContext): NashRead | null {
  if (!ctx.isPreflop || !ctx.headsUp) return null;
  if (ctx.bb <= 0) return null;
  const depthBb = ctx.effectiveStack / ctx.bb;
  const depth = nearestDepth(depthBb);
  if (depth === null) return null;
  const hand = hand169(ctx.hole[0], ctx.hole[1]).index;
  // Facing an all-in-sized bet makes this the calling node; otherwise the bot
  // is the one deciding whether to jam.
  const facingJam = ctx.facingBet && ctx.toCall >= ctx.effectiveStack * 0.75;
  const chartId = facingJam ? nashHuCallChartId(depth) : nashHuJamChartId(depth);
  const weight = actionWeights(NASH_HU, chartId, hand) / 100;
  return { chartId, depthBb: depth, weight, role: facingJam ? "call" : "jam" };
}
