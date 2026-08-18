/**
 * Typed access to the generated custom properties.
 *
 * `cssVar` is the only sanctioned way for a component to reach a token from
 * TypeScript (inline styles, canvas/SVG paint, motion values). The name is
 * checked against the token source at compile time, so a renamed token breaks
 * the build rather than silently rendering `var(--fr-nope)` as nothing.
 */

import { VAR_PREFIX } from "./tokens/emit";
import type {
  blur,
  distance,
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  ink,
  letterSpacing,
  lineHeight,
  loop,
  radius,
  scale,
  space,
  zLayer,
} from "./tokens/primitives";
import type { SemanticTokenName } from "./tokens/semantic";

/** Type-level twin of `kebab()` in `emit.ts`: `accentA` -> `accent-a`. */
type KebabCase<S extends string, Acc extends string = ""> = S extends `${infer Head}${infer Rest}`
  ? KebabCase<Rest, `${Acc}${Head extends Lowercase<Head> ? Head : `-${Lowercase<Head>}`}`>
  : Acc;

type Prefixed<P extends string, K extends PropertyKey> = K extends string | number
  ? `${P}-${KebabCase<`${K}`>}`
  : never;

/** Every custom property name the system emits, minus the `--fr-` prefix. */
export type TokenVarName =
  | Prefixed<"ink", keyof typeof ink>
  | Prefixed<"space", keyof typeof space>
  | Prefixed<"radius", keyof typeof radius>
  | Prefixed<"font", keyof typeof fontFamily>
  | Prefixed<"font-size", keyof typeof fontSize>
  | Prefixed<"font-weight", keyof typeof fontWeight>
  | Prefixed<"line-height", keyof typeof lineHeight>
  | Prefixed<"letter-spacing", keyof typeof letterSpacing>
  | Prefixed<"duration", keyof typeof duration>
  | Prefixed<"ease", keyof typeof easing>
  | Prefixed<"distance", keyof typeof distance>
  | Prefixed<"scale", keyof typeof scale>
  | Prefixed<"blur", keyof typeof blur>
  | Prefixed<"loop", keyof typeof loop>
  | Prefixed<"z", keyof typeof zLayer>
  | KebabCase<SemanticTokenName>;

/** The full custom property, e.g. `cssVarName("accent-a") === "--fr-accent-a"`. */
export function cssVarName(name: TokenVarName): string {
  return `${VAR_PREFIX}${name}`;
}

/**
 * A `var()` reference, e.g. `cssVar("felt-1")` -> `var(--fr-felt-1)`.
 * The optional fallback is for surfaces that render before the stylesheet
 * (offscreen canvas, worker-side raster) — not for guessing at a token.
 */
export function cssVar(name: TokenVarName, fallback?: string): string {
  return fallback === undefined ? `var(${cssVarName(name)})` : `var(${cssVarName(name)}, ${fallback})`;
}
