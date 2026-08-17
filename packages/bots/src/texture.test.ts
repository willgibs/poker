import { describe, expect, it } from "vitest";
import { classifyTexture, isScareCard, streetOfBoard } from "./texture";
import { cards } from "./test-helpers";

const t = (board: string) => classifyTexture(cards(board));

describe("board texture", () => {
  it("maps board length to a street", () => {
    expect(streetOfBoard(0)).toBe("preflop");
    expect(streetOfBoard(3)).toBe("flop");
    expect(streetOfBoard(4)).toBe("turn");
    expect(streetOfBoard(5)).toBe("river");
  });

  it("treats an empty board as no texture", () => {
    const empty = classifyTexture([]);
    expect(empty.wetness).toBe(0);
    expect(empty.label).toBe("dry");
    expect(empty.monotone).toBe(false);
    expect(empty.rainbow).toBe(false);
  });

  it("reads suits", () => {
    expect(t("Ac Kc Qc").monotone).toBe(true);
    expect(t("Ac Kc Qc").maxSuitCount).toBe(3);
    expect(t("Ac Kc Qd").twoTone).toBe(true);
    expect(t("Ac Kd Qh").rainbow).toBe(true);
  });

  it("reads pairs and trips", () => {
    expect(t("9c 9d 4h").paired).toBe(true);
    expect(t("9c 9d 9h").trips).toBe(true);
    expect(t("9c 8d 4h").paired).toBe(false);
  });

  it("ranks the canonical dry board as dry and the canonical wet one as wet", () => {
    const dry = t("Kd 7h 2c");
    const wet = t("9h 8h 7d");
    expect(dry.label).toBe("dry");
    expect(wet.label).toBe("wet");
    expect(wet.wetness).toBeGreaterThan(dry.wetness);
  });

  it("scores connectedness higher for consecutive ranks", () => {
    expect(t("9c 8d 7h").connectedness).toBeGreaterThan(t("Kc 8d 3h").connectedness);
    expect(t("Kc 8d 3h").connectedness).toBeLessThan(0.4);
  });

  it("scores highness from broadway cards", () => {
    expect(t("Ac Kd Qh").highness).toBe(1);
    expect(t("7c 5d 2h").highness).toBe(0);
  });

  it("keeps wetness inside [0, 1] for every three-card board shape tested", () => {
    for (const board of ["Ac Kc Qc", "2c 7d 9h", "9h 8h 7h", "Ad Ah As", "5c 4d 3h", "Kd 7h 2c"]) {
      const w = t(board).wetness;
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe("scare cards", () => {
  it("is never true before the turn", () => {
    expect(isScareCard(cards("Kd 7h 2c"))).toBe(false);
    expect(isScareCard([])).toBe(false);
  });

  it("fires on a broadway card, a completed flush and a paired board", () => {
    expect(isScareCard(cards("Kd 7h 2c Ah"))).toBe(true); // ace
    expect(isScareCard(cards("Kd 7h 2h 9h"))).toBe(true); // third heart
    expect(isScareCard(cards("Kd 7h 2c 7s"))).toBe(true); // board pairs
  });

  it("stays quiet on a blank", () => {
    expect(isScareCard(cards("Kd 9h 2c 3s"))).toBe(false);
  });
});
