# Poker Trainer (working title)

A free, open-source solo poker trainer: play beautiful No-Limit Hold'em against a cast of
bots that feel human — they tilt, adapt, have tells — while a deterministic analysis engine
quietly turns every hand you play into improvement.

- **Local-first.** No accounts, no server. Your hands, stats, and progress live in your browser.
- **Deterministic.** Every hand is replayable from a seed. Daily puzzles are the same for everyone.
- **AI-optional.** The full app works with zero AI configured. Bring your own API key to add a
  natural-language coach on top of the deterministic math.
- **Honest analysis.** True preflop chart grading; postflop graded as Monte-Carlo EV vs estimated
  ranges and labeled as the estimate it is.

## Status

Early development (P0 foundations). Not yet playable.

## Development

```bash
pnpm install
pnpm test        # run all package tests
pnpm typecheck
pnpm lint
```

The repo is a pnpm workspace. Engine packages (`packages/core`, `rng`, `eval`, `engine`, …) are
zero-dependency TypeScript, consumed as source. See [CLAUDE.md](CLAUDE.md) and [docs/](docs/)
for architecture and contribution conventions.

## License

MIT
