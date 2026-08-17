# AI layer (v1)

LLM features as **progressive enhancements** over a fully deterministic app.
Implemented by `packages/ai` (built P2, banter capped until P5); **this document is
normative** — the P2 agents build exactly this. Change the implementation and this
document in the same PR.

The two laws this layer exists to uphold (PRD, non-negotiable):

1. **Zero-key completeness.** The core app is 100% playable and coachable with no AI
   configured. Every AI feature has a deterministic fallback and degrades *silently*
   into it. No nag, no broken surface, no error toast for the keyless.
2. **Cost discipline.** Analysis is what users should pay tokens for. Chat and banter
   are capped in code so they can never dominate analysis spend. Budgets are enforced
   by the layer, not by prompt hope.

## Ground rules

- **Quarantine.** Nothing an LLM produces feeds the engine, grading, rating, or any
  determinism-bearing path. AI output is presentation (prose) or authoring input
  (a bot definition that goes through the same validation as hand-built ones).
- **Dependency posture: zero runtime deps.** Transport is a thin `fetch` client
  against the Vercel AI Gateway's OpenAI-compatible endpoint
  (`https://ai-gateway.vercel.sh/v1/chat/completions`), with `fetch` injected for
  testability. *(Deliberate deviation from the PRD's "Vercel AI SDK" mention,
  exercised under the engineering mandate: the SDK buys nothing we use — one endpoint,
  one schema — and costs a dependency and bundle weight. The transport interface below
  keeps the door open to swap it in later without touching adapters.)*
- **BYO key, local only.** The gateway key lives in the settings store under
  `ai.apiKey`, which is on the archive export/import blocklist
  (`docs/data-layer.md`). The key never appears in exports, logs, prompts, or error
  reports. It is sent only as the `Authorization` header to the gateway.
- **Hero-legal context only.** Serializers never include cards the hero could not
  have seen (hidden bot holes, mucked hands) — the coach must not be accidentally
  omniscient, and banter must never leak hero holdings. Bot-mind data reaches prompts
  only for hands where the UI has already revealed it.
- **True facts only.** Prompts carry facts derived from logged events (same rule as
  bot memory and the coach voice spec). The LLM rephrases; it never invents numbers,
  hands, or history.
- **Every call is metered.** One `aiUsage` row per transport call, success or not.
  No unmetered path exists.

```ts
export interface AiTransport {
  chat(req: {
    modelId: string;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    maxOutputTokens: number;
    timeoutMs: number;
    stream?: boolean;
  }): Promise<TransportResult>;
}
type TransportResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number;
      truncated: boolean }
  | { ok: false; failure: AiFailure };
```

## Model registry

A **data module**, not code: `packages/ai/src/registry.ts` exports a versioned list
that data-only PRs can update (prices drift; the app must not need logic changes to
track them). The UI renders Settings → AI entirely from this data.

```ts
export interface ModelEntry {
  id: string;              // gateway-routable slug, e.g. "google/gemini-2.5-flash"
  label: string;           // "Gemini 2.5 Flash"
  vendor: "google" | "openai" | "anthropic" | (string & {});
  tier: "budget" | "value" | "premium";
  recommended?: true;      // EXACTLY one entry carries this
  usdPerMTokIn: number;    // list price, USD per million input tokens
  usdPerMTokOut: number;
  contextWindow: number;   // tokens
  note: string;            // one plain-language sentence for the picker
}

export const REGISTRY_VERSION = 1;
export const PRICES_AS_OF = "2026-08";  // update with any price edit
export const MODELS: readonly ModelEntry[] = [ /* table below */ ];
```

### Curated launch list

Six models, all routable through one Vercel AI Gateway key as `vendor/model` slugs.
Prices are **list prices as of `PRICES_AS_OF`, approximate and data-updatable** —
verify against the gateway's model page when touching this table; they exist for the
meter and the picker, not for billing. The default is a value-tier model per the PRD
(coaching prompts are tested/tuned against it; smarter models buy better prose, not
better math — all poker math is deterministic and client-side).

| id | tier | ~$/M in | ~$/M out | note (shown in picker) |
|---|---|---|---|---|
| `google/gemini-2.5-flash` | value · **Recommended** | 0.30 | 2.50 | "The tuned default — fast, cheap, and what the coach is written for." |
| `google/gemini-2.5-flash-lite` | budget | 0.10 | 0.40 | "Cheapest sensible option. Coach prose gets plainer; the math is identical." |
| `openai/gpt-5-mini` | value | 0.25 | 2.00 | "Solid alternate default if you prefer OpenAI." |
| `anthropic/claude-haiku-4.5` | value | 1.00 | 5.00 | "Snappy and a touch more polished; costs a bit more per session." |
| `anthropic/claude-sonnet-4.5` | premium | 3.00 | 15.00 | "Noticeably nicer narrative writing. Roughly 10x the default's cost." |
| `openai/gpt-5` | premium | 1.25 | 10.00 | "Big-model prose. Overkill for drills; pleasant for deep reviews." |

Honest per-action costs at the default (used verbatim in Settings → AI copy):
a full session review ≈ **half a cent**; a coach chat message ≈ **a third of a
cent**; an hour of table banter ≈ **a cent**. Premium models multiply those by
roughly their price ratio. There is no markup — the user's key, the user's bill.

**Custom model id** (advanced field): any string is accepted and passed through to
the gateway. Unknown ids get `usdPerMTokIn/Out = 0` and the meter marks their cost
"unknown" — never guess prices.

```ts
export function resolveModel(id: string): ModelEntry; // falls back to custom-entry
export function estimateCostMicroUsd(
  m: ModelEntry, usage: { inputTokens: number; outputTokens: number },
): number {
  // µ$ = tokens × $/Mtok  (integers out; Math.round; 0 for unknown-price models)
  return Math.round(usage.inputTokens * m.usdPerMTokIn
                  + usage.outputTokens * m.usdPerMTokOut);
}
```

## ContextBudget & the priority ladder

Every feature declares hard input/output token caps. Context is assembled by a
**priority ladder**: items are added best-first until the input budget is spent;
whole items drop, never mid-item truncation (a half-serialized hand is worse than no
hand). Estimation is deterministic and dependency-free.

```ts
export interface ContextBudget { maxInputTokens: number; maxOutputTokens: number }

export interface ContextItem {
  priority: number;        // 0 = most important; ties keep insertion order
  label: string;           // for traces/tests, e.g. "findings", "hand:01J…:text"
  text: string;
  required?: true;         // if a required item alone busts the budget → hard fail
}

/** ceil(chars / 4) — deliberately conservative, deterministic, tokenizer-free.
 *  All budgets are sized assuming this overestimates by up to ~25%. */
export function estimateTokens(text: string): number;

export function packContext(items: ContextItem[], budget: ContextBudget): {
  text: string;                // included items joined in priority order
  included: string[];          // labels, for tests and the debug trace
  dropped: string[];
  estInputTokens: number;      // ALWAYS ≤ budget.maxInputTokens (invariant C1)
};
```

`packContext` throws `BudgetError` only when a `required` item cannot fit alone —
adapters treat that as `invalid-output`-class failure and fall back. Output caps are
enforced by passing `maxOutputTokens` to the transport as the provider `max_tokens`;
a `truncated: true` result is handled per feature (below), never silently shown as
complete analysis.

### Budget table (single source: `AI_BUDGETS`)

All numbers live in one config object so the cost invariants can be asserted against
whatever the config says, and tuning is a one-line data change.

```ts
export const AI_BUDGETS = {
  coachReview: { maxInputTokens: 8000, maxOutputTokens: 1000,
                 timeoutMs: 30_000, perSession: 1 },
  coachChat:   { maxInputTokens: 6000, maxOutputTokens: 700,
                 timeoutMs: 30_000, messagesPerSession: 20 },
  botGen:      { maxInputTokens: 1500, maxOutputTokens: 1200,
                 timeoutMs: 30_000, perDay: 20 },
  banter:      { maxInputTokens: 800,  maxOutputTokens: 60,
                 timeoutMs: 2500,
                 bucket: { capacity: 3, refillPerHands: 12, sessionCap: 10 } },
} as const;
```

## Feature adapters

Four adapters share one shape and one runner. Adapters are pure except through
injected deps; the runner owns metering, entitlement/key gates, and fallback.

```ts
export type AiFeature = "coachReview" | "coachChat" | "botGen" | "banter";

export type AiFailure =
  | { kind: "no-key" }                     // not configured — the silent path
  | { kind: "unentitled" }                 // entitlements.check() said no
  | { kind: "budget-exhausted"; scope: "message" | "session" | "day" | "bucket" }
  | { kind: "timeout"; ms: number }
  | { kind: "rate-limited"; retryAfterMs?: number }
  | { kind: "invalid-output"; detail: string }  // failed parse/validation/voice lint
  | { kind: "provider-error"; status?: number }
  | { kind: "offline" };

export type AiResult<T> =
  | { ok: true; value: T; usage: { inputTokens: number; outputTokens: number;
      costEstMicroUsd: number; modelId: string } }
  | { ok: false; failure: AiFailure; fallback: T | null };  // null ⇒ surface hides

export interface FeatureAdapter<Req, Out> {
  feature: AiFeature;
  promptVersion: number;                   // bump on ANY prompt change; caches key on it
  budget(): ContextBudget;                 // reads AI_BUDGETS
  system(req: Req): string;                // voice/system prompt (deterministic)
  serialize(req: Req): ContextItem[];      // deterministic; hero-legal facts only
  parse(raw: string): Out | { kind: "invalid-output"; detail: string };
  fallback(req: Req): Out | null;          // deterministic, no I/O, never throws
}

export async function runFeature<Req, Out>(
  a: FeatureAdapter<Req, Out>, req: Req,
  deps: { transport: AiTransport; settings: AiSettings; entitlements: Entitlements;
          usage: AiUsageAppender; caps: CapState; now: () => number },
): Promise<AiResult<Out>>;
```

Runner order (fixed): entitlement check → key check → cap/bucket check →
`packContext` → transport → parse/validate → **on any failure, return
`fallback(req)`** → append exactly one `aiUsage` row (outcome `ok` / `error` /
`truncated` / `fallback`). Failures after transport still meter real token usage.

### Degradation matrix

| Failure | coachReview | coachChat | botGen | banter |
|---|---|---|---|---|
| `no-key` | template narrative, silently | input hidden entirely | "describe" field hidden; sliders only | canned lines, silently |
| `budget-exhausted` | template (cap is 1/session — re-runs serve cache) | meter shows 0 left; input disabled, coach-voice one-liner | quiet "daily limit" note | canned lines |
| `timeout` / `rate-limited` / `provider-error` / `offline` | template, one quiet retry affordance on the report | inline quiet error, message retryable | quiet error, description preserved for retry | canned lines (2.5s hard deadline) |
| `truncated` | discard, template (never show half an analysis) | render + "…" marker, counts against caps | discard, retry once, then error | discard, canned |
| `invalid-output` | template | render as-is unless voice-lint fails hard (blacklist) → drop | retry once with error appended, then sliders | canned |

Silent means silent: no toast, no badge, no error state the keyless user can see.
The only discovery moment for keyless users is the one dismissable coach-voice
footer on the first session report (PRD: "AI discoverability").

---

### Adapter 1 — `coachReview`

- **Trigger:** user opens a session report (user navigation, never background) with a
  key configured. Runs once; result cached on the session row
  (`SessionRow.aiNarrative`, keyed by `modelId` + `promptVersion`) — reopening a
  report costs zero tokens.
- **Context ladder** (priority order):
  0. *(required)* coach voice contract + vocabulary register for the player's rating
     tier (foundations/advanced — see pipeline below)
  1. *(required)* deterministic findings, serialized compactly (concept id, decision
     ref, EV loss band, better line, facts[])
  2. session summary line (hands, net, EV-net, grade, top concepts)
  3. key-hand text exports (`exportHandText`, hero-visible), costliest first —
     as many as fit
  4. relevant villain notes (earned stats one-liners for characters in the findings)
- **Budget:** 8k in / 1k out / 30s / 1 per session.
- **Output contract:** JSON `{ opening: string, findings: [{ decisionId, text }],
  close: string }`. `parse` validates: every `decisionId` present in the input
  findings (no invented findings), finding text ≤55 words, ≤2 numbers per finding,
  zero blacklist words, no exclamation marks in mistake copy — the CI-lintable voice
  invariants from the voice pack, applied at runtime. Any violation ⇒ fallback.
- **Fallback:** the template narrative (voice pack §2.3 skeletons + concept-family
  frames) — same structure, same voice, zero tokens.

### Adapter 2 — `coachChat`

- **Trigger:** user sends a message in the Coach rail tab or a report's "ask about
  this" (input only exists with a key — hidden, not disabled, without one).
- **Context ladder:**
  0. *(required)* coach voice contract + register
  1. *(required)* current hand context block — **serialized once per hand, cached,
     reused for every message about that hand** (PRD editorial decision). Contents:
     hero-visible hand text, the hand's findings, price/equity readouts already shown
     to the user.
  2. player context: rating tier, active leak focus, session summary line
  3. rolling window: last 6 chat turns (older turns drop whole)
  4. the user's message *(required, priority 0 in practice — required items always
     pack)*
- **Budget:** 6k in / 700 out per message / 30s; **20 messages per session** with a
  visible meter (see Meters). Streaming on.
- **Output contract:** plain prose; soft voice lint (blacklist scan only — chat is
  conversational, not templated). Truncation renders with a marker.
- **Fallback:** none (`null`) — chat is inherently an AI surface; failures show a
  quiet inline error in coach voice. The deterministic coach (hints, badges,
  templates) is the keyless answer to "coaching without chat".

### Adapter 3 — `botGen`

- **Trigger:** user writes a description in `/players/new` ("describe-with-AI") and
  taps generate.
- **Context ladder:**
  0. *(required)* the BotDefinition JSON schema (compact), the legal parameter ranges
     per tier envelope, and two few-shot examples from the builtin cast
  1. *(required)* the user's description
- **Budget:** 1.5k in / 1.2k out / 30s / 20 per day (abuse valve, not a monetization
  lever).
- **Output contract:** a single JSON `BotDefinition`. `parse` runs the same schema
  validation as file-imported custom bots, then **clamps** every numeric parameter
  into its tier envelope — an LLM can flavor a bot, it cannot mint a super-crusher or
  a broken persona. On invalid JSON: one retry with the validation error appended to
  the prompt, then fail to sliders.
- **Fallback:** `null` — the sliders are right there; generation is a convenience.

### Adapter 4 — `banter`

Canned-first is doctrine: hand-written character lines are the primary path (they
ship with the cast and are always available); LLM banter is a garnish behind a token
bucket, so table talk can never dominate analysis spend (PRD Q60).

- **Trigger:** the banter director (in `bots`/UI land) picks a banter moment and a
  character. It first asks the bucket: no token ⇒ canned line, no transport, no
  meter entry. With a token ⇒ LLM attempt with a **2.5s hard deadline**; any failure
  or slow response falls back to canned (the moment must not wait).
- **Token bucket:** capacity 3, +1 token per 12 hands, hard cap **10 LLM lines per
  session**. Bucket state is session-scoped and in-memory.
- **Context ladder:**
  0. *(required)* character card: persona sketch, current mood arc state, voice
     examples (3 canned lines as few-shots)
  1. *(required)* the moment: one line of public table context ("Rocco just lost a
     280bb pot to Hero", "Hero has won 4 straight")
  2. one relationship memory fact (real logged event from `villainObs.memory`) when
     relevant
  — **Public information only.** Never hero hole cards, never live-hand state that
  the character couldn't see, never other bots' minds.
- **Budget:** 800 in / 60 out per line.
- **Output contract:** one line ≤120 chars, no numbers invented (soft lint), no
  blacklist words (hard lint). Violation ⇒ canned.
- **Fallback:** the canned line the director had already selected — fallback is the
  default path, the LLM is the exception.

## Coach voice pipeline

One pipeline renders every coach utterance; the LLM is an optional last stage.

```
deterministic findings           tier filter                    render
(packages/analysis)      →   (rating → register,     →   template render (always works)
 concept, EV loss, better     severity ordering,          OR llm rewrite (key + budget)
 line, facts — pure data)     cap: ≤3 on rough                → validate → on fail:
                              sessions)                          template render
```

1. **Findings are deterministic.** `packages/analysis` produces
   `{ decisionId, handId, conceptId, severity: 'light'|'medium'|'big',
   evLossMilliBb, better, facts: string[] }` — pure functions of the graded hand.
   The AI layer never computes poker; it narrates.
2. **Tier filter.** The player's rating selects the vocabulary **register**
   (foundations vs advanced — taxonomy "coach vocabulary" rule) and bounds finding
   count. The filter's output is identical whether the renderer is template or LLM —
   both paths describe the same findings in the same register.
3. **Render.**
   - **Template path** (always available, the keyless coach): templates keyed
     `(surface, conceptFamily, severity, tone)` from the voice pack, slot-filled with
     number-quieting rules, session-scoped no-repeat window. Deterministic given
     (findings, register, template-pick stream) — template selection uses an injected
     RNG stream, never `Math.random`.
   - **LLM path**: `coachReview`/`coachChat` adapters above. The prompt embeds the
     voice spec and the register; the model's job is *rewrite, not analyze* — it may
     rephrase facts, it may not add numbers, hands, or findings. Runtime validation
     enforces the same CI voice invariants the templates pass (length budgets, number
     counts, blacklist, no invented decisionIds). **Validation failure falls back to
     the template render** — the user always gets the coach, in voice, on time.

The template renderer and validators live in dependency-free modules and are
property-tested against worst-case slot fills (the voice pack's CI lint reuses them).

## Usage ledger & visible meters

- Every transport call appends one `AiUsageRow` (shape in `docs/data-layer.md`):
  feature, modelId, real token counts from the provider response (estimates only if
  the response omitted them), `costEstMicroUsd` via `estimateCostMicroUsd`, outcome.
- **Settings → AI meter:** month-to-date fold over `aiUsage` — total est. cost, per
  feature breakdown, per model. Copy is honest about being an estimate at list
  prices ("your provider's bill is the truth").
- **Chat meter:** "14 of 20 left" in the chat input area, always visible, counts
  down per sent message; at 0 the input disables with a coach-voice line. Session
  scope resets per session.
- **Banter is silent** (no meter — it's ambience) but fully ledgered; its spend
  shows up in Settings → AI like everything else.
- First-AI-feature moment links to Settings → AI where the estimates table lives
  ("a session review costs about half a cent on the default model").

## Cost-discipline invariants (testable rules — CI enforces every one)

- **C1 — No over-budget input, ever.** For every adapter and any request,
  `packContext(...).estInputTokens ≤ budget.maxInputTokens` (property test with
  generated oversized items).
- **C2 — Output capped at the transport.** Every transport call passes
  `maxOutputTokens` from `AI_BUDGETS`; no call site overrides upward (asserted in
  the runner; adapters cannot reach the transport directly).
- **C3 — Ambient spend ≤ analysis spend.** Worst-case banter session
  (`bucket.sessionCap × (banter.in + banter.out)`) ≤ 1× one `coachReview` call
  (`in + out`). Asserted against `AI_BUDGETS` itself, so retuning that breaks the
  mandate fails CI. (Current: 10 × 860 = 8,600 ≤ 9,000 ✓.)
- **C4 — Chat is bounded and visible.** `messagesPerSession` is finite, enforced in
  the runner (`budget-exhausted`, scope `session`), and the meter renders from the
  same counter the runner enforces (one source of truth).
- **C5 — Keyless means zero calls.** With no key configured, the transport is never
  invoked by any feature (test: transport spy across all four adapters and every
  failure path).
- **C6 — Everything is metered.** Exactly one `aiUsage` row per transport
  invocation, including failures and truncations (spy-count equality test).
- **C7 — Once per hand.** Chat's hand-context block is serialized once per hand and
  cached; N messages about one hand invoke the serializer once (memoization test).
- **C8 — Hero-legal serialization.** No serializer output ever contains a card
  string/int for cards outside the hero-visible set of the hand in context
  (property test over generated hands with known hidden holes).
- **C9 — Registry is data.** Adapters obtain model parameters only via
  `resolveModel`; no model-id literals outside `registry.ts` (lint rule). Unknown
  models get cost "unknown", never a guessed price.
- **C10 — Integer money.** All cost math is integer micro-USD end to end; the meter
  formats at the edge (same law as chips-are-cents).
- **C11 — Fallback totality.** For every failure kind in `AiFailure`, every adapter
  returns either a non-null fallback or a defined hidden/quiet-error UI state — the
  degradation matrix above is exhaustive and each cell has a test.
- **C12 — Caches hold.** Re-opening a report with an existing
  `(modelId, promptVersion)` narrative performs zero transport calls (C6's spy at
  zero); bumping `promptVersion` invalidates.

## Test checklist (P2 agents: definition of done)

- `estimateTokens`/`packContext`: determinism, priority ordering, whole-item drops,
  required-item hard-fail, C1 property.
- Runner: gate order (entitlement → key → caps → pack → transport), one usage row
  per call (C6), fallback on every failure kind (C11), streaming + truncation paths.
- Token bucket: refill schedule over a simulated 200-hand session, session cap,
  deadline fallback (fake timers — time is an input here too).
- Coach pipeline: register selection per rating tier; template renderer no-repeat
  window with seeded stream; validator rejects each voice-invariant violation
  (fixture corpus of bad outputs); LLM-path validation failure lands on template
  output byte-identical to the keyless path.
- botGen: schema validation + tier-envelope clamping (property: any parsed output
  is a legal bot); retry-once flow.
- Invariants C1–C12 each as a named test — they are the spec's teeth.

When you change this system, update this document in the same PR.
