# Architecture

## Shape

Local-first browser SPA. All poker computation runs client-side in Web Workers; the app is
deployed as static files. No server compute, no accounts.

Three rings, one-way data flow:

1. **Engine truth (worker):** the engine runs event-sourced in a worker — given
   `(config, seed, decisions)` it emits an append-only event stream (see `docs/hand-format.md`).
2. **Table projection (main thread):** a store reduces events to a view model instantly; a
   separate **Presenter** schedules them into timed, interruptible, speed-aware UI beats.
   All timing lives here — the engine has no concept of time.
3. **Persistence:** at hand boundaries, the app writes through repository interfaces
   (IndexedDB via Dexie). Aggregates are rebuildable caches, never sources of truth.

## Core conventions

- **Cards are ints 0–51:** `card = rank * 4 + suit`; rank `0=2 … 12=A`;
  suit `0=♣ 1=♦ 2=♥ 3=♠`. String form: `"As"`, `"Td"`, `"2c"`.
- **Chips are integer cents.** No float chip math anywhere.
- **Determinism:** seed hierarchy `sessionSeed → handSeed = H(sessionSeed, handNumber)` →
  named streams: `"deck"` (full shuffle up-front — the runout is fixed before any action),
  `"bot/{seat}/{street}/{n}"` (decisions keyed by structural position, so what-if branches
  re-decide with the same luck), `"mc/{decisionKey}"` (fixed-iteration Monte Carlo).
  splitmix32 derives stream seeds; xoshiro128** generates within streams (`packages/rng`).
- **Purity:** `engine` is `(TableState, Action) → { state, events[] }`. Bots are
  `decide(snapshot, botState, streams) → { action, sizing, thinkTimeMs, trace, nextBotState }`.

## Worker model

Pool of ≤4 stateless compute workers behind a priority scheduler:
P0 = acting bot / hero live analysis · P1 = speculative prefetch · P2 = background grading.
Jobs are sliced into ≤10ms chunks and preemptible at chunk boundaries. No SharedArrayBuffer.

## Performance budgets

Bot decision ≤50ms P50 · instant-mode full 8-bot orbit ≤500ms · live equity first estimate
≤100ms · post-hand grading ≤2s (background) · cold start → first hand ≤2s.
