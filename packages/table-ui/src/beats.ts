/**
 * The beat model — the Presenter's output vocabulary.
 *
 * Normative source: `poker-internal/content/motion/beats.md` §4 (the beat
 * vocabulary) and §8 (the Presenter beat contract). A Beat is *data*: a typed,
 * timed, self-describing UI moment. Renderers subscribe; they never schedule.
 *
 * Deviations from the §8 sketch, deliberate and documented:
 * - `sound?: {...}` is `sounds: BeatSound[]` (0..2) — the pot award carries
 *   `pot_slide` *and* a conditional `win_chime` (§4.8).
 * - `settled: () => TableProjection` is not carried here: the projection lives
 *   in the app's table store, which owns engine truth. A beat instead carries
 *   the `event` (and typed `meta`) that produced it, so the store can apply the
 *   same settled end-state whether the beat played or was flushed.
 * - `lane` is joined by `blocking` and `group`: sub-beats inside one dealer
 *   phase (12 staggered hole cards) legitimately overlap each other; whole
 *   phases never overlap. `group` names the phase; `blocking` marks the beats
 *   the sequencing law applies to.
 */

import type { BoardStreet, Card, HandEvent, Street } from "@poker/history";
import type { DurationToken, SpringToken } from "./tokens";

/** Orchestration lane (beats.md §5.1). */
export type BeatLane = "dealer" | "actor" | "ambient";

/** Speed class (beats.md §2.3). PACED scales; FEEDBACK and AMBIENT never do. */
export type SpeedClass = "paced" | "feedback" | "ambient";

/** Animatable properties. Transform + opacity (+ ≤2px blur) only — law #4. */
export type BeatTransform = "translate" | "rotate" | "rotateY" | "scale" | "opacity" | "blur2px";

/**
 * Declared reduce-motion variant (beats.md §5.4). `"static"` extends the §8
 * list for beats that are pure elapsed time (the think-pulse becomes a static
 * dot): nothing animates, but the beat still occupies its slot in the schedule.
 */
export type ReduceMotionVariant = "fade-in-place" | "cross-fade" | "unchanged" | "pulse" | "static";

/** Sound cues (beats.md §6.2), minus the session-end `celebrate_*` family. */
export type CueName =
  | "card_slide"
  | "card_flip"
  | "fold_muck"
  | "check_knock"
  | "chip_click_1"
  | "chip_click_2"
  | "chip_click_3"
  | "chip_allin"
  | "pot_merge"
  | "pot_slide"
  | "turn_blip"
  | "badge_tick"
  | "win_chime";

/** A cue attached to a beat, fired at `atProgress` of the beat's duration. */
export interface BeatSound {
  readonly cue: CueName;
  /** 0 = launch, 0.7 = chip impact timing, 1 = landing. */
  readonly atProgress: number;
  /** Trim relative to the cue's own default level (beats.md §6.2/§6.3). */
  readonly gainDb: number;
}

/** Visual chip-stack tier / chip-ladder step, keyed to the bet:pot ratio. */
export type ChipTier = 1 | 2 | 3 | 4;

/** Bot mood states that drive the portrait cross-fade (beats.md §4.12). */
export type SeatMood = "neutral" | "heated" | "steaming";

export type BeatKind =
  | "deal-hole"
  | "deal-board"
  | "reveal"
  | "winner-glow"
  | "chips-out"
  | "chips-collect"
  | "pot-award"
  | "fold-muck"
  | "check-knock"
  | "turn-indicator"
  | "think-pause"
  | "rest"
  | "mind-affordance"
  | "badge-glint"
  | "mood-shift"
  | "banter";

export interface BeatBase {
  /** ms from the schedule's `startAt`. */
  readonly at: number;
  /** ms; 0 means "snap to settled" (instant mode, or a flushed beat). */
  readonly duration: number;
  readonly lane: BeatLane;
  readonly speedClass: SpeedClass;
  /**
   * Phase id — beats sharing a group are one choreographed moment (the twelve
   * staggered hole cards; the three flop flips) and may overlap each other.
   */
  readonly group: string;
  /**
   * Subject to the sequencing law (beats.md §5.1/§5.2). Blocking groups never
   * overlap, except actor→actor settle overlap. Preparatory beats
   * (turn indicator, think pulse) and all ambient beats are non-blocking.
   */
  readonly blocking: boolean;
  /** Renders a minimal form at instant instead of snapping (beats.md §3). */
  readonly keepsTrace: boolean;
  readonly transforms: readonly BeatTransform[];
  readonly reduceMotion: ReduceMotionVariant;
  readonly spring?: SpringToken;
  readonly cssToken?: DurationToken;
  /** 0..2 cues; empty when the beat is silent (or was silenced by §6 policy). */
  readonly sounds: readonly BeatSound[];
  /** The engine event that caused this beat, when there is one. */
  readonly event?: HandEvent;
  /** Index of `event` in the scheduled array — stable ordering handle. */
  readonly eventIndex?: number;
}

export interface CardDelivery {
  readonly seat: number;
  readonly cards: readonly Card[];
}

export interface DealHoleMeta {
  readonly deliveries: readonly CardDelivery[];
  /** Dealer pass, or `"merged"` once both cards travel as one sprite (2x+). */
  readonly pass: 1 | 2 | "merged";
  /** The whole deal collapsed into one group beat (tier 2 / instant). */
  readonly grouped: boolean;
  /** Travel arc height, px; 0 once tier-1 flattens arcs to lines. */
  readonly arcPx: number;
}

export interface DealBoardMeta {
  readonly street: BoardStreet;
  readonly cards: readonly Card[];
  /**
   * `"slide"` — face-down travel, a `reveal` beat flips it afterwards;
   * `"slide+flip"` — merged, the card turns while travelling (tier 1+);
   * `"fade"` — reduce-motion: appears face-up in place.
   */
  readonly form: "slide" | "slide+flip" | "fade";
  readonly grouped: boolean;
  readonly arcPx: number;
}

export interface RevealMeta {
  readonly source: "hero" | "board" | "showdown";
  /** Hole cards turning over, by seat. Empty for board reveals. */
  readonly deliveries: readonly CardDelivery[];
  /** Board cards turning over. Empty for hole-card reveals. */
  readonly cards: readonly Card[];
  readonly street?: BoardStreet;
  /** All seats / cards revealed as one unit (tier 2 / instant). */
  readonly grouped: boolean;
}

export interface WinnerGlowMeta {
  readonly winners: readonly number[];
  /** Revealed losing seats, dimmed to 70% (beats.md §4.9). */
  readonly dimmed: readonly number[];
}

export interface BlindPost {
  readonly seat: number;
  readonly kind: "sb" | "bb" | "ante";
  readonly amount: number;
}

export type ChipsOutMeta =
  | {
      readonly aggression: "blind";
      readonly posts: readonly BlindPost[];
      readonly total: number;
      readonly arcPx: number;
    }
  | {
      readonly aggression: "call" | "bet" | "raise";
      readonly seat: number;
      /** Chips added to the felt by this action (cents). */
      readonly amount: number;
      /** Seat's total street commitment after the action (cents). */
      readonly toAmount: number;
      readonly tier: ChipTier;
      readonly allIn: boolean;
      /** Chips already on the felt + in the pot before the action (cents). */
      readonly potBefore: number;
      readonly arcPx: number;
      /** The 120ms spawn pop — dropped once tier-1 merges it into travel. */
      readonly spawnPop: boolean;
    };

export interface ChipsCollectMeta {
  readonly seats: readonly { readonly seat: number; readonly amount: number }[];
  readonly total: number;
  /** Pot size after the merge (cents). */
  readonly potAfter: number;
  readonly street: Street;
  /** Spinning-counter roll-up length, overlapped with the merge. */
  readonly rollUpMs: number;
}

export interface PotAwardMeta {
  readonly seat: number;
  readonly potIndex: number;
  readonly amount: number;
  /** Stillness before the pot moves (beats.md §4.8/§6.4) — already elapsed at `at`. */
  readonly breathMs: number;
  readonly splitIndex: number;
  readonly splitCount: number;
  readonly heroWin: boolean;
  readonly rollUpMs: number;
}

export interface FoldMuckMeta {
  readonly seat: number;
  /** Seat-plate dim, overlapping the muck. */
  readonly dimMs: number;
  /** Cards travel to the muck; false once tier-2 fades them in place. */
  readonly travel: boolean;
  /** Hero's own fold ducks Cards+Chips −6dB until hand end (beats.md §6.3). */
  readonly tableRecede: boolean;
}

export interface CheckKnockMeta {
  readonly seat: number;
  readonly dips: 1 | 2;
}

export interface TurnIndicatorMeta {
  readonly seat: number;
  readonly from: number | null;
  readonly hero: boolean;
  /** Ring glides the perimeter, or cross-fades once travel would be noise. */
  readonly form: "glide" | "fade";
  /** Hero zone arms (buttons are live from frame 0 — law #2). */
  readonly arms: boolean;
}

export interface ThinkPauseMeta {
  readonly seat: number;
  readonly hero: boolean;
  /** The bot pipeline's raw think time, before speed scaling and the floor. */
  readonly requestedMs: number;
}

export interface RestMeta {
  readonly reason: "auto-deal";
}

export interface MindAffordanceMeta {
  readonly seat: number;
  /** At 3x/instant the affordance skips the felt and lives on the tray chip. */
  readonly target: "felt" | "tray";
}

export interface BadgeGlintMeta {
  readonly phase: "pop" | "sweep";
  /** A badge nags exactly twice (beats.md §4.11). */
  readonly nag: 1 | 2;
  /** `badge_tick` suppressed — hero has a pending decision (§6.3). */
  readonly silent: boolean;
}

export interface MoodShiftMeta {
  readonly seat: number;
  readonly from: SeatMood;
  readonly to: SeatMood;
}

export interface BanterMeta {
  readonly seat: number;
  readonly text: string;
  readonly phase: "in" | "out";
  /** Hold between the in and out beats (4s ÷ S, min 2s). */
  readonly holdMs: number;
}

export interface BeatMetaMap {
  "deal-hole": DealHoleMeta;
  "deal-board": DealBoardMeta;
  reveal: RevealMeta;
  "winner-glow": WinnerGlowMeta;
  "chips-out": ChipsOutMeta;
  "chips-collect": ChipsCollectMeta;
  "pot-award": PotAwardMeta;
  "fold-muck": FoldMuckMeta;
  "check-knock": CheckKnockMeta;
  "turn-indicator": TurnIndicatorMeta;
  "think-pause": ThinkPauseMeta;
  rest: RestMeta;
  "mind-affordance": MindAffordanceMeta;
  "badge-glint": BadgeGlintMeta;
  "mood-shift": MoodShiftMeta;
  banter: BanterMeta;
}

/** A scheduled UI moment. Switch on `kind` to narrow `meta`. */
export type Beat = {
  [K in BeatKind]: BeatBase & { readonly kind: K; readonly meta: BeatMetaMap[K] };
}[BeatKind];

/** The beat variant for one kind, e.g. `BeatOf<"pot-award">`. */
export type BeatOf<K extends BeatKind> = Extract<Beat, { kind: K }>;

/** Settle time of a beat, ms on the same axis as `at`. */
export function beatEnd(beat: Beat): number {
  return beat.at + beat.duration;
}

/** Absolute time a cue fires, ms on the same axis as `at`. */
export function cueTime(beat: Beat, sound: BeatSound): number {
  return beat.at + beat.duration * sound.atProgress;
}

/** Motion through space — forbidden under reduce-motion (beats.md §5.4). */
const TRANSLATION: readonly BeatTransform[] = ["translate", "rotate", "rotateY", "scale"];

export function isTranslation(transform: BeatTransform): boolean {
  return TRANSLATION.includes(transform);
}

/** `true` when the beat moves anything through space. */
export function hasTranslation(beat: Beat): boolean {
  return beat.transforms.some(isTranslation);
}

/** Shift a beat along the time axis (used when re-anchoring a schedule). */
export function shiftBeat(beat: Beat, dt: number): Beat {
  if (dt === 0) return beat;
  return { ...beat, at: beat.at + dt } as Beat;
}
