/**
 * PokerStars-style text export — exportHandText.
 *
 * Readable standard-format hand history. Hole cards are hidden except the
 * hero's (opts.heroSeat) and any cards revealed at showdown. Informative
 * format: the canonical data is the event log, not this text.
 * Line shapes are documented in docs/hand-format.md §Text export.
 */

import type { HandEvent, HandRecord, HandStart } from "./types";
import { cardToString } from "./cards";

export interface ExportOptions {
  /** Seat whose hole cards are shown in the "Dealt to" line. */
  heroSeat?: number;
}

/** Integer-cents → "$12.34" (no float chip math). */
function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = (abs - (abs % 100)) / 100;
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, "0")}`;
}

function fmtCards(cards: readonly number[]): string {
  return `[${cards.map(cardToString).join(" ")}]`;
}

function playerName(seat: number): string {
  return `Player ${seat}`;
}

/** Render a HandRecord as PokerStars-style text. Ends with a newline. */
export function exportHandText(record: HandRecord, opts: ExportOptions = {}): string {
  const heroSeat = opts.heroSeat;
  const events = record.events;
  const start = events.find((e): e is HandStart => e.t === "start");
  if (start === undefined) throw new Error("exportHandText: record has no start event");

  const lines: string[] = [];
  lines.push(`Hand #${start.handNumber}: Hold'em No Limit (${fmtMoney(start.blinds.sb)}/${fmtMoney(start.blinds.bb)})`);
  lines.push(`Table '${record.sessionId}' ${record.config.maxSeats}-max Seat #${start.button} is the button`);
  for (const s of start.seats) {
    lines.push(`Seat ${s.seat}: ${playerName(s.seat)} (${fmtMoney(s.stack)} in chips)`);
  }

  // Distinct pot indexes, for "pot" vs "main pot"/"side pot" wording.
  const potIndexes = new Set<number>();
  for (const e of events) if (e.t === "pot") potIndexes.add(e.potIndex);
  const potLabel = (potIndex: number): string => {
    if (potIndexes.size <= 1) return "pot";
    if (potIndex === 0) return "main pot";
    return potIndexes.size > 2 ? `side pot ${potIndex}` : "side pot";
  };

  let holeHeaderPrinted = false;
  const printHoleHeaderOnce = (): void => {
    if (!holeHeaderPrinted) {
      lines.push("*** HOLE CARDS ***");
      holeHeaderPrinted = true;
    }
  };

  const board: number[] = [];
  let betLevel = 0; // highest per-seat street commitment so far, this street
  let totalPot = 0;

  for (const e of events as readonly HandEvent[]) {
    switch (e.t) {
      case "start":
        break;
      case "post": {
        const who = playerName(e.seat);
        if (e.kind === "sb") lines.push(`${who}: posts small blind ${fmtMoney(e.amount)}`);
        else if (e.kind === "bb") lines.push(`${who}: posts big blind ${fmtMoney(e.amount)}`);
        else lines.push(`${who}: posts the ante ${fmtMoney(e.amount)}`);
        if (e.kind !== "ante" && e.amount > betLevel) betLevel = e.amount;
        break;
      }
      case "hole": {
        printHoleHeaderOnce();
        if (e.seat === heroSeat) lines.push(`Dealt to ${playerName(e.seat)} ${fmtCards(e.cards)}`);
        break;
      }
      case "act": {
        printHoleHeaderOnce();
        const who = playerName(e.seat);
        switch (e.kind) {
          case "fold":
            lines.push(`${who}: folds`);
            break;
          case "check":
            lines.push(`${who}: checks`);
            break;
          case "call":
            lines.push(`${who}: calls ${fmtMoney(e.amount ?? 0)}`);
            break;
          case "bet": {
            const amount = e.amount ?? 0;
            lines.push(`${who}: bets ${fmtMoney(amount)}`);
            if (amount > betLevel) betLevel = amount;
            break;
          }
          case "raise": {
            const to = e.toAmount ?? 0;
            lines.push(`${who}: raises ${fmtMoney(to - betLevel)} to ${fmtMoney(to)}`);
            if (to > betLevel) betLevel = to;
            break;
          }
        }
        break;
      }
      case "board": {
        const prior = fmtCards(board);
        const dealtNow = fmtCards(e.cards);
        if (e.street === "flop") lines.push(`*** FLOP *** ${dealtNow}`);
        else if (e.street === "turn") lines.push(`*** TURN *** ${prior} ${dealtNow}`);
        else lines.push(`*** RIVER *** ${prior} ${dealtNow}`);
        board.push(...e.cards);
        betLevel = 0;
        break;
      }
      case "showdown": {
        lines.push("*** SHOW DOWN ***");
        for (const r of e.reveals) {
          lines.push(`${playerName(r.seat)}: shows ${fmtCards(r.cards)}`);
        }
        break;
      }
      case "pot": {
        totalPot += e.amount;
        lines.push(`${playerName(e.seat)} collected ${fmtMoney(e.amount)} from ${potLabel(e.potIndex)}`);
        break;
      }
      case "end":
        break;
    }
  }

  lines.push("*** SUMMARY ***");
  lines.push(`Total pot ${fmtMoney(totalPot)}`);
  if (board.length > 0) lines.push(`Board ${fmtCards(board)}`);

  return lines.join("\n") + "\n";
}
