/**
 * `/table` — the felt.
 *
 * This wave renders the scene `poker-internal/design/explorations/table.html`
 * runs through every study: 6-max, board Q♥ 7♦ 2♣ K♦, pot $18.40, Rocco's
 * $4.60 in front of him, and the hero facing it with A♠ Q♦. Everything on the
 * page is real code — the real `TableStage`, the real `ActionBar` driven by a
 * real `LegalActions` menu, the real price chip — wired to a frozen scene
 * instead of a live session.
 *
 * The seam where that changes is `SessionAdapter`, below. It is written as a
 * type today so the next wave replaces one constant with one hook and nothing
 * else moves: the route already speaks only view-models and callbacks.
 *
 * Keep the export named `TableRoute` — `router.ts` imports it by name.
 */
import { TableStage } from "@poker/table-ui";
import type { SizePreset, StageActionState, TableHeaderProps, TableStageView } from "@poker/table-ui";
import type { LegalActions } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { formatStakes } from "@poker/ui";

import "@poker/table-ui/components.css";
import "@poker/table-ui/hero.css";
import "@poker/table-ui/stage.css";
import "./table.css";

/* -------------------------------------------------------------------------- */
/* TODO(sim-wiring): the seam                                                  */
/* -------------------------------------------------------------------------- */

/**
 * TODO(sim-wiring): what `/table` will consume once `@poker/sim` runs a session.
 *
 * The contract is deliberately narrow, and it is the same one-way flow
 * `docs/architecture.md` describes: the session owns engine truth in a worker,
 * hands the route a **view-model** for the felt and a burst of **HandEvents**
 * for the Presenter to schedule, and takes back exactly four intents. The
 * route will:
 *
 *   1. render `adapter.view` / `adapter.header` — no derivation on this side;
 *   2. `adapter.subscribe(events => stage.current?.enqueue(events))`, so
 *      engine truth reaches the felt as beats and never as a re-render;
 *   3. pass the four intents straight through to the stage's handlers.
 *
 * Nothing here computes a bet size, a pot odd, or a legality — those are
 * `@poker/engine`, `@poker/equity` and `@poker/sim` respectively. When this
 * interface is implemented, `STATIC_SCENE` below is the only thing that dies.
 */
export interface SessionAdapter {
  /** The felt, right now. */
  readonly view: TableStageView;
  /** The four header slots. */
  readonly header: TableHeaderProps;
  /**
   * Engine event bursts as the session produces them, for the Presenter.
   * Returns the unsubscribe.
   */
  subscribe(onEvents: (events: readonly HandEvent[]) => void): () => void;

  fold(): void;
  check(): void;
  /** The exact call amount from the menu — never a recomputed one. */
  call(amountCents: number): void;
  /** Bet amount, or raise-TO total. Always integer cents. */
  commit(amountCents: number): void;
}

/* -------------------------------------------------------------------------- */
/* The frozen scene (table.html, Studies 1–3)                                 */
/* -------------------------------------------------------------------------- */

const BIG_BLIND_CENTS = 25;

/** Facing Rocco's $4.60 into $18.40 — the menu `legalActions()` would return. */
const LEGAL: LegalActions = {
  fold: true,
  call: { amount: 460 },
  raise: { minTo: 920, maxTo: 4255 },
};

/** Study 3B's sizing row, verbatim: the coach's half-pot is pre-armed. */
const PRESETS: readonly SizePreset[] = [
  { id: "third", label: "33%", amountCents: 610 },
  { id: "half", label: "50%", amountCents: 920, suggested: true },
  { id: "twothirds", label: "66%", amountCents: 1215 },
  { id: "pot", label: "Pot", amountCents: 1840 },
  { id: "allin", label: "All-in", amountCents: 4255 },
];

const ACTION: StageActionState = {
  legal: LEGAL,
  presets: PRESETS,
  bigBlindCents: BIG_BLIND_CENTS,
  // The one coach line (table.html Study 3A).
  coach: "The king changes less than it looks — your queens are still good. Half pot keeps worse pairs in.",
  // The one price chip, in its facing-a-bet state (Study 3C).
  price: { kind: "call", callCents: 460, ratio: 3.4, needPct: 23 },
};

/**
 * Slot order: the hero's chair first, then clockwise — Barry on the left rail,
 * Doris, Rocco at the top with the action, Priya, Silas on the right with the
 * button. Exactly the six chairs table.html draws at 6-max.
 */
const STATIC_SCENE: TableStageView = {
  density: 6,
  seats: [
    { seat: 0, name: "Hero", hero: true, stackCents: 4255 },
    { seat: 1, name: "Barry", stackCents: 1230, folded: true },
    { seat: 2, name: "Doris", stackCents: 3175, folded: true, earnedRead: true },
    { seat: 3, name: "Rocco", stackCents: 2430, betCents: 460, betTier: 2, thinking: false, faceDown: 2 },
    { seat: 4, name: "Priya", stackCents: 2410, folded: true },
    { seat: 5, name: "Silas", stackCents: 6120, button: true, faceDown: 2 },
  ],
  board: ["Qh", "7d", "2c", "Kd"],
  potCents: 1840,
  hero: { seat: 0, cards: ["As", "Qd"] },
  actionState: ACTION,
};

const HEADER: TableHeaderProps = {
  stakes: formatStakes(10, BIG_BLIND_CENTS),
  netCents: 1420,
  bigBlindCents: BIG_BLIND_CENTS,
  handsPlayed: 34,
  loadoutName: "Guided",
};

/* -------------------------------------------------------------------------- */

/**
 * No-op handlers, on purpose. The bar is fully live — it expands, arms a size,
 * takes the keyboard — and commits into nothing, because there is no session to
 * commit to yet. Wiring them to a fake session would make this page lie about
 * what works.
 */
const noop = (): void => {};

export function TableRoute() {
  return (
    <div className="table-route">
      <TableStage
        view={STATIC_SCENE}
        header={HEADER}
        label="table, four-handed to the turn"
        onFold={noop}
        onCheck={noop}
        onCall={noop}
        onCommit={noop}
      />
    </div>
  );
}
