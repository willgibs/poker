/**
 * The nav rail's line icons — poker-internal/design/explorations/menu.html's
 * icon set, translated to components. Stroke-only (`fill="none"`, `stroke="currentColor"`)
 * so they never write down a colour literal and always inherit `NavLink`'s
 * text colour, including its active-state change.
 */
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

const BASE: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function HomeIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </svg>
  );
}

export function TrainIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CareerIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 3.5L17 11H5" />
    </svg>
  );
}

export function PlayersIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 19c.4-3 3-4.6 6.2-4.6s5.8 1.6 6.2 4.6" />
      <circle cx="17.3" cy="9" r="2.7" />
      <path d="M17.5 14.6c2.6.4 4 1.8 4.3 4.4" />
    </svg>
  );
}

export function StatsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <path d="M5 20v-8" />
      <path d="M12 20V5" />
      <path d="M19 20v-5" />
    </svg>
  );
}

export function StudyIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props} aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M8 17h12M4 12h6M14 12h6" />
      <circle cx="14" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="17" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
