# Hand format (v1)

The canonical hand event log — the constitution of the app. The replayer,
grading, exports, and aggregates all consume this format and nothing else.
Implemented by `packages/history`; this document is normative. Change the
implementation and this document in the same PR.

## Conventions

- **Cards are ints 0–51:** `card = rank * 4 + suit`; rank `0=2 … 12=A`;
  suit `0=♣(c) 1=♦(d) 2=♥(h) 3=♠(s)`. String form is rank char from
  `"23456789TJQKA"` + suit char from `"cdhs"` — `"As"` = 51, `"Td"` = 33, `"2c"` = 0.
- **Chips are integer cents.** All `amount`, `stack`, `net`, and blind fields.
- **Seats are non-negative integers**, stable for a session. They are seat
  numbers, not positions; position is derived from `button`.
- **Time is an input:** `thinkTimeMs` records observed think time; nothing in
  the format is ever read from a clock.

## Envelope — `HandRecord`

```ts
{
  v: 1,                       // format version (this document)
  id: string,                 // globally unique hand id
  sessionId: string,          // owning session
  seed: string,               // hand seed from the session seed hierarchy
  config: TableConfig,        // table configuration in force
  events: HandEvent[],        // the event log (see below)
  annotations?: Record<string, unknown>  // opaque, keyed by decisionId
}
```

`TableConfig` (v1): `{ variant: 'nlhe', maxSeats, sb, bb, ante }` — blinds in
cents. Additive-only within v1 (new optional fields may appear; readers must
ignore fields they don't know).

Given `(config, seed)` and the hero's decisions, the engine re-emits this
event stream byte-identically — the record is both a replay input and a
replay assertion (golden replays, `docs/testing.md`).

### decisionId

Annotation keys are `${street}:${seat}:${n}`:

- `street` ∈ `preflop | flop | turn | river` — everything before the first
  `board` event is `preflop`; each `board` event advances the street.
- `seat` — the acting seat.
- `n` — 0-based count of that seat's **prior `act` events on that street**.

Example: seat 5 raises preflop (`preflop:5:0`), bets flop (`flop:5:0`),
checks river then check-raises (`river:5:0`, `river:5:1`). The scheme is
structural — a what-if branch that reaches the same position derives the same
id. `decisionRefs(events)` in `packages/history` computes ids for a log.

### Annotations

Opaque in v1: producers (grading, notes) and consumers agree on the value
shape out of band. Values must be JSON-safe. Unknown keys/values are
preserved verbatim by every layer, including serialization.

## Events — `HandEvent`

A discriminated union on `t`. Exactly these eight event types exist in v1.

### `start` — HandStart

```ts
{ t: 'start', handNumber, button, seats: [{ seat, stack }...], blinds: { sb, bb, ante } }
```

First event of every hand. `handNumber` is 1-based within the session (feeds
`handSeed = H(sessionSeed, handNumber)`). `seats` lists only dealt-in seats
with starting stacks; `button` must be one of them. `blinds` is the structure
for this hand (short posts appear in `post` events, not here).

### `post` — PostBlind

```ts
{ t: 'post', seat, kind: 'sb'|'bb'|'ante', amount }
```

One event per forced posting. `amount` is what was actually posted — an
all-in short post carries the short amount.

### `hole` — DealHole

```ts
{ t: 'hole', seat, cards: [Card, Card] }
```

At most one per seat per hand. Records what was dealt regardless of later
visibility; visibility is an export/UI concern, not a format concern.

### `act` — PlayerAction

```ts
{ t: 'act', seat, kind: 'fold'|'check'|'call'|'bet'|'raise',
  amount?, toAmount?, thinkTimeMs? }
```

- `fold` / `check` — no chip fields.
- `call` — `amount` = chips **added** by the call.
- `bet` — `amount` = size of the bet.
- `raise` — `toAmount` = seat's **total** street commitment after the raise.
  Raises never carry `amount`.
- `thinkTimeMs` — optional, any kind; observed think time in ms.

### `board` — DealBoard

```ts
{ t: 'board', street: 'flop'|'turn'|'river', cards: Card[] }
```

Flop carries 3 cards; turn and river carry 1. Streets appear in order, each
at most once.

### `showdown` — Showdown

```ts
{ t: 'showdown', reveals: [{ seat, cards: [Card, Card] }...] }
```

Reveals in table reveal order. A revealed hand must match the seat's `hole`
event (order-insensitive) when one exists.

### `pot` — PotAwarded

```ts
{ t: 'pot', potIndex, seat, amount }
```

One event per (pot, winner). `potIndex` 0 = main pot; 1+ = side pots. A split
pot emits multiple events with the same `potIndex`.

### `end` — HandEnd

```ts
{ t: 'end', net: [{ seat, net }...] }
```

Last event of every hand. One entry per dealt-in seat (net 0 included).
Nets sum to exactly 0 — chip conservation is a validity requirement.

## Event order

```
start post* hole* act* (board act*){0..3} showdown? pot* end
```

(Informal; the engine enforces betting legality. `validateEvents` enforces
the structural subset below.)

## Validation — `validateEvents(events)`

Plain structural checking, no schema library. Returns `{ ok, errors }` with
every violation listed. Enforced:

- exactly one `start`, and it is first; exactly one `end`, and it is last;
  nothing after `end`
- `start`: ≥2 unique seats, integer stacks ≥ 0, `button` dealt in, integer
  blinds ≥ 0
- every `seat` referenced anywhere is dealt in
- `hole`: at most one per seat, two distinct cards
- `board`: streets in flop→turn→river order, each once, 3/1/1 cards
- no card appears twice across `hole`/`board`/`showdown`; reveals match the
  seat's dealt hole cards when present
- `act` chip-field rules per kind (above); amounts are positive integers;
  `thinkTimeMs` a non-negative integer
- `post`/`pot` amounts positive integers; `potIndex` ≥ 0
- `end` covers exactly the dealt-in seats, integer nets summing to 0

Betting-line legality (sizings, action order, who may act) is **not**
validated here — the engine is the authority; history checks structure only.

## Compact encoding — `encodeHand` / `decodeHand`

JSON-safe compact form: plain objects/arrays/strings/integers/nulls only;
survives `JSON.stringify`/`JSON.parse` unchanged; `decodeHand(encodeHand(r))`
round-trips exactly, including presence/absence of optional fields.

The envelope stays an object (`{ v, id, sessionId, seed, config, events,
annotations? }` — same fields as `HandRecord`); each event becomes a short
tuple whose first element is the `t` tag:

| Event | Tuple layout |
|---|---|
| `start` | `['start', handNumber, button, [seat, stack, ...], sb, bb, ante]` |
| `post` | `['post', seat, kind, amount]` |
| `hole` | `['hole', seat, c1, c2]` |
| `act` | `['act', seat, kind, amount?, toAmount?, thinkTimeMs?]` |
| `board` | `['board', street, ...cards]` |
| `showdown` | `['showdown', seat, c1, c2, seat, c1, c2, ...]` |
| `pot` | `['pot', potIndex, seat, amount]` |
| `end` | `['end', seat, net, seat, net, ...]` |

`act` optional fields sit at fixed positions `[amount, toAmount, thinkTimeMs]`;
absent fields encode as `null`; trailing `null`s are trimmed. So
`{kind:'call', amount:200}` → `['act', 3, 'call', 200]` and
`{kind:'raise', toAmount:300}` → `['act', 5, 'raise', null, 300]`.

`decodeHand` rejects malformed input and unknown versions with
`HandDecodeError`.

**Size:** the committed 6-max fixture (29 events: full deal, 3 streets,
showdown) encodes to **~890 bytes** (~810 without annotations) — about half
of verbose JSON. Expect roughly 0.5–1 KB/hand before storage-level
compression.

## Text export — `exportHandText(record, { heroSeat? })`

PokerStars-style readable text (informative — the event log is canonical;
the text is derived and lossy). Hole cards are hidden except the hero's
"Dealt to" line and showdown reveals. Players render as `Player <seat>`;
money as `$D.CC` via integer math. Raises render as
`raises $X to $Y` where `X = toAmount − prior street bet level`. With
multiple pots, collected lines read `from main pot` / `from side pot [n]`.
The exact line shapes are locked by the golden fixture
`packages/history/test/fixtures/hand001.golden.txt`.

## Versioning policy

- **`v` is the format's major version.** This document specifies v1.
- **Within v1, changes are additive only:** new *optional* envelope/event
  fields, new annotation keys, new `TableConfig` fields. Readers must
  tolerate and preserve unknown fields. Existing fields never change
  meaning, type, or units; the eight event types and their tuple layouts are
  frozen (a tuple may only *grow*, following the trailing-optional rule).
- **Anything breaking is v2:** removing/renaming fields, changing semantics,
  new event types (old replayers could not honestly replay a log they don't
  fully understand), tuple reshapes.
- **Upgrade-on-read:** when v2 exists, readers upgrade older records to the
  current version in memory at decode time (`decodeHand` becomes
  `v1 → upgrade → v2`); stored records are rewritten only opportunistically.
  Readers must refuse versions newer than they understand (`decodeHand`
  already throws `HandDecodeError` for `v ≠ 1`).
- Golden fixtures pin the format: they regenerate only in reviewed commits.
