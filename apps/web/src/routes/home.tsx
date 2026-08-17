/**
 * `/` — Home v1 (poker-internal/design/explorations/menu.html, Study 1,
 * adapted for day one: Career has no real data yet, so it is the disabled
 * card and Quick Seat carries the screen's one gradient CTA instead — the
 * wrap section's "Quick Seat owns it on first load" rule).
 *
 * Day-one rule: rows render only once they have real data — this is a
 * greeting and three cards, full stop. No Row 2 (today-strip) or Row 3
 * (recent sessions) here yet.
 */
import { useNavigate } from "@tanstack/react-router";
import { Button, NUM_CLASS, formatStakes } from "@poker/ui";

import { PlayCard } from "../components/PlayCard";
import "./home.css";

export function HomeRoute() {
  const navigate = useNavigate();

  return (
    <div className="home">
      <header className="home__greet">
        <h1>Hey, Hero.</h1>
        <p>Quick Seat's ready when you are — everything else is still warming up.</p>
      </header>

      <div className="home__row1">
        <PlayCard kicker="Career">
          <p className="play-card__body">
            Your career table isn't built yet — rungs, bankroll goals, the gauntlet all land in a later phase.
          </p>
          <div className="play-card__footer">
            <Button variant="ghost" disabled>
              Coming in P3
            </Button>
          </div>
        </PlayCard>

        <PlayCard kicker="Quick Seat" tone="primary">
          <p className="play-card__body">A 6-max cash table, dealt in five seconds.</p>
          <p className={`play-card__stakes ${NUM_CLASS}`}>{formatStakes(10, 25)} · 6-max</p>
          <div className="play-card__footer">
            <Button
              variant="primary"
              onClick={() => {
                void navigate({ to: "/table" });
              }}
            >
              Deal me in <span aria-hidden="true">→</span>
            </Button>
          </div>
        </PlayCard>

        <PlayCard kicker="Daily Puzzle">
          <p className="play-card__body">Today's spot is warming up — puzzles arrive soon.</p>
          <div className="play-card__footer">
            <Button variant="ghost" disabled>
              Coming soon
            </Button>
          </div>
        </PlayCard>
      </div>
    </div>
  );
}
