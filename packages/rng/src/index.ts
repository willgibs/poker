/**
 * @packageDocumentation
 * # @poker/rng — deterministic seeded randomness
 *
 * Zero-dependency seeded RNG for the poker engine. Everything here is pure and
 * reproducible: the same seed always yields the same sequence, on every platform.
 *
 * ## Design deviation (approved)
 *
 * The architecture doc names SplitMix64 + xoshiro256**. This package instead uses
 * **32-bit arithmetic** — splitmix32 for seed derivation and xoshiro128** for
 * stream generation — because JavaScript has no native 64-bit integers: 64-bit
 * variants would require BigInt (slow) or manual 32-bit-pair emulation (complex).
 * All arithmetic uses `Math.imul` and `>>> 0` so every intermediate stays an
 * exact unsigned 32-bit value. Statistical quality is more than sufficient for
 * shuffling and Monte Carlo at our scales.
 *
 * ## Layout
 *
 * - {@link hashString} — FNV-1a 32-bit, for turning labels into numbers.
 * - {@link deriveSeed} — mixes a parent seed with a label via splitmix32 steps.
 * - {@link createStream} — a xoshiro128** stream: `nextU32`, `nextFloat`,
 *   `nextInt` (unbiased), `shuffle` (Fisher-Yates), `fork`.
 * - {@link streamFor} — session seed hierarchy: derive a stream from a root
 *   seed and a slash-separated path such as `"hand/42/deck"`.
 *
 * ## Precision note
 *
 * `nextFloat()` returns one u32 divided by 2^32, i.e. a float in [0, 1) with
 * **32 bits of precision**, not the full 53 bits a double can carry. That is
 * deliberate simplification: one draw per float, and 2^-32 resolution is far
 * below any tolerance used in this codebase.
 */

/** 32-bit golden-ratio increment used by splitmix32. */
const GOLDEN_GAMMA_32 = 0x9e3779b9;

/** Left-rotate a u32 by `k` bits (0 < k < 32). */
function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * splitmix32 finalizer: avalanche a u32 state into an output word.
 * Constants are from the widely used murmur3-derived mix
 * (0x21f0aaad / 0x735a2d97 variant).
 */
function mix32(z: number): number {
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

/**
 * FNV-1a 32-bit hash of a string, for deriving child seeds from labels.
 *
 * Hashes UTF-16 code units (not UTF-8 bytes); for ASCII labels this matches
 * the published FNV-1a byte-wise vectors. Returns an unsigned 32-bit integer.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministically derive a child seed from a parent seed and a label.
 *
 * XORs the parent with {@link hashString}(label), then advances two splitmix32
 * steps for avalanche, returning the final mixed output. Same (parent, label)
 * always yields the same child; different labels decorrelate completely.
 */
export function deriveSeed(parent: number, label: string): number {
  let state = ((parent >>> 0) ^ hashString(label)) >>> 0;
  let out = 0;
  for (let i = 0; i < 2; i++) {
    state = (state + GOLDEN_GAMMA_32) >>> 0;
    out = mix32(state);
  }
  return out;
}

/** A deterministic random stream. All methods advance internal state. */
export interface RngStream {
  /** Next raw unsigned 32-bit integer. */
  nextU32(): number;
  /**
   * Float in [0, 1): one u32 / 2^32. 32 bits of precision (not 53) — see the
   * package precision note.
   */
  nextFloat(): number;
  /**
   * Unbiased integer in [0, boundExclusive), via rejection sampling (draws
   * below `2^32 mod bound` are rejected so every residue is equally likely).
   * `boundExclusive` must be an integer in [1, 2^32].
   */
  nextInt(boundExclusive: number): number;
  /** In-place Fisher-Yates shuffle. Returns the same array for convenience. */
  shuffle<T>(arr: T[]): T[];
  /**
   * Derive an independent child stream keyed by `label`. Forking is keyed off
   * the stream's originating seed, not its current position: it never consumes
   * parent state (child draws cannot affect the parent sequence), and forking
   * the same label twice yields identical child streams.
   */
  fork(label: string): RngStream;
}

/**
 * Create a xoshiro128** stream from a 32-bit seed.
 *
 * The 128-bit xoshiro state is filled from four splitmix32 outputs of the
 * seed (the seeding procedure recommended by the xoshiro authors, adapted to
 * 32-bit). A theoretical all-zero fill is remapped to a fixed nonzero state.
 */
export function createStream(seed: number): RngStream {
  const seed32 = seed >>> 0;

  // Seed the 4-word state via splitmix32.
  let sm = seed32;
  const smNext = (): number => {
    sm = (sm + GOLDEN_GAMMA_32) >>> 0;
    return mix32(sm);
  };
  let s0 = smNext();
  let s1 = smNext();
  let s2 = smNext();
  let s3 = smNext();
  if ((s0 | s1 | s2 | s3) === 0) s0 = GOLDEN_GAMMA_32; // xoshiro forbids all-zero state

  const nextU32 = (): number => {
    const result = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl32(s3, 11);
    return result;
  };

  const nextFloat = (): number => nextU32() / 0x1_0000_0000;

  const nextInt = (boundExclusive: number): number => {
    if (!Number.isInteger(boundExclusive) || boundExclusive < 1 || boundExclusive > 0x1_0000_0000) {
      throw new RangeError(`nextInt bound must be an integer in [1, 2^32], got ${boundExclusive}`);
    }
    // Rejection sampling: 2^32 mod bound values at the bottom are rejected,
    // leaving an accept range whose size is an exact multiple of the bound.
    const threshold = 0x1_0000_0000 % boundExclusive;
    let u: number;
    do {
      u = nextU32();
    } while (u < threshold);
    return u % boundExclusive;
  };

  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(i + 1);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  };

  const fork = (label: string): RngStream => createStream(deriveSeed(seed32, label));

  return { nextU32, nextFloat, nextInt, shuffle, fork };
}

/**
 * Session seed-hierarchy helper: derive a stream from a root seed and a
 * slash-separated path, one {@link deriveSeed} step per segment.
 *
 * `streamFor(root, "hand/42/deck")` is equivalent to deriving `"hand"`, then
 * `"42"`, then `"deck"` and creating a stream from the result. A string root
 * is first reduced with {@link hashString}. Empty segments (leading, trailing,
 * or doubled slashes) are ignored.
 */
export function streamFor(rootSeed: number | string, path: string): RngStream {
  let seed = typeof rootSeed === "string" ? hashString(rootSeed) : rootSeed >>> 0;
  for (const segment of path.split("/")) {
    if (segment.length === 0) continue;
    seed = deriveSeed(seed, segment);
  }
  return createStream(seed);
}
