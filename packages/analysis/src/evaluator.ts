/**
 * Adapter between the two evaluator shapes in the monorepo.
 *
 * `@poker/eval` exposes `evaluate7(c0…c6)` — seven separate arguments, so hot
 * loops never allocate a wrapper array. `@poker/equity` takes an injected
 * `Evaluate7 = (cards: number[]) => number` so it can stay evaluator-agnostic.
 * Analysis consumes both, so the bridge lives here, once.
 *
 * Both conventions agree on the ordering contract: LOWER = STRONGER.
 */

import type { Evaluate7 } from "@poker/equity";
import { evaluate7 } from "@poker/eval";

/** The shipped evaluator in `@poker/equity`'s array-taking shape. */
export const defaultEvaluate7: Evaluate7 = (cards) =>
  evaluate7(
    cards[0] ?? 0,
    cards[1] ?? 0,
    cards[2] ?? 0,
    cards[3] ?? 0,
    cards[4] ?? 0,
    cards[5] ?? 0,
    cards[6] ?? 0,
  );
