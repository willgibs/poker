/**
 * @poker/ui — the design system.
 *
 * Consume the CSS custom properties with `import "@poker/ui/tokens.css"`, the
 * component styles with `import "@poker/ui/components.css"`, and the typed
 * token objects + atoms from here. Components elsewhere in the repo speak
 * semantic tokens only; primitives are exported for the system's own internals
 * and for the token compiler.
 */

/* Layer 1 — primitives */
export {
  blur,
  distance,
  duration,
  durationMs,
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
  scaleNum,
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

/* Components */
export { Button } from "./components/Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./components/Button";
export { Link } from "./components/Link";
export type { LinkProps, LinkVariant } from "./components/Link";
export { NavLink } from "./components/NavLink";
export type { NavLinkProps } from "./components/NavLink";

/* Atoms — the only home for raw interactive elements. Styles: components.css */
export { AmountField, Kbd, Pill, SizeChip, Slider } from "./components";
export type {
  AmountFieldProps,
  KbdProps,
  PillProps,
  PillTone,
  SizeChipProps,
  SliderProps,
} from "./components";

/* Money — the single display path for chip amounts (integer cents in, string out) */
export {
  NUM_CLASS,
  formatAmountInput,
  formatBb,
  formatCents,
  formatStakes,
  parseAmountInput,
} from "./components";
export type { FormatCentsOptions } from "./components";

/* Motion — the layer-1 tables in the form `motion/react` consumes */
export {
  PRESS_SCALE,
  easeToMotion,
  flatTransition,
  pressTransition,
  reducedTransition,
  seconds,
  springToMotion,
} from "./components";
export type { MotionEase } from "./components";
