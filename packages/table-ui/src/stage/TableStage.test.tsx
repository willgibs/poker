// @vitest-environment jsdom
/**
 * The stage's four promises, against the engine's own committed 6-max hand
 * (`packages/engine/test/fixtures/hand6max.golden.json` — the same log the
 * engine's golden replay pins, so the renderer and the reducer are tested on
 * one artefact and cannot drift apart).
 *
 *   1. it renders a view-model — seats, board and pot, by role and label;
 *   2. **flush-equivalence at the DOM**: playing the hand out on a manual clock
 *      lands on the same markup as rendering the settled view-model directly.
 *      This is beats.md §5.3's interrupt policy, asserted where a player would
 *      notice it breaking rather than where it is easy to assert;
 *   3. `instant` needs exactly one flush and zero frames;
 *   4. reduce-motion consumes no beat that moves anything through space, and
 *      therefore never puts an element in the air.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { HandEvent, HandStart } from "@poker/history";

import type { Beat } from "../beats";
import { hasTranslation } from "../beats";
import { TableStage } from "./TableStage";
import { manualClock } from "./clock";
import type { StageHandle } from "./useStagePresenter";
import type { SeatIdentity, TableStageView } from "./view";
import { applyBeats, viewFromStart } from "./view";

afterEach(cleanup);

/* --- the fixture ---------------------------------------------------------- */

// Path arithmetic, not `new URL(rel, import.meta.url)`: under jsdom the global
// `URL` resolves relative references against the document's origin, not the
// module's file: URL, and the fixture would be looked for on localhost.
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../engine/test/fixtures/hand6max.golden.json",
);

/**
 * The log is validated by `packages/engine/test/golden.test.ts` and structurally
 * by `validateEvents`; re-checking it here would test the fixture, not the
 * stage. The cast is the file's own contract.
 */
const EVENTS = JSON.parse(readFileSync(FIXTURE, "utf8")) as HandEvent[];

const START = EVENTS[0] as HandStart;
const HERO_SEAT = 1;

/** Slot order: the hero's chair first, then clockwise. */
const IDENTITIES: readonly SeatIdentity[] = [
  { seat: 1, name: "Hero", hero: true },
  { seat: 2, name: "Barry" },
  { seat: 3, name: "Doris" },
  { seat: 4, name: "Hank" },
  { seat: 5, name: "Priya" },
  { seat: 6, name: "Silas" },
];

function baseView(): TableStageView {
  return viewFromStart(START, IDENTITIES, 6);
}

/* --- DOM comparison ------------------------------------------------------- */

/**
 * A structural snapshot of the felt: every element the kit tags with `data-fr`,
 * its attributes, and its text.
 *
 * `style` is excluded on purpose — it is `motion`'s scratch space, and two
 * renders of the same settled view legitimately differ in how far through an
 * entrance spring they are on the frame the snapshot was taken. `id` and
 * `aria-controls` are excluded because `useId()` counts mounts. What is left is
 * everything a player or a screen reader can actually perceive.
 */
const VOLATILE = new Set(["style", "id", "aria-controls"]);

function sceneSnapshot(root: HTMLElement): string {
  return [...root.querySelectorAll("[data-fr]")]
    .map((el) => {
      const attrs = [...el.attributes]
        .filter((attr) => !VOLATILE.has(attr.name))
        .map((attr) => `${attr.name}="${attr.value}"`)
        .sort()
        .join(" ");
      return `${el.tagName.toLowerCase()} ${attrs} :: ${(el.textContent ?? "").trim()}`;
    })
    .join("\n");
}

/* --- harness -------------------------------------------------------------- */

interface Playback {
  readonly handle: StageHandle;
  readonly container: HTMLElement;
  readonly beats: readonly Beat[];
  readonly settled: readonly Beat[];
  /** One frame of `ms`. */
  advance(ms: number): void;
  advanceToSettled(): void;
  unmount(): void;
}

interface PlayOptions {
  readonly speed?: 0.5 | 1 | 2 | 3 | "instant";
  readonly reduceMotion?: boolean;
  /** Enqueue nothing — a static scene. */
  readonly view?: TableStageView;
}

/** Mount the stage on a hand-driven clock and hand back the controls. */
function mountHand(options: PlayOptions = {}): Playback {
  const clock = manualClock();
  const ref = createRef<StageHandle>();
  const settled: Beat[] = [];

  const { container, unmount } = render(
    <TableStage
      ref={ref}
      view={options.view ?? baseView()}
      clock={clock}
      speed={options.speed ?? 1}
      reduceMotion={options.reduceMotion ?? false}
      onBeat={(event) => {
        if (event.phase === "settle") settled.push(event.beat);
      }}
    />,
  );

  const handle = ref.current;
  if (handle === null) throw new Error("stage handle never arrived");

  let beats: readonly Beat[] = [];
  act(() => {
    beats = handle.enqueue(EVENTS);
  });

  return {
    handle,
    container,
    get beats() {
      return beats;
    },
    settled,
    advance(ms) {
      act(() => {
        clock.advance(ms);
      });
    },
    advanceToSettled() {
      // Frame by frame, like the real thing: a 16ms rAF cadence, never a single
      // jump — the whole point is that the projection survives being sampled.
      const finish = handle.horizon() + 32;
      act(() => {
        while (handle.time() < finish) clock.advance(16);
      });
    },
    unmount,
  };
}

/** Render a settled view-model with nothing driving it. */
function renderStatic(view: TableStageView): HTMLElement {
  const { container } = render(<TableStage view={view} clock={manualClock()} speed={1} reduceMotion={false} />);
  return container;
}

/* --- 1. the view-model renders ------------------------------------------- */

describe("TableStage — the 6-max fixture, rendered", () => {
  it("seats the whole table, hero first, with names and stacks", () => {
    renderStatic(baseView());

    for (const name of ["Hero", "Barry", "Doris", "Hank", "Priya", "Silas"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${name}, \\$100\\.00`) })).toBeDefined();
    }
    expect(document.querySelectorAll('[data-fr="stage-seat"]')).toHaveLength(6);
  });

  it("puts every seat in its density's slot, hero in slot 0", () => {
    renderStatic(baseView());
    const seats = [...document.querySelectorAll('[data-fr="stage-seat"]')];
    expect(seats.map((el) => el.getAttribute("data-slot"))).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(seats[0]?.getAttribute("data-seat")).toBe(String(HERO_SEAT));
    expect(seats[0]?.className).toContain("fr-stage-slot-0");
  });

  it("marks the button seat and only that seat", () => {
    renderStatic(baseView());
    const buttons = screen.getAllByRole("img", { name: /dealer button/i });
    expect(buttons).toHaveLength(1);
    // The fixture's button is seat 3 — Doris.
    expect(buttons[0]?.getAttribute("aria-label")).toBe("dealer button, Doris");
  });

  it("reads the settled board and pot out loud", () => {
    const play = mountHand();
    play.advanceToSettled();

    expect(
      screen.getByRole("group", {
        name: "board: ace of spades, ten of spades, two of hearts, six of hearts, three of hearts",
      }),
    ).toBeDefined();
    // The pot has been pushed to the winner: the pill stays, quiet, at zero.
    expect(screen.getByRole("status", { name: "Pot $0.00" })).toBeDefined();
    play.unmount();
  });

  it("shows the showdown hands face-up and the folders folded", () => {
    const play = mountHand();
    play.advanceToSettled();

    // Seats 1 and 2 reached showdown; 3, 4 and 6 folded preflop, 5 on the flop.
    const folded = [...document.querySelectorAll('[data-fr="stage-seat"]')].filter(
      (el) => el.querySelector('[data-folded="true"]') !== null,
    );
    expect(folded.map((el) => el.getAttribute("data-seat")).sort()).toEqual(["3", "4", "5", "6"]);

    expect(screen.getByRole("img", { name: "ace of spades" })).toBeDefined();
    expect(screen.getByRole("img", { name: "king of spades" })).toBeDefined();
    play.unmount();
  });
});

/* --- 2. flush-equivalence, at the DOM ------------------------------------ */

describe("TableStage — playback lands where the view-model says", () => {
  it("plays the whole hand frame by frame into the settled markup", () => {
    const play = mountHand();
    play.advanceToSettled();

    expect(play.handle.pending()).toBe(0);
    const played = sceneSnapshot(play.container);
    const settledView = applyBeats(baseView(), play.beats);
    play.unmount();

    expect(sceneSnapshot(renderStatic(settledView))).toBe(played);
  });

  it("lands on the same markup when the hand is flushed mid-air", () => {
    const play = mountHand();
    // Somewhere in the middle of the deal, with cards still travelling.
    play.advance(320);
    expect(play.container.querySelectorAll('[data-fr="stage-flight"]').length).toBeGreaterThan(0);
    act(() => {
      play.handle.flush();
    });

    expect(play.handle.pending()).toBe(0);
    const flushed = sceneSnapshot(play.container);
    const settledView = applyBeats(baseView(), play.beats);
    play.unmount();

    expect(sceneSnapshot(renderStatic(settledView))).toBe(flushed);
  });

  it("settles every beat exactly once, in settle order", () => {
    const play = mountHand();
    play.advanceToSettled();

    expect(play.settled).toHaveLength(play.beats.length);
    expect(new Set(play.settled).size).toBe(play.beats.length);
    const ends = play.settled.map((beat) => beat.at + beat.duration);
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
    play.unmount();
  });
});

/* --- 3. instant ---------------------------------------------------------- */

describe("TableStage — instant", () => {
  it("settles the whole hand in one flush, without a single frame", () => {
    const play = mountHand({ speed: "instant" });
    expect(play.handle.pending()).toBeGreaterThan(0);

    act(() => {
      play.handle.flush();
    });

    expect(play.handle.pending()).toBe(0);
    // The clock never moved: no frame was needed to reach the settled state.
    expect(play.handle.time()).toBe(0);

    const flushed = sceneSnapshot(play.container);
    const settledView = applyBeats(baseView(), play.beats);
    play.unmount();
    expect(sceneSnapshot(renderStatic(settledView))).toBe(flushed);
  });

  it("keeps only the traces — the schedule collapses to a fraction of 1x", () => {
    const fast = mountHand({ speed: "instant" });
    const fastHorizon = fast.handle.horizon();
    fast.unmount();

    const paced = mountHand({ speed: 1 });
    const pacedHorizon = paced.handle.horizon();
    paced.unmount();

    expect(fastHorizon).toBeGreaterThan(0); // pot award and showdown keep a trace
    expect(fastHorizon).toBeLessThan(pacedHorizon / 10);
  });
});

/* --- 4. reduce-motion ---------------------------------------------------- */

describe("TableStage — reduce-motion", () => {
  it("consumes no beat that moves anything through space", () => {
    const play = mountHand({ reduceMotion: true });
    play.advanceToSettled();

    expect(play.settled.length).toBeGreaterThan(20);
    expect(play.settled.filter(hasTranslation).map((beat) => beat.kind)).toEqual([]);
    // …and it is the same hand, not a shorter one: the beats that would have
    // travelled are all still here, fading in place instead.
    const kinds = new Set(play.settled.map((beat) => beat.kind));
    for (const kind of ["deal-hole", "chips-out", "chips-collect", "fold-muck", "pot-award"]) {
      expect(kinds.has(kind as Beat["kind"])).toBe(true);
    }
    play.unmount();
  });

  it("never puts an element in the air, at any frame of the hand", () => {
    const play = mountHand({ reduceMotion: true });
    const frames = Math.ceil(play.handle.horizon() / 16) + 2;
    for (let i = 0; i < frames; i++) {
      play.advance(16);
      expect(play.container.querySelectorAll('[data-fr="stage-flight"]')).toHaveLength(0);
    }
    expect(play.handle.pending()).toBe(0);
    play.unmount();
  });

  it("does put elements in the air when motion is allowed — the control", () => {
    const play = mountHand({ reduceMotion: false });
    let sawFlight = false;
    for (let i = 0; i < 60 && !sawFlight; i++) {
      play.advance(16);
      sawFlight = play.container.querySelectorAll('[data-fr="stage-flight"]').length > 0;
    }
    expect(sawFlight).toBe(true);
    play.unmount();
  });
});
