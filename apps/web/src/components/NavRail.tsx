/**
 * The left nav rail — poker-internal/design/explorations/menu.html.
 *
 * Brand mark + wordmark, the six primary links, Settings pinned to the
 * bottom. Navigation goes through `RouterNavLink`, `@poker/ui`'s `NavLink`
 * wrapped with TanStack Router's own `createLink()` — the officially
 * supported way to make an existing component route-aware (typed `to`,
 * active-state detection) without the design system depending on the
 * router (see `NavLink.tsx`'s doc comment).
 */
import { createLink } from "@tanstack/react-router";
import { NavLink } from "@poker/ui";

import {
  CareerIcon,
  HomeIcon,
  PlayersIcon,
  SettingsIcon,
  StatsIcon,
  StudyIcon,
  TrainIcon,
} from "./icons";
import "./NavRail.css";

const RouterNavLink = createLink(NavLink);

const ACTIVE_PROPS = { "data-active": "true", "aria-current": "page" as const };

const PRIMARY_LINKS = [
  { to: "/" as const, label: "Home", Icon: HomeIcon, exact: true },
  { to: "/train" as const, label: "Train", Icon: TrainIcon, exact: false },
  { to: "/career" as const, label: "Career", Icon: CareerIcon, exact: false },
  { to: "/players" as const, label: "Players", Icon: PlayersIcon, exact: false },
  { to: "/stats" as const, label: "Stats", Icon: StatsIcon, exact: false },
  { to: "/study" as const, label: "Study", Icon: StudyIcon, exact: false },
];

export function NavRail() {
  return (
    <div className="nav-rail">
      <div className="nav-rail__brand">
        <span className="nav-rail__mark" aria-hidden="true" />
        <span className="nav-rail__word">freeroll</span>
      </div>

      <nav className="nav-rail__nav" aria-label="Primary">
        {PRIMARY_LINKS.map(({ to, label, Icon, exact }) => (
          <RouterNavLink
            key={to}
            to={to}
            icon={<Icon />}
            activeOptions={{ exact }}
            activeProps={ACTIVE_PROPS}
          >
            {label}
          </RouterNavLink>
        ))}
      </nav>

      <div className="nav-rail__foot">
        <nav className="nav-rail__nav" aria-label="Account">
          <RouterNavLink to="/settings" icon={<SettingsIcon />} activeProps={ACTIVE_PROPS}>
            Settings
          </RouterNavLink>
        </nav>
      </div>
    </div>
  );
}
