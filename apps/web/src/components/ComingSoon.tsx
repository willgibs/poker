/**
 * The "not yet" empty state for a nav route with no surface built for it
 * yet — coach voice, not a dead end. One line explaining why, one pointer
 * back to what does work today (Quick Seat).
 */
import "./ComingSoon.css";

export interface ComingSoonProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

export function ComingSoon({ eyebrow, title, body }: ComingSoonProps) {
  return (
    <div className="coming-soon">
      <p className="coming-soon__eyebrow">{eyebrow}</p>
      <h1 className="coming-soon__title">{title}</h1>
      <p className="coming-soon__body">{body}</p>
    </div>
  );
}
