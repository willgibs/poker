// @vitest-environment jsdom
/**
 * The action bar's contract, in the four things that can go wrong:
 * the wrong buttons for the menu, a bar that rebuilds itself when it expands,
 * a keyboard path that does not reach commit, and a suggestion nobody armed.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LegalActions } from "@poker/engine";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionBar, aggressionLabel, commitLabel, passiveLabel } from "./ActionBar";
import type { SizePreset } from "./types";

afterEach(cleanup);

/* --- fixtures: real `legalActions()` shapes ------------------------------- */

/** Checked to, no bet in front: fold / check / bet. */
const CHECK_MENU: LegalActions = {
  fold: true,
  check: true,
  bet: { min: 25, max: 4255 },
};

/** Facing Rocco's $4.60 into $18.40: fold / call / raise. */
const CALL_MENU: LegalActions = {
  fold: true,
  call: { amount: 460 },
  raise: { minTo: 920, maxTo: 4255 },
};

/** Facing an all-in with no chips behind for a raise: fold / call only. */
const CALL_ONLY_MENU: LegalActions = {
  fold: true,
  call: { amount: 4255 },
};

/** The scene's presets — table.html Study 3B, pot $18.40, stack $42.55. */
const PRESETS: readonly SizePreset[] = [
  { id: "33", label: "33%", amountCents: 610 },
  { id: "50", label: "50%", amountCents: 920, suggested: true },
  { id: "66", label: "66%", amountCents: 1215 },
  { id: "pot", label: "Pot", amountCents: 1840 },
  { id: "allin", label: "All-in", amountCents: 4255 },
];

function renderBar(props: Partial<React.ComponentProps<typeof ActionBar>> = {}) {
  const onFold = vi.fn();
  const onCheck = vi.fn();
  const onCall = vi.fn();
  const onCommit = vi.fn();
  const utils = render(
    <ActionBar
      legal={CHECK_MENU}
      presets={PRESETS}
      bigBlindCents={25}
      onFold={onFold}
      onCheck={onCheck}
      onCall={onCall}
      onCommit={onCommit}
      {...props}
    />,
  );
  const bar = () => {
    const node = utils.container.querySelector("[data-hero-bar]");
    if (node === null) throw new Error("no action bar");
    return node as HTMLElement;
  };
  return { ...utils, bar, onFold, onCheck, onCall, onCommit };
}

/* --- labels from the menu ------------------------------------------------- */

describe("labels adapt to the legal-action menu", () => {
  it("reads Check when checking is legal and Call $X when facing a bet", () => {
    expect(passiveLabel(CHECK_MENU)).toBe("Check");
    expect(passiveLabel(CALL_MENU)).toBe("Call $4.60");
    expect(passiveLabel({ fold: true })).toBeNull();
  });

  it("reads Bet when opening and Raise when answering", () => {
    expect(aggressionLabel(CHECK_MENU)).toBe("Bet");
    expect(aggressionLabel(CALL_MENU)).toBe("Raise");
    expect(aggressionLabel(CALL_ONLY_MENU)).toBeNull();
  });

  it("commits with the verb that matches", () => {
    expect(commitLabel("bet", 920)).toBe("Bet $9.20");
    expect(commitLabel("raise", 920)).toBe("Raise to $9.20");
  });
});

/* --- which buttons render ------------------------------------------------- */

describe("renders the buttons the menu allows", () => {
  it("fold / check / bet on the check branch", () => {
    renderBar({ legal: CHECK_MENU });
    expect(screen.getByRole("button", { name: "Fold" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Check" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Bet" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Call/ })).toBeNull();
  });

  it("fold / call / raise when facing a bet", () => {
    renderBar({ legal: CALL_MENU });
    expect(screen.getByRole("button", { name: "Fold" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Call $4.60" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Raise" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
  });

  it("drops the aggressive control when no raise is legal", () => {
    renderBar({ legal: CALL_ONLY_MENU });
    expect(screen.getByRole("button", { name: "Call $42.55" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Raise" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bet" })).toBeNull();
  });

  it("renders nothing actionable for an empty menu", () => {
    renderBar({ legal: {} });
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bet" })).toBeNull();
  });

  it("fires the callback the menu implies", () => {
    const { onCheck, onCall, onFold } = renderBar({ legal: CHECK_MENU });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    expect(onFold).toHaveBeenCalledTimes(1);
    expect(onCall).not.toHaveBeenCalled();
  });

  it("calls with the exact amount from the menu, never a recomputed one", () => {
    const { onCall } = renderBar({ legal: CALL_MENU });
    fireEvent.click(screen.getByRole("button", { name: "Call $4.60" }));
    expect(onCall).toHaveBeenCalledWith(460);
  });
});

/* --- expand in place ------------------------------------------------------ */

describe("expands in place", () => {
  it("toggles the sizing state without unmounting the bar", () => {
    const { bar } = renderBar();
    const before = bar();
    expect(before.hasAttribute("data-expanded")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    const during = bar();
    expect(during).toBe(before); // same node — the bar is never rebuilt
    expect(during.hasAttribute("data-expanded")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back to actions" }));
    const after = bar();
    expect(after).toBe(before);
    expect(after.hasAttribute("data-expanded")).toBe(false);
  });

  it("keeps both rows mounted so the bar's footprint cannot jump", () => {
    const { bar } = renderBar();
    const rows = () => bar().querySelectorAll("[data-hero-row]");
    expect(rows()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    expect(rows()).toHaveLength(2);
    expect(bar().querySelector('[data-hero-row="resting"]')).not.toBeNull();
  });

  it("opens exactly one extra row — the slider — and closes it again", () => {
    const { bar } = renderBar();
    expect(bar().querySelector("[data-hero-slider-row]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    expect(bar().querySelector("[data-hero-slider-row]")).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Bet size" })).not.toBeNull();
  });

  it("reports expansion to its owner", () => {
    const onExpandedChange = vi.fn();
    renderBar({ onExpandedChange });
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to actions" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("closes when the menu goes away under it", () => {
    const { bar, rerender } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    expect(bar().hasAttribute("data-expanded")).toBe(true);

    rerender(<ActionBar legal={{}} presets={PRESETS} bigBlindCents={25} />);
    expect(bar().hasAttribute("data-expanded")).toBe(false);
  });
});

/* --- the suggestion ------------------------------------------------------- */

describe("the suggested size", () => {
  it("is pre-highlighted the moment the bar expands", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));

    const suggested = screen.getByRole("button", { name: /50%/ });
    expect(suggested.getAttribute("aria-pressed")).toBe("true");
    expect(suggested.dataset["suggested"]).toBe("");
    expect(screen.getByText("suggested")).not.toBeNull();
  });

  it("is the only armed chip", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    const armed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(armed).toHaveLength(1);
  });

  it("puts its amount on the commit button, so the fast path is two taps", () => {
    const { onCommit } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    fireEvent.click(screen.getByRole("button", { name: "Bet $9.20" }));
    expect(onCommit).toHaveBeenCalledWith(920);
  });

  it("falls back to the first preset when nothing is suggested", () => {
    const { onCommit } = renderBar({ presets: PRESETS.map(({ suggested: _s, ...rest }) => rest) });
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    fireEvent.click(screen.getByRole("button", { name: "Bet $6.10" }));
    expect(onCommit).toHaveBeenCalledWith(610);
  });
});

/* --- the keyboard --------------------------------------------------------- */

describe("the keyboard is the fast lane", () => {
  it("B → 2 → Enter commits the 50% size", () => {
    const { bar, onCommit } = renderBar();

    fireEvent.keyDown(bar(), { key: "b" });
    expect(bar().hasAttribute("data-expanded")).toBe(true);

    fireEvent.keyDown(bar(), { key: "2" });
    expect(screen.getByRole("button", { name: /50%/ }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(920);
    expect(bar().hasAttribute("data-expanded")).toBe(false);
  });

  it("B → 4 → Enter commits pot", () => {
    const { bar, onCommit } = renderBar();
    fireEvent.keyDown(bar(), { key: "B" });
    fireEvent.keyDown(bar(), { key: "4" });
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(1840);
  });

  it("F folds and C checks from the resting state", () => {
    const { bar, onFold, onCheck } = renderBar();
    fireEvent.keyDown(bar(), { key: "f" });
    expect(onFold).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(bar(), { key: "c" });
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("C is one key: it calls when there is a bet in front", () => {
    const { bar, onCall, onCheck } = renderBar({ legal: CALL_MENU });
    fireEvent.keyDown(bar(), { key: "c" });
    expect(onCall).toHaveBeenCalledWith(460);
    expect(onCheck).not.toHaveBeenCalled();
  });

  it("ignores keys whose action the menu does not allow", () => {
    const { bar, onCheck, onCommit } = renderBar({ legal: CALL_ONLY_MENU });
    fireEvent.keyDown(bar(), { key: "b" });
    expect(bar().hasAttribute("data-expanded")).toBe(false);
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onCheck).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("arrows nudge by one big blind and clear the preset", () => {
    const { bar, onCommit } = renderBar();
    fireEvent.keyDown(bar(), { key: "b" }); // armed at $9.20
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /50%/ }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    fireEvent.keyDown(bar(), { key: "ArrowLeft" });
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(945); // 920 + 25
  });

  it("clamps a nudge to the legal interval", () => {
    const { bar, onCommit } = renderBar({
      legal: { fold: true, check: true, bet: { min: 900, max: 930 } },
    });
    fireEvent.keyDown(bar(), { key: "b" });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(bar(), { key: "ArrowLeft" });
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(900);
  });

  it("Escape goes back without committing", () => {
    const { bar, onCommit } = renderBar();
    fireEvent.keyDown(bar(), { key: "b" });
    fireEvent.keyDown(bar(), { key: "Escape" });
    expect(bar().hasAttribute("data-expanded")).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("holds the map while ? is down, and drops it on release", () => {
    const { bar } = renderBar();
    expect(screen.queryByRole("note", { name: "Keyboard map" })).toBeNull();

    fireEvent.keyDown(bar(), { key: "?" });
    const map = screen.getByRole("note", { name: "Keyboard map" });
    expect(map.textContent).toContain("fold");
    expect(map.textContent).toContain("commit");

    fireEvent.keyUp(bar(), { key: "?" });
    expect(screen.queryByRole("note", { name: "Keyboard map" })).toBeNull();
  });

  it("does not steal keys from the type-in field", () => {
    const { bar, onCommit } = renderBar();
    fireEvent.keyDown(bar(), { key: "b" });
    const field = screen.getByRole("textbox", { name: "Bet amount" });

    fireEvent.keyDown(field, { key: "3" });
    expect(screen.getByRole("button", { name: /66%/ }).getAttribute("aria-pressed")).toBe("false");

    // …but Enter still commits from inside the field.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("leaves modified keys to the browser", () => {
    const { bar, onFold } = renderBar();
    fireEvent.keyDown(bar(), { key: "f", metaKey: true });
    expect(onFold).not.toHaveBeenCalled();
  });

  it("does nothing at all when disabled", () => {
    const { bar, onFold, onCommit } = renderBar({ disabled: true });
    fireEvent.keyDown(bar(), { key: "f" });
    fireEvent.keyDown(bar(), { key: "b" });
    expect(onFold).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(bar().hasAttribute("data-expanded")).toBe(false);
  });
});

/* --- pointer sizing ------------------------------------------------------- */

describe("pointer sizing", () => {
  it("arms a chip on click and commits its amount", () => {
    const { onCommit } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    fireEvent.click(screen.getByRole("button", { name: /All-in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bet $42.55" }));
    expect(onCommit).toHaveBeenCalledWith(4255);
  });

  it("takes a slider value in integer cents", () => {
    const { onCommit } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    fireEvent.change(screen.getByRole("slider", { name: "Bet size" }), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet $12.34" }));
    expect(onCommit).toHaveBeenCalledWith(1234);
  });

  it("takes a typed amount and clamps it to the legal interval", () => {
    const { onCommit } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    const field = screen.getByRole("textbox", { name: "Bet amount" });

    fireEvent.change(field, { target: { value: "15.75" } });
    expect((field as HTMLInputElement).value).toBe("15.75");

    fireEvent.change(field, { target: { value: "999.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet $42.55" }));
    expect(onCommit).toHaveBeenCalledWith(4255);
  });

  it("raises TO the total, using the raise interval", () => {
    const { onCommit } = renderBar({ legal: CALL_MENU });
    fireEvent.click(screen.getByRole("button", { name: "Raise" }));
    const slider = screen.getByRole("slider", { name: "Bet size" });
    expect(slider.getAttribute("min")).toBe("920");
    expect(slider.getAttribute("max")).toBe("4255");
    fireEvent.click(screen.getByRole("button", { name: "Raise to $9.20" }));
    expect(onCommit).toHaveBeenCalledWith(920);
  });
});

/* --- a11y ----------------------------------------------------------------- */

describe("accessibility", () => {
  it("names the zone and every control", () => {
    renderBar();
    expect(screen.getByRole("group", { name: "Your action" })).not.toBeNull();
    for (const name of ["Fold", "Check", "Bet"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-keyshortcuts")).not.toBeNull();
    }
  });

  it("keeps every visible control in the tab order and focusable", () => {
    const { bar } = renderBar();
    const focusables = () =>
      Array.from(bar().querySelectorAll<HTMLElement>("button, input")).filter((el) => !el.hasAttribute("disabled"));

    for (const el of focusables()) {
      expect(Number(el.getAttribute("tabindex") ?? "0")).toBeGreaterThanOrEqual(0);
      el.focus();
      expect(document.activeElement).toBe(el);
    }

    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    const expandedControls = focusables();
    expect(expandedControls.length).toBeGreaterThan(3);
    for (const el of expandedControls) {
      el.focus();
      expect(document.activeElement).toBe(el);
    }
  });

  it("points the aggressive control at the sizing row it opens", () => {
    renderBar();
    const bet = screen.getByRole("button", { name: "Bet" });
    expect(bet.getAttribute("aria-expanded")).toBe("false");
    const controls = bet.getAttribute("aria-controls");
    expect(controls).not.toBeNull();
    expect(document.getElementById(controls as string)).not.toBeNull();
  });

  it("speaks the slider's value as a price, not a cent count", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Bet" }));
    expect(screen.getByRole("slider", { name: "Bet size" }).getAttribute("aria-valuetext")).toBe("$9.20");
  });

  it("renders the hero, coach and price slots it is given", () => {
    renderBar({
      hero: <span data-testid="hero-slot" />,
      coach: <span data-testid="coach-slot" />,
      price: <span data-testid="price-slot" />,
    });
    expect(screen.getByTestId("hero-slot")).not.toBeNull();
    expect(screen.getByTestId("coach-slot")).not.toBeNull();
    expect(screen.getByTestId("price-slot")).not.toBeNull();
  });
});
