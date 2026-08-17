/**
 * Bot arena smoke harness — headless self-play for eyeballing behaviour and
 * checking the decision-latency budget (docs/architecture.md: bot decision
 * <= 50ms P50).
 *
 * Usage:
 *   node --import tsx packages/bots/bench/arena.ts [seed] [hands]
 *
 * Prints one hand's decision trace summary, then per-decision timings over a
 * batch of seeded hands. Not a test — an inspection tool. The real statistical
 * envelopes (VPIP/PFR/AF per persona) belong to the P1 arena dashboards.
 */

import { CAST } from "../src/cast/index";
import { playHand } from "../src/test-helpers";
import type { PersonaConfig } from "../src/persona";

const SEED = process.argv[2] ?? "arena";
const HANDS = Number(process.argv[3] ?? 60);
const STACKS = [20000, 20000, 20000, 20000, 20000, 20000];

function personaForSeat(seat: number): PersonaConfig {
  const p = CAST[seat % CAST.length];
  if (p === undefined) throw new Error("cast is empty");
  return p;
}

const sample = playHand({ seed: SEED, stacks: STACKS }, personaForSeat);
console.log(`— sample hand (seed "${SEED}") —`);
for (const { seat, decision } of sample.decisions) {
  const t = decision.trace;
  const amount = decision.amount === undefined ? "" : String(decision.amount);
  console.log(
    [
      t.context.street.padEnd(7),
      `s${seat}`,
      t.personaName.padEnd(13),
      decision.action.padEnd(6),
      amount.padEnd(7),
      `pot=${String(t.context.pot).padEnd(6)}`,
      `eq=${t.strength.equity.toFixed(3)}`,
      `pct=${t.strength.strengthPercentile.toFixed(2)}`,
      t.strength.made.padEnd(11),
      `think=${String(decision.thinkTimeMs).padEnd(5)}`,
      `gate=${t.shaping.bluffGate.open ? "open" : "shut"}`,
      `tells=[${t.tells.map((x) => x.id).join(",")}]`,
    ].join(" "),
  );
}

const perDecision: number[] = [];
let decisions = 0;
for (let i = 0; i < HANDS; i++) {
  const start = process.hrtime.bigint();
  const played = playHand({ seed: `${SEED}-${i}`, stacks: STACKS }, personaForSeat);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  decisions += played.decisions.length;
  perDecision.push(elapsedMs / Math.max(1, played.decisions.length));
}
perDecision.sort((a, b) => a - b);
const at = (q: number): string => (perDecision[Math.floor((perDecision.length - 1) * q)] ?? 0).toFixed(2);
console.log(
  `\n— ${HANDS} hands, ${decisions} decisions — ms/decision  p50=${at(0.5)}  p95=${at(0.95)}  max=${at(1)}`,
);
