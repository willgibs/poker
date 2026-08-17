/**
 * `@poker/table-ui` — the Presenter.
 *
 * A pure, headless, framework-free timed-beat scheduler: engine events arrive
 * instantly, the Presenter turns them into interruptible, speed-aware,
 * reduce-motion-aware UI beats. Zero runtime dependencies, no DOM, no timers,
 * no clock of its own.
 *
 * Normative spec: `poker-internal/content/motion/beats.md`.
 */

export type {
  Beat,
  BeatBase,
  BeatKind,
  BeatLane,
  BeatMetaMap,
  BeatOf,
  BeatSound,
  BeatTransform,
  BlindPost,
  BanterMeta,
  BadgeGlintMeta,
  CardDelivery,
  CheckKnockMeta,
  ChipTier,
  ChipsCollectMeta,
  ChipsOutMeta,
  CueName,
  DealBoardMeta,
  DealHoleMeta,
  FoldMuckMeta,
  MindAffordanceMeta,
  MoodShiftMeta,
  PotAwardMeta,
  ReduceMotionVariant,
  RestMeta,
  RevealMeta,
  SeatMood,
  SpeedClass,
  ThinkPauseMeta,
  TurnIndicatorMeta,
  WinnerGlowMeta,
} from "./beats";
export { beatEnd, cueTime, hasTranslation, isTranslation, shiftBeat } from "./beats";

export type { CompressionTier, DurationSpec, DurationToken, Speed, SpringToken } from "./tokens";
export {
  ACTOR_SETTLE_OVERLAP,
  AUTO_DEAL_REST_MS,
  BACKLOG_GUARD_MS,
  CARD_ARC_PX,
  CHIP_ARC_PX,
  DURATION,
  MIND_AFFORDANCE_DELAY_MS,
  SPEEDS,
  THINK_FLOOR_MS,
  WINNER_GLOW_DELAY_MS,
  compressionTier,
  isInstant,
  nextSpeedTier,
  resolveDuration,
  resolveStagger,
} from "./tokens";

export type { BanterLine, BadgeGlintOptions, ScheduleOptions } from "./schedule";
export { schedule, scheduleBadgeGlint, scheduleBanter, scheduleMoodShift, scheduleThink, thinkDuration } from "./schedule";

export { CALL_TRIM_DB, CUE_DEDUPE_MS, INSTANT_CUES, applySoundPolicy, chipCue, chipTier } from "./sound";

export type { BeatAnchor, BeatEvent, BeatPhase, Presenter, PresenterConfig } from "./presenter";
export { createPresenter } from "./presenter";

/* ==== BEGIN components — the table's presentational kit (React) ==== */
/* The Presenter above is headless; everything below renders it. Styles:
   `import "@poker/table-ui/components.css"` alongside `@poker/ui/tokens.css`. */
export {
  BOARD_SLOTS,
  BetChips,
  Board,
  CARD_RANKS,
  CARD_SUITS,
  DealerButton,
  EmptySlot,
  Felt,
  PlayingCard,
  PotDisplay,
  SeatPlate,
  boardCardEntrance,
  cardLabel,
  readCard,
} from "./components";
export type {
  BetChipsProps,
  BoardProps,
  CardCode,
  CardRank,
  CardSize,
  CardSuit,
  DealerButtonProps,
  EmptySlotProps,
  Entrance,
  EntranceTransition,
  FeltProps,
  PlayingCardProps,
  PotDisplayProps,
  ReadCard,
  SeatPlateProps,
  TableDensity,
} from "./components";
/* ==== END components ==== */

/* ==== BEGIN hero — the zone between the felt and the player (React) ==== */
/* Action bar + its fixed strip (one coach line, one price chip), the two hole
   cards, and the four-slot table header. Styles:
   `import "@poker/table-ui/hero.css"`. */
export {
  ActionBar,
  CoachLine,
  HEADER_SLOTS,
  HEADER_SLOT_BUDGET,
  HeroCards,
  KEY_MAP,
  KeyMapOverlay,
  PriceChip,
  TableHeader,
  aggressionBounds,
  aggressionLabel,
  commitLabel,
  formatNeed,
  formatRatio,
  passiveLabel,
  priceLabel,
} from "./hero";
export type {
  ActionBarProps,
  CoachLineProps,
  HeaderSlot,
  HeroCardsProps,
  KeyMapOverlayProps,
  NetUnit,
  PriceChipProps,
  PriceState,
  SizePreset,
  TableHeaderProps,
} from "./hero";
/* ==== END hero ==== */
