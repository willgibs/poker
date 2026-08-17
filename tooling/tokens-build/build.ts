/**
 * Token build — emits `packages/ui/src/tokens.gen.css` from the TypeScript
 * token source. Run with `pnpm tokens:build`; the output is committed.
 *
 * All of the interesting work lives in `@poker/ui`'s `tokens/emit.ts` so that
 * the emitter is unit-testable inside the package it serves. This file is the
 * I/O shell: read nothing, compute nothing, just write the string.
 *
 * The write is idempotent — if the generated file already matches, nothing is
 * touched, so a no-op build never dirties the working tree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCss } from "../../packages/ui/src/tokens/emit";

const OUTPUT_URL = new URL("../../packages/ui/src/tokens.gen.css", import.meta.url);
const outputPath = fileURLToPath(OUTPUT_URL);
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const css = buildCss();

let current: string | null = null;
try {
  current = readFileSync(outputPath, "utf8");
} catch {
  current = null;
}

const rel = relative(repoRoot, outputPath);
if (current === css) {
  process.stdout.write(`tokens: ${rel} already up to date\n`);
} else {
  writeFileSync(outputPath, css, "utf8");
  process.stdout.write(`tokens: wrote ${rel} (${css.length} bytes)\n`);
}
