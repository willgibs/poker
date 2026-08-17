# Data layer (v1)

Persistence ring 3 of the architecture: repository interfaces over IndexedDB (Dexie),
written to only at hand boundaries. Implemented by `packages/data` (built in P1, grown
in P2/P3); **this document is normative** — the P1/P2 agents build exactly this. Change
the implementation and this document in the same PR.

Position in the system (`docs/architecture.md`): the engine emits events in a worker,
the table projection renders them, and *this layer* is where hands, sessions, stats,
economy ledgers, and study data become durable. Aggregates are rebuildable caches,
never sources of truth.

## Ground rules

- **Interface-first.** Every consumer talks to repository interfaces. Three
  implementations over time: `InMemory` (tests + off-the-record), `Dexie` (v1
  production), Supabase (post-v1, same interfaces). UI reads via TanStack Query over
  repos; nothing outside `packages/data` imports Dexie.
- **Dependency posture.** `packages/data` is platform-side (like `ui`). It takes
  exactly **one** runtime dependency: `dexie`. The interfaces, record shapes, ULID
  factory, and the InMemory implementation live in dependency-free modules so they run
  in Node tests without IndexedDB (`fake-indexeddb` is a dev-dependency for the Dexie
  contract tests). Add the `data` row to CLAUDE.md's package map in the PR that creates
  the package.
- **Plain data only.** Everything crossing a repo boundary is structured-clone-safe
  JSON: objects, arrays, strings, integers, booleans, null. No `Date` (epoch-ms
  numbers), no `Map`/`Set`, no class instances, no `undefined` inside arrays.
- **Chips are integer cents** in every stored amount. XP and gems are plain integers.
  Cost estimates are integer micro-USD. No float money anywhere.
- **Time is an input.** Repos never call `Date.now()`; every write that needs a
  timestamp receives it (`at`, `endedAt`, …) from the caller. `apps/web` supplies the
  real clock; tests supply fixed ones.
- **No `Math.random`.** Identity comes from an injected ULID factory (below).
- **Main thread only, hand boundaries only.** Workers never touch storage. No write
  path exists mid-hand — the engine finishes the hand, then the app persists.
- **Append-only ledgers.** `walletLedger`, `xpLedger`, `gemLedger` expose append and
  read, never update or delete. Balances are folds over entries.

## ULID policy

IDs for locally minted records are **ULIDs**: 26 chars, uppercase Crockford base32,
48-bit timestamp + 80-bit randomness, lexicographically sortable by creation time.

```ts
export interface UlidFactory {
  /** Next ULID. Monotonic: two calls in the same millisecond increment the
   *  random component, so ids never collide or sort out of creation order. */
  next(): string;
}

export function createUlidFactory(deps: {
  now: () => number;          // epoch ms
  random: RngStream;          // from @poker/rng — apps/web seeds it from
                              // crypto.getRandomValues at boot; tests seed it fixed
}): UlidFactory;
```

Rules:

- ULIDs are minted **client-side** in `apps/web`/`sim` and passed into repos — repos
  never generate ids. This is the multiplayer-ready posture from the PRD: ids survive
  a later move to a server-authoritative store unchanged.
- A hand's ULID is minted at hand start and **is** `HandRecord.id` — one identity from
  engine to disk to export.
- ULIDs are identity, never semantics. Display timestamps come from `at`/`endedAt`
  fields, never parsed out of the id. Sorting and cursor pagination MAY rely on
  lexicographic order (that's the point of ULID).
- Deterministic tests: fixed clock + seeded stream ⇒ byte-identical ids. Never assert
  on hardcoded ULIDs in fixtures that also run with real clocks.

## Store catalog

Sixteen stores in Dexie schema v1. "Rebuildable" means the store is a cache that can
be recomputed from source-of-truth stores; rebuildables are never exported as truth
(they ARE exported, as a convenience, but import may discard and rebuild them).

| Store | Primary key | Truth or cache | Written when |
|---|---|---|---|
| `hands` | `id` (ULID) | **truth** | hand boundary (checkpoint), metadata updated by grading |
| `sessions` | `id` (ULID) | **truth** | session start, hand boundary, bank |
| `statsAgg` | `key` (string) | cache (rebuildable) | bank |
| `villainObs` | `characterId` | counters: cache · tells/memory: **truth** | bank |
| `studyItems` | `id` (ULID) | **truth** | user action |
| `characters` | `id` | **truth** (custom bots only) | bot lab save |
| `career` | `id` (`'career'`) | **truth** | bank, gauntlet/rival transitions |
| `puzzles` | `date` (`YYYY-MM-DD`) | **truth** | puzzle completion |
| `settings` | `key` | **truth** | user action |
| `meta` | `key` | mixed (versions: truth · balances/streaks: cache) | various |
| `walletLedger` | `id` (ULID) | **truth**, append-only | bank, store purchase, career events |
| `xpLedger` | `id` (ULID) | **truth**, append-only | bank, drills, puzzles, challenges |
| `gemLedger` | `id` (ULID) | **truth**, append-only | challenge/achievement/level payouts, store spend |
| `inventory` | `itemId` | **truth** | unlock or purchase |
| `entitlements` | `feature` | **truth** (overrides only) | post-v1 switch |
| `aiUsage` | `id` (ULID) | **truth**, append-only | every AI transport call |

### Dexie schema v1 (verbatim)

```ts
db.version(1).stores({
  hands:        "id, sessionId, endedAt, [sessionId+handNumber], *concepts, *flags",
  sessions:     "id, status, startedAt, endedAt",
  statsAgg:     "key",
  villainObs:   "characterId",
  studyItems:   "id, handId, *tags, *collectionIds, srsDue, createdAt",
  characters:   "id, kind, updatedAt",
  career:       "id",
  puzzles:      "date, completedAt",
  settings:     "key",
  meta:         "key",
  walletLedger: "id, at, kind, sessionId",
  xpLedger:     "id, at, kind, sessionId",
  gemLedger:    "id, at, kind, sessionId",
  inventory:    "itemId, acquiredAt",
  entitlements: "feature",
  aiUsage:      "id, at, feature, modelId, sessionId",
});
```

Index notes: Dexie can't index nested properties, so anything queried is denormalized
to a top-level field (`srsDue`, `concepts`, `flags`). Multi-entry indexes (`*`) are
arrays of strings. `[sessionId+handNumber]` serves the replayer's "hand N of session
S" lookups. Ledger `at` indexes serve month-window queries; ULID order serves
everything chronological.

### Record shapes

All shapes are additive-only within schema v1 — new **optional** fields may appear;
readers ignore fields they don't know (same policy as `docs/hand-format.md`).

```ts
import type { EncodedHand } from "@poker/history";   // compact tuple form, docs/hand-format.md
import type { TableConfig } from "@poker/history";
import type { ConceptId } from "@poker/analysis";    // kebab-case ids, taxonomy v1

// ---- hands ---------------------------------------------------------------
type HandFlag = "starred" | "study" | "offRecordKept" | "pruned";

interface HandRow {
  id: string;                  // ULID; === the HandRecord.id inside `record`
  sessionId: string;           // owning session ULID (may be unbanked or absent
                               //   for offRecordKept hands — never join blindly)
  handNumber: number;          // 1-based within session
  endedAt: number;             // epoch ms, supplied by caller at write time
  record: EncodedHand | null;  // encodeHand() output; null once pruned
  summary?: HandSummary;       // present when pruned (and MAY be precomputed earlier)
  flags: HandFlag[];           // indexed multi-entry; [] when none
  net: number;                 // hero net, cents (denormalized for lists)
  concepts: ConceptId[];       // graded mistake tags; [] until graded
  grade?: string;              // per-hand grade token from analysis, if any
}

/** What survives pruning: enough for lists, aggregates, and honest history. */
interface HandSummary {
  heroCards: [number, number] | null;  // ints 0–51
  board: number[];                     // 0–5 cards
  potFinal: number;                    // cents
  seatCount: number;
  showdown: boolean;
  counters: Record<string, number>;    // this hand's stat-counter contributions,
                                       // frozen at prune time so statsAgg stays
                                       // rebuildable after the events are gone
}

// ---- sessions ------------------------------------------------------------
interface SessionRow {
  id: string;                  // ULID
  status: "live" | "banked";   // discarded sessions are deleted, never marked
  format: "cash" | "sng" | "mtt";
  offRecord?: never;           // off-record sessions NEVER reach this store
  config: TableConfig & Record<string, unknown>;  // full setup-sheet config
  seed: string;                // session seed (root of the hand-seed hierarchy)
  startedAt: number;
  endedAt?: number;
  handCount: number;
  heroNet: number;             // cents
  heroEvNet?: number;          // cents, EV-adjusted (grading, P2)
  engineVersion: string;       // stamped for replay honesty
  chartSetVersion?: string;    // stamped when grading exists
  checkpoint?: unknown;        // sim-owned resume blob; live sessions only;
                               //   cleared at bank
  aiNarrative?: { modelId: string; promptVersion: number; text: string; at: number };
  career?: { rung: number; gauntletId?: string };
  result?: { finish: number; payoutCents: number };  // SNG/MTT
}

// ---- statsAgg ------------------------------------------------------------
// Keyed rows of opaque counters owned by packages/analysis. Data layer stores
// and transacts; it never interprets counter names.
// Key vocabulary: "hero/overall" · "hero/pos/{BTN}" · "hero/stake/{sb}-{bb}"
//                 · "hero/concept/{conceptId}" · "rating"
interface StatsAggRow {
  key: string;
  hands: number;                       // sample size behind this row
  counters: Record<string, number>;
  lastHandId: string;                  // high-water mark (ULID) — makes folds
                                       //   idempotent and rebuilds incremental
  buildVersion: number;                // bump AGG_BUILD_VERSION to force rebuild
  updatedAt: number;
}

// ---- villainObs ----------------------------------------------------------
// Per-character earned HUD + relationship memory. Counters are rebuildable;
// tells and memory are truth (user/UI events — not derivable from hands alone).
interface VillainObsRow {
  characterId: string;                 // builtin id ("rocco") or custom ULID
  handsObserved: number;
  counters: Record<string, number>;    // opaque, owned by analysis (VPIP/PFR/…)
  tellsSpotted: { tellId: string; handId: string; at: number }[];
  memory: {                            // banter-callback facts — REAL logged
    handId: string; at: number;        //   events only, never invented; capped
    fact: string;                      //   at 20 entries, oldest evicted
  }[];
  rivalry?: { status: string; updatedAt: number };
  lastHandId: string;
  buildVersion: number;
  updatedAt: number;
}

// ---- studyItems ----------------------------------------------------------
interface StudyItemRow {
  id: string;                  // ULID
  handId: string;
  decisionId?: string;         // "${street}:${seat}:${n}" anchor (hand-format)
  tags: string[];              // indexed multi-entry
  collectionIds: string[];     // indexed multi-entry; collection metadata lives
                               //   in settings key "study.collections"
  note?: string;
  srs?: { interval: number; ease: number; reps: number; lapses: number };
  srsDue: number | null;       // denormalized from srs for the index; null = not queued
  createdAt: number;
  source: "manual" | "report" | "offRecordKeep" | "puzzle";
}

// ---- characters ----------------------------------------------------------
// Custom bots only. The builtin 12-character roster ships as a code/data module
// (content is versioned in-repo); storing it would just create migration debt.
interface CharacterRow {
  id: string;                  // ULID
  kind: "custom";              // reserved for future kinds
  name: string;
  schemaVersion: number;       // BotDefinition schema version
  def: unknown;                // BotDefinition JSON (owned by packages/bots);
                               //   same schema as share-file exports
  createdAt: number;
  updatedAt: number;
}

// ---- career --------------------------------------------------------------
// Single row. The career BANKROLL IS NOT HERE — it is the fold over walletLedger.
interface CareerRow {
  id: "career";
  rung: number;                        // 1–8
  gauntlets: Record<string, unknown>;  // per-gauntlet state, owned by career logic
  rivals: Record<string, unknown>;     // rival-arc state
  unlockedFormats: string[];
  rebuild?: { active: boolean; startedAt: number };
  updatedAt: number;
}

// ---- puzzles -------------------------------------------------------------
interface PuzzleRow {
  date: string;                // "YYYY-MM-DD" local date — PK; one row per day
  puzzleSeed: string;          // deterministic from date (date-seeded, serverless)
  status: "solved" | "attempted";
  score: number;
  answers: unknown[];          // puzzle-owned shape
  completedAt: number;
}
// Streak = fold over rows, cached in meta "puzzle.streak".

// ---- settings ------------------------------------------------------------
interface SettingRow { key: string; value: unknown; updatedAt: number }
// Known keys (sample, additive): "hero.name", "loadout.default", "speed",
// "sound.*", "display.*", "keybinds", "equipped.*", "study.collections",
// "ai.modelId", "ai.apiKey"  ← BLOCKLISTED from export, see Archive section.

// ---- meta ----------------------------------------------------------------
interface MetaRow { key: string; value: unknown }
// Known keys: "schema.version" (data-layer record-shape version, currently 1),
// "agg.buildVersion", "balance.wallet" | "balance.xp" | "balance.gems"
//   (each { lastEntryId: string; balance: number } — a checkpointed fold),
// "puzzle.streak", "storage.lastPruneAt", "app.installedAt".

// ---- ledgers (walletLedger / xpLedger / gemLedger) -----------------------
interface LedgerEntry<Kind extends string> {
  id: string;                  // ULID — total order, append-only
  at: number;                  // epoch ms (input)
  kind: Kind;
  amount: number;              // SIGNED integer: cents (wallet) / XP / gems
  source: { type: string; ref?: string };  // e.g. { type: "hand", ref: handId },
                                           // { type: "challenge", ref: id },
                                           // { type: "store", ref: itemId }
  sessionId?: string;
}
type WalletKind = "buyin" | "cashout" | "session-net" | "rake" | "tourney-fee"
                | "payout" | "rebuild-stake" | "adjust";
type XpKind     = "hands" | "session" | "drill" | "puzzle" | "challenge"
                | "gauntlet" | "achievement" | "adjust";
type GemKind    = "challenge" | "achievement" | "level-up" | "streak"
                | "store-spend" | "adjust";
// "adjust" exists for migrations/refunds only; every adjust carries a source ref.
// Balances are folds. Never store balanceAfter on entries; the checkpointed fold
// lives in meta and is verified/rebuilt by walking entries above lastEntryId.

// ---- inventory -----------------------------------------------------------
interface InventoryRow {
  itemId: string;              // cosmetics catalog id (code-shipped catalog)
  acquiredAt: number;
  source: "unlock" | "gems" | "grant";
  ref?: string;                // gemLedger entry id | achievement id | grant note
}
// Equipped state is settings ("equipped.deckSkin" etc.), not inventory.

// ---- entitlements --------------------------------------------------------
interface EntitlementRow {
  feature: string;             // e.g. "ai.byok", "ai.hosted", "sync.cloud"
  granted: boolean;
  source: "default" | "promo" | "pro";
  updatedAt: number;
}
// v1: the store is EMPTY. entitlements.check(feature) consults a code-shipped
// default table (everything free in v1; "ai.hosted"/"sync.cloud" default false)
// and this store only holds overrides. The free/pro switch is data, not refactor.

// ---- aiUsage -------------------------------------------------------------
interface AiUsageRow {
  id: string;                  // ULID
  at: number;
  feature: "coachReview" | "coachChat" | "botGen" | "banter";
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costEstMicroUsd: number;     // integer micro-USD estimate (see docs/ai-layer.md)
  outcome: "ok" | "error" | "truncated" | "fallback";
  sessionId?: string;
  handId?: string;
}
```

## Repository contract

One bundle, one repo per store, plus a transaction primitive:

```ts
export interface Repos {
  hands: HandRepo;
  sessions: SessionRepo;
  stats: StatsAggRepo;
  villains: VillainObsRepo;
  study: StudyRepo;
  characters: CharacterRepo;
  career: CareerRepo;
  puzzles: PuzzleRepo;
  settings: SettingsRepo;
  meta: MetaRepo;
  ledgers: {
    wallet: LedgerRepo<WalletKind>;
    xp: LedgerRepo<XpKind>;
    gems: LedgerRepo<GemKind>;
  };
  inventory: InventoryRepo;
  entitlements: EntitlementRepo;
  aiUsage: AiUsageRepo;

  /** Run `fn` atomically across the named stores. Dexie: one 'rw' transaction.
   *  InMemory: snapshot-and-restore on throw. Nesting is not supported. */
  tx(stores: StoreName[], fn: () => Promise<void>): Promise<void>;
}

export function createInMemoryRepos(): Repos;                    // dep-free
export function createDexieRepos(db: PokerDb): Repos;            // dexie impl
export function createOffRecordRepos(base: Repos): OffRecordRepos; // overlay, below
```

Method style — shown in full for `HandRepo` and `LedgerRepo`; every other repo
follows the same pattern (get/put/query minimal set, nothing speculative):

```ts
export interface HandRepo {
  get(id: string): Promise<HandRow | undefined>;
  put(row: HandRow): Promise<void>;                 // upsert by id, last-write-wins
  putMany(rows: HandRow[]): Promise<void>;          // atomic within the store
  bySession(sessionId: string): Promise<HandRow[]>; // handNumber ascending
  /** Cursor pagination, newest first. `before` is an exclusive ULID cursor. */
  page(opts: {
    before?: string; limit: number;
    concept?: ConceptId; flag?: HandFlag; sessionId?: string;
  }): Promise<HandRow[]>;
  count(): Promise<number>;
  deleteBySession(sessionId: string, opts: { keepFlagged: boolean }): Promise<number>;
  /** Prune support: replace record with summary. See Prune policy. */
  pruneToSummary(id: string, summary: HandSummary): Promise<void>;
}

export interface LedgerRepo<K extends string> {
  append(entry: LedgerEntry<K>): Promise<void>;     // id must be fresh; rejects dupes
  appendMany(entries: LedgerEntry<K>[]): Promise<void>;
  /** Fold from an exclusive ULID cursor; used to verify/extend balance checkpoints. */
  foldFrom(afterId: string | null): Promise<{ lastEntryId: string | null; sum: number }>;
  page(opts: { before?: string; limit: number; kind?: K }): Promise<LedgerEntry<K>[]>;
  inWindow(fromAt: number, toAt: number): Promise<LedgerEntry<K>[]>;
  // NO update. NO delete. This is enforced by the interface, not by discipline.
}
```

Contract rules (tested against **both** implementations by one shared suite):

- All methods are `Promise`-based, even where InMemory is synchronous.
- Missing records resolve `undefined`; repos never throw for absence.
- Writes are upserts keyed by PK, idempotent when replayed with identical rows.
- Implementations return **clones** — a caller mutating a returned row must not
  affect the store (InMemory uses `structuredClone` on both read and write).
- No Dexie type, error, or promise flavor leaks through the interface.
- `tx` gives atomicity; ordering inside a tx is program order.

## Write choreography

### During a tracked live session (per hand boundary)

One `tx(["hands", "sessions"])` per hand end:

1. `hands.put` the finished hand (`record: encodeHand(handRecord)`).
2. `sessions.put` the updated session row: `handCount`, `heroNet`, `checkpoint`
   (the sim's resume blob), `endedAt` untouched (still live).

Nothing else. **No aggregates, no ledgers, no career, no XP during play.** Background
grading (P2) may later update hand-row *metadata* (`concepts`, `grade`, annotations
re-encoded into `record`) — metadata is mutable; the event log inside `record` is not.

### Commit-at-bank-time (the rule)

Earned state — stats, HUD, rating, ledgers, career, XP — commits **only** when a
session banks, in **one transaction**:

```ts
await repos.tx(
  ["sessions", "hands", "statsAgg", "villainObs",
   "walletLedger", "xpLedger", "career", "meta"],
  async () => {
    const session = await repos.sessions.get(sessionId);
    if (!session || session.status !== "live") return;   // idempotence guard
    const hands = await repos.hands.bySession(sessionId);
    // 1. fold hands into statsAgg rows (analysis-owned fold; lastHandId advances)
    // 2. fold villain observations into villainObs counters
    // 3. append wallet entries (career sessions: session-net / payout / rake)
    // 4. append xp entries (hands, session, challenge ticks)
    // 5. update career row if rung/gauntlet state moved
    // 6. advance meta balance checkpoints
    // 7. sessions.put({ ...session, status: "banked", endedAt, checkpoint: undefined })
  });
```

Consequences, all load-bearing:

- **Discard is deletion, never rollback.** An abandoned session wrote only `hands`
  and its own `sessions` row. Discard = `hands.deleteBySession(id, { keepFlagged:
  true })` + delete the session row. Hands the user explicitly starred/saved survive
  (flagged, never aggregated — aggregation only ever happens through a bank fold).
- **Crash-safe by construction.** The bank tx either happened or didn't; the status
  guard makes retry idempotent; `lastHandId` high-water marks make any future
  incremental re-fold a no-op for already-folded hands.
- **Short sessions** (<~20 hands) bank normally — they earn XP and count hands; they
  just render without a grade (UI concern, not a data rule).
- Live UI that wants mid-session earned reads merges banked `villainObs` with the
  in-session observation state held by the table store — the data layer stays silent
  until bank.

### Off-the-record: the in-memory swap

Off-record sessions run against an **overlay bundle**, not the persistent one:

```ts
export interface OffRecordRepos extends Repos {
  /** The single escape hatch: persist one hand to the REAL store, flagged
   *  "offRecordKept", plus a studyItems row (source "offRecordKeep").
   *  Kept hands never aggregate, never rate, never touch career. */
  keepHand(handId: string, deps: { ulid: UlidFactory; at: number }): Promise<void>;
  /** Drop every buffered write. Called on session end/discard. */
  discardAll(): void;
}
```

Semantics: **reads merge overlay-over-base** (the session still sees your earned HUD,
characters, settings — full in-session tools); **writes go to the overlay only**
(session-local villainObs updates are visible live, then evaporate). Banking an
off-record session is a no-op by construction — the overlay is dropped. No session
row, no ledger entry, no XP, no challenge progress ever reaches disk. The 🔒 marking
in UI comes from the session never existing in `sessions`.

## Migration & upgrade policy

Two independent version axes — don't conflate them:

1. **Dexie schema version** (`db.version(n)`): bumped only for *structural* change —
   new stores, new/changed indexes. Every historical `version()` call is kept forever.
   Upgrade callbacks must be O(small): index consistency fixes, single-row moves.
   **Never iterate `hands` in a Dexie upgrade** — 100k rows in an upgrade transaction
   is how apps eat their own database.
2. **Record-shape version** (`meta "schema.version"`, per-row `v` fields where a shape
   has evolved): handled by **upgrade-on-read**. Readers detect old shapes, upgrade in
   memory, and return current shapes; rows are rewritten opportunistically on their
   next natural write, never in bulk. Same policy as `docs/hand-format.md` — and hand
   records inside `HandRow.record` follow hand-format's own versioning via
   `decodeHand` (v1 → upgrade → current).

Additional rules:

- Additive-only within v1: new optional fields need no version bump anywhere.
- Aggregates never migrate — bump `agg.buildVersion` and rebuild from truth stores.
  (This is why `HandSummary.counters` exists: pruned hands stay foldable.)
- **Refuse downgrade:** if `meta "schema.version"` is newer than the code understands,
  block writes and surface a friendly error with an export path. Never guess.
- Ledgers never migrate destructively. If an entry kind is retired, old entries keep
  their kind; folds must tolerate unknown kinds (they still sum `amount`).

## Storage estimates & prune policy

Budget math (from the hand-format fixture: ~890 B encoded per showdown 6-max hand):

| Volume | hands store | everything else | total |
|---|---|---|---|
| 1k hands | ~1.2 MB | < 1 MB | ~2 MB |
| 10k hands | ~12 MB | ~2 MB | ~14 MB |
| 100k hands | ~120 MB | ~10 MB | ~130 MB |

(~1.2 KB/hand budgeted = record + row fields + index overhead. Ledgers are tiny:
~200 B/entry, a few entries per session.) At install, request
`navigator.storage.persist()`; surface `navigator.storage.estimate()` in
Settings → Data. Safari/WebKit persistence gets an explicit CI test (PRD verification
plan).

**Prune-to-summary policy** (never silent, never destructive of protected data):

- Trigger: soft cap of **50k full hand logs** or storage estimate >50% of quota —
  whichever first. Surfaced as a Settings → Data suggestion; one tap executes. No
  automatic pruning without the user seeing it.
- Action: oldest-first by ULID, replace `record` with `summary` (`HandSummary`,
  counters frozen), add flag `"pruned"`. The row, its indexes, its net/concepts — all
  stay; lists and stats are unaffected. Replaying a pruned hand is honestly refused
  in UI ("full log pruned to save space").
- **Protected, always keep full logs:** flags `starred`/`study`/`offRecordKept`, any
  hand referenced by a `studyItems` row, hands of the current live session.
- Never pruned at all: `sessions`, all three ledgers, `statsAgg`, `villainObs`,
  `studyItems`, `puzzles`, `aiUsage` (rows are tiny; history is the product).

## Archive export / import

Full-fidelity backup, streamed both directions with constant memory. Format:
**JSON Lines** (`.jsonl`), one JSON object per line:

```
{"t":"manifest","format":"poker-archive","v":1,"exportedAt":1755400000000,
 "appVersion":"1.0.0","schemaVersion":1,
 "stores":{"hands":12345,"sessions":181,"walletLedger":420, …}}
{"t":"row","store":"sessions","row":{…SessionRow…}}
{"t":"row","store":"hands","row":{…HandRow, record in encoded form…}}
…
{"t":"end","rows":12946}
```

Export rules:

- First line is the manifest (declared counts per store); last line is `end` with the
  total actually written — a truncated file is detectable by construction.
- Rows stream store-by-store in the catalog order above, ULID/PK ascending within a
  store. Hands export their **encoded** record (already compact — no re-encoding).
- Everything exports, including rebuildable caches (cheap, and makes import instant),
  EXCEPT blocklisted settings:

```ts
/** Never exported, never imported. Tested: no exported line may contain the
 *  VALUE of any blocklisted key, and import drops these keys from any archive. */
export const EXPORT_SETTINGS_BLOCKLIST: readonly RegExp[] = [
  /^ai\.apiKey$/,
  /(?:^|\.)(?:apiKey|token|secret|password|credential)s?$/i,
];
```

The blocklist is enforced on **both** directions — export (privacy: an archive is
shareable) and import (defense: a crafted archive must not plant a key).

Import rules:

- Parse the manifest first; refuse `v` newer than understood (mirror of hand-format's
  refuse-newer rule). Older archives go through upgrade-on-read per row.
- Two modes: **merge** (default — existing PKs win, new rows insert; ledger entries
  are append-only so duplicate ids are skipped, never summed twice) and **replace**
  (wipe stores, then load — requires explicit confirmation).
- Rows are validated structurally per store before write; unknown stores in the
  archive are skipped with a warning (forward compatibility); unknown fields inside
  rows are preserved verbatim.
- Writes land in batches (~500 rows) inside per-store transactions; the importer
  reports per-store counts at the end.
- After import: bump `agg.buildVersion` if aggregates were skipped or look stale —
  rebuild from truth beats trusting a foreign cache.
- Round-trip is a CI test: export → import into a fresh DB → export again →
  byte-identical modulo manifest timestamp.

## Supabase posture (post-v1, design constraint now)

Do not build it; do not preclude it. The interfaces above are the contract a
`createSupabaseRepos()` will implement. What makes that migration mechanical:
client-minted ULIDs (no id remapping), append-only ledgers (ship entries, verify
folds server-side), plain-JSON rows (map 1:1 to tables), and commit-at-bank-time
(bank becomes the natural sync unit). Anything you add to this layer must keep those
four properties.

## Test checklist (P1/P2 agents: this is the definition of done)

- Shared contract suite runs against InMemory AND Dexie (`fake-indexeddb`): CRUD,
  clone-on-read/write, pagination cursors, tx atomicity (throw mid-tx ⇒ no writes).
- Bank: property test — bank once ≡ bank twice (idempotence); after bank, ledger
  folds equal meta checkpoints; chip-sum of wallet entries for a session equals the
  session's net movement. Deterministic seeds throughout.
- Discard: leaves zero rows for the session except flagged/study-referenced hands;
  aggregates untouched.
- Off-record: after `discardAll`, persistent stores byte-identical to before the
  session; `keepHand` writes exactly one flagged hand + one study item.
- Ledgers: interface exposes no update/delete; `foldFrom(null)` equals sum of all
  entries; unknown-kind tolerance.
- Prune: protected hands never pruned; post-prune rebuild of statsAgg from
  records+summaries equals pre-prune aggregates.
- Archive: round-trip byte-equality; blocklist holds on export AND import (seeded
  archive with a planted `ai.apiKey` never lands); truncated-file detection.
- Upgrade-on-read: fixture rows in old shapes read back current; newer
  `schema.version` blocks writes.

When you change this system, update this document in the same PR.
