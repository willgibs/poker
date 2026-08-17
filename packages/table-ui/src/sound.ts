/**
 * Cue policy — the sound half of the beat contract.
 *
 * Normative source: `poker-internal/content/motion/beats.md` §6. The Presenter
 * decides *which* cues survive and at what trim; the WebAudio layer in
 * `packages/ui` decides how they sound. Dedupe and the instant-mode reduction
 * are scheduling decisions, so they live here.
 *
 * Not modelled here (mixer state, not beat data): bus ducking (§6.3) — the
 * hero-fold table recede is flagged on the fold beat's meta instead — and the
 * all-in runout hush, which the app derives from engine state.
 */

import type { Beat, BeatSound, ChipTier, CueName } from "./beats";
import { cueTime } from "./beats";
import type { Speed } from "./tokens";

/** Per-cue dedupe windows in ms (beats.md §6.3). 0 = no dedupe. */
export const CUE_DEDUPE_MS: Readonly<Record<CueName, number>> = {
  card_slide: 50,
  card_flip: 80,
  fold_muck: 0,
  check_knock: 0,
  chip_click_1: 150,
  chip_click_2: 150,
  chip_click_3: 150,
  chip_allin: 150,
  pot_merge: 0,
  pot_slide: 0,
  turn_blip: 0,
  badge_tick: 0,
  win_chime: 0,
};

/** The chip ladder shares one dedupe window: keep the latest, drop the earlier. */
const CHIP_CUES: readonly CueName[] = ["chip_click_1", "chip_click_2", "chip_click_3", "chip_allin"];

function isChipCue(cue: CueName): boolean {
  return CHIP_CUES.includes(cue);
}

/** The only cues instant mode keeps — three per hand (beats.md §6.3/§6.4). */
export const INSTANT_CUES: readonly CueName[] = ["card_slide", "card_flip", "pot_slide"];

/** Calls play their ladder step below a bet of the same size (beats.md §4.4). */
export const CALL_TRIM_DB = -3;

/** Floor of the deal's descending `card_slide` ladder (beats.md §4.1). */
const CARD_SLIDE_LADDER_FLOOR_DB = -6;

/**
 * Visual stack tier / chip-ladder step from the bet:pot ratio (beats.md §4.3).
 * T1 ≤33% · T2 33–75% · T3 75–125% · T4 >125% (or all-in).
 */
export function chipTier(amount: number, potBefore: number, allIn = false): ChipTier {
  if (allIn) return 4;
  if (potBefore <= 0) return amount > 0 ? 4 : 1;
  const ratio = amount / potBefore;
  if (ratio <= 0.33) return 1;
  if (ratio <= 0.75) return 2;
  if (ratio <= 1.25) return 3;
  return 4;
}

/** Ladder cue for a stack tier — ears and eyes always agree (beats.md §6.2). */
export function chipCue(tier: ChipTier): CueName {
  if (tier === 1) return "chip_click_1";
  if (tier === 2) return "chip_click_2";
  if (tier === 3) return "chip_click_3";
  return "chip_allin";
}

interface CueRef {
  readonly beat: number;
  readonly sound: number;
  readonly time: number;
  readonly cue: CueName;
  readonly group: string;
}

function collect(beats: readonly Beat[]): CueRef[] {
  const refs: CueRef[] = [];
  for (let b = 0; b < beats.length; b++) {
    const beat = beats[b];
    if (beat === undefined) continue;
    for (let s = 0; s < beat.sounds.length; s++) {
      const sound = beat.sounds[s];
      if (sound === undefined) continue;
      refs.push({ beat: b, sound: s, time: cueTime(beat, sound), cue: sound.cue, group: beat.group });
    }
  }
  refs.sort((a, b) => a.time - b.time || a.beat - b.beat || a.sound - b.sound);
  return refs;
}

function key(ref: CueRef): string {
  return `${ref.beat}:${ref.sound}`;
}

function rebuild(beats: readonly Beat[], dropped: ReadonlySet<string>, gain: ReadonlyMap<string, number>): Beat[] {
  return beats.map((beat, b) => {
    const kept: BeatSound[] = [];
    let changed = false;
    for (let s = 0; s < beat.sounds.length; s++) {
      const sound = beat.sounds[s];
      if (sound === undefined) continue;
      const id = `${b}:${s}`;
      if (dropped.has(id)) {
        changed = true;
        continue;
      }
      const trim = gain.get(id);
      if (trim !== undefined && trim !== 0) {
        kept.push({ ...sound, gainDb: sound.gainDb + trim });
        changed = true;
      } else {
        kept.push(sound);
      }
    }
    if (!changed) return beat;
    return { ...beat, sounds: kept } as Beat;
  });
}

/**
 * Apply §6 cue policy to a finished schedule: instant-mode reduction, per-cue
 * dedupe windows, and the deal's descending `card_slide` ladder. Pure — returns
 * new beats where anything changed.
 */
export function applySoundPolicy(beats: readonly Beat[], speed: Speed): Beat[] {
  const refs = collect(beats);
  const dropped = new Set<string>();
  const gain = new Map<string, number>();

  if (speed === "instant") {
    const seen = new Set<CueName>();
    for (const ref of refs) {
      if (!INSTANT_CUES.includes(ref.cue) || seen.has(ref.cue)) {
        dropped.add(key(ref));
        continue;
      }
      seen.add(ref.cue);
    }
    return rebuild(beats, dropped, gain);
  }

  // Keep-first dedupe for card and cue families (the riffle keeps its head).
  const lastKept = new Map<CueName, number>();
  for (const ref of refs) {
    if (isChipCue(ref.cue)) continue;
    const window = CUE_DEDUPE_MS[ref.cue];
    if (window <= 0) continue;
    const prev = lastKept.get(ref.cue);
    if (prev !== undefined && ref.time - prev < window) {
      dropped.add(key(ref));
      continue;
    }
    lastKept.set(ref.cue, ref.time);
  }

  // Keep-last dedupe across the chip ladder (beats.md §6.3).
  let nextChipTime: number | undefined;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    if (ref === undefined || !isChipCue(ref.cue)) continue;
    if (nextChipTime !== undefined && nextChipTime - ref.time < CUE_DEDUPE_MS[ref.cue]) {
      dropped.add(key(ref));
      continue;
    }
    nextChipTime = ref.time;
  }

  // The deal's riffle: each surviving swish −1dB, floored (beats.md §4.1).
  const slideIndex = new Map<string, number>();
  for (const ref of refs) {
    if (ref.cue !== "card_slide" || dropped.has(key(ref))) continue;
    const n = slideIndex.get(ref.group) ?? 0;
    slideIndex.set(ref.group, n + 1);
    if (n > 0) gain.set(key(ref), Math.max(-n, CARD_SLIDE_LADDER_FLOOR_DB));
  }

  return rebuild(beats, dropped, gain);
}
