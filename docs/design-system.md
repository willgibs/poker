# Design system

This is the normative doc: the tokens, the skin mechanism, the design budgets in
`CLAUDE.md`, how each is enforced today, and the component rules. When you change
`packages/ui`, `packages/table-ui`, or any of the rules in `tooling/eslint-rules`,
update this file in the same PR.

## Three token layers

Source of truth: `packages/ui/src/tokens/*.ts`. Nothing downstream may invent a
color, a spacing value, a duration, or a spring — every one of those is a lookup
into this layer, never a literal.

### Layer 1 — primitives (`tokens/primitives.ts`)

Raw, meaningless values: the ink ramp, the 4-based space scale, radii, the type
scale, z-layers, motion durations/easings/springs, sound cue tables. This is the
**only** file in the repo allowed to write down a color literal. Groups that map
to CSS are emitted as `--fr-<group>-<token>` custom properties; springs and sound
cues stay TypeScript-only (`motion/react` consumes spring physics directly, and
sound cues aren't CSS values at all).

```ts
import { ink, space, spring } from "@poker/ui";

ink[50];            // "#050507" — canvas
space[4];            // "16px"
spring.chip;          // { stiffness: 385.5, damping: 32.2, mass: 1, ... }
```

The values here are **Carbon**, locked at Gate 1 (design-law L12, variation C).
Three families carry law directly and may not be changed without a gate:

| Family | Law | Shape |
|---|---|---|
| `ink` | L12 | Carbon grey ramp. The named anchors sit on fixed steps: `50` canvas, `150` surface/card-ink, `200` raised, `250` hairline, `300` line, `600` faint, `800` dim, `950` text, `1000` card face. |
| `radius` | L14 | Tight: `sm` 2px · `md` 4px · `lg` 7px, plus `pill`/`circle`. Crisp 1px edges are part of the identity. |
| `fontSize` / `letterSpacing` / `textStyles` | L1, L2, L9 | The six Gate 1 roles in one family (General Sans): display 32/600/-0.021em · title 22/600/-0.018em · heading 17/600/-0.014em · body 14/400/-0.006em · small 12.5/400/-0.004em · label 11/500/+0.08em uppercase. `label` is the **only** tracked and the only uppercase role. |

`fontWeight.bold` is pinned to 600, not 700: the shipped webfont carries 400 and
600 only (see "Fonts" below), and a 700 request would be faux-bolded.

#### Compatibility aliases

Tokens ripple, but components wait for Gates 3-5. Rather than strand the CSS
those components already ship, the pre-Carbon **names** are kept as aliases onto
the Carbon **values** — `radius.xs/xl/xxl`, the `fontSize.displayXl…labelSm`
ladder, and `letterSpacing.tighter/tight/snug/wide/wider/widest`. They are
labelled as aliases in `primitives.ts` and retire with the components that use
them. Note the consequence in the tracking table: `wide`/`wider`/`widest` used
to be 0.14/0.18/0.26em and now all resolve to the single sanctioned +0.08em
eyebrow value, so no surface can reintroduce wide tracking by name (L1).

### Layer 2 — semantic (`tokens/semantic.ts`)

Meaning, not appearance: `canvas`, `surface`, `raised`, `line`, `text`, `dim`,
`primary`, `felt`, `pos`, `neg`, etc. Components reference **only** this layer
(plus non-color primitives like `space`/`radius`) — never a primitive color,
never a skin. The base values *are* the default skin, "Carbon".

```ts
import { semantic } from "@poker/ui";

semantic.pos; // "#1cb271" — win color, identical in every skin (see below)
```

Under the Signal doctrine (L8) this layer is **achromatic except where color
carries meaning**. Everything chromatic in it is on the sanctioned list:

- **Suits (L13)** — vivid `suitH`/`suitD`/`suitC`. The spade is not a hue: it is
  two tokens, `suitSpadeFace` (near-black, on card stock) and `suitSpadeChrome`
  (near-white, on dark chrome). Never collapse them into "the spade color".
- **States** — `pos`, `neg`, `warn`.
- **Data (L10)** — `chart`, the analytics encoding base.

Primaries are **white**, not chromatic: `primary`/`onPrimary`/`primaryHover`/
`primaryPress`, and one focus ring (`focus`, 2px with a 2px offset) for the whole
system.

**The felt is still open (L16).** Both candidates ship as tokens —
`feltAchromatic` (#0a0b0d) and `feltWhisperGreen` (#090e0c) — and `felt` points
at the achromatic one as a *placeholder*, not a decision. The felt and the
floating-stage question are answered together, on the real table at scale.

Semantic tokens carry compatibility aliases on the same terms as the primitives:
`edge` → `line`, `muted` → `dim`, `suitS` → `suitSpadeFace`, `felt1`/`felt2` →
`felt`, `glow` → `focus`, and `accentA`/`accentB` → `primary`. That last pair is
how L3 is enforced without touching component CSS: every surviving
`linear-gradient(var(--fr-accent-a), var(--fr-accent-b))` now collapses to the
flat white primary instead of stranding a dead gradient.

### Layer 3 — skins (`tokens/skins.ts`)

A skin is nothing but a set of semantic overrides. That's the entire cosmetics
engine: table felts, deck skins, and card backs are career unlocks, expressed
purely as a `Partial<Record<SemanticTokenName, string>>` per skin name.

```ts
export const skins = {
  carbon: {}, // DEFAULT and, for now, ONLY — the base layer IS this skin
};
```

The pre-Carbon trio (`afterhours`, `midnight`, `cardroom`) is **deleted, not
migrated**: all three were built on gradient accents and colored felts, which L3
and L8 retired. The mechanism above is kept intact and exercised so that
reopening cosmetics at Gate 3-5 is a data change, not a rebuild.

`pos`/`neg` (profit/loss color) are never overridden by a skin — profit must
read the same color in every theme (see the comment in `semantic.ts`).

## Skin mechanism: `data-skin`

`resolveSkin(skin)` collapses a skin's overrides onto the base semantic layer —
total by construction, every token comes back with a concrete value under every
skin. `tokens/emit.ts` compiles that into `tokens.gen.css`
(`pnpm tokens:build`, wrapped by `tooling/tokens-build`): a `:root` block with
every primitive + the default skin's semantic values, plus one
`[data-skin="…"]` block per skin, each self-contained so switching skins can
never leave a stale token behind.

```css
/* apps/web sets this attribute on <html> or a theme root; everything under it
   re-resolves for free because components only ever speak semantic tokens. */
<html data-skin="carbon">
```

Regenerate with `pnpm tokens:build` whenever a token in `primitives.ts` or
`semantic.ts` changes; `tokens.gen.css` is a generated file (see header) — hand
edits are lost on the next build, which is also why it's exempt from
`no-raw-colors` (see below).

## Reading a token from TypeScript: `cssVar`

`packages/ui/src/cssVar.ts`'s `cssVar(name, fallback?)` is the **only**
sanctioned way for TypeScript to reach a token — inline `style` props that must
carry a computed value, canvas/SVG paint, motion values. `TokenVarName` is a
compile-time-checked union built from the same primitive/semantic tables the
compiler emits, so a renamed or typo'd token is a build error, not a silently
missing CSS variable.

```ts
cssVar("felt");                    // "var(--fr-felt)"
cssVar("suit-h", "#f04a37");       // "var(--fr-suit-h, #f04a37)" — offscreen fallback only
```

## Fonts

General Sans is the voice (L9), self-hosted and imported alongside the tokens:

```ts
import "@poker/ui/fonts.css";   // packages/ui/src/fonts.gen.css
import "@poker/ui/tokens.css";
```

`fonts.gen.css` is copied verbatim from the Gate 0 kit
(`poker-internal/design/gates/gate0/fonts/fonts.css`) — two `@font-face` blocks,
weights 400 and 600, each inlined as a base64 woff2 data URI so the sheet issues
no network request and needs no CSP allowance. **These are ASCII subsets**
(U+0020-007E plus curly quotes, en/em dashes, ellipsis); arbitrary user-entered
or non-Latin text falls through to the system stack. The full character-set
files land at Gate 5. `packages/ui/src/fonts.test.ts` guards all of it — face
count, weights, data-URI-only sources, and that `fontWeight` never asks for a
weight the kit cannot draw.

## Beat tokens: the pointer to the Presenter

Motion durations and springs are consumed twice, at two different altitudes,
and the design system treats that as two separate token surfaces:

- `packages/ui/src/tokens/primitives.ts` (`duration`, `easing`, `spring`) is the
  **CSS/physics vocabulary** — what a transition or spring *is*.
- `packages/table-ui/src/tokens.ts` (`DURATION`, `DurationToken`, `SpringToken`,
  `resolveDuration`, `resolveStagger`, `compressionTier`) is the **scheduling
  vocabulary** — the same values, plus the speed model (0.5x–3x, instant) and
  the PACED clamp law that the table's Presenter (see `docs/architecture.md`,
  "Table projection") uses to decide *when* and *how long*.

`packages/table-ui/src/beats.ts` defines `Beat`: a typed, timed, self-describing
UI moment carrying `cssToken?: DurationToken` and `spring?: SpringToken` —
string pointers into the layer-1 tables, never a raw ms number or spring
object. The Presenter (headless; lives conceptually between the table store and
`apps/web`'s renderers) schedules beats using `resolveDuration`/`resolveStagger`
against `packages/table-ui`'s tokens; renderers in `packages/ui`/`apps/web` read
`beat.cssToken`/`beat.spring` back out and look them up in
`packages/ui`'s `duration`/`spring` tables to actually animate. Neither side
invents a duration or spring outside these two tables — that identity
(`table-ui`'s `DURATION` mirrors `ui`'s `duration`) is intentional, mirroring
the pattern `packages/ui/src/tokens/tokens.test.ts` already uses to keep
`duration` and `durationMs` in lockstep *within* `packages/ui`. There is not
yet an equivalent cross-package test asserting `table-ui`'s `DURATION` and
`ui`'s `duration` stay numerically identical — add one (in either package) the
next time either table changes.

## Design budgets (CLAUDE.md) and their enforcement

These are product law, not suggestions. Each row names the mechanism that
currently holds the line — most are not yet automatable because the components
they govern don't exist yet; those are marked accordingly rather than
overclaimed.

| Budget | Enforcement today |
|---|---|
| Table header ≤ 4 slots | **Not yet automated.** No header component exists yet. When it lands, add a unit test in its package asserting `slots.length <= 4` (mirrors the pattern in `docs/testing.md`'s "UI: Presenter is headless and unit-tested"). |
| One ambient analysis chip in Guided loadout | **Not yet automated.** Enforce with a unit test on the Guided loadout assembly once it exists (assert exactly one chip tagged `ambient-analysis`). |
| Session-end sheet ≤ 4 slots | **Not yet automated.** Same pattern as the header budget — a unit test on the session-end sheet component once it lands. |
| One celebration per session end | **Partially structural today:** `spring.celebrate` in `packages/ui/src/tokens/primitives.ts` is documented as "the app's only bouncy spring — session-end celebration slot only," and `celebrate_milestone` / `celebrate_unlock` / `celebrate_level` are the only `moments`-bus sound cues (`soundCueBus` in `primitives.ts`). Once the Presenter's session-end scheduling exists, add a property test asserting a beat schedule never contains more than one beat using `spring/celebrate` per session. |
| One coach line + one banter slot | **Partially structural today:** `packages/table-ui/src/beats.ts`'s `BeatKind` union has exactly one `"banter"` kind with an in/out `phase` (`BanterMeta`) — there's no vocabulary for a second concurrent banter beat. A coach-line equivalent doesn't exist yet; add it to `BeatMetaMap` the same way when it lands, and a scheduling-level test once the Presenter does. |
| No popups/modals mid-hand | **Enforced by architecture + review, not lint.** Modal/dialog primitives live in `packages/ui` as system components; the table store only opens them at hand boundaries. Covered by the Playwright "keyboard-only hand playthrough" pass in `docs/testing.md` once that suite exists (assert no dialog role in the DOM during an in-progress hand). |
| Numbers quiet, moments warm | **Design review, not lint.** The mechanism it rides on: `textStyles.body*`/`label*` in `primitives.ts` are deliberately restrained (no display-weight numerals in HUD chrome), and `spring.celebrate`'s exclusivity (above) is the only "warm" moment in the motion vocabulary. No automated check for tone; caught in design/code review. |

## Component rules

- **System components only.** Anything outside `packages/ui` consumes `Button`,
  `Link`, etc. from `packages/ui` rather than raw DOM elements. Partially
  enforced today by `local/no-raw-interactive-elements` (bans raw
  `<button>`/`<a>`, `.tsx`, outside `packages/ui`); other raw interactive
  elements (`<input>`, `<select>`, …) are conventionally banned the same way
  but not yet lint-enforced — extend `BANNED_TAGS` in
  `tooling/eslint-rules/src/rules/no-raw-interactive-elements.ts` as system
  components for them land.
- **Every `packages/ui` and `packages/table-ui` export needs a story once
  Storybook lands.** Not yet enforced (Storybook isn't wired up this wave);
  when it is, the intended CI check is "every named export of
  `packages/ui/src/index.ts` / a future `packages/table-ui` component index
  has a matching `.stories.tsx`," analogous to how `docs/testing.md` gates
  math-critical code on property tests.
- **Motion only through `motion`/`framer-motion` inside `packages/ui` and
  `packages/table-ui`.** Enforced by `local/no-direct-motion-import`
  everywhere else under `apps/**` and `packages/**`.
- **No inline style objects, anywhere.** Enforced by
  `local/no-inline-style-objects` — see below for the escape hatch.
- **No raw color/hex/rgb()/hsl() literals outside the token layer.** Enforced
  by `local/no-raw-colors` — see below for the token-file and generated-file
  exemptions.

## The lint rules (`tooling/eslint-rules`)

A tiny local flat-config ESLint plugin, imported by relative path from
`eslint.config.js` (not published to npm). Source: `tooling/eslint-rules/src`.
Unit tests: `tooling/eslint-rules/src/rules/*.test.ts`, via ESLint's
`RuleTester`. Wired into `eslint.config.js` as one appended, delimited block
scoped to `apps/**/*.{ts,tsx}` and `packages/**/*.{ts,tsx}`.

| Rule | Bans | Exempt paths | Escape hatch |
|---|---|---|---|
| `local/no-raw-colors` | Hex (`#fff`, `#ffffffaa`, …) and `rgb()`/`rgba()`/`hsl()`/`hsla()` literals in string/template literals | `packages/ui/src/tokens/**` · any `*.gen.*` file | none by design — move the value into the token layer |
| `local/no-inline-style-objects` | JSX `style={{ … }}` (object-literal form only; `style={variable}` is unaffected) | none | a single `// eslint-disable-line local/no-inline-style-objects` with a reason in the same line |
| `local/no-direct-motion-import` | `import`/dynamic `import()`/`require()`/re-export of `motion` or `framer-motion` (and subpaths) | `packages/ui/**` · `packages/table-ui/**` | none by design — consume motion through the system component/animation API |
| `local/no-raw-interactive-elements` | JSX `<button>`/`<a>` (lowercase — intrinsic elements only, custom components like `<Button>` are unaffected) | `packages/ui/**`; also skips any file not ending in `.tsx` | none by design — use the system component |

All four rules read `context.filename` for their path exemptions (not a
separate `eslint.config.js` override block), which is why the exemptions
themselves are covered by each rule's own `RuleTester` cases rather than
living only in config.

`no-raw-interactive-elements` is wired now even though nothing in `apps/**`
or `packages/**` (other than `packages/ui` itself) has React components yet —
per the plan, it's written and wired ahead of the code it will eventually
flag, not added retroactively.

### A known, intentional gap

`apps/web/src/App.tsx` is P0 scaffold that predates the token layer — it
currently trips both `no-raw-colors` and `no-inline-style-objects`. That's
correct behavior for the rules (the scaffold really does hardcode hex colors
and inline styles); migrating it to `packages/ui` system components and
semantic tokens is tracked separately and is not a lint-rule bug.
