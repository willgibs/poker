/**
 * Compact serialization — encodeHand / decodeHand.
 *
 * JSON-safe: the encoded form contains only plain objects, arrays, strings,
 * integers, and nulls, and survives JSON.stringify → JSON.parse unchanged.
 * Events become short tuple arrays (e.g. ['act', seat, kind, amount]); the
 * envelope stays a small object. Exact round-trip: decodeHand(encodeHand(r))
 * deep-equals r, including presence/absence of optional fields.
 *
 * Tuple layouts are normative — see docs/hand-format.md §Compact encoding.
 */

import type {
  ActionKind,
  BlindKind,
  BoardStreet,
  Card,
  DealBoard,
  DealHole,
  HandEnd,
  HandEvent,
  HandRecord,
  HandStart,
  PlayerAction,
  PostBlind,
  PotAwarded,
  Showdown,
  TableConfig,
} from "./types";
import { HAND_RECORD_VERSION } from "./types";

/** One encoded event tuple. First element is the event's `t` tag. */
export type EncodedEvent = Array<string | number | null | number[]>;

/** The JSON-safe encoded envelope. */
export interface EncodedHand {
  v: 1;
  id: string;
  sessionId: string;
  seed: string;
  config: TableConfig;
  events: EncodedEvent[];
  annotations?: Record<string, unknown>;
}

/** Thrown by decodeHand/decodeEvent on any malformed input. */
export class HandDecodeError extends Error {
  override name = "HandDecodeError";
}

const ACTION_KINDS: readonly string[] = ["fold", "check", "call", "bet", "raise"];
const BLIND_KINDS: readonly string[] = ["sb", "bb", "ante"];
const BOARD_STREETS: readonly string[] = ["flop", "turn", "river"];

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Encode a single event to its compact tuple form. */
export function encodeEvent(e: HandEvent): EncodedEvent {
  switch (e.t) {
    case "start": {
      const seats: number[] = [];
      for (const s of e.seats) seats.push(s.seat, s.stack);
      return ["start", e.handNumber, e.button, seats, e.blinds.sb, e.blinds.bb, e.blinds.ante];
    }
    case "post":
      return ["post", e.seat, e.kind, e.amount];
    case "hole":
      return ["hole", e.seat, e.cards[0], e.cards[1]];
    case "act": {
      // Fixed field positions [amount, toAmount, thinkTimeMs]; absent fields
      // encode as null; trailing nulls are trimmed.
      const tail: Array<number | null> = [e.amount ?? null, e.toAmount ?? null, e.thinkTimeMs ?? null];
      while (tail.length > 0 && tail[tail.length - 1] === null) tail.pop();
      return ["act", e.seat, e.kind, ...tail];
    }
    case "board":
      return ["board", e.street, ...e.cards];
    case "showdown": {
      const flat: number[] = [];
      for (const r of e.reveals) flat.push(r.seat, r.cards[0], r.cards[1]);
      return ["showdown", ...flat];
    }
    case "pot":
      return ["pot", e.potIndex, e.seat, e.amount];
    case "end": {
      const flat: number[] = [];
      for (const n of e.net) flat.push(n.seat, n.net);
      return ["end", ...flat];
    }
  }
}

/** Encode a HandRecord to its JSON-safe compact form. */
export function encodeHand(record: HandRecord): EncodedHand {
  const out: EncodedHand = {
    v: record.v,
    id: record.id,
    sessionId: record.sessionId,
    seed: record.seed,
    config: { ...record.config },
    events: record.events.map(encodeEvent),
  };
  if (record.annotations !== undefined) out.annotations = { ...record.annotations };
  return out;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function fail(msg: string): never {
  throw new HandDecodeError(msg);
}

function intAt(e: readonly unknown[], i: number, what: string): number {
  const v = e[i];
  if (typeof v !== "number" || !Number.isInteger(v)) fail(`${what}: expected integer at tuple index ${i}`);
  return v;
}

function nonNegIntAt(e: readonly unknown[], i: number, what: string): number {
  const v = intAt(e, i, what);
  if (v < 0) fail(`${what}: expected non-negative integer at tuple index ${i}`);
  return v;
}

function cardAt(e: readonly unknown[], i: number, what: string): Card {
  const v = intAt(e, i, what);
  if (v < 0 || v > 51) fail(`${what}: card out of range 0..51 at tuple index ${i}`);
  return v;
}

function stringAt(e: readonly unknown[], i: number, what: string): string {
  const v = e[i];
  if (typeof v !== "string") fail(`${what}: expected string at tuple index ${i}`);
  return v;
}

function expectLength(e: readonly unknown[], n: number, what: string): void {
  if (e.length !== n) fail(`${what}: expected tuple of length ${n}, got ${e.length}`);
}

/** Decode a single compact event tuple. Throws HandDecodeError when malformed. */
export function decodeEvent(data: unknown): HandEvent {
  if (!Array.isArray(data) || data.length === 0) fail("event: expected non-empty tuple array");
  const e: readonly unknown[] = data;
  const tag = e[0];
  switch (tag) {
    case "start": {
      expectLength(e, 7, "start");
      const handNumber = nonNegIntAt(e, 1, "start.handNumber");
      const button = nonNegIntAt(e, 2, "start.button");
      const flat = e[3];
      if (!Array.isArray(flat) || flat.length % 2 !== 0) fail("start.seats: expected flat [seat,stack,...] array of even length");
      const seats: HandStart["seats"] = [];
      for (let i = 0; i < flat.length; i += 2) {
        seats.push({ seat: nonNegIntAt(flat, i, "start.seats.seat"), stack: nonNegIntAt(flat, i + 1, "start.seats.stack") });
      }
      const blinds = {
        sb: nonNegIntAt(e, 4, "start.blinds.sb"),
        bb: nonNegIntAt(e, 5, "start.blinds.bb"),
        ante: nonNegIntAt(e, 6, "start.blinds.ante"),
      };
      return { t: "start", handNumber, button, seats, blinds };
    }
    case "post": {
      expectLength(e, 4, "post");
      const seat = nonNegIntAt(e, 1, "post.seat");
      const kind = stringAt(e, 2, "post.kind");
      if (!BLIND_KINDS.includes(kind)) fail(`post.kind: unknown kind ${JSON.stringify(kind)}`);
      const amount = nonNegIntAt(e, 3, "post.amount");
      const ev: PostBlind = { t: "post", seat, kind: kind as BlindKind, amount };
      return ev;
    }
    case "hole": {
      expectLength(e, 4, "hole");
      const ev: DealHole = {
        t: "hole",
        seat: nonNegIntAt(e, 1, "hole.seat"),
        cards: [cardAt(e, 2, "hole.cards"), cardAt(e, 3, "hole.cards")],
      };
      return ev;
    }
    case "act": {
      if (e.length < 3 || e.length > 6) fail(`act: expected tuple of length 3..6, got ${e.length}`);
      const seat = nonNegIntAt(e, 1, "act.seat");
      const kind = stringAt(e, 2, "act.kind");
      if (!ACTION_KINDS.includes(kind)) fail(`act.kind: unknown kind ${JSON.stringify(kind)}`);
      const ev: PlayerAction = { t: "act", seat, kind: kind as ActionKind };
      const fields = ["amount", "toAmount", "thinkTimeMs"] as const;
      for (let i = 3; i < e.length; i++) {
        const v = e[i];
        if (v === null) continue; // absent optional field (interior null)
        const key = fields[i - 3];
        if (key === undefined) fail("act: too many fields");
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          fail(`act.${key}: expected non-negative integer at tuple index ${i}`);
        }
        ev[key] = v;
      }
      return ev;
    }
    case "board": {
      if (e.length < 2) fail("board: expected at least [tag, street]");
      const street = stringAt(e, 1, "board.street");
      if (!BOARD_STREETS.includes(street)) fail(`board.street: unknown street ${JSON.stringify(street)}`);
      const cards: Card[] = [];
      for (let i = 2; i < e.length; i++) cards.push(cardAt(e, i, "board.cards"));
      const ev: DealBoard = { t: "board", street: street as BoardStreet, cards };
      return ev;
    }
    case "showdown": {
      if ((e.length - 1) % 3 !== 0) fail("showdown: expected flat [seat,c1,c2,...] triples");
      const reveals: Showdown["reveals"] = [];
      for (let i = 1; i < e.length; i += 3) {
        reveals.push({
          seat: nonNegIntAt(e, i, "showdown.seat"),
          cards: [cardAt(e, i + 1, "showdown.cards"), cardAt(e, i + 2, "showdown.cards")],
        });
      }
      const ev: Showdown = { t: "showdown", reveals };
      return ev;
    }
    case "pot": {
      expectLength(e, 4, "pot");
      const ev: PotAwarded = {
        t: "pot",
        potIndex: nonNegIntAt(e, 1, "pot.potIndex"),
        seat: nonNegIntAt(e, 2, "pot.seat"),
        amount: nonNegIntAt(e, 3, "pot.amount"),
      };
      return ev;
    }
    case "end": {
      if ((e.length - 1) % 2 !== 0) fail("end: expected flat [seat,net,...] pairs");
      const net: HandEnd["net"] = [];
      for (let i = 1; i < e.length; i += 2) {
        net.push({ seat: nonNegIntAt(e, i, "end.seat"), net: intAt(e, i + 1, "end.net") });
      }
      const ev: HandEnd = { t: "end", net };
      return ev;
    }
    default:
      fail(`event: unknown tag ${JSON.stringify(tag)}`);
  }
}

function decodeConfig(data: unknown): TableConfig {
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail("config: expected object");
  const o = data as Record<string, unknown>;
  if (o["variant"] !== "nlhe") fail(`config.variant: expected "nlhe"`);
  const num = (key: string): number => {
    const v = o[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`config.${key}: expected non-negative integer`);
    return v;
  };
  const maxSeats = num("maxSeats");
  if (maxSeats < 2) fail("config.maxSeats: expected >= 2");
  return { variant: "nlhe", maxSeats, sb: num("sb"), bb: num("bb"), ante: num("ante") };
}

/** Decode a JSON-safe encoded hand back to a HandRecord. Throws HandDecodeError. */
export function decodeHand(data: unknown): HandRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail("hand: expected object");
  const o = data as Record<string, unknown>;
  const v = o["v"];
  if (v !== HAND_RECORD_VERSION) {
    fail(
      `hand: unsupported version ${JSON.stringify(v)} — this reader supports v${HAND_RECORD_VERSION}; ` +
        `newer major versions require upgrade-on-read (docs/hand-format.md §Versioning)`,
    );
  }
  const str = (key: string): string => {
    const s = o[key];
    if (typeof s !== "string") fail(`hand.${key}: expected string`);
    return s;
  };
  const id = str("id");
  const sessionId = str("sessionId");
  const seed = str("seed");
  const config = decodeConfig(o["config"]);
  const eventsRaw = o["events"];
  if (!Array.isArray(eventsRaw)) fail("hand.events: expected array");
  const events = eventsRaw.map(decodeEvent);
  const record: HandRecord = { v: HAND_RECORD_VERSION, id, sessionId, seed, config, events };
  const ann = o["annotations"];
  if (ann !== undefined) {
    if (typeof ann !== "object" || ann === null || Array.isArray(ann)) fail("hand.annotations: expected object");
    record.annotations = { ...(ann as Record<string, unknown>) };
  }
  return record;
}
