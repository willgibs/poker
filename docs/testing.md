# Testing strategy

The quality bar is **engine-hardened**: exhaustive verification of everything math-critical,
lighter-touch elsewhere. Vitest + fast-check throughout; engine packages run in Node.

## Per layer

- **Evaluator (`eval`):** full 133,784,560-combination 7-card enumeration must reproduce the
  published hand-class frequency table exactly (slow CI job). Fast suite: curated boundary
  vectors (wheels, flush-vs-straight-flush, kicker battles). Permutation invariance property.
- **Engine (`engine`):** property tests — chip conservation across every reducer step on
  generated action sequences; side pots vs a brute-force oracle; legality (generated illegal
  actions always rejected, legal accepted). Golden replays: committed `(seed, config, actions)`
  fixtures must re-emit byte-identical event logs.
- **RNG (`rng`):** known-answer vectors for splitmix32/xoshiro128**; stream independence.
- **Equity:** MC within 3 standard errors of exact enumeration on a spot corpus; symmetry
  and dominance properties.
- **Bots:** statistical envelopes — simulated VPIP/PFR/AF per persona within bounds over
  seeded self-play; tier ordering (each tier beats the tier below at a margin).
- **ICM:** Malmuth-Harville vs published worked examples; equities sum to prize pool.
- **UI:** Presenter is headless and unit-tested (event burst → beat schedule). Playwright:
  keyboard-only hand playthrough, axe scans, tablet-width smoke.

## Rules

- Deterministic seeds in every statistical test.
- Golden fixtures regenerate only in reviewed commits.
- A bug fix lands with the regression test that would have caught it.
