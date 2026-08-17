/**
 * Suit-isomorphism machinery for 169-class matchups (tool code).
 *
 * For a class pair (i, j) we fix one representative combo of class i (valid
 * because the suit group S4 acts transitively on the combos of any 169
 * class), then reduce the disjoint combos of class j to orbit representatives
 * under the stabilizer of the fixed combo. Equity of class i vs class j is
 * the orbit-size-weighted average of the representative matchup equities —
 * exactly the average over all non-conflicting combo pairs.
 */

import { combosOf169, comboIndex } from "../../packages/core/src/index";

export type ComboPair = readonly [number, number];

/** All 24 permutations of the 4 suits. */
function buildSuitPerms(): number[][] {
  const perms: number[][] = [];
  const suits = [0, 1, 2, 3];
  const permute = (rest: number[], acc: number[]): void => {
    if (rest.length === 0) {
      perms.push([...acc]);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest.slice();
      const [chosen] = next.splice(i, 1);
      acc.push(chosen as number);
      permute(next, acc);
      acc.pop();
    }
  };
  permute(suits, []);
  return perms;
}

const SUIT_PERMS = buildSuitPerms();

function applyPerm(perm: readonly number[], card: number): number {
  return (card & ~3) | (perm[card & 3] as number);
}

function permComboKey(perm: readonly number[], combo: ComboPair): number {
  return comboIndex(applyPerm(perm, combo[0]), applyPerm(perm, combo[1]));
}

/** Fixed representative combo for a 169 class (first canonical combo). */
export function repCombo(class169: number): ComboPair {
  const combos = combosOf169(class169);
  const first = combos[0];
  if (first === undefined) throw new RangeError(`no combos for class ${class169}`);
  return first;
}

/** Suit permutations fixing `combo` (as an unordered pair of cards). */
function stabilizer(combo: ComboPair): number[][] {
  const key = comboIndex(combo[0], combo[1]);
  return SUIT_PERMS.filter((p) => permComboKey(p, combo) === key);
}

function conflicts(a: ComboPair, b: ComboPair): boolean {
  return a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];
}

export interface OrbitRep {
  /** Villain combo representative [a, b], a < b. */
  cards: ComboPair;
  /** Orbit size = number of villain combos this representative stands for. */
  weight: number;
}

/**
 * Orbit representatives of class-j combos disjoint from the fixed class-i
 * representative, under the stabilizer of that representative. Weights sum
 * to disjointCount(i, j). Deterministic enumeration order.
 */
export function orbitReps(classI: number, classJ: number): OrbitRep[] {
  const rep = repCombo(classI);
  const stab = stabilizer(rep);
  const seen = new Set<number>();
  const out: OrbitRep[] = [];
  for (const c of combosOf169(classJ)) {
    if (conflicts(c, rep)) continue;
    const idx = comboIndex(c[0], c[1]);
    if (seen.has(idx)) continue;
    const orbit = new Set<number>();
    for (const p of stab) orbit.add(permComboKey(p, c));
    for (const o of orbit) seen.add(o);
    out.push({ cards: c, weight: orbit.size });
  }
  return out;
}

/**
 * Number of class-j combos disjoint from a fixed class-i combo (identical
 * for every class-i combo by suit symmetry). Sums over j to C(50,2) = 1225.
 */
export function disjointCount(classI: number, classJ: number): number {
  const rep = repCombo(classI);
  let n = 0;
  for (const c of combosOf169(classJ)) {
    if (!conflicts(c, rep)) n++;
  }
  return n;
}
