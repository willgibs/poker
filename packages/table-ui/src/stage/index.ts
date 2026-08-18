/**
 * `@poker/table-ui/stage` — the felt, assembled.
 *
 * The components next door are pieces; this is the composition: geometry for
 * the open plan, and the Presenter wired to it so engine events become timed
 * motion. Everything is either a plain view-model, a pure function over one, or
 * the single React component that renders it.
 *
 *   import "@poker/table-ui/stage.css";
 */

export { TableStage } from "./TableStage";
export type { TableStageProps } from "./TableStage";

export type {
  StageActionState,
  StageHero,
  StageSeat,
  SeatIdentity,
  TableStageView,
} from "./view";
export {
  applyBeat,
  applyBeats,
  emptyStageView,
  settleOrder,
  toCardCode,
  toCardCodes,
  viewFromStart,
} from "./view";

export type { ManualClock, StageClock } from "./clock";
export { MAX_FRAME_MS, manualClock, rafClock } from "./clock";

export type { FlightContext, FlightKind, FlightTransition, StageFlight } from "./flights";
export { flightTransition, flightsForBeat } from "./flights";

export type { StagePoint } from "./geometry";
export {
  BET_AXIS_FRACTION,
  BOARD_ANCHOR,
  DEALER_AXIS_DEGREES,
  DEALER_AXIS_FRACTION,
  DEALER_ORIGIN,
  POT_ANCHOR,
  SEAT_SLOTS,
  anchorTransform,
  betAnchor,
  dealerAnchor,
  roundPct,
  seatSlot,
  seatSlots,
  slotClass,
} from "./geometry";

export type { StageHandle, StagePresenter, UseStagePresenterOptions } from "./useStagePresenter";
export { useStagePresenter } from "./useStagePresenter";
