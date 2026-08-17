import { describe, expect, it } from "vitest";
import { MADE_CLASS_ORDER, holdingFeatures, holdingScore, madeRankOf } from "./handclass";
import { cards, hole } from "./test-helpers";

const f = (h: string, board: string) => holdingFeatures(hole(h), cards(board));

describe("made-hand classification", () => {
  it("orders the classes weakest to strongest", () => {
    for (let i = 1; i < MADE_CLASS_ORDER.length; i++) {
      expect(madeRankOf(MADE_CLASS_ORDER[i] as never)).toBeGreaterThan(
        madeRankOf(MADE_CLASS_ORDER[i - 1] as never),
      );
    }
  });

  it("classifies the standard shapes", () => {
    expect(f("Ac Kd", "7h 5s 2c").made).toBe("air");
    expect(f("Ac Kd", "Ah 5s 2c").made).toBe("top-pair");
    expect(f("5c 5d", "Ah Kd 2c").made).toBe("weak-pair");
    expect(f("Ac Ad", "Kh 9s 2c").made).toBe("over-pair");
    expect(f("Ac Kd", "Ah Ks 2c").made).toBe("two-pair");
    expect(f("9c 9d", "9h 5s 2c").made).toBe("trips");
    expect(f("8c 7d", "9h Ts Jc").made).toBe("straight");
    expect(f("Ac 2c", "Kc 9c 5c").made).toBe("flush");
    expect(f("9c 9d", "9h 5s 5c").made).toBe("full-house");
    expect(f("9c 9d", "9h 9s 5c").made).toBe("quads");
    expect(f("Tc 9c", "8c 7c 6c").made).toBe("straight-flush");
  });

  it("reads the wheel as a straight", () => {
    expect(f("Ac 2d", "3h 4s 5c").made).toBe("straight");
  });

  it("does not credit a board pair the holding does not share", () => {
    const feat = f("Ac Kd", "7h 7s 2c");
    expect(feat.made).toBe("air");
  });

  it("does credit a pocket pair alongside a board pair as two pair", () => {
    expect(f("8c 8d", "7h 7s 2c").made).toBe("two-pair");
  });
});

describe("draw classification", () => {
  it("finds flush draws that use a hole card", () => {
    expect(f("Ac 5c", "Kc 9c 2d").flushDraw).toBe(true);
    // Four to a flush entirely on the board is not the bot's draw.
    expect(f("Ah 5d", "Kc 9c 2c 7c").flushDraw).toBe(false);
  });

  it("separates open-enders from gutshots", () => {
    const oesd = f("9c 8d", "7h 6s 2c");
    expect(oesd.oesd).toBe(true);
    expect(oesd.gutshot).toBe(false);
    const gut = f("9c 8d", "7h 5s 2c");
    expect(gut.gutshot).toBe(true);
    expect(gut.oesd).toBe(false);
  });

  it("reports no draw once the straight is already there", () => {
    const made = f("9c 8d", "7h 6s 5c");
    expect(made.made).toBe("straight");
    expect(made.oesd).toBe(false);
    expect(made.gutshot).toBe(false);
  });

  it("counts outs for the classic draws", () => {
    expect(f("Ac 5c", "Kc 9c 2d").outs).toBe(9);
    expect(f("9c 8d", "7h 6s 2c").outs).toBe(8);
    expect(f("9c 8d", "7h 5s 2c").outs).toBe(4);
    expect(f("Tc 9c", "8c 7d 2c").outs).toBe(15); // combo draw, discounted for overlap
  });
});

describe("holdingScore", () => {
  it("is monotone in made-hand class", () => {
    const board = "Kh 9s 4c";
    const air = holdingScore(hole("7c 2d"), cards(board));
    const pair = holdingScore(hole("9c 2d"), cards(board));
    const twoPair = holdingScore(hole("Kc 9d"), cards(board));
    const set = holdingScore(hole("9c 9d"), cards(board));
    expect(pair).toBeGreaterThan(air);
    expect(twoPair).toBeGreaterThan(pair);
    expect(set).toBeGreaterThan(twoPair);
  });

  it("ranks a draw above pure air", () => {
    const board = "Kc 9c 4d";
    expect(holdingScore(hole("Ac 5c"), cards(board))).toBeGreaterThan(
      holdingScore(hole("Ah 5d"), cards(board)),
    );
  });

  it("breaks ties by kicker", () => {
    const board = "Kh 9s 4c";
    expect(holdingScore(hole("Kc Qd"), cards(board))).toBeGreaterThan(
      holdingScore(hole("Kd 5d"), cards(board)),
    );
  });

  it("is deterministic and order-insensitive in the hole cards", () => {
    const board = cards("Kh 9s 4c");
    expect(holdingScore(hole("Ac 5c"), board)).toBe(holdingScore(hole("5c Ac"), board));
  });
});
