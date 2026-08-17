// @vitest-environment jsdom
/**
 * The atoms: what they render, what states they expose, and what assistive
 * tech gets told. Not pixels — the stylesheet has its own guard
 * (`components.css.test.ts`).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AmountField } from "./AmountField";
import { Kbd } from "./Kbd";
import { Pill } from "./Pill";
import { SizeChip } from "./SizeChip";
import { Slider } from "./Slider";

afterEach(cleanup);

/*
 * `Button` is authored and tested alongside `Button.css` in its own files —
 * this suite covers the atoms that have no home elsewhere. The hero zone
 * (`packages/table-ui/src/hero`) exercises Button in the composition that
 * actually matters: three action controls, all tabbable, all keyboard-driven.
 */

describe("Pill", () => {
  it("renders its label and tone", () => {
    render(<Pill tone="accent">Guided</Pill>);
    const pill = screen.getByText("Guided");
    expect(pill.dataset["tone"]).toBe("accent");
    expect(pill.className).toContain("fr-pill--accent");
  });

  it("is not interactive — a pill is never a button", () => {
    render(<Pill>Turn</Pill>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds tabular numerals when it carries an amount", () => {
    render(<Pill numeric>$18.40</Pill>);
    expect(screen.getByText("$18.40").className).toContain("fr-num");
  });

  it("announces politely only when asked", () => {
    const { unmount } = render(<Pill live>Pot $18.40</Pill>);
    expect(screen.getByRole("status").textContent).toBe("Pot $18.40");
    unmount();

    render(<Pill>Pot $18.40</Pill>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders a leading swatch slot", () => {
    render(<Pill leading={<span data-testid="swatch" />}>Afterhours</Pill>);
    expect(screen.getByTestId("swatch")).not.toBeNull();
  });
});

describe("SizeChip", () => {
  it("renders the size over the money it means", () => {
    render(<SizeChip label="50%" sublabel="$9.20" />);
    const chip = screen.getByRole("button", { name: /50%/ });
    expect(chip.textContent).toContain("50%");
    expect(chip.textContent).toContain("$9.20");
  });

  it("reports selection as aria-pressed", () => {
    const { rerender } = render(<SizeChip label="50%" />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");

    rerender(<SizeChip label="50%" selected />);
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain("fr-sizechip--on");
  });

  it("floats a suggested tag", () => {
    render(<SizeChip label="50%" sublabel="$9.20" suggested />);
    const chip = screen.getByRole("button", { name: /50%/ });
    expect(chip.dataset["suggested"]).toBe("");
    expect(screen.getByText("suggested")).not.toBeNull();
  });

  it("fires onSelect, and does not when disabled", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<SizeChip label="Pot" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<SizeChip label="Pot" onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("puts tabular numerals on both lines", () => {
    render(<SizeChip label="33%" sublabel="$6.10" />);
    expect(screen.getByText("33%").className).toContain("fr-num");
    expect(screen.getByText("$6.10").className).toContain("fr-num");
  });
});

describe("Kbd", () => {
  it("is hidden from assistive tech by default", () => {
    render(<Kbd>F</Kbd>);
    expect(screen.getByText("F").getAttribute("aria-hidden")).toBe("true");
  });

  it("can be exposed for a standalone legend", () => {
    render(<Kbd decorative={false}>Esc</Kbd>);
    expect(screen.getByText("Esc").getAttribute("aria-hidden")).toBeNull();
  });
});

describe("Slider", () => {
  it("exposes the native slider role with a name and a spoken value", () => {
    render(
      <Slider value={920} min={100} max={4255} onValueChange={() => {}} aria-label="Bet size" aria-valuetext="$9.20" />,
    );
    const slider = screen.getByRole("slider", { name: "Bet size" });
    expect(slider.getAttribute("aria-valuetext")).toBe("$9.20");
    expect(slider.getAttribute("min")).toBe("100");
    expect(slider.getAttribute("max")).toBe("4255");
  });

  it("reports changes in integer cents", () => {
    const onValueChange = vi.fn();
    render(<Slider value={920} min={100} max={4255} onValueChange={onValueChange} aria-label="Bet size" />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1500" } });
    expect(onValueChange).toHaveBeenCalledWith(1500);
  });

  it("hands the fill ratio to CSS as a custom property", () => {
    render(<Slider value={1000} min={0} max={2000} onValueChange={() => {}} aria-label="Bet size" />);
    const slider = screen.getByRole("slider");
    expect(slider.style.getPropertyValue("--fr-fill")).toBe("0.5000");
  });
});

describe("AmountField", () => {
  it("is a named text field with a decimal keypad", () => {
    render(<AmountField value="9.20" onValueChange={() => {}} aria-label="Bet amount" />);
    const input = screen.getByRole("textbox", { name: "Bet amount" });
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect((input as HTMLInputElement).value).toBe("9.20");
  });

  it("reports raw display strings and leaves parsing to its owner", () => {
    const onValueChange = vi.fn();
    render(<AmountField value="9.20" onValueChange={onValueChange} aria-label="Bet amount" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "12.5" } });
    expect(onValueChange).toHaveBeenCalledWith("12.5");
  });

  it("hides the currency prefix from the accessible name", () => {
    render(<AmountField value="9.20" onValueChange={() => {}} aria-label="Bet amount" />);
    expect(screen.getByText("$").getAttribute("aria-hidden")).toBe("true");
  });
});
