import { useEffect, useRef } from "react";
import type { TurnInfo } from "../../shared/protocol.ts";
import { useAnimationNow } from "../lib/clock.ts";
import { sfx } from "../lib/sfx.ts";
import { Icon } from "./Pixel.tsx";

const SEGMENTS = 20;

function colorFor(fraction: number): string {
  if (fraction > 0.5) return "var(--green)";
  if (fraction > 0.25) return "var(--yellow)";
  return "var(--red)";
}

/** Chunky segmented countdown; ticks audibly in the last seconds when `audible`. */
export function Countdown({ turn, offset, audible }: { turn: TurnInfo; offset: number; audible: boolean }) {
  const running = turn.deadline !== null;
  const now = useAnimationNow(running) + offset;
  const total = turn.durationMs ?? 1;
  const remaining = running ? Math.max(0, turn.deadline! - now) : (turn.frozenRemainingMs ?? total);
  const fraction = Math.min(1, remaining / total);
  const lit = Math.ceil(fraction * SEGMENTS);
  const seconds = Math.ceil(remaining / 1000);
  const lastTick = useRef<number | null>(null);

  useEffect(() => {
    if (!audible || !running) return;
    if (seconds <= 5 && seconds > 0 && lastTick.current !== seconds) {
      lastTick.current = seconds;
      if (seconds <= 3) sfx.urgent();
      else sfx.tick();
    }
  }, [seconds, audible, running]);

  const urgent = running && seconds <= 3;
  return (
    <div className={`countdown ${urgent ? "urgent" : ""} ${running ? "" : "frozen"}`} role="timer" aria-label={`${seconds} seconds left`}>
      <div className="countdown-bar">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className="seg" style={{ background: i < lit ? colorFor(fraction) : undefined }} />
        ))}
      </div>
      <span className="countdown-num" style={{ color: colorFor(fraction) }}>
        {running ? seconds : <Icon name="pause" />}
      </span>
    </div>
  );
}
