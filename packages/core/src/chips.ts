/**
 * Chip math. Chips are integer cents — never floats.
 */

/** Throws unless `n` is a non-negative safe integer (a valid chip amount in cents). */
export function assertChips(n: number, what = "chip amount"): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`invalid ${what}: ${n} (expected non-negative integer cents)`);
  }
}

/**
 * Split `amount` cents evenly into `n` shares. Every share is floor(amount/n)
 * or floor(amount/n)+1; the `amount % n` odd cents go one each to the earliest
 * entries of `oddChipOrder`, which must be a permutation of share indices
 * 0..n-1 (e.g. seats ordered from first seat left of the button).
 *
 * Returns an array of `n` integer shares indexed by share index; the total is
 * always exactly `amount`.
 */
export function splitPotEven(
  amount: number,
  n: number,
  oddChipOrder: readonly number[],
): number[] {
  assertChips(amount, "pot amount");
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`invalid share count: ${n} (expected integer >= 1)`);
  }
  if (oddChipOrder.length !== n) {
    throw new RangeError(
      `invalid odd-chip order: length ${oddChipOrder.length} (expected permutation of 0-${n - 1})`,
    );
  }
  const seen = new Array<boolean>(n).fill(false);
  for (const idx of oddChipOrder) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= n || seen[idx] === true) {
      throw new RangeError(
        `invalid odd-chip order: ${JSON.stringify(oddChipOrder)} (expected permutation of 0-${n - 1})`,
      );
    }
    seen[idx] = true;
  }

  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  const shares = new Array<number>(n).fill(base);
  for (let k = 0; k < remainder; k++) {
    const idx = oddChipOrder[k];
    if (idx === undefined) break; // unreachable: length validated above
    shares[idx] = base + 1;
  }
  return shares;
}
