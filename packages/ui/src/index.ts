/**
 * @poker/ui — the design system.
 *
 * Consume the CSS custom properties with `import "@poker/ui/tokens.css"`, and
 * the typed token objects from here. Components elsewhere in the repo speak
 * semantic tokens only; primitives are exported for the system's own internals
 * and for the token compiler.
 */

/* Layer 1 — primitives */
export {
  blur,
  duration,
  durationMs,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  ink,
  letterSpacing,
  lineHeight,
  radius,
  soundBuses,
  soundCueBus,
  soundCueDefaultDb,
  soundCues,
  space,
  spring,
  textStyles,
  zLayer,
} from "./tokens/primitives";
export type { SoundBus, SoundCueId, SpringConfig, SpringName, TextStyle } from "./tokens/primitives";

/* Layer 2 — semantic */
export { semantic, semanticTokenNames } from "./tokens/semantic";
export type { SemanticTokenName, SemanticTokens } from "./tokens/semantic";

/* Layer 3 — skins */
export { DEFAULT_SKIN, resolveSkin, skinNames, skins } from "./tokens/skins";
export type { SkinName, SkinOverrides } from "./tokens/skins";

/* Access */
export { cssVar, cssVarName } from "./cssVar";
export type { TokenVarName } from "./cssVar";
export { VAR_PREFIX } from "./tokens/emit";
