# @poker/charts

Preflop chart data + accessors: a typed `ChartSet`/`Chart` model over the
canonical 169-hand grid, plus the generated heads-up Nash push/fold
equilibrium (`NASH_HU`, depths 2–15bb).

## Data model

- `Chart { id, format, positions, depthBb, node, weights }` — `weights` is a
  169-length array of integers 0–100: the percentage of the time the chart
  takes its action with that hand (indexing follows the `@poker/core`
  169-ordering contract: pairs 0–12, suited 13–90, offsuit 91–168).
- `ChartSet { version, charts }` — `version` is the `chartSetVersion` stamped
  into hand records.
- Accessors: `getChart(set, id)` and `actionWeights(set, chartId, hand)`
  where `hand` is a canonical 169 index or label (`"AA"`, `"AKs"`, `"T9o"`).
- Heads-up seat naming follows core's position contract: the button posts the
  small blind, so jam charts are `BTN` charts and call charts are `BB` charts.

## Nash heads-up push/fold: methodology

The `NASH_HU` chart set is solved entirely in-repo by
`tools/nash-pushfold/`; nothing is copied from published charts.

1. **Equity table** (`tools/nash-pushfold/equity169.ts`): the 169×169
   preflop all-in equity matrix. For each unordered class pair, one
   representative combo of the first class is fixed (exact by suit symmetry),
   the disjoint combos of the second class are exact-enumerated and deduped
   to suit-isomorphism orbit representatives with orbit-size weights, and
   each representative matchup is Monte-Carlo'd over boards drawn from a
   seeded `@poker/rng` stream (deterministic; no wall-clock or `Math.random`
   anywhere). Boards are allocated proportionally to orbit weights in
   adaptive rounds until the class-pair estimate reaches **stderr < 0.2%**
   (200k-board cap). Diagonal entries are exactly 0.5 by symmetry. The
   7-card evaluator is tool-local and cross-checked at startup against an
   independent naive best-of-21 five-card scorer. Results cache to
   `tools/nash-pushfold/equity169.gen.json`, so reruns are incremental.
2. **Solver** (`tools/nash-pushfold/solve.ts`): heads-up jam/fold — blinds
   0.5/1bb, equal stacks of D bb, SB jams or folds, BB calls or folds — is
   solved per depth D ∈ {2..15} by **fictitious play** over the 169-hand
   abstraction: alternating best responses to the opponent's average
   strategy with uniform averaging, using exact card-removal weights
   (`count(i) × A[i][j]`, rows of A summing to C(50,2) = 1225). Iteration
   stops when the exploitability of the average strategy pair is
   **< 0.001 bb**; the achieved epsilon per depth ships in the data as
   `NASH_HU_EPSILON_BB`. Averaged strategies are emitted as 0–100 weights
   into `packages/charts/src/nashHU.gen.ts`.

## Regeneration

```bash
node --import tsx tools/nash-pushfold/equity169.ts   # builds/refreshes the equity cache (minutes)
node --import tsx tools/nash-pushfold/solve.ts       # solves all depths, writes src/nashHU.gen.ts
pnpm vitest run packages/charts                      # validation suite
```

Bump the tool's seed root / cache version when changing sampling parameters;
the cache self-invalidates when parameters differ.

## Licensing

All chart data in this package is **generated in-repo from first principles**
(exact combinatorics plus seeded Monte Carlo) with zero third-party chart
inputs, solver binaries, or scraped tables. The generated data files are
released under **CC0** (public domain dedication); the generation pipeline is
covered by the repository license. There is no licensing entanglement with
any commercial solver or published chart product, and regeneration is fully
reproducible from the committed tools.
