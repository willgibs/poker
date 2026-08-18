/**
 * `/replay/demo` — one hand, played by the Presenter.
 *
 * The hand is not a mock: it is `packages/engine/test/fixtures/hand6max.golden.json`,
 * the committed event log the engine's own golden replay is pinned to. Antes, a
 * preflop raise, a multiway flop, two barrels, a river bluff picked off at
 * showdown — every event type in the v1 format, on one felt.
 *
 * That choice is the point of the route. If the renderer and the engine ever
 * disagree about what a hand *is*, this page shows it: no fixture written for
 * the UI's convenience sits between them.
 *
 * The controls are the Presenter's own vocabulary — play/pause is whether the
 * clock is sampled, speed is the `S` in beats.md's speed model, restart drops
 * the queue and re-enqueues. Changing speed restarts the hand: a schedule is
 * built at one speed, and re-timing beats already in the air would be a
 * different (and much less honest) feature than the one this page demonstrates.
 *
 * Keep the export named `ReplayDemoRoute` — `router.ts` imports it by name.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Pill, SizeChip } from "@poker/ui";
import { BARRY, DORIS, HANK, PRIYA, SILAS } from "@poker/bots";
import { TableStage, viewFromStart } from "@poker/table-ui";
import type { SeatIdentity, Speed, StageHandle, TableStageView } from "@poker/table-ui";
import type { HandEvent, HandStart } from "@poker/history";

import "@poker/table-ui/components.css";
import "@poker/table-ui/stage.css";
import "./replay.demo.css";

// The workspace's own fixture, imported as data. Vite inlines it; the cast is
// the file's contract — `packages/engine/test/golden.test.ts` is what keeps the
// file honest, and re-validating it here would test the fixture, not the page.
import golden from "../../../../packages/engine/test/fixtures/hand6max.golden.json";

const EVENTS = golden as unknown as readonly HandEvent[];
const START = EVENTS[0] as HandStart;

/**
 * Seats in slot order — the hero's chair first, then clockwise. Names come from
 * the cast configs themselves (`@poker/bots`), not from string literals, so a
 * character renamed in their bible is renamed on the felt.
 */
const IDENTITIES: readonly SeatIdentity[] = [
  { seat: 1, name: "Hero", hero: true },
  { seat: 2, name: BARRY.name },
  { seat: 3, name: DORIS.name, earnedRead: true },
  { seat: 4, name: HANK.name },
  { seat: 5, name: PRIYA.name },
  { seat: 6, name: SILAS.name },
];

const SPEEDS: readonly { readonly value: Speed; readonly label: string }[] = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 3, label: "3×" },
  { value: "instant", label: "Instant" },
];

/**
 * The pre-deal felt. Immutable and shared: `applyBeat` never mutates, so every
 * restart re-bases on the same object and cannot inherit the last run's chips.
 */
const BASE_VIEW: TableStageView = viewFromStart(START, IDENTITIES, 6);

export function ReplayDemoRoute() {
  const stage = useRef<StageHandle>(null);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(true);
  /** Bumped to re-run the same hand; also the effect's restart trigger. */
  const [run, setRun] = useState(0);

  useEffect(() => {
    const handle = stage.current;
    if (handle === null) return;
    handle.reset(BASE_VIEW);
    handle.enqueue(EVENTS);
  }, [run, speed]);

  const restart = useCallback(() => {
    setPlaying(true);
    setRun((n) => n + 1);
  }, []);

  return (
    <div className="replay">
      <header className="replay__intro">
        <p className="replay__kicker">Replay</p>
        <h1 className="replay__title">One hand, beat by beat.</h1>
        <p className="replay__body">
          The engine&apos;s committed 6-max golden hand, scheduled by the Presenter and played onto the felt.
        </p>
      </header>

      <div className="replay__controls" role="group" aria-label="Replay controls">
        <Button variant="quiet" size="sm" onClick={() => setPlaying((on) => !on)}>
          {playing ? "Pause" : "Play"}
        </Button>
        <Button variant="ghost" size="sm" onClick={restart}>
          Restart
        </Button>

        <span className="replay__speeds" role="group" aria-label="Speed">
          {SPEEDS.map((option) => (
            <SizeChip
              key={String(option.value)}
              label={option.label}
              selected={speed === option.value}
              onSelect={() => {
                setPlaying(true);
                setSpeed(option.value);
              }}
            />
          ))}
        </span>

        <Pill tone={playing ? "accent" : "neutral"} live>
          {playing ? "Playing" : "Paused"}
        </Pill>
      </div>

      <TableStage ref={stage} view={BASE_VIEW} speed={speed} paused={!playing} label="replay table" />
    </div>
  );
}
