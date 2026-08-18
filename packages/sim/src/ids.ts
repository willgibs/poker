/**
 * Deterministic identity for a session and its hands.
 *
 * Nothing here reads a clock or a random source: a hand id is a pure function
 * of `(sessionId, sessionSeed, handNumber)`, so replaying a session produces
 * the same ids it produced the first time — which is what makes a golden
 * record comparison a byte-for-byte comparison.
 */

import { streamFor } from "@poker/rng";

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/** Session id when the caller supplies none: `sim-<16 hex>` from the seed. */
export function defaultSessionId(sessionSeed: string): string {
  const s = streamFor(sessionSeed, "session/id");
  return `sim-${hex8(s.nextU32())}${hex8(s.nextU32())}`;
}

/**
 * The `HandRecord.seed` field: the hand's node in the seed hierarchy, written
 * as the path it actually is. `@poker/analysis` roots its grading streams here,
 * so distinct hands grade off distinct streams.
 */
export function handSeed(sessionSeed: string, handNumber: number): string {
  return `${sessionSeed}/hand/${handNumber}`;
}

/** Globally unique, deterministic hand id: session + ordinal + seed-derived tag. */
export function handId(sessionId: string, sessionSeed: string, handNumber: number): string {
  const s = streamFor(sessionSeed, `hand/${handNumber}/id`);
  return `${sessionId}-${String(handNumber).padStart(6, "0")}-${hex8(s.nextU32())}`;
}
