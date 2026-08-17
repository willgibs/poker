/**
 * The whole class-name utility: join what is truthy, drop what is not.
 *
 * Components own their class names; the only thing a consumer may add is one
 * extra `className` for placement. Nothing here computes a style — styling
 * lives in `components.css`, in tokens.
 */
export function cx(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}
