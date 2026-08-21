> **THIS IS THE ACADEMY BRANCH.** You are the Academy's agent, not the app's. Read
> [`apps/academy/CLAUDE.md`](apps/academy/CLAUDE.md) FIRST — it is your founding contract.
> The rest of this file is the host monorepo's engineering contract: useful as reference
> for tooling (pnpm, TypeScript, test conventions), but its design budgets and laws do not
> govern the Academy unless your lane adopts them. This banner exists only on the
> `academy` branch.

# CLAUDE.md — Contributor & Agent Guide

Solo poker trainer: play NLHE vs humanlike bots, learn from deterministic analysis.
Local-first browser SPA, no server compute, deployed static. This file is the onboarding
contract for both human contributors and AI agents. Everything needed to contribute
correctly is in this repo; if a sibling checkout `../poker-internal` exists, read its
`AGENTS.md` for roadmap/product context.

## Commands

```bash
pnpm install
pnpm test              # vitest across all packages
pnpm typecheck         # tsc strict, no emit
pnpm lint
pnpm bench:eval        # evaluator throughput benchmark
```

Run a single package's tests: `pnpm vitest run packages/eval`.

## Package map (dependency direction is strictly downward)

| Package | Responsibility | May depend on |
|---|---|---|
| `packages/core` | Cards, deck, combos, positions, chip math, board texture | nothing |
| `packages/rng` | Seeded RNG: splitmix32 derivation, xoshiro128** streams | nothing |
| `packages/eval` | 7-card hand evaluator (two-table lookup) + table generation | core |
| `packages/history` | Canonical hand event log (versioned), serialization, exports | core |
| `packages/engine` | Pure NLHE reducer: betting rules, side pots, hand lifecycle | core, history (types) |
| `packages/ranges` | Weighted combo vectors, archetype distortion, Bayesian filtering | core, charts |
| `packages/equity` | Exact enumeration + Monte Carlo equity, EV helpers | core, eval, rng, ranges |
| `packages/charts` | Preflop chart data + accessors, Nash push/fold | core |
| `packages/bots` | Bot decision pipeline, personas, tilt, tells, traces | core, engine, ranges, equity, rng, charts |
| `packages/analysis` | Grading, leaks, earned HUD, skill rating, ICM | core, eval, equity, ranges, charts, history |
| `packages/sim` | Session orchestrator; owns seed hierarchy | engine-side packages |
| `packages/ui` | Design tokens + system components (atoms/molecules) | nothing engine-side |
| `apps/web` | The SPA. The ONLY package touching DOM/storage | anything |

Engine-side packages are **zero-runtime-dependency** TypeScript. Only `apps/web` and `ui`
may take third-party dependencies, and sparingly.

## Non-negotiable conventions

- **Cards are ints 0–51:** `card = rank * 4 + suit`; rank `0=2 … 12=A`; suit `0=♣ 1=♦ 2=♥ 3=♠`.
  String form is rank char + suit char, e.g. `"As"`, `"Td"`, `"2c"`.
- **Chips are integer cents.** No floats in chip math, ever.
- **Determinism:** no `Date.now()`, `Math.random()`, or environment reads inside
  `packages/*` engine code. Randomness comes from injected named RNG streams; time is an input.
  Monte Carlo uses **fixed iteration counts** (never time-boxed).
- **Purity:** `engine` is a pure reducer; bots are `decide(snapshot, botState, streams) →
  {action, …, nextBotState}` — no hidden state.
- **TS strict** (see tsconfig.base.json); ESM only; `exports` in package.json point at
  `src/index.ts` (packages are consumed as source; no build step).
- Tests live in `packages/<name>/src/**/*.test.ts` or `packages/<name>/test/`.
  Math-critical code gets property tests (fast-check) + known-vector suites.

## Design budgets (enforced product law — see docs/design-system.md)

Table header ≤4 slots · one ambient analysis chip in Guided loadout · session-end sheet ≤4
slots · one celebration per session end · one coach line + one banter slot · no popups/modals
mid-hand · numbers quiet, moments warm.

## Docs

- `docs/architecture.md` — system shape, worker model, state rings
- `docs/hand-format.md` — the canonical hand event log (the constitution; version it carefully)
- `docs/design-system.md` — tokens, budgets, component rules
- `docs/testing.md` — testing strategy per layer
- `docs/contributing.md` — PR conventions

When you change a system, update its doc in the same PR.
