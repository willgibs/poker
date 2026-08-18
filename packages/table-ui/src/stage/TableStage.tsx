/**
 * `TableStage` — the felt, assembled.
 *
 * Everything it draws already exists: `Felt`, `SeatPlate`, `Board`,
 * `PotDisplay`, `BetChips`, `DealerButton` from `../components`, `ActionBar`,
 * `CoachLine`, `PriceChip`, `HeroCards`, `TableHeader` from `../hero`. This
 * component contributes exactly two things those pieces cannot have on their
 * own:
 *
 *   1. **Geometry.** The open plan has no rail, so a seat's position is not
 *      implied by a shape — it is a coordinate. `geometry.ts` holds the three
 *      rings (2 / 6 / 9) and `stage.css` turns a slot index into
 *      `--fr-slot-x` / `--fr-slot-y`; the bet axis and the button derive from
 *      there. No element measures itself, and nothing writes an inline style.
 *   2. **Time.** Engine events arrive instantly; the Presenter turns them into
 *      timed beats, and this component renders both halves of one — the
 *      travelling half as a flight, the settled half as a fold into the view
 *      (`useStagePresenter`). Beats are the *only* way the view moves once a
 *      hand is enqueued, which is why an interrupt is just `flush()`.
 *
 * Props are a plain view-model plus handlers. The stage has no idea what is
 * legal, what a bet is worth, or who is winning — it renders decisions.
 *
 *   import "@poker/ui/tokens.css";
 *   import "@poker/ui/components.css";
 *   import "@poker/table-ui/components.css";
 *   import "@poker/table-ui/hero.css";
 *   import "@poker/table-ui/stage.css";
 */

import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { motion, useReducedMotion } from "motion/react";
import { formatCents } from "@poker/ui";
import type { BeatEvent } from "../presenter";
import type { Speed } from "../tokens";
import { Board, BetChips, DealerButton, Felt, PlayingCard, PotDisplay, SeatPlate } from "../components";
import { cx } from "../components/cx";
import { ActionBar, CoachLine, HeroCards, PriceChip, TableHeader } from "../hero";
import type { TableHeaderProps } from "../hero";
import type { StageClock } from "./clock";
import { rafClock } from "./clock";
import type { FlightContext } from "./flights";
import { anchorTransform, slotClass } from "./geometry";
import type { StageHandle } from "./useStagePresenter";
import { useStagePresenter } from "./useStagePresenter";
import type { StageSeat, TableStageView } from "./view";
import type { CardCode } from "../components";

export interface TableStageProps {
  /** The felt, as plain data. */
  readonly view: TableStageView;
  /** The four-slot table header, above the felt. Omit to render none. */
  readonly header?: TableHeaderProps;

  /** Global speed multiplier, fed straight to the Presenter. Default `1`. */
  readonly speed?: Speed;
  /** Defaults to the OS preference via `useReducedMotion()`. */
  readonly reduceMotion?: boolean;
  /** Time source. Defaults to a `requestAnimationFrame` adapter. */
  readonly clock?: StageClock;
  /** Stop sampling the clock — with `rafClock` this freezes the hand. */
  readonly paused?: boolean;
  /** Backlog above which an enqueue escalates a compression tier (beats.md §3). */
  readonly backlogGuardMs?: number;

  /** Every beat phase — the seam a sound layer or devtools overlay hangs on. */
  readonly onBeat?: (event: BeatEvent) => void;
  /** Handed the imperative surface once mounted. The alternative to `ref`. */
  readonly onStageReady?: (handle: StageHandle) => void;
  readonly ref?: Ref<StageHandle>;

  readonly onFold?: () => void;
  readonly onCheck?: () => void;
  readonly onCall?: (amountCents: number) => void;
  readonly onCommit?: (amountCents: number) => void;

  /** Accessible name for the felt. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Hole cards above the plate: backs while live, faces at showdown.
 *
 * The hero's pair normally lives in the hero zone, at 72px, where the decision
 * is made — so the chair stays empty. With no hero zone mounted (a replay, a
 * spectator view) the chair is the only place they can be, and they go there.
 */
function seatCards(seat: StageSeat, heroZone: boolean): ReactNode {
  if (seat.hero === true && heroZone) return null;
  const faces = seat.cards ?? [];
  const backs = Math.max(0, seat.faceDown ?? 0);
  if (faces.length === 0 && backs === 0) return null;
  return (
    <span className="fr-stage__hole" data-fr="seat-cards">
      {faces.map((card, i) => (
        <PlayingCard key={`face-${card}-${String(i)}`} card={card} size="hud" />
      ))}
      {Array.from({ length: backs }, (_, i) => (
        <PlayingCard key={`back-${String(i)}`} faceDown size="hud" />
      ))}
    </span>
  );
}

/** The hero's two cards, once both have landed. */
function heroPair(cards: readonly CardCode[] | null): readonly [CardCode, CardCode] | null {
  if (cards === null || cards.length < 2) return null;
  const [first, second] = cards;
  return first === undefined || second === undefined ? null : [first, second];
}

export function TableStage({
  view,
  header,
  speed = 1,
  reduceMotion,
  clock,
  paused = false,
  backlogGuardMs,
  onBeat,
  onStageReady,
  ref,
  onFold,
  onCheck,
  onCall,
  onCommit,
  label = "table",
  className,
}: TableStageProps): ReactElement {
  const osReduceMotion = useReducedMotion() === true;
  const reduced = reduceMotion ?? osReduceMotion;
  const defaultClock = useMemo(() => rafClock(), []);
  const activeClock = clock ?? defaultClock;

  /*
   * Flight geometry reads the *rendered* view, not the prop: after a
   * `handle.reset(nextView)` the seat ring can differ from the one the props
   * carry, and a chip must fly to the chair the player is looking at. Refs,
   * because `useStagePresenter` needs the context to produce the view it
   * describes — the cycle is broken by reading one render late, which is
   * exactly right: a beat launched now belongs to the table painted now.
   */
  const seatsRef = useRef(view.seats);
  const densityRef = useRef(view.density);
  const flightContext = useMemo<FlightContext>(
    () => ({
      get density() {
        return densityRef.current;
      },
      slotOf(seat) {
        const index = seatsRef.current.findIndex((entry) => entry.seat === seat);
        return index < 0 ? undefined : index;
      },
    }),
    [],
  );

  const stage = useStagePresenter({
    view,
    speed,
    reduceMotion: reduced,
    clock: activeClock,
    paused,
    flightContext,
    ...(view.hero === null ? {} : { heroSeat: view.hero.seat }),
    ...(backlogGuardMs === undefined ? {} : { backlogGuardMs }),
    ...(onBeat === undefined ? {} : { onBeat }),
  });

  const live = stage.view;
  seatsRef.current = live.seats;
  densityRef.current = live.density;

  useImperativeHandle(ref, () => stage.handle, [stage.handle]);
  useEffect(() => {
    onStageReady?.(stage.handle);
  }, [onStageReady, stage.handle]);

  const heroSeat = live.hero === null ? undefined : live.seats.find((s) => s.seat === live.hero?.seat);
  const action = live.actionState;

  return (
    <div className={cx("fr-stage", className)} data-fr="table-stage" data-fr-density={live.density}>
      {header === undefined ? null : <TableHeader {...header} />}

      <Felt density={live.density} label={label} className="fr-stage__felt">
        <div className="fr-stage__scene" data-fr="stage-scene" data-fr-density={live.density}>
          <div className="fr-stage__board" data-fr="stage-board">
            <Board cards={live.board} />
          </div>

          <PotDisplay cents={live.potCents} />

          {live.seats.map((seat, slot) => (
            <div
              key={`seat-${String(seat.seat)}`}
              className={cx("fr-stage__seat", "fr-stage__anchor", slotClass(slot))}
              data-fr="stage-seat"
              data-slot={slot}
              data-seat={seat.seat}
              data-winner={seat.winner === true ? "true" : undefined}
              data-dimmed={seat.dimmed === true ? "true" : undefined}
            >
              <SeatPlate
                name={seat.name}
                stackCents={seat.stackCents}
                density={live.density}
                hero={seat.hero === true}
                folded={seat.folded === true}
                thinking={seat.thinking === true}
                moodState={seat.mood ?? "neutral"}
                earnedRead={seat.earnedRead === true}
                {...(seat.hudTag === undefined ? {} : { hudTag: seat.hudTag })}
              >
                {seatCards(seat, action !== null)}
              </SeatPlate>
            </div>
          ))}

          {live.seats.map((seat, slot) =>
            (seat.betCents ?? 0) > 0 ? (
              <BetChips
                key={`bet-${String(seat.seat)}`}
                cents={seat.betCents ?? 0}
                tier={seat.betTier ?? 2}
                className={cx("fr-stage__anchor", slotClass(slot))}
                label={`${seat.name} bet ${formatCents(seat.betCents ?? 0)}`}
              />
            ) : null,
          )}

          {live.seats.map((seat, slot) =>
            seat.button === true ? (
              <DealerButton
                key={`button-${String(seat.seat)}`}
                className={cx("fr-stage__anchor", slotClass(slot))}
                label={`dealer button, ${seat.name}`}
              />
            ) : null,
          )}

          {/*
            The travelling half of every beat. Transform + opacity only
            (beats.md law #4), both halves of the transform present in every
            keyframe so the two strings interpolate, and `aria-hidden` because
            a card in the air says nothing the settled felt will not say a
            quarter of a second later.
          */}
          <div className="fr-stage__flights" data-fr="stage-flights" aria-hidden="true">
            {stage.flights.map((flight) => (
              <motion.span
                key={flight.id}
                className={cx("fr-stage__flight", `fr-stage__flight--${flight.kind}`)}
                data-fr="stage-flight"
                data-flight={flight.kind}
                initial={{ transform: anchorTransform(flight.from), opacity: 1 }}
                animate={{ transform: anchorTransform(flight.to), opacity: flight.fading === true ? 0 : 1 }}
                transition={flight.transition}
              >
                {flight.kind === "card" ? (
                  <PlayingCard faceDown size="hud" />
                ) : (
                  <span className="fr-stage__chip" />
                )}
              </motion.span>
            ))}
          </div>
        </div>
      </Felt>

      {action === null ? null : (
        <div className="fr-stage__hero" data-fr="stage-hero">
          <ActionBar
            legal={action.legal}
            {...(action.presets === undefined ? {} : { presets: action.presets })}
            bigBlindCents={action.bigBlindCents}
            disabled={action.disabled === true}
            {...(onFold === undefined ? {} : { onFold })}
            {...(onCheck === undefined ? {} : { onCheck })}
            {...(onCall === undefined ? {} : { onCall })}
            {...(onCommit === undefined ? {} : { onCommit })}
            hero={
              live.hero === null ? undefined : (
                <>
                  <HeroCards
                    cards={heroPair(live.hero.cards)}
                    faceDown={live.hero.faceDown === true}
                    mucked={live.hero.mucked === true}
                  />
                  {heroSeat === undefined ? null : (
                    <span className="fr-stage__whoami" data-fr="hero-identity">
                      <span className="fr-stage__whoami-name">{heroSeat.name}</span>
                      <span className="fr-stage__whoami-stack fr-num">{formatCents(heroSeat.stackCents)}</span>
                    </span>
                  )}
                </>
              )
            }
            coach={<CoachLine line={action.coach ?? null} />}
            price={action.price === undefined ? undefined : <PriceChip state={action.price} />}
          />
        </div>
      )}
    </div>
  );
}
