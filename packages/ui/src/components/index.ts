/**
 * The atoms.
 *
 * `packages/ui` is the only package allowed to render a raw interactive
 * element (docs/design-system.md, "System components only"), so every raw
 * `<button>`, `<input type="range">`, and `<input type="text">` in the app
 * bottoms out in one of these files.
 *
 * `Button`, `Link`, and `NavLink` are exported from `../index.ts` directly and
 * are deliberately absent here — one export site per component, no aliasing.
 *
 * Styles: `Button.css` / `Link.css` / `NavLink.css` are imported by their own
 * components; the shared atom sheet is pulled once by the app, next to the
 * tokens:
 *
 *   import "@poker/ui/tokens.css";
 *   import "@poker/ui/components.css";
 */

export { Pill } from "./Pill";
export type { PillProps, PillTone } from "./Pill";

export { SizeChip } from "./SizeChip";
export type { SizeChipProps } from "./SizeChip";

export { Kbd } from "./Kbd";
export type { KbdProps } from "./Kbd";

export { Slider } from "./Slider";
export type { SliderProps } from "./Slider";

export { AmountField } from "./AmountField";
export type { AmountFieldProps } from "./AmountField";

/* Money — every visible chip amount goes through one of these. */
export { NUM_CLASS, formatAmountInput, formatBb, formatCents, formatStakes, parseAmountInput } from "./formatCents";
export type { FormatCentsOptions } from "./formatCents";

export {
  PRESS_SCALE,
  easeToMotion,
  flatTransition,
  pressTransition,
  reducedTransition,
  seconds,
  springToMotion,
} from "./motionTokens";
export type { MotionEase } from "./motionTokens";
