# @poker/sim — the session orchestrator

The layer that owns a *session*: the seed hierarchy, the seat/stack ledger, the
button, the bots' memory across hands, the hero's pause/resume loop, and the
assembly of a complete `HandRecord` per `docs/hand-format.md`.

```ts
const session = createSession({
  sessionSeed: "s1",
  format: "cash",
  stakes: { sbCents: 50, bbCents: 100 },
  seats: [{ hero: true }, { personaId: "barry" }, { personaId: "doris" }],
  stackCents: 20_000,
  rake: { pct: 0.05, capCents: 300 },
});

let step = session.nextHand();
while (step.awaitingHero) step = session.act({ kind: "fold" });
step.outcome.record; // a validated v1 HandRecord
```

Everything is deterministic: the same `(config, sessionSeed, hero script)` always
produces byte-identical event logs, on every platform. There is no clock and no
ambient randomness anywhere in this package — think time is *computed* by the
bots and recorded as an input, never measured.

## Seed hierarchy

Straight out of `docs/architecture.md`, rooted at `config.sessionSeed`:

| Purpose | Stream path |
|---|---|
| Deck shuffle (whole runout fixed up front) | `hand/{N}/deck` |
| Bot decision rolls | `hand/{N}/bot/{seat}/{street}/{n}` |
| Bot Monte Carlo | `hand/{N}/mc/{seat}/{street}/{n}` |
| Hand id | `hand/{N}/id` |

`{n}` is the 0-based count of that seat's prior actions on that street — the
same structural key as a `decisionId`, so a what-if branch that reaches the same
position re-decides with identical luck.

Grading streams are derived by `@poker/analysis` from `record.seed`, which this
package sets to `` `${sessionSeed}/hand/${handNumber}` ``.

## Rake — the representation, and why

**The engine is rake-free and stays that way.** A v1 hand log requires the `end`
event's nets to sum to exactly zero (chip conservation is a *validity*
requirement — `validateEvents` enforces it), and a raked pot does not sum to
zero. Encoding rake inside `pot`/`end` amounts would either break validation or
quietly redefine what those fields mean, and the format is frozen within v1.

So rake is recorded as **a distinct post-award adjustment in the record's
annotations**, under the reserved key `sim/rake`:

```ts
record.annotations["sim/rake"] = {
  v: 1,
  pct: 0.05,            // config, echoed for auditability
  capCents: 300,
  noFlopNoDrop: true,
  potCents: 4200,       // Σ committed = Σ pot-event awards
  uncalledCents: 0,     // returned-to-bettor portion, excluded from the base
  baseCents: 4200,      // potCents − uncalledCents (0 when no-flop-no-drop hits)
  totalCents: 210,      // Σ bySeat — what left the table
  bySeat: { "3": 210 }, // charged to winners, pro-rata on their awards
  applied: true,
  reason: undefined,    // set when rake was skipped ("no-flop-no-drop", …)
};
```

Annotation keys are opaque in v1 and `decisionId`s are always
`` `${street}:${seat}:${n}` ``, so the `sim/` namespace can never collide with a
decision key. Read it back with `rakeOf(record)`.

The **session ledger** is where rake actually bites: after each hand,
`stack[seat] += net(seat) − rake(seat)`, and the session tracks
`rakeTotalCents`. The conservation identity the tests assert is therefore

```text
Σ view().stacks  +  view().rakeTotalCents  ===  view().buyInTotalCents
```

i.e. **chips on the table plus chips raked equals chips bought in, exactly, in
integer cents, at every hand boundary** (`buyInTotalCents` counts the initial
buy-ins plus every rebuy/top-up the dealer options triggered).

### How the numbers are computed

- `potCents` = Σ of every seat's `committedTotal` (identical to Σ of the `pot`
  events' amounts — the engine conserves chips).
- `uncalledCents` = `max − secondMax` over every dealt-in seat's
  `committedTotal`. That is exactly the portion of the biggest bet nobody
  matched; casinos return it before dropping, so it is excluded from the base.
- `baseCents` = `potCents − uncalledCents`, or `0` when `noFlopNoDrop` is on
  (default) and the hand never produced a `board` event.
- `totalCents` = `min(capCents, floor(pct × baseCents))`.
- `bySeat` charges winners pro-rata on their `pot` awards, integer cents;
  the rounding remainder goes to the largest award first, ties broken by lowest
  seat — deterministic, never a float.

## Annotations

`record.annotations[decisionId]` is a `DecisionAnnotation`:

- `trace` — the bot's full nine-stage `DecisionTrace` (the bot-mind reveal), on
  every bot decision.
- `grade` — a `DecisionGrade` from `@poker/analysis`, on every hero decision.
  Postflop grading is handed the **villains' ground-truth policy**, built from
  the seated personas' own parameters via `@poker/bots`' `policyLikelihood`
  model — not the tier-default fallback. Preflop grading uses the shipped charts.

Both are opt-out (`annotations: { traces: false, grades: false }`) for bulk
self-play, where 10k traces are pure memory pressure.

## Checkpoints

`serializeSession(session)` returns a JSON-safe blob capturing everything needed
to resume: config, hand counter, button cursor, stacks, rake total, and every
bot's `BotState` (tilt, opponent models, tell cooldowns). It is only valid at a
**hand boundary** — calling it while a hero decision is pending throws.

`restoreSession(blob, runtime?)` rebuilds a session that continues *identically*
to the uninterrupted run. Non-serializable runtime injections (a custom
`evaluate7`, a preflop `chartSet`) are not stored in the blob and must be
re-supplied through `runtime`.

## The arena (`tools/arena`)

The headless harness this package exists to feed:

```bash
node --import tsx tools/arena/arena.ts --lineup barry,doris --hands 500 --seed s1
node --import tsx tools/arena/arena.ts --probe vera --hands 400
node --import tsx tools/arena/arena.ts --matrix --hands 300
```

- default mode seats a lineup and prints per-persona VPIP/PFR/3bet/AF/WTSD,
  bb/100 with a 95% CI, tilt-event counts and the think-time distribution;
- `--probe` runs four adversarial **scripted deciders** (always-min-raise,
  always-jam, always-fold, pure-station — not personas) heads-up against a
  target character, seated in the hero slot and driven purely from
  `legalActions`;
- `--matrix` runs every tier against the tier below, heads-up, in all pairings.

Every number is a pure function of the seed; the only non-deterministic line is
the wall-clock footer, which says so.
