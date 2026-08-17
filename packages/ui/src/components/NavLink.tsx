/**
 * `NavLink` — a labelled, icon-fronted anchor for primary navigation.
 *
 * Plain and router-agnostic on purpose (see `Link.tsx`'s doc comment): it
 * renders a real `<a>` with icon + label chrome and a `[data-active]`
 * styling hook, and knows nothing about routing. `apps/web` gets the actual
 * navigation behaviour — typed `to`, active-state detection, preloading — by
 * wrapping this component with TanStack Router's `createLink(NavLink)`,
 * the officially-supported way to make an existing component route-aware
 * without the design system depending on the router.
 */
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

import "./NavLink.css";

export interface NavLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLAnchorElement>;
}

export function NavLink({ icon, children, ref, ...rest }: NavLinkProps) {
  return (
    <a {...rest} ref={ref} className="fr-nav-link">
      {icon !== undefined ? (
        <span className="fr-nav-link__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="fr-nav-link__label">{children}</span>
    </a>
  );
}
