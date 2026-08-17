# Contributing

- `pnpm install && pnpm test && pnpm typecheck && pnpm lint` must pass before a PR.
- Engine-side packages (`core`, `rng`, `eval`, `engine`, `history`, `ranges`, `equity`,
  `charts`, `bots`, `analysis`, `sim`) take **zero runtime dependencies** — pure TypeScript.
- Respect the dependency direction in CLAUDE.md's package map; imports that violate it are
  rejected in review.
- Math-critical changes need property tests or known-vector coverage, not just examples.
- When you change a system, update its `docs/*.md` in the same PR.
- Commit style: conventional-ish, imperative mood, scoped (`engine: reject string bets
  below min-raise`). Small PRs over large ones.
