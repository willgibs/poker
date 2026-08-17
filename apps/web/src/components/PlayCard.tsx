/**
 * A Row 1 play card — poker-internal/design/explorations/menu.html's `.card`.
 * `tone="primary"` carries the felt-toned gradient background; it is a
 * styling hook only; whether the card *also* contains the screen's one
 * gradient `<Button variant="primary">` is the caller's call.
 */
import type { ReactNode } from "react";

import "./PlayCard.css";

export interface PlayCardProps {
  readonly tone?: "primary" | "default";
  readonly kicker: string;
  readonly children: ReactNode;
}

export function PlayCard({ tone = "default", kicker, children }: PlayCardProps) {
  return (
    <article className="play-card" data-tone={tone}>
      <p className="play-card__kicker">{kicker}</p>
      {children}
    </article>
  );
}
