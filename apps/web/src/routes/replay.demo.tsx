/**
 * `/replay/demo` — mount point for the replay viewer demo.
 *
 * PLACEHOLDER. Reuses `route-placeholder` (see `table.css`) since it is the
 * same "nothing built here yet, but this is exactly where it goes" shape.
 * Keep the export named `ReplayDemoRoute` — `router.ts` imports it by name.
 */
import "./table.css";

export function ReplayDemoRoute() {
  return (
    <div className="route-placeholder">
      <p className="route-placeholder__kicker">Replay</p>
      <h1 className="route-placeholder__title">A hand to study, soon.</h1>
      <p className="route-placeholder__body">
        This is where you'll step back through a hand, beat by beat.
      </p>
    </div>
  );
}
