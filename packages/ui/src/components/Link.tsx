/**
 * `Link` — the one system component for raw anchors.
 *
 * Raw `<a>` is banned outside `packages/ui` (`local/no-raw-interactive-elements`);
 * this is the sanctioned source, and `NavLink` is built on the same pattern.
 * Deliberately router-agnostic — `packages/ui` does not take a dependency on
 * `@tanstack/react-router` (only `apps/web` and `packages/ui` may take
 * third-party dependencies "sparingly", and the router belongs to the app,
 * not the design system). A route-aware anchor is produced by wrapping this
 * component (or `NavLink`) with TanStack Router's own `createLink()` in
 * `apps/web` — see `apps/web/src/components/NavRail.tsx`.
 */
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import "./Link.css";

export type LinkVariant = "inline" | "skip";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  readonly variant?: LinkVariant;
  readonly children?: ReactNode;
  readonly ref?: Ref<HTMLAnchorElement>;
}

export function Link({ variant = "inline", children, ref, ...rest }: LinkProps) {
  const classes = variant === "inline" ? "fr-link" : `fr-link fr-link--${variant}`;
  return (
    <a {...rest} ref={ref} className={classes}>
      {children}
    </a>
  );
}
