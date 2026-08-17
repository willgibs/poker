/**
 * Test-only hand-record construction (not exported from the package index).
 *
 * Grading, leak detection and the HUD all consume `HandRecord`s, and writing
 * those by hand is both tedious and easy to get subtly wrong — a mistyped call
 * amount produces a record the engine would never emit, and a test built on it
 * proves nothing. This builder does the chip bookkeeping (street commitments,
 * call sizes, nets that sum to zero) and runs `validateEvents` on `build()`,
 * so every synthetic corpus in this package's tests is a structurally valid
 * log.
 *
 * Cards come from a seeded `@poker/rng` shuffle — no `Math.random`, even in
 * tests.
 */

import { type Card, cardFromString } from "@poker/core";
import {
  type HandEvent,
  type HandRecord,
  type TableConfig,
  validateEvents,
} from "@poker/history";
import { streamFor } from "@poker/rng";

/** Parse a card string like `"As"`. Re-exported for terse test literals. */
export const c = cardFromString;

/** Parse several card strings at once. */
export function cards(...names: string[]): Card[] {
  return names.map(cardFromString);
}

export interface HandBuilderOptions {
  handNumber?: number;
  /** Seat numbers dealt in, ascending. Defaults to `[0, 1]`. */
  seats?: readonly number[];
  /** Seat of the button. Defaults to the first seat. */
  button?: number;
  /** Starting stack for every seat, cents. */
  stack?: number;
  /** Per-seat starting stacks, overriding `stack`. */
  stacks?: Readonly<Record<number, number>>;
  sb?: number;
  bb?: number;
  ante?: number;
  id?: string;
  sessionId?: string;
  seed?: string;
  maxSeats?: number;
  /**
   * The runout, reserved up front so `deal()` cannot hand a board card to a
   * player. `flop()` / `turn()` / `river()` take from it positionally when
   * called with no arguments.
   */
  board?: readonly string[];
}

interface SeatState {
  seat: number;
  stack: number;
  committedStreet: number;
  committedTotal: number;
  folded: boolean;
  awarded: number;
}

/** A fluent builder producing valid `HandRecord`s. */
export class HandBuilder {
  private readonly events: HandEvent[] = [];
  private readonly state = new Map<number, SeatState>();
  private readonly used = new Set<Card>();
  private readonly reserved = new Set<Card>();
  private readonly plannedBoard: Card[] = [];
  private plannedAt = 0;
  private readonly deck: Card[];
  private deckAt = 0;
  private readonly config: TableConfig;
  private readonly seatsOrder: number[];
  private readonly buttonSeat: number;
  private readonly blindsStructure: { sb: number; bb: number; ante: number };
  private readonly recordId: string;
  private readonly sessionId: string;
  private readonly seed: string;
  private ended = false;

  constructor(opts: HandBuilderOptions = {}) {
    const seats = [...(opts.seats ?? [0, 1])].sort((a, b) => a - b);
    const handNumber = opts.handNumber ?? 1;
    const stack = opts.stack ?? 10_000;
    this.buttonSeat = opts.button ?? (seats[0] as number);
    this.seatsOrder = seats;
    this.blindsStructure = { sb: opts.sb ?? 50, bb: opts.bb ?? 100, ante: opts.ante ?? 0 };
    this.recordId = opts.id ?? `hand-${handNumber}`;
    this.sessionId = opts.sessionId ?? "session-test";
    this.seed = opts.seed ?? `seed-${handNumber}`;
    this.config = {
      variant: "nlhe",
      maxSeats: opts.maxSeats ?? Math.max(seats.length, 6),
      sb: this.blindsStructure.sb,
      bb: this.blindsStructure.bb,
      ante: this.blindsStructure.ante,
    };

    const startSeats: Array<{ seat: number; stack: number }> = [];
    for (const seat of seats) {
      const s = opts.stacks?.[seat] ?? stack;
      this.state.set(seat, {
        seat,
        stack: s,
        committedStreet: 0,
        committedTotal: 0,
        folded: false,
        awarded: 0,
      });
      startSeats.push({ seat, stack: s });
    }
    this.events.push({
      t: "start",
      handNumber,
      button: this.buttonSeat,
      seats: startSeats,
      blinds: { ...this.blindsStructure },
    });

    const deck: Card[] = [];
    for (let i = 0; i < 52; i++) deck.push(i);
    this.deck = streamFor(this.seed, `test-deck/${handNumber}`).shuffle(deck);

    for (const name of opts.board ?? []) this.plannedBoard.push(this.reserve(name));
  }

  /** Mark a card as spoken for so `deal()` will not hand it to a player. */
  reserve(name: string): Card {
    const card = cardFromString(name);
    if (this.used.has(card)) throw new Error(`card ${name} already used in this hand`);
    this.used.add(card);
    this.reserved.add(card);
    return card;
  }

  /** Seats in action order starting one seat left of the button. */
  private orderFromButton(): number[] {
    const at = this.seatsOrder.indexOf(this.buttonSeat);
    return [...this.seatsOrder.slice(at + 1), ...this.seatsOrder.slice(0, at + 1)];
  }

  private seatState(seat: number): SeatState {
    const s = this.state.get(seat);
    if (s === undefined) throw new Error(`seat ${seat} is not dealt in`);
    return s;
  }

  private nextCard(): Card {
    while (this.deckAt < this.deck.length) {
      const card = this.deck[this.deckAt++] as Card;
      if (!this.used.has(card)) {
        this.used.add(card);
        return card;
      }
    }
    throw new Error("test deck exhausted");
  }

  private take(card: Card): Card {
    if (this.reserved.has(card)) {
      this.reserved.delete(card);
      return card;
    }
    if (this.used.has(card)) throw new Error(`card ${card} already used in this hand`);
    this.used.add(card);
    return card;
  }

  /** The next planned board card, or a fresh deck card when none was planned. */
  private nextBoardCard(): Card {
    const planned = this.plannedBoard[this.plannedAt];
    if (planned !== undefined) {
      this.plannedAt += 1;
      return this.take(planned);
    }
    return this.nextCard();
  }

  /** Post the blinds (and antes, when non-zero) in standard order. */
  blinds(): this {
    const order = this.orderFromButton();
    const heads = this.seatsOrder.length === 2;
    const sbSeat = heads ? this.buttonSeat : (order[0] as number);
    const bbSeat = heads ? (order[0] as number) : (order[1] as number);
    if (this.blindsStructure.ante > 0) {
      for (const seat of this.seatsOrder) this.post(seat, "ante", this.blindsStructure.ante);
    }
    this.post(sbSeat, "sb", this.blindsStructure.sb);
    this.post(bbSeat, "bb", this.blindsStructure.bb);
    return this;
  }

  post(seat: number, kind: "sb" | "bb" | "ante", amount: number): this {
    const s = this.seatState(seat);
    const paid = Math.min(amount, s.stack);
    if (paid <= 0) return this;
    s.stack -= paid;
    s.committedTotal += paid;
    if (kind !== "ante") s.committedStreet += paid;
    this.events.push({ t: "post", seat, kind, amount: paid });
    return this;
  }

  /** Deal two cards to `seat`; explicit names or the next unused deck cards. */
  dealTo(seat: number, a?: string, b?: string): this {
    const c1 = a === undefined ? this.nextCard() : this.take(cardFromString(a));
    const c2 = b === undefined ? this.nextCard() : this.take(cardFromString(b));
    this.events.push({ t: "hole", seat, cards: [c1, c2] });
    return this;
  }

  /** Deal every seat that has no hole cards yet. */
  deal(): this {
    const dealt = new Set(
      this.events.filter((e): e is Extract<HandEvent, { t: "hole" }> => e.t === "hole").map((e) => e.seat),
    );
    for (const seat of this.orderFromButton()) {
      if (!dealt.has(seat)) this.dealTo(seat);
    }
    return this;
  }

  private maxStreet(): number {
    let max = 0;
    for (const s of this.state.values()) if (s.committedStreet > max) max = s.committedStreet;
    return max;
  }

  fold(seat: number): this {
    this.seatState(seat).folded = true;
    this.events.push({ t: "act", seat, kind: "fold" });
    return this;
  }

  check(seat: number): this {
    this.events.push({ t: "act", seat, kind: "check" });
    return this;
  }

  /** Call the current bet; the amount is computed from street commitments. */
  call(seat: number): this {
    const s = this.seatState(seat);
    const amount = Math.min(this.maxStreet() - s.committedStreet, s.stack);
    if (amount <= 0) return this.check(seat);
    s.stack -= amount;
    s.committedStreet += amount;
    s.committedTotal += amount;
    this.events.push({ t: "act", seat, kind: "call", amount });
    return this;
  }

  bet(seat: number, amount: number): this {
    const s = this.seatState(seat);
    const paid = Math.min(amount, s.stack);
    s.stack -= paid;
    s.committedStreet += paid;
    s.committedTotal += paid;
    this.events.push({ t: "act", seat, kind: "bet", amount: paid });
    return this;
  }

  /** Raise to a total street commitment of `toAmount` (capped by the stack). */
  raise(seat: number, toAmount: number): this {
    const s = this.seatState(seat);
    const want = toAmount - s.committedStreet;
    const paid = Math.min(want, s.stack);
    if (paid <= 0) throw new Error(`raise to ${toAmount} adds nothing for seat ${seat}`);
    s.stack -= paid;
    s.committedStreet += paid;
    s.committedTotal += paid;
    this.events.push({ t: "act", seat, kind: "raise", toAmount: s.committedStreet });
    return this;
  }

  /** Shove: raise to the seat's whole remaining street-plus-stack total. */
  jam(seat: number): this {
    const s = this.seatState(seat);
    return this.raise(seat, s.committedStreet + s.stack);
  }

  private board(street: "flop" | "turn" | "river", names: string[]): this {
    const count = street === "flop" ? 3 : 1;
    const list: Card[] = [];
    for (let i = 0; i < count; i++) {
      const name = names[i];
      list.push(name === undefined ? this.nextBoardCard() : this.take(cardFromString(name)));
    }
    for (const s of this.state.values()) s.committedStreet = 0;
    this.events.push({ t: "board", street, cards: list });
    return this;
  }

  flop(...names: string[]): this {
    return this.board("flop", names);
  }
  turn(...names: string[]): this {
    return this.board("turn", names);
  }
  river(...names: string[]): this {
    return this.board("river", names);
  }

  /** Reveal the given seats' dealt hole cards, in order. */
  showdown(...seats: number[]): this {
    const reveals: Array<{ seat: number; cards: [Card, Card] }> = [];
    for (const seat of seats) {
      const hole = this.events.find(
        (e): e is Extract<HandEvent, { t: "hole" }> => e.t === "hole" && e.seat === seat,
      );
      if (hole === undefined) throw new Error(`seat ${seat} has no hole cards to reveal`);
      reveals.push({ seat, cards: [hole.cards[0], hole.cards[1]] });
    }
    this.events.push({ t: "showdown", reveals });
    return this;
  }

  /** Total chips in the pot. */
  pot(): number {
    let sum = 0;
    for (const s of this.state.values()) sum += s.committedTotal;
    return sum;
  }

  /** Award the whole (remaining) pot to `seat`. */
  award(seat: number, amount?: number): this {
    let awardedSoFar = 0;
    for (const s of this.state.values()) awardedSoFar += s.awarded;
    const value = amount ?? this.pot() - awardedSoFar;
    if (value <= 0) return this;
    this.seatState(seat).awarded += value;
    this.events.push({ t: "pot", potIndex: 0, seat, amount: value });
    return this;
  }

  /** Emit the `end` event with nets derived from commitments and awards. */
  done(): this {
    if (this.ended) return this;
    this.ended = true;
    const net = this.seatsOrder.map((seat) => {
      const s = this.seatState(seat);
      return { seat, net: s.awarded - s.committedTotal };
    });
    this.events.push({ t: "end", net });
    return this;
  }

  /** Build the record, validating its structure. */
  build(): HandRecord {
    this.done();
    const record: HandRecord = {
      v: 1,
      id: this.recordId,
      sessionId: this.sessionId,
      seed: this.seed,
      config: this.config,
      events: this.events,
    };
    const result = validateEvents(record.events);
    if (!result.ok) {
      throw new Error(`test hand ${this.recordId} is structurally invalid:\n  ${result.errors.join("\n  ")}`);
    }
    return record;
  }
}

/** Start a hand builder. */
export function hand(opts: HandBuilderOptions = {}): HandBuilder {
  return new HandBuilder(opts);
}
