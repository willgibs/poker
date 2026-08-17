// @vitest-environment jsdom
/**
 * The app shell: Home's cards and CTA count, the nav rail's links, the
 * placeholder routes mounting, and the a11y landmarks (skip link + nav).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAppRouter } from "./router";

beforeAll(() => {
  // jsdom does not implement scrollTo; TanStack Router's scroll restoration
  // calls it on every navigation. A no-op keeps test output free of noise
  // from a browser API this suite has no opinion about.
  window.scrollTo = () => {};
});

// vitest.config.ts does not set `test.globals`, so @testing-library/react's
// automatic per-test cleanup (which hooks a global `afterEach`) never
// registers — without this, every test in this file renders on top of the
// last one's leftover DOM, and later queries start matching duplicates.
afterEach(cleanup);

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<RouterProvider router={router} />);
}

/** The kicker text is intentionally echoed in the greeting/copy too — scope to the card. */
function getCardKicker(name: string) {
  return screen.getByText(
    (content, element) => content === name && element?.className === "play-card__kicker",
  );
}

describe("Home", () => {
  it("renders the greeting and all three play cards", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: /hey, hero/i })).toBeInTheDocument();
    expect(getCardKicker("Career")).toBeInTheDocument();
    expect(getCardKicker("Quick Seat")).toBeInTheDocument();
    expect(getCardKicker("Daily Puzzle")).toBeInTheDocument();
  });

  it("renders exactly one primary button — Quick Seat's CTA", async () => {
    renderAt("/");

    const dealMeIn = await screen.findByRole("button", { name: /deal me in/i });
    const continueCareer = screen.getByRole("button", { name: /coming in p3/i });
    const dailyPuzzle = screen.getByRole("button", { name: /coming soon/i });

    expect(dealMeIn).toBeEnabled();
    expect(continueCareer).toBeDisabled();
    expect(dailyPuzzle).toBeDisabled();

    const primaryButtons = screen.getAllByRole("button").filter((btn) => btn.dataset["variant"] === "primary");
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toBe(dealMeIn);
  });

  it("navigates to /table when Quick Seat's CTA is clicked", async () => {
    renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: /deal me in/i }));

    expect(await screen.findByText(/the felt is warming up/i)).toBeInTheDocument();
  });
});

describe("nav rail", () => {
  it("shows all six primary links plus Settings, each pointing at its route", async () => {
    renderAt("/");

    const primaryNav = await screen.findByRole("navigation", { name: /primary/i });
    const expected: Record<string, string> = {
      Home: "/",
      Train: "/train",
      Career: "/career",
      Players: "/players",
      Stats: "/stats",
      Study: "/study",
    };
    for (const [name, href] of Object.entries(expected)) {
      expect(within(primaryNav).getByRole("link", { name })).toHaveAttribute("href", href);
    }

    const accountNav = screen.getByRole("navigation", { name: /account/i });
    expect(within(accountNav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("marks Home as the active link on the Home route", async () => {
    renderAt("/");
    const homeLink = await screen.findByRole("link", { name: "Home" });
    expect(homeLink).toHaveAttribute("aria-current", "page");
  });

  it("renders a coach-voice empty state for a non-Home nav route", async () => {
    renderAt("/train");
    expect(await screen.findByRole("heading", { name: /drills aren.t dealt yet/i })).toBeInTheDocument();
  });
});

describe("placeholder routes", () => {
  it("mounts the /table felt placeholder", async () => {
    renderAt("/table");
    expect(await screen.findByText(/the felt is warming up/i)).toBeInTheDocument();
  });

  it("mounts the /replay/demo placeholder", async () => {
    renderAt("/replay/demo");
    expect(await screen.findByText(/a hand to study, soon/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has a skip-to-content link targeting the main landmark", async () => {
    renderAt("/");

    const skipLink = await screen.findByRole("link", { name: /skip to main content/i });
    expect(skipLink).toHaveAttribute("href", "#main-content");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it("exposes two labelled navigation landmarks", async () => {
    renderAt("/");
    expect(await screen.findByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /account/i })).toBeInTheDocument();
  });
});
