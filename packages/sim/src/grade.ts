/**
 * Grading a simulated hand — the one place the simulator talks to
 * `@poker/analysis`.
 *
 * Preflop goes to the chart grader; postflop to the Monte-Carlo/EV grader with
 * the villains' GROUND-TRUTH policy injected (see `policy.ts`), which is what
 * lifts a simulated grade above the tier-default fallback. Both are
 * deterministic: the analysis package derives every stream from
 * `record.seed` + `decisionId`, so a hand grades to the same number every time
 * it is graded.
 */

import {
  type DecisionGrade,
  type PolicyTier,
  gradePostflop,
  gradePreflop,
} from "@poker/analysis";
import type { PersonaConfig } from "@poker/bots";
import type { ChartSet } from "@poker/charts";
import type { Evaluate7 } from "@poker/engine";
import type { HandRecord } from "@poker/history";
import { groundTruthPolicy } from "./policy";

export interface GradeRecordOptions {
  heroSeat: number;
  /** The characters in the other seats — the ground-truth policy source. */
  personaBySeat: ReadonlyMap<number, PersonaConfig>;
  evaluate7: Evaluate7;
  /** Cash preflop charts. Without them preflop grades are honest non-answers. */
  chartSet?: ChartSet;
  /** Fixed Monte Carlo trials per postflop equity estimate. */
  trials?: number;
  /** Price jam-vs-fold EV at push/fold preflop nodes. */
  estimateEv?: boolean;
  /** Tier used for hero's own fold-equity estimates. */
  tier?: PolicyTier;
}

/**
 * Every hero decision in the record, graded. One {@link DecisionGrade} per hero
 * `act` event, keyed by `decisionId`; spots the graders declined to assess come
 * back banded `undefined` with `confidence: "unknown"` rather than invented.
 */
export function gradeRecord(record: HandRecord, opts: GradeRecordOptions): DecisionGrade[] {
  const preflop = gradePreflop(record, {
    heroSeat: opts.heroSeat,
    chartSet: opts.chartSet,
    evaluate7: opts.evaluate7,
    estimateEv: opts.estimateEv ?? false,
  });
  const postflop = gradePostflop(record, {
    heroSeat: opts.heroSeat,
    evaluate7: opts.evaluate7,
    policy: groundTruthPolicy(opts.personaBySeat),
    tier: opts.tier,
    trials: opts.trials,
  });
  return [...preflop, ...postflop];
}
