/**
 * Session checkpoints — resume a session exactly where it stopped.
 *
 * A checkpoint is JSON-safe by construction and only valid at a **hand
 * boundary**: mid-hand there is engine state, a shuffled deck and a pending
 * hero decision in flight, none of which belongs in a durable blob (and all of
 * which is re-derivable from the seed anyway). The data layer stores this as
 * `SessionRow.checkpoint` (docs/data-layer.md).
 *
 * The correctness bar is exact, and `checkpoint.test.ts` asserts it: a session
 * checkpointed at hand K, restored, and run to hand N produces event logs
 * byte-identical to the uninterrupted run. That is what makes the blob a
 * resume point rather than an approximation — the bots' tilt, opponent models
 * and tell cooldowns all travel with it.
 *
 * Runtime injections (a custom `evaluate7`, a preflop `chartSet`) are NOT
 * stored — they are code and data the caller owns — and must be re-supplied
 * through {@link restoreSession}'s `runtime` argument.
 */

import { type BotState, restoreBotState, snapshotBotState } from "@poker/bots";
import type { BotStateSnapshot } from "@poker/bots";
import {
  type ResumeState,
  type Session,
  SessionError,
  internalsOf,
  resumeSession,
} from "./session";
import type { SessionConfig, SessionRuntime } from "./types";

/** Checkpoint schema version. */
export const CHECKPOINT_VERSION = 1;

/** A JSON-safe, round-trippable snapshot of a session at a hand boundary. */
export interface SessionCheckpoint {
  v: 1;
  sessionId: string;
  /** The config the session was created with, verbatim. */
  config: SessionConfig;
  /** Hands completed. */
  handsPlayed: number;
  /** Number the next hand will carry. */
  nextHandNumber: number;
  /** Ring position the button search starts from. */
  buttonCursor: number;
  /** Stacks by seat, cents. */
  stacks: number[];
  /** Cumulative rake taken, cents. */
  rakeTotalCents: number;
  /** Cumulative chips bought in, cents. */
  buyInTotalCents: number;
  /** Bot memory, keyed by seat number as a string. */
  botStates: Record<string, BotStateSnapshot>;
}

/**
 * Capture a session.
 *
 * @throws SessionError when a hero decision is pending — checkpoints are
 * hand-boundary only.
 */
export function serializeSession(session: Session): SessionCheckpoint {
  const s = internalsOf(session);
  if (s.awaitingHero) {
    throw new SessionError("cannot checkpoint mid-hand: a hero decision is pending");
  }
  const botStates: Record<string, BotStateSnapshot> = {};
  for (const [seat, state] of s.botStates) botStates[String(seat)] = snapshotBotState(state);
  return {
    v: CHECKPOINT_VERSION,
    sessionId: s.sessionId,
    config: structuredConfig(s.config),
    handsPlayed: s.handsPlayed,
    nextHandNumber: s.nextHandNumber,
    buttonCursor: s.buttonCursor,
    stacks: [...s.stacks],
    rakeTotalCents: s.rakeTotalCents,
    buyInTotalCents: s.buyInTotalCents,
    botStates,
  };
}

/** A deep, JSON-safe copy of the config (it is plain data by contract). */
function structuredConfig(config: SessionConfig): SessionConfig {
  return JSON.parse(JSON.stringify(config)) as SessionConfig;
}

function intAt(raw: Record<string, unknown>, key: string, errors: string[]): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    errors.push(`${key} must be a non-negative safe integer, got ${String(v)}`);
    return 0;
  }
  return v;
}

/**
 * Validate and restore a checkpoint.
 *
 * @param raw the blob produced by {@link serializeSession} (or its JSON
 * round-trip — they are the same value).
 * @param runtime injections the blob cannot carry (evaluator, chart set).
 * @throws RangeError listing every problem, rather than resuming a session with
 * impossible state.
 */
export function restoreSession(raw: unknown, runtime?: SessionRuntime): Session {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object") {
    throw new RangeError("session checkpoint must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r["v"] !== CHECKPOINT_VERSION) {
    throw new RangeError(`unsupported session checkpoint version: ${String(r["v"])}`);
  }
  const config = r["config"];
  if (config === null || typeof config !== "object") {
    throw new RangeError("session checkpoint is missing its config");
  }

  const handsPlayed = intAt(r, "handsPlayed", errors);
  const nextHandNumber = intAt(r, "nextHandNumber", errors);
  const buttonCursor = intAt(r, "buttonCursor", errors);
  const rakeTotalCents = intAt(r, "rakeTotalCents", errors);
  const buyInTotalCents = intAt(r, "buyInTotalCents", errors);
  if (nextHandNumber < 1) errors.push("nextHandNumber must be >= 1");

  const rawStacks = r["stacks"];
  const stacks: number[] = [];
  if (!Array.isArray(rawStacks)) {
    errors.push("stacks must be an array");
  } else {
    rawStacks.forEach((v: unknown, i: number) => {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
        errors.push(`stacks[${i}] must be a non-negative integer (cents), got ${String(v)}`);
        stacks.push(0);
        return;
      }
      stacks.push(v);
    });
  }

  const botStates = new Map<number, BotState>();
  const rawBots = r["botStates"];
  if (rawBots !== undefined) {
    if (rawBots === null || typeof rawBots !== "object") {
      errors.push("botStates must be an object");
    } else {
      for (const [seat, snapshot] of Object.entries(rawBots as Record<string, unknown>)) {
        const n = Number(seat);
        if (!Number.isSafeInteger(n) || n < 0) {
          errors.push(`botStates key ${JSON.stringify(seat)} is not a seat number`);
          continue;
        }
        try {
          botStates.set(n, restoreBotState(snapshot));
        } catch (e) {
          errors.push(`botStates[${seat}]: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new RangeError(`invalid session checkpoint:\n  ${errors.join("\n  ")}`);
  }

  const resume: ResumeState = {
    handsPlayed,
    nextHandNumber,
    buttonCursor,
    stacks,
    rakeTotalCents,
    buyInTotalCents,
    botStates,
  };
  const restored = resumeSession(config as SessionConfig, runtime, resume);
  const sessionId = r["sessionId"];
  if (typeof sessionId === "string" && sessionId !== restored.sessionId) {
    throw new RangeError(
      `checkpoint sessionId ${JSON.stringify(sessionId)} does not match the id derived from its config (${JSON.stringify(restored.sessionId)})`,
    );
  }
  return restored;
}
