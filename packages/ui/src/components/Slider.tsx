/**
 * Slider — a native `<input type="range">`, skinned entirely in tokens.
 *
 * Native on purpose: it arrives with keyboard support, `role="slider"`, the
 * platform's own value announcements, and pointer/touch behaviour we would
 * otherwise re-implement badly. Only the paint is ours (`components.css`).
 *
 * It lives here rather than in `packages/table-ui` for the same reason
 * `Button` does — `packages/ui` is the only home for raw interactive elements
 * (docs/design-system.md, "System components only"). The bet slider on the
 * table is this component with a token-styled track.
 *
 * Values are **integer cents**, like everywhere else in the app.
 */

import type { CSSProperties, Ref } from "react";

export interface SliderProps {
  /** Integer cents. */
  value: number;
  min: number;
  max: number;
  /** Integer cents per notch. Default 1 — the engine's resolution. */
  step?: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  /** Required: a range with no name is unusable by anything but a mouse. */
  "aria-label": string;
  /** Spoken value, e.g. `"$9.20"` — the raw cent count is not a price. */
  "aria-valuetext"?: string;
  className?: string;
  id?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  disabled = false,
  className,
  id,
  ref,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
}: SliderProps) {
  const classes = ["fr-slider", className]
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .join(" ");

  // The filled portion of the track, as a 0–1 ratio the stylesheet paints with.
  // A computed custom property is the sanctioned way to hand a live number to
  // CSS (docs/design-system.md, `cssVar`); `local/no-inline-style-objects` bans
  // the *object literal* in JSX, which is why this is a named variable.
  const span = max - min;
  const ratio = span > 0 ? (value - min) / span : 0;
  const fillStyle = { "--fr-fill": ratio.toFixed(4) } as unknown as CSSProperties;

  return (
    <input
      ref={ref}
      id={id}
      type="range"
      className={classes}
      style={fillStyle}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      data-fill={ratio.toFixed(4)}
      onChange={(event) => {
        onValueChange(Number(event.currentTarget.value));
      }}
    />
  );
}
