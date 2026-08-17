/**
 * Lookup tables for the two-table 7-card evaluator, decoded from the
 * generated base64 payload at module load (~1ms).
 *
 * Regenerate tables.gen.ts with: pnpm --filter @poker/eval tablegen
 */

import { FLUSH_B64, NOFLUSH_B64, DPH_DATA, NOFLUSH_SIZE } from "./tables.gen";
import { b64ToInt16 } from "./b64";

/**
 * FLUSH[mask13] -> best 5-card class for a 13-bit rank mask of the flush
 * suit (5, 6, or 7 bits set). Entries for other masks are 0 (never read).
 */
export const FLUSH: Int16Array = b64ToInt16(FLUSH_B64);

/**
 * NOFLUSH[hash] -> best 5-card class for a quinary rank-count vector
 * (13 digits 0..4 summing to 7), suits ignored (no flush possible).
 */
export const NOFLUSH: Int16Array = b64ToInt16(NOFLUSH_B64);

/**
 * Perfect-hash DP offsets: DPH[i*40 + s*5 + q] where i = rank position
 * (0 = deuce, most significant), s = prefix count sum, q = count digit.
 */
export const DPH: Int32Array = Int32Array.from(DPH_DATA);

if (FLUSH.length !== 8192 || NOFLUSH.length !== NOFLUSH_SIZE || DPH.length !== 520) {
  throw new Error("@poker/eval: corrupt generated tables");
}
