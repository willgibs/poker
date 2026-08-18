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

    expect(await screen.findByRole("group", { name: /table, four-handed to the turn/i })).toBeInTheDocument();
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

describe("/table — the felt", () => {
  it("mounts table.html's scene: six seats, the turn, the pot", async () => {
    renderAt("/table");

    expect(await screen.findByRole("group", { name: /table, four-handed to the turn/i })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "board: queen of hearts, seven of diamonds, two of clubs, king of diamonds" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Pot $18.40" })).toBeInTheDocument();
    for (const name of ["Hero", "Barry", "Doris", "Rocco", "Priya", "Silas"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${name}, \\$`) })).toBeInTheDocument();
    }
  });

  it("arms the action bar from the fixture's legal menu, one gradient only", async () => {
    renderAt("/table");

    expect(await screen.findByRole("button", { name: /^fold/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /call \$4\.60/i })).toBeEnabled();
    const primary = screen.getAllByRole("button").filter((btn) => btn.dataset["variant"] === "primary");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAccessibleName(/^raise/i);
  });

  it("holds the one coach line and the one price chip in the same strip", async () => {
    renderAt("/table");

    expect(await screen.findByText(/the king changes less than it looks/i)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-coach-slot]")).toHaveLength(1);
    expect(screen.getByText("Call $4.60 · 3.4 : 1 · need 23%")).toBeInTheDocument();
  });

  it("keeps the header to its four slots", async () => {
    renderAt("/table");
    await screen.findByRole("group", { name: /table, four-handed to the turn/i });
    expect(document.querySelectorAll("[data-header-slot]")).toHaveLength(4);
  });
});

describe("/replay/demo — the golden hand", () => {
  it("mounts the felt and the Presenter's controls", async () => {
    renderAt("/replay/demo");

    expect(await screen.findByRole("heading", { level: 1, name: /one hand, beat by beat/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /replay table/i })).toBeInTheDocument();

    const controls = screen.getByRole("group", { name: /replay controls/i });
    expect(within(controls).getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: /restart/i })).toBeInTheDocument();

    const speeds = within(controls).getByRole("group", { name: /^speed$/i });
    for (const label of ["0.5×", "1×", "2×", "3×", "Instant"]) {
      expect(within(speeds).getByRole("button", { name: new RegExp(label.replace(".", "\\.")) })).toBeInTheDocument();
    }
  });

  it("seats the cast the fixture's six seats map to", async () => {
    renderAt("/replay/demo");
    await screen.findByRole("group", { name: /replay table/i });

    for (const name of ["Hero", "Barry", "Doris", "Hank", "Priya", "Silas"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${name}, \\$`) })).toBeInTheDocument();
    }
  });

  it("toggles between playing and paused", async () => {
    renderAt("/replay/demo");
    const controls = await screen.findByRole("group", { name: /replay controls/i });

    expect(within(controls).getByRole("status")).toHaveTextContent("Playing");
    fireEvent.click(within(controls).getByRole("button", { name: /pause/i }));
    expect(within(controls).getByRole("status")).toHaveTextContent("Paused");
    fireEvent.click(within(controls).getByRole("button", { name: /play/i }));
    expect(within(controls).getByRole("status")).toHaveTextContent("Playing");
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
