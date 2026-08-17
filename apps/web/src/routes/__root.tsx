/**
 * Root layout — poker-internal/design/explorations/menu.html's rail + main
 * column, plus a skip-to-content link ahead of everything else in the DOM.
 */
import { Outlet } from "@tanstack/react-router";
import { Link } from "@poker/ui";

import { NavRail } from "../components/NavRail";
import "./__root.css";

export function RootLayout() {
  return (
    <div className="app-shell">
      <Link href="#main-content" variant="skip">
        Skip to main content
      </Link>

      <NavRail />

      <main id="main-content" className="app-shell__main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
