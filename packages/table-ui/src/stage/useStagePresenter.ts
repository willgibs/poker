/**
 * The wire between the Presenter and React.
 *
 * The Presenter is a queue of timed beats and nothing else: it does not know
 * what a seat looks like, and the felt does not know what time it is. This hook
 * is the only place the two meet.
 *
 *   engine events → presenter.enqueue → beats
 *   beat `start`  → flights mount (the travelling half)
 *   beat `settle` → `applyBeat` folds the view (the settled half), flights unmount
 *
 * Because the settled half is driven purely by `settle` — which `flush()` emits
 * for every pending beat, in exactly the order uninterrupted playback would
 * have (presenter.ts) — interrupting a hand at any frame lands on the same view
 * as watching it to the end. That is the whole interrupt policy, and it is the
 * property the stage's flush-equivalence test pins at the DOM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HandEvent } from "@poker/history";
import type { Beat } from "../beats";
import type { BeatEvent, Presenter } from "../presenter";
import { createPresenter } from "../presenter";
import type { ScheduleOptions } from "../schedule";
import type { Speed } from "../tokens";
import type { StageClock } from "./clock";
import type { FlightContext, StageFlight } from "./flights";
import { flightsForBeat } from "./flights";
import type { TableStageView } from "./view";
import { applyBeat } from "./view";

/** The stage's imperative surface: feed it a hand, interrupt it, re-base it. */
export interface StageHandle {
  /**
   * Schedule an engine event burst after everything already queued. Options
   * default to the stage's own `speed` / `reduceMotion` / hero seat.
   */
  enqueue(events: readonly HandEvent[], opts?: Partial<ScheduleOptions>): readonly Beat[];
  /** Queue pre-built beats (think pauses, banter, badge glints, mood shifts). */
  enqueueBeats(beats: readonly Beat[], anchor?: "now" | "tail" | "as-is" | number): readonly Beat[];
  /** Interrupt: every pending beat jumps to its settled end-state, in order. */
  flush(): void;
  /** Drop the queue and re-base the felt. Omit `view` to return to the prop. */
  reset(view?: TableStageView): void;
  /** Beats not yet settled. */
  pending(): number;
  /** Presenter clock, ms. */
  time(): number;
  /** Settle time of the last queued beat. */
  horizon(): number;
}

export interface UseStagePresenterOptions {
  /** The base view: what the felt shows until a beat says otherwise. */
  readonly view: TableStageView;
  readonly speed: Speed;
  readonly reduceMotion: boolean;
  readonly clock: StageClock;
  /** Stop sampling the clock. With `rafClock` this freezes time — it is pause. */
  readonly paused?: boolean;
  readonly heroSeat?: number;
  readonly backlogGuardMs?: number;
  /** Every beat phase, for sound, devtools or analytics. */
  readonly onBeat?: (event: BeatEvent) => void;
  /** Engine seat number → slot index, for the flight geometry. */
  readonly flightContext: FlightContext;
}

export interface StagePresenter {
  /** What to render: the base view until a hand is enqueued, the live one after. */
  readonly view: TableStageView;
  readonly flights: readonly StageFlight[];
  readonly handle: StageHandle;
}

export function useStagePresenter(options: UseStagePresenterOptions): StagePresenter {
  const [driven, setDriven] = useState(false);
  const [liveView, setLiveView] = useState<TableStageView>(options.view);
  const [flights, setFlights] = useState<readonly StageFlight[]>([]);

  // Latest-value refs: the presenter's callback outlives any one render, and a
  // beat must always be folded against the options in force *now*.
  const latest = useRef(options);
  latest.current = options;
  const drivenRef = useRef(false);

  /** Which beat launched which flights. Beats are objects, so a WeakMap fits. */
  const tokens = useRef(new WeakMap<Beat, string>());
  const tokenSeq = useRef(0);

  const onBeat = useCallback((event: BeatEvent) => {
    latest.current.onBeat?.(event);

    if (event.phase === "start") {
      // A flushed beat starts and settles in the same tick — mounting anything
      // for it would be a frame of motion nobody asked for.
      if (event.flushed) return;
      const launched = flightsForBeat(event.beat, latest.current.flightContext);
      if (launched.length === 0) return;
      // The token makes the id unique across concurrent beats that share a
      // group — twelve staggered hole cards are one group, twelve launches.
      const token = `f${++tokenSeq.current}`;
      tokens.current.set(event.beat, token);
      setFlights((prev) => [...prev, ...launched.map((flight) => ({ ...flight, id: `${token}:${flight.id}` }))]);
      return;
    }

    if (event.phase !== "settle") return;

    setLiveView((prev) => applyBeat(prev, event.beat));
    const token = tokens.current.get(event.beat);
    if (token !== undefined) {
      tokens.current.delete(event.beat);
      setFlights((prev) => prev.filter((flight) => !flight.id.startsWith(`${token}:`)));
    }
  }, []);

  const presenterRef = useRef<Presenter | null>(null);
  const makePresenter = useCallback(
    (): Presenter =>
      createPresenter({
        onBeat,
        now: () => latest.current.clock.now(),
        ...(latest.current.backlogGuardMs === undefined
          ? {}
          : { backlogGuardMs: latest.current.backlogGuardMs }),
      }),
    [onBeat],
  );
  if (presenterRef.current === null) presenterRef.current = makePresenter();

  // The frame loop. Unsubscribing freezes `rafClock`'s virtual time, so
  // `paused` needs no other machinery: the presenter simply stops being asked.
  const clock = options.clock;
  const paused = options.paused === true;
  useEffect(() => {
    if (paused) return;
    return clock.subscribe(() => {
      presenterRef.current?.tick();
    });
  }, [clock, paused]);

  const handle = useMemo<StageHandle>(
    () => ({
      enqueue(events, opts) {
        const current = latest.current;
        if (!drivenRef.current) {
          drivenRef.current = true;
          setDriven(true);
          setLiveView(current.view);
        }
        const presenter = presenterRef.current;
        if (presenter === null) return [];
        return presenter.enqueue(events, {
          speed: current.speed,
          reduceMotion: current.reduceMotion,
          ...(current.heroSeat === undefined ? {} : { heroSeat: current.heroSeat }),
          ...opts,
        });
      },
      enqueueBeats(beats, anchor) {
        return presenterRef.current?.enqueueBeats(beats, anchor) ?? [];
      },
      flush() {
        presenterRef.current?.flush();
      },
      reset(view) {
        // A fresh presenter rather than `flush()`: restarting a hand must not
        // emit the settles of the hand being abandoned.
        presenterRef.current = makePresenter();
        tokens.current = new WeakMap<Beat, string>();
        setFlights([]);
        if (view === undefined) {
          drivenRef.current = false;
          setDriven(false);
          setLiveView(latest.current.view);
          return;
        }
        drivenRef.current = true;
        setDriven(true);
        setLiveView(view);
      },
      pending() {
        return presenterRef.current?.pending() ?? 0;
      },
      time() {
        return presenterRef.current?.time() ?? 0;
      },
      horizon() {
        return presenterRef.current?.horizon() ?? 0;
      },
    }),
    [makePresenter],
  );

  return { view: driven ? liveView : options.view, flights, handle };
}
