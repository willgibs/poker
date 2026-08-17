/**
 * `/table` — mount point for the felt.
 *
 * PLACEHOLDER. This component is where the Assemble agent wires the real
 * table: `packages/table-ui`'s Presenter driving the seat/board/action-bar
 * renderers (see `packages/table-ui/src/hero/ActionBar.tsx` and friends).
 * Keep the export named `TableRoute` — `router.ts` imports it by name, and
 * so does the "mounts the /table placeholder" test.
 */
import "./table.css";

export function TableRoute() {
  return (
    <div className="route-placeholder">
      <p className="route-placeholder__kicker">Quick Seat</p>
      <h1 className="route-placeholder__title">The felt is warming up.</h1>
      <p className="route-placeholder__body">
        This is the mount point for the table — the real felt lands here next.
      </p>
    </div>
  );
}
