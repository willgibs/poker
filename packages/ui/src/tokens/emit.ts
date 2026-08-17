/**
 * The token compiler: TypeScript source of truth -> `tokens.gen.css`.
 *
 * Lives in `@poker/ui` (not in the tooling package) so the emitted CSS can be
 * property-tested next to the tokens it comes from; `tooling/tokens-build` is a
 * thin `writeFileSync` wrapper around `buildCss()`.
 *
 * Determinism is a hard requirement — `buildCss()` is a pure function of static
 * data, reads no clock, no environment, and no filesystem, and every group's
 * key order is fixed by its declaration in `primitives.ts` / `semantic.ts`.
 */

import {
  blur,
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  ink,
  letterSpacing,
  lineHeight,
  radius,
  space,
  zLayer,
} from "./primitives";
import { semantic } from "./semantic";
import { DEFAULT_SKIN, resolveSkin, skinNames } from "./skins";
import type { SkinName } from "./skins";

/** Every custom property this design system owns starts with this. */
export const VAR_PREFIX = "--fr-";

/** `accentA` -> `accent-a`, `verySlow` -> `very-slow`, `950` -> `950`. */
export function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export interface CssVar {
  /** Full custom property name, including the `--fr-` prefix. */
  readonly name: string;
  readonly value: string;
}

interface TokenGroup {
  /** Human label for the section comment in the generated file. */
  readonly label: string;
  /** Namespace segment: `space` -> `--fr-space-4`. Empty for semantic tokens. */
  readonly prefix: string;
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * Primitive groups, in emission order. Springs, sound cues, and `textStyles`
 * are intentionally absent: they are not expressible as CSS values.
 */
const primitiveGroups: readonly TokenGroup[] = [
  { label: "ink ramp", prefix: "ink", tokens: ink },
  { label: "space (4-based)", prefix: "space", tokens: space },
  { label: "radii", prefix: "radius", tokens: radius },
  { label: "font stacks", prefix: "font", tokens: fontFamily },
  { label: "type scale", prefix: "font-size", tokens: fontSize },
  { label: "weights", prefix: "font-weight", tokens: fontWeight },
  { label: "line heights", prefix: "line-height", tokens: lineHeight },
  { label: "tracking", prefix: "letter-spacing", tokens: letterSpacing },
  { label: "motion — durations (beats.md §2.2)", prefix: "duration", tokens: duration },
  { label: "motion — easings (beats.md §2.2)", prefix: "ease", tokens: easing },
  { label: "motion — blur", prefix: "blur", tokens: blur },
  { label: "z layers", prefix: "z", tokens: zLayer },
];

function groupVars(group: TokenGroup): readonly CssVar[] {
  return Object.entries(group.tokens).map(([key, value]) => ({
    name: `${VAR_PREFIX}${group.prefix}-${kebab(key)}`,
    value,
  }));
}

/** Every primitive custom property, in emission order. */
export function primitiveVars(): readonly CssVar[] {
  return primitiveGroups.flatMap(groupVars);
}

/** Every semantic custom property for one skin, in declaration order. */
export function semanticVars(skin: SkinName): readonly CssVar[] {
  const resolved = resolveSkin(skin);
  return Object.keys(semantic).map((key) => ({
    name: `${VAR_PREFIX}${kebab(key)}`,
    value: resolved[key as keyof typeof semantic],
  }));
}

const HEADER = [
  "/*",
  " * GENERATED FILE — do not edit.",
  " * Source: packages/ui/src/tokens/*.ts",
  " * Regenerate: pnpm tokens:build",
  " *",
  " * Layer 1 (primitives) + layer 2 (semantic, resolved for the default skin)",
  " * land in :root. Layer 3 re-resolves the whole semantic layer per skin, so a",
  " * [data-skin] block is self-contained and switching skins cannot leave a",
  " * token behind.",
  " */",
].join("\n");

function block(selector: string, sections: readonly { comment?: string; vars: readonly CssVar[] }[]): string {
  const lines: string[] = [`${selector} {`];
  sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    if (section.comment !== undefined) lines.push(`  /* ${section.comment} */`);
    for (const { name, value } of section.vars) lines.push(`  ${name}: ${value};`);
  });
  lines.push("}");
  return lines.join("\n");
}

/**
 * The whole stylesheet, as a string. Pure: calling it twice in the same process
 * or in different processes yields byte-identical output.
 */
export function buildCss(): string {
  const rootSections = [
    ...primitiveGroups.map((group) => ({ comment: group.label, vars: groupVars(group) })),
    { comment: `semantic — default skin: ${DEFAULT_SKIN}`, vars: semanticVars(DEFAULT_SKIN) },
  ];

  const blocks = [
    block(":root", rootSections),
    ...skinNames.map((skin) => block(`[data-skin="${skin}"]`, [{ comment: `skin: ${skin}`, vars: semanticVars(skin) }])),
  ];

  return `${HEADER}\n\n${blocks.join("\n\n")}\n`;
}
