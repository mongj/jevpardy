import { useEffect, useRef } from "react";
import type { TurnInfo } from "../../shared/protocol.ts";
import { useAnimationNow } from "../lib/clock.ts";
import { sfx } from "../lib/sfx.ts";

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
        {running ? seconds : "❚❚"}
      </span>
    </div>
  );
}

/** Mystery fuse: no numbers, just a fizzing bomb that gets twitchier over time. */
export function Fuse({ turn, offset, averageMs }: { turn: TurnInfo; offset: number; averageMs: number }) {
  const now = useAnimationNow(!turn.judging) + offset;
  const elapsed = Math.max(0, now - turn.startedAt);
  const heat = Math.min(1, elapsed / averageMs);
  const fuseLeft = Math.max(0.08, 1 - heat * 0.85);
  return (
    <div className={`fuse ${turn.judging ? "frozen" : ""}`} style={{ ["--heat" as string]: heat.toFixed(2) }} aria-label="mystery fuse burning">
      <svg viewBox="0 0 60 16" width="100%" height="34" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="0" y="7" width={44 * fuseLeft} height="2" fill="#c9a26b" />
        <g className="spark" transform={`translate(${44 * fuseLeft} 8)`}>
          <rect x="-1" y="-1" width="2" height="2" fill="#fff" />
          <rect x="-3" y="-3" width="1" height="1" fill="#ffd23f" />
          <rect x="2" y="-2" width="1" height="1" fill="#ff8a3d" />
          <rect x="1" y="2" width="1" height="1" fill="#ffd23f" />
        </g>
        <g transform="translate(46 2)">
          <rect x="3" y="0" width="4" height="2" fill="#6b6799" />
          <rect x="1" y="2" width="10" height="10" fill="#2a2650" />
          <rect x="0" y="4" width="12" height="6" fill="#2a2650" />
          <rect x="3" y="4" width="2" height="2" fill="#8a86b8" />
        </g>
      </svg>
      <span className="fuse-label">{turn.judging ? "PAUSED" : "???"}</span>
    </div>
  );
}
