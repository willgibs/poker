/**
 * Committed fixture hand: 6-max NLHE $0.50/$1.00, hero in seat 5 wins a
 * single-raised pot at showdown. Golden text: hand001.golden.txt.
 * Regenerate only in reviewed commits (docs/testing.md).
 */

import type { HandRecord } from "../../src/types";
import { cardFromString as c } from "../../src/cards";

export const fixtureHand: HandRecord = {
  v: 1,
  id: "hand-0001",
  sessionId: "sess-fixture-001",
  seed: "seed-fixture-001",
  config: { variant: "nlhe", maxSeats: 6, sb: 50, bb: 100, ante: 0 },
  events: [
    {
      t: "start",
      handNumber: 1,
      button: 1,
      seats: [
        { seat: 1, stack: 10000 },
        { seat: 2, stack: 10000 },
        { seat: 3, stack: 10000 },
        { seat: 4, stack: 10000 },
        { seat: 5, stack: 10000 },
        { seat: 6, stack: 10000 },
      ],
      blinds: { sb: 50, bb: 100, ante: 0 },
    },
    { t: "post", seat: 2, kind: "sb", amount: 50 },
    { t: "post", seat: 3, kind: "bb", amount: 100 },
    { t: "hole", seat: 2, cards: [c("4c"), c("5c")] },
    { t: "hole", seat: 3, cards: [c("Ad"), c("Qd")] },
    { t: "hole", seat: 4, cards: [c("9c"), c("8c")] },
    { t: "hole", seat: 5, cards: [c("As"), c("Ks")] },
    { t: "hole", seat: 6, cards: [c("Jh"), c("Th")] },
    { t: "hole", seat: 1, cards: [c("2d"), c("3c")] },
    { t: "act", seat: 4, kind: "fold", thinkTimeMs: 800 },
    { t: "act", seat: 5, kind: "raise", toAmount: 300, thinkTimeMs: 1400 },
    { t: "act", seat: 6, kind: "fold" },
    { t: "act", seat: 1, kind: "fold" },
    { t: "act", seat: 2, kind: "fold" },
    { t: "act", seat: 3, kind: "call", amount: 200 },
    { t: "board", street: "flop", cards: [c("Ah"), c("7d"), c("2c")] },
    { t: "act", seat: 3, kind: "check" },
    { t: "act", seat: 5, kind: "bet", amount: 400 },
    { t: "act", seat: 3, kind: "call", amount: 400 },
    { t: "board", street: "turn", cards: [c("Td")] },
    { t: "act", seat: 3, kind: "check" },
    { t: "act", seat: 5, kind: "check" },
    { t: "board", street: "river", cards: [c("3s")] },
    { t: "act", seat: 3, kind: "check" },
    { t: "act", seat: 5, kind: "bet", amount: 800 },
    { t: "act", seat: 3, kind: "call", amount: 800 },
    {
      t: "showdown",
      reveals: [
        { seat: 5, cards: [c("As"), c("Ks")] },
        { seat: 3, cards: [c("Ad"), c("Qd")] },
      ],
    },
    { t: "pot", potIndex: 0, seat: 5, amount: 3050 },
    {
      t: "end",
      net: [
        { seat: 1, net: 0 },
        { seat: 2, net: -50 },
        { seat: 3, net: -1500 },
        { seat: 4, net: 0 },
        { seat: 5, net: 1550 },
        { seat: 6, net: 0 },
      ],
    },
  ],
  annotations: {
    "preflop:5:0": { grade: "A", note: "standard open from CO" },
  },
};
