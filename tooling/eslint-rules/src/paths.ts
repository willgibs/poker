/**
 * Path-exemption helpers shared by the design-system lint rules.
 * All checks are substring/segment based on a posix-normalized path so they
 * work the same for absolute paths (real lint runs) and relative paths
 * (RuleTester fixtures).
 */

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** True if `filePath` contains `segment` as a path fragment. */
export function pathContains(filePath: string, segment: string): boolean {
  return toPosix(filePath).includes(segment);
}

/** True if the file's basename contains a `.gen.` marker (any extension). */
export function isGeneratedFile(filePath: string): boolean {
  const base = toPosix(filePath).split("/").pop() ?? "";
  return base.includes(".gen.");
}

/** packages/ui/src/tokens/** — the only place raw color values may live. */
export function isTokensPath(filePath: string): boolean {
  return pathContains(filePath, "packages/ui/src/tokens/");
}

/** packages/ui/** — owns the system components and may import motion libs. */
export function isUiPackagePath(filePath: string): boolean {
  return pathContains(filePath, "packages/ui/");
}

/** packages/table-ui/** — the felt/table rendering package; also motion-aware. */
export function isTableUiPackagePath(filePath: string): boolean {
  return pathContains(filePath, "packages/table-ui/");
}
