/**
 * Atomic solidarity, first brick.
 *
 * The design system owns colour. `src/tokens/` is the one place a colour
 * literal may be written; everywhere else in TypeScript must reach values
 * through the token objects or `cssVar()`. This scan is deliberately dumb and
 * fast so it can grow to cover the component packages and `apps/web` as they
 * land (the PRD's lint-enforced rule also bans raw buttons, arbitrary Tailwind
 * values, and direct motion imports outside the system packages).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL(".", import.meta.url));
const TOKEN_ROOT = join(SRC_ROOT, "tokens");
const TOOLING_ROOT = fileURLToPath(new URL("../../../tooling/tokens-build", import.meta.url));

/**
 * Assembled from parts so this file does not flag itself. Matches the hash form
 * in 3, 4, 6, and 8 hex digits (the 4/8 forms carry alpha).
 */
const COLOUR_LITERAL = new RegExp("#" + "(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b", "g");

function tsFilesIn(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

describe("atomic solidarity", () => {
  it("finds files to scan", () => {
    expect(tsFilesIn(SRC_ROOT).length).toBeGreaterThan(0);
    expect(tsFilesIn(TOOLING_ROOT).length).toBeGreaterThan(0);
  });

  it("confines colour literals to src/tokens/", () => {
    const scanned = [...tsFilesIn(SRC_ROOT), ...tsFilesIn(TOOLING_ROOT)].filter(
      (file) => !file.startsWith(TOKEN_ROOT),
    );

    const offenders: string[] = [];
    for (const file of scanned) {
      const matches = readFileSync(file, "utf8").match(COLOUR_LITERAL);
      if (matches) offenders.push(`${relative(SRC_ROOT, file)}: ${matches.join(", ")}`);
    }

    expect(offenders, "colour literals outside packages/ui/src/tokens/").toEqual([]);
  });

  it("still catches a colour literal when one appears", () => {
    const sample = "const bad = " + '"' + "#" + 'ff00aa";';
    expect(sample.match(COLOUR_LITERAL)).not.toBeNull();
  });
});
