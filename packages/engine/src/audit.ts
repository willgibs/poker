/**
 * auditChips — invariant checker used by tests after every reducer step.
 *
 * Conservation identity (holds at every point in a hand's life):
 *   per seat:  stack + committedTotal - awarded === startingStack
 *   globally:  Σ (stack + committedTotal - awarded) === initialTotal
 * Awards fold winnings back into stacks, so after `handOver`
 * Σ awarded === Σ committedTotal and Σ stacks === initialTotal.
 *
 * Throws EngineError("invariant") on the first violation.
 */

import { EngineError } from "./errors";
import type { TableState } from "./types";

function fail(message: string): never {
  throw new EngineError("invariant", `chip audit failed: ${message}`);
}

export function auditChips(state: TableState, initialTotal: number): void {
  if (!Number.isSafeInteger(initialTotal) || initialTotal < 0) {
    fail(`initialTotal ${initialTotal} is not a non-negative integer`);
  }

  let total = 0;
  let committedSum = 0;
  let awardedSum = 0;
  let maxCommittedStreet = 0;

  for (const s of state.seats) {
    for (const [name, v] of [
      ["stack", s.stack],
      ["committedStreet", s.committedStreet],
      ["committedTotal", s.committedTotal],
      ["awarded", s.awarded],
      ["startingStack", s.startingStack],
    ] as const) {
      if (!Number.isSafeInteger(v) || v < 0) {
        fail(`seat ${s.seat}: ${name} ${v} is not a non-negative integer`);
      }
    }
    if (s.committedStreet > s.committedTotal) {
      fail(`seat ${s.seat}: committedStreet ${s.committedStreet} > committedTotal ${s.committedTotal}`);
    }
    if (s.stack + s.committedTotal - s.awarded !== s.startingStack) {
      fail(
        `seat ${s.seat}: stack ${s.stack} + committed ${s.committedTotal} - awarded ${s.awarded} !== startingStack ${s.startingStack}`,
      );
    }
    // While the hand runs, all-in means nothing behind; after settlement an
    // all-in winner's stack is exactly what the pots returned.
    if (s.allIn && !state.handOver && s.stack !== 0) {
      fail(`seat ${s.seat}: allIn with stack ${s.stack}`);
    }
    if (s.allIn && state.handOver && s.stack !== s.awarded) {
      fail(`seat ${s.seat}: all-in stack ${s.stack} !== awarded ${s.awarded}`);
    }
    total += s.stack + s.committedTotal - s.awarded;
    committedSum += s.committedTotal;
    awardedSum += s.awarded;
    if (s.committedStreet > maxCommittedStreet) maxCommittedStreet = s.committedStreet;
  }

  if (total !== initialTotal) {
    fail(`table total ${total} !== initial total ${initialTotal}`);
  }
  if (state.currentBet < maxCommittedStreet) {
    fail(`currentBet ${state.currentBet} < max street commitment ${maxCommittedStreet}`);
  }

  const expectedBoard = { preflop: 0, flop: 3, turn: 4, river: 5 }[state.street];
  if (state.board.length !== expectedBoard) {
    fail(`street ${state.street} with ${state.board.length} board cards`);
  }

  if (state.handOver) {
    if (awardedSum !== committedSum) {
      fail(`hand over but awarded ${awardedSum} !== committed ${committedSum}`);
    }
    if (state.actionSeat !== null) fail("hand over with a seat still to act");
  } else if (awardedSum !== 0) {
    fail(`awards before hand end (${awardedSum})`);
  } else if (state.actionSeat !== null) {
    const actor = state.seats.find((s) => s.seat === state.actionSeat);
    if (actor === undefined) fail(`actionSeat ${state.actionSeat} is not dealt in`);
    if (actor.folded || actor.allIn) fail(`actionSeat ${state.actionSeat} cannot act`);
  }
}
