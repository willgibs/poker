/**
 * ActionBar — the hero zone (table.html Study 3).
 *
 * "Under 400ms from intent to committed action — the bar carries the whole
 * promise." Everything about this component is that sentence:
 *
 * - **Three targets, one loud.** Fold is `ghost`, Check/Call is `quiet`,
 *   Bet/Raise is the screen's only `primary` gradient. Labels come from a
 *   `LegalActions` menu straight out of `@poker/engine` — the bar renders the
 *   menu, it never reasons about the rules.
 * - **Sizing expands in place.** Same panel, same top edge, no modal, no second
 *   screen: the resting row and the sizing row share one grid cell and
 *   cross-fade; only the slider row below them opens. Nothing above the bar
 *   moves, which is what makes the fast path muscle memory.
 * - **The suggestion is pre-selected**, so the fast path stays two taps:
 *   Bet → Bet $9.20.
 * - **The keyboard is the fast lane, not a power feature.** F/C/B, 1–5 for
 *   sizes, ←/→ to nudge by a big blind, ⏎ to commit, ⎋ to go back, hold ? for
 *   the map. One `onKeyDown` on the zone's focus container drives all of it.
 *
 * Presentational: every amount, every preset, and the legality of every button
 * arrives as a prop. The bar owns exactly two pieces of state — whether it is
 * expanded, and which size is armed — because both are UI, not poker.
 */

import {
  AmountField,
  Button,
  Kbd,
  SizeChip,
  Slider,
  flatTransition,
  formatAmountInput,
  formatCents,
  parseAmountInput,
  springToMotion,
} from "@poker/ui";
import type { LegalActions } from "@poker/engine";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { KeyMapOverlay } from "./KeyMapOverlay";
import type { SizePreset } from "./types";

/** Keys 1–5 arm a preset; anything past the fifth is pointer-only. */
const MAX_KEYED_PRESETS = 5;

export interface ActionBarProps {
  /** The exact menu from `legalActions(state)`. `{}` disarms the bar. */
  legal: LegalActions;
  /** Sizing presets, in display order. At most one may be `suggested`. */
  presets?: readonly SizePreset[];
  /** Big blind in cents — one ←/→ nudge. */
  bigBlindCents: number;

  onFold?: () => void;
  onCheck?: () => void;
  /** Called with the exact call amount from the menu. */
  onCall?: (amountCents: number) => void;
  /** Bet amount, or raise-TO total. Always integer cents. */
  onCommit?: (amountCents: number) => void;
  /** Fired when the sizing state opens or closes. */
  onExpandedChange?: (expanded: boolean) => void;

  /** Left slot: `<HeroCards />` plus the hero's own name and stack. */
  hero?: ReactNode;
  /** The strip under the bar: one coach line… */
  coach?: ReactNode;
  /** …and one price chip. Both hold position across every state. */
  price?: ReactNode;

  /** Nothing is actionable (villain to act, hand over, beats replaying). */
  disabled?: boolean;
  className?: string;
}

interface Bounds {
  readonly min: number;
  readonly max: number;
  /** `"bet"` opens the pot, `"raise"` answers a bet. */
  readonly kind: "bet" | "raise";
}

/** The sizing interval, whichever aggressive action is legal. */
export function aggressionBounds(legal: LegalActions): Bounds | null {
  if (legal.bet !== undefined) return { min: legal.bet.min, max: legal.bet.max, kind: "bet" };
  if (legal.raise !== undefined) return { min: legal.raise.minTo, max: legal.raise.maxTo, kind: "raise" };
  return null;
}

/** Resting label for the aggressive button — "Bet" opens, "Raise" answers. */
export function aggressionLabel(legal: LegalActions): string | null {
  const bounds = aggressionBounds(legal);
  return bounds === null ? null : bounds.kind === "bet" ? "Bet" : "Raise";
}

/** Resting label for the passive button. One key (C), context does the rest. */
export function passiveLabel(legal: LegalActions): string | null {
  if (legal.check === true) return "Check";
  if (legal.call !== undefined) return `Call ${formatCents(legal.call.amount)}`;
  return null;
}

/** Commit label: `Bet $9.20` opening, `Raise to $9.20` answering. */
export function commitLabel(kind: Bounds["kind"], amountCents: number): string {
  return kind === "bet" ? `Bet ${formatCents(amountCents)}` : `Raise to ${formatCents(amountCents)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ActionBar({
  legal,
  presets = [],
  bigBlindCents,
  onFold,
  onCheck,
  onCall,
  onCommit,
  onExpandedChange,
  hero,
  coach,
  price,
  disabled = false,
  className,
}: ActionBarProps) {
  const reduced = useReducedMotion() === true;
  const containerRef = useRef<HTMLDivElement>(null);
  const groupId = useId();

  const bounds = aggressionBounds(legal);
  const aggression = aggressionLabel(legal);
  const passive = passiveLabel(legal);

  const [expanded, setExpanded] = useState(false);
  const [amountCents, setAmountCents] = useState(0);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // The menu changed under us (villain acted, street turned): the sizing state
  // is about an offer that no longer exists, so it closes rather than commits
  // stale chips.
  const armed = bounds !== null;
  useEffect(() => {
    if (!armed) setExpanded(false);
  }, [armed]);

  const setExpandedAndNotify = useCallback(
    (next: boolean) => {
      setExpanded(next);
      onExpandedChange?.(next);
    },
    [onExpandedChange],
  );

  const openSizing = useCallback(() => {
    if (bounds === null || disabled) return;
    const suggested = presets.find((p) => p.suggested === true) ?? presets[0];
    setAmountCents(clamp(suggested?.amountCents ?? bounds.min, bounds.min, bounds.max));
    setPresetId(suggested?.id ?? null);
    setDraft(null);
    setExpandedAndNotify(true);
    // Keep the keys live: focus returns to the container, not to a chip, so
    // 1–5 / ←→ / ⏎ keep working without a second tab.
    containerRef.current?.focus();
  }, [bounds, disabled, presets, setExpandedAndNotify]);

  const closeSizing = useCallback(() => {
    setExpandedAndNotify(false);
    setDraft(null);
    containerRef.current?.focus();
  }, [setExpandedAndNotify]);

  const applyAmount = useCallback(
    (next: number, fromPreset: string | null) => {
      if (bounds === null) return;
      setAmountCents(clamp(Math.round(next), bounds.min, bounds.max));
      setPresetId(fromPreset);
      setDraft(null);
    },
    [bounds],
  );

  const commit = useCallback(() => {
    if (bounds === null || disabled) return;
    onCommit?.(clamp(amountCents, bounds.min, bounds.max));
    setExpandedAndNotify(false);
  }, [amountCents, bounds, disabled, onCommit, setExpandedAndNotify]);

  const passiveAction = useCallback(() => {
    if (disabled) return;
    if (legal.check === true) onCheck?.();
    else if (legal.call !== undefined) onCall?.(legal.call.amount);
  }, [disabled, legal, onCall, onCheck]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const onTextField = target instanceof HTMLInputElement && target.type !== "range";
      const onRange = target instanceof HTMLInputElement && target.type === "range";
      const onButton = target instanceof HTMLButtonElement;
      const key = event.key;

      if (key === "?") {
        setHelpOpen(true);
        return;
      }
      if (disabled) return;

      if (!expanded) {
        if (onTextField) return;
        if (key === "f" || key === "F") {
          if (legal.fold === true) {
            event.preventDefault();
            onFold?.();
          }
          return;
        }
        if (key === "c" || key === "C") {
          if (passive !== null) {
            event.preventDefault();
            passiveAction();
          }
          return;
        }
        if (key === "b" || key === "B") {
          if (bounds !== null) {
            event.preventDefault();
            openSizing();
          }
        }
        return;
      }

      /* --- expanded -------------------------------------------------------- */
      if (key === "Escape") {
        event.preventDefault();
        closeSizing();
        return;
      }
      if (key === "Enter") {
        // A focused button activates itself; committing here too would fire twice.
        if (onButton) return;
        event.preventDefault();
        commit();
        return;
      }
      if (onTextField) return;

      if (key >= "1" && key <= "5") {
        const preset = presets[Number(key) - 1];
        if (preset !== undefined) {
          event.preventDefault();
          applyAmount(preset.amountCents, preset.id);
        }
        return;
      }
      if (onRange) return; // the native range owns its own arrows
      if (key === "ArrowLeft" || key === "ArrowDown") {
        event.preventDefault();
        applyAmount(amountCents - bigBlindCents, null);
        return;
      }
      if (key === "ArrowRight" || key === "ArrowUp") {
        event.preventDefault();
        applyAmount(amountCents + bigBlindCents, null);
      }
    },
    [
      amountCents,
      applyAmount,
      bigBlindCents,
      bounds,
      closeSizing,
      commit,
      disabled,
      expanded,
      legal.fold,
      onFold,
      openSizing,
      passive,
      passiveAction,
      presets,
    ],
  );

  const handleKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "?" || event.key === "/") setHelpOpen(false);
  }, []);

  const showSizing = expanded && bounds !== null;
  const classes = ["fr-hero", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
  const rowTransition = reduced ? flatTransition : springToMotion("ui");

  return (
    <div
      ref={containerRef}
      className={classes}
      data-hero-bar
      data-expanded={showSizing ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      role="group"
      aria-label="Your action"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={() => setHelpOpen(false)}
    >
      {/*
        One grid cell, two rows stacked in it. This is the "expands in place"
        mechanic: the resting controls and the sizing controls occupy the same
        box, so the bar's top edge — and everything above it — cannot move.
        Neither row unmounts, so the bar is never rebuilt mid-decision.
      */}
      <div className="fr-hero__stack">
        <motion.div
          className="fr-hero__row fr-hero__row--resting"
          data-hero-row="resting"
          animate={{ opacity: showSizing ? 0 : 1 }}
          transition={rowTransition}
        >
          {hero !== undefined ? <div className="fr-hero__cards">{hero}</div> : null}
          {legal.fold === true ? (
            <span className="fr-hero__btn fr-hero__btn--fold">
              <Button
                variant="ghost"
                size="lg"
                onClick={onFold}
                disabled={disabled || showSizing}
                aria-keyshortcuts="f"
                hint={<Kbd>F</Kbd>}
              >
                Fold
              </Button>
            </span>
          ) : null}
          {passive !== null ? (
            <span className="fr-hero__btn fr-hero__btn--passive">
              <Button
                variant="quiet"
                size="lg"
                onClick={passiveAction}
                disabled={disabled || showSizing}
                aria-keyshortcuts="c"
                hint={<Kbd>C</Kbd>}
              >
                {passive}
              </Button>
            </span>
          ) : null}
          {aggression !== null ? (
            <span className="fr-hero__btn fr-hero__btn--aggro">
              <Button
                variant="primary"
                size="lg"
                onClick={openSizing}
                disabled={disabled || showSizing}
                aria-expanded={showSizing}
                aria-controls={`${groupId}-sizing`}
                aria-keyshortcuts="b"
                hint={<Kbd>B</Kbd>}
              >
                {aggression}
              </Button>
            </span>
          ) : null}
        </motion.div>

        <motion.div
          className="fr-hero__row fr-hero__row--sizing"
          id={`${groupId}-sizing`}
          data-hero-row="sizing"
          animate={{ opacity: showSizing ? 1 : 0 }}
          transition={rowTransition}
        >
          <span className="fr-hero__btn fr-hero__back">
            <Button
              variant="quiet"
              size="lg"
              onClick={closeSizing}
              disabled={disabled || !showSizing}
              aria-label="Back to actions"
              aria-keyshortcuts="Escape"
            >
              ‹
            </Button>
          </span>
          {presets.map((preset, index) => (
            <SizeChip
              key={preset.id}
              label={preset.label}
              sublabel={formatCents(preset.amountCents)}
              selected={presetId === preset.id}
              suggested={preset.suggested === true}
              disabled={disabled || !showSizing}
              hint={index < MAX_KEYED_PRESETS ? <Kbd>{String(index + 1)}</Kbd> : undefined}
              onSelect={() => applyAmount(preset.amountCents, preset.id)}
            />
          ))}
          <AmountField
            className="fr-hero__amount"
            value={draft ?? formatAmountInput(amountCents)}
            disabled={disabled || !showSizing}
            aria-label="Bet amount"
            onValueChange={(next) => {
              setDraft(next);
              const parsed = parseAmountInput(next);
              if (parsed !== null && bounds !== null) {
                setAmountCents(clamp(parsed, bounds.min, bounds.max));
                setPresetId(null);
              }
            }}
            onBlur={() => setDraft(null)}
          />
        </motion.div>
      </div>

      {/*
        The one row that really opens. beats.md law #4 keeps layout properties
        out of motion; this bar's spec asks for height + opacity here, so it is
        the single deliberate exception — and it grows downward only, so the
        promise that "nothing above moves" still holds.
      */}
      <AnimatePresence initial={false}>
        {showSizing && bounds !== null ? (
          <motion.div
            className="fr-hero__sliderrow"
            data-hero-slider-row
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0 } : flatTransition}
          >
            <Slider
              className="fr-hero__slider"
              value={amountCents}
              min={bounds.min}
              max={bounds.max}
              step={1}
              disabled={disabled}
              onValueChange={(next) => applyAmount(next, null)}
              aria-label="Bet size"
              aria-valuetext={formatCents(amountCents)}
            />
            <span className="fr-hero__btn fr-hero__commit">
              <Button variant="primary" size="lg" onClick={commit} disabled={disabled} aria-keyshortcuts="Enter">
                {commitLabel(bounds.kind, amountCents)}
              </Button>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* One coach line + one price chip. Same strip, same places, every state. */}
      <div className="fr-hero__strip">
        {coach ?? <span className="fr-hero__coachgap" />}
        {price ?? null}
      </div>

      <KeyMapOverlay open={helpOpen} />
    </div>
  );
}
