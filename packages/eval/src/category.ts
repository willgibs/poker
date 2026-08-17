export type HandCategory =
  | "straight-flush"
  | "four-of-a-kind"
  | "full-house"
  | "flush"
  | "straight"
  | "three-of-a-kind"
  | "two-pair"
  | "pair"
  | "high-card";

/** Total number of 5-card equivalence classes. */
export const HAND_CLASS_COUNT = 7462;

/** Strongest possible rank (royal flush). */
export const BEST_RANK = 1;

/** Weakest possible rank (7-5-4-3-2 offsuit high card). */
export const WORST_RANK = 7462;

/**
 * Category of an evaluate7/5-card-class rank via the standard 7462-class
 * boundaries:
 *   1..10    straight flush   (10 classes)
 *   11..166  four of a kind   (156)
 *   167..322 full house       (156)
 *   323..1599 flush           (1277)
 *   1600..1609 straight       (10)
 *   1610..2467 three of a kind (858)
 *   2468..3325 two pair       (858)
 *   3326..6185 pair           (2860)
 *   6186..7462 high card      (1277)
 *
 * Input must be a valid rank 1..7462 (not validated — hot-path helper).
 */
export function handCategory(rank: number): HandCategory {
  if (rank <= 1599) {
    if (rank <= 166) {
      if (rank <= 10) return "straight-flush";
      return "four-of-a-kind";
    }
    if (rank <= 322) return "full-house";
    return "flush";
  }
  if (rank <= 2467) {
    if (rank <= 1609) return "straight";
    return "three-of-a-kind";
  }
  if (rank <= 3325) return "two-pair";
  if (rank <= 6185) return "pair";
  return "high-card";
}
