# Benchmarks

Performance measurements for the engine-side hot paths, run against the harnesses that
exist in the repo today. This doc is descriptive, not enforced by CI — it exists to give
future changes a baseline to compare against and to flag where coverage is thin.

Last measured: 2026-08-18, commit `febe3af`.

## Machine context

| | |
|---|---|
| CPU | Apple M3 Max (14 cores: `sysctl machdep.cpu.brand_string` / `hw.ncpu`) |
| RAM | 38.6 GB (`hw.memsize`) |
| OS | macOS 26.5.2 (build 25F84) |
| Node | v22.21.1 |
| pnpm | 9.14.4 |

Single machine, single sitting, no thermal/contention controls beyond closing other apps.
Treat absolute numbers as one data point, not a certified result — the run-to-run spread
below (±3-4%) is the honest error bar on this hardware.

## `evaluate7` throughput — `pnpm bench:eval`

`packages/eval/bench/bench.ts`: 1,000,000 seeded random 7-card boards, 3 warmup passes + 7
timed passes per run, reports best and average pass rate.

| Run | Pass rates (M evals/sec) | Avg | Best |
|---|---|---|---|
| 1 | 26.39, 26.25, 26.03, 27.02, 26.98, 27.00, 26.79 | 26.63M | 27.02M |
| 2 | 27.03, 26.87, 26.79, 26.99, 27.04, 27.00, 26.77 | 26.93M | 27.04M |
| 3 | 26.19, 25.91, 26.11, 26.27, 26.13, 24.70, 26.71 | 25.99M | 26.71M |

**Median across runs: 26.63M evals/sec avg, 27.02M evals/sec best.**

### Against the stated claims

- PRD (`../poker-internal/PRD.md`) architecture line: target "10M+ evals/sec".
- PRD P0 go/no-go gate: "≥8M evals/sec else WASM port".
- `../poker-internal/roadmap.md`: eval shipped at **"26.6M evals/sec (3.3x go/no-go)"**.

This run reproduces that claim almost exactly (26.63M measured avg vs 26.6M claimed) on
this M3 Max. The claim holds — it isn't stale or measured on unrepresentative hardware, at
least relative to a modern Apple Silicon laptop. No WASM port is warranted by this data.
Two caveats worth carrying forward: (1) the number was presumably captured on the same
class of machine originally, so this isn't independent confirmation across hardware
generations (e.g. no Intel Mac, no CI runner, no lower-end Android/Chromebook — the actual
deployment target per `docs/architecture.md`'s "local-first browser SPA"); (2) this is
Node/V8 via `tsx`, not a Worker inside a browser JS engine — the eventual runtime
environment for this code — so it's a proxy, not the real thing.

## Bot decision latency — `pnpm --filter @poker/bots arena`

`packages/bots/bench/arena.ts` is explicitly documented as "not a test — an inspection
tool," checking against `docs/architecture.md`'s "Bot decision ≤50ms P50" budget. Default
60 hands, `ms/decision` computed as wall time per `playHand()` call divided by that hand's
decision count.

| Run | p50 | p95 | max |
|---|---|---|---|
| 1 | 0.97ms | 1.29ms | 1.46ms |
| 2 | 0.95ms | 1.28ms | 1.45ms |
| 3 | 0.99ms | 1.23ms | 1.47ms |

**Median: p50 0.97ms, p95 1.28ms, max 1.46ms** — roughly 50x under the 50ms P50 budget.

Caveat this one harder than the eval number: this is synthetic self-play on warm V8 with no
Worker boundary, no `postMessage` serialization, no 10ms chunk-yield overhead from the
`packages/workers` scheduler, and no browser JIT cold-start. The 50ms budget almost
certainly exists because those costs are non-trivial in the real path. This harness proves
the *decision math itself* (range state → strength model → EV candidates → shaping →
trace) is cheap, not that the end-to-end budget is met — those are different claims. Good
signal, not a substitute for an in-browser measurement.

## Stated performance budgets (`docs/architecture.md` + PRD) vs. current coverage

| Budget | Value | Benchmarked here? |
|---|---|---|
| `evaluate7` throughput | ≥8M evals/sec (go/no-go), 26.6M claimed | Yes — confirmed, see above |
| Bot decision | ≤50ms P50 | Partially — decision-math-only proxy, see caveat above |
| Instant-mode full 8-bot orbit | ≤500ms | No harness exists |
| Live equity first estimate | ≤100ms | No harness exists |
| Post-hand grading (background) | ≤2s | No harness exists |
| Cold start → first hand | ≤2s | No harness exists |

## Watch list — hot paths worth a harness later

Described only, not built — this repo lane is docs-only.

- **MC equity throughput** (`packages/equity/src/mc.ts`, `equityVsRangeMC`). Fixed-trial by
  design (never time-boxed, per the determinism rules), cost is exactly `2 * trials`
  `evaluate7` calls plus a weighted-combo draw (cumulative-sum inverse-CDF binary search)
  and a partial Fisher-Yates runout per trial. A harness should sweep trial count (whatever
  values the bot pipeline and "live equity first estimate" feature actually use) and range
  shape (heads-up vs. multiway, wide vs. pinned range) separately, since combo count drives
  the rejection-sampling cost independently of trial count. This is the most direct way to
  validate the ≤100ms "live equity first estimate" budget, which currently has no
  benchmark at all.

- **Reducer ops/sec** (`packages/engine`, `applyAction` in `src/apply.ts` driving
  `advance()` in `src/lifecycle.ts`). Pure `(TableState, Action) → { state, events[] }`,
  so it's cheap to benchmark in isolation — no I/O, no RNG beyond injected streams. Worth
  measuring both raw actions/sec on a hot loop and, separately, full-hand throughput
  (deal → showdown), since `docs/architecture.md` notes what-if branches re-decide from the
  same point with the same luck (structural-position-keyed RNG streams) — that pattern
  implies the reducer gets re-run repeatedly per hand in the real product, not called once.

- **`schedule()` throughput** (`packages/table-ui/src/schedule.ts`), the pure
  event-burst → beat-list transform that turns the engine's instant event stream into
  timed, speed-aware beats for the Presenter. This sits directly on the critical path for
  the "instant-mode full 8-bot orbit ≤500ms" budget — schedule() runs once the engine has
  already produced all events, and the Presenter's beat timings are downstream of what it
  emits. No existing harness measures ms-per-hand or beats/sec here, and it's the most
  behavior-adjacent unbenchmarked path (regressions here are UI-visible, not just
  numeric). Related but distinct: `packages/workers/src/scheduler.ts`'s priority scheduler
  (P0/P1/P2, cooperative preemption at ~10ms chunk-yield boundaries) has no throughput
  harness either — e.g. worst-case latency for a P0 job queued behind a running P2 chunk.

Not asked for explicitly but noticed in passing: `packages/ranges`' Bayesian
action-filtering over `Float32Array(1326)` combo vectors is the other candidate — it's
named as compute-shaped in the PRD's package list but has neither a bench script nor a
mention in `docs/architecture.md`'s budget list.
