/**
 * AmountField — the type-in amount (table.html Study 3B, the `$9.20` box).
 *
 * A controlled text input, not `type="number"`: number inputs bring spinners
 * we do not want, locale-dependent decimal parsing we cannot control, and a
 * scroll-wheel gesture that silently changes a bet. `inputMode="decimal"` gets
 * the numeric keypad on touch without any of that.
 *
 * The field speaks **display strings** ("9.20"); the owner converts to cents.
 * Keeping the parse in one place upstream is what stops a rounding rule from
 * being invented twice.
 *
 * Here in `packages/ui` for the same reason as `Slider`: raw interactive
 * elements live in exactly one package.
 */

import type { Ref } from "react";

export interface AmountFieldProps {
  /** Display string, e.g. `"9.20"`. */
  value: string;
  onValueChange: (value: string) => void;
  /** Rendered inside the field, before the value. Usually `"$"`. */
  prefix?: string;
  disabled?: boolean;
  "aria-label": string;
  className?: string;
  id?: string;
  ref?: Ref<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function AmountField({
  value,
  onValueChange,
  prefix = "$",
  disabled = false,
  className,
  id,
  ref,
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
}: AmountFieldProps) {
  const classes = ["fr-amount", className]
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .join(" ");

  return (
    <span className={classes}>
      <span className="fr-amount__prefix" aria-hidden="true">
        {prefix}
      </span>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="fr-amount__input fr-num"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
      />
    </span>
  );
}
