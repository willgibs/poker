/**
 * Code-based route tree — no codegen, no `routes.gen.ts`.
 *
 * Every route's `component` is a plain, presentational function imported
 * from `./routes/*`; this file's only job is wiring paths to components and
 * producing a router instance. `createAppRouter` takes an optional
 * `history` override so tests can mount the app on a `createMemoryHistory`
 * instead of the browser's real history.
 */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";

import { CareerRoute } from "./routes/career";
import { HomeRoute } from "./routes/home";
import { PlayersRoute } from "./routes/players";
import { ReplayDemoRoute } from "./routes/replay.demo";
import { RootLayout } from "./routes/__root";
import { SettingsRoute } from "./routes/settings";
import { StatsRoute } from "./routes/stats";
import { StudyRoute } from "./routes/study";
import { TableRoute } from "./routes/table";
import { TrainRoute } from "./routes/train";

const rootRoute = createRootRoute({ component: RootLayout });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomeRoute });
const tableRoute = createRoute({ getParentRoute: () => rootRoute, path: "/table", component: TableRoute });
const replayDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/replay/demo",
  component: ReplayDemoRoute,
});
const trainRoute = createRoute({ getParentRoute: () => rootRoute, path: "/train", component: TrainRoute });
const careerRoute = createRoute({ getParentRoute: () => rootRoute, path: "/career", component: CareerRoute });
const playersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/players", component: PlayersRoute });
const statsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/stats", component: StatsRoute });
const studyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/study", component: StudyRoute });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsRoute });

const routeTree = rootRoute.addChildren([
  homeRoute,
  tableRoute,
  replayDemoRoute,
  trainRoute,
  careerRoute,
  playersRoute,
  statsRoute,
  studyRoute,
  settingsRoute,
]);

/** `history` is overridable so tests can mount on `createMemoryHistory(...)`. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
