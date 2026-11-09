import type { ReactNode } from "react";
import { SETTINGS_LIMITS } from "../../shared/constants.ts";
import type { GameSettings } from "../../shared/protocol.ts";
import { Icon } from "../components/Pixel.tsx";
import { Stepper, Toggle } from "../components/ui.tsx";

export function TimedSettings({ settings, onChange, disabled }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void; disabled?: boolean }) {
  return (
    <div className="timed-settings">
      <Stepper label="HEARTS" value={settings.lives} min={SETTINGS_LIMITS.lives.min} max={SETTINGS_LIMITS.lives.max} onChange={(lives) => onChange({ lives })} disabled={disabled} />
      <Stepper
        label={settings.mysteryFuse ? "AVG FUSE" : "TURN"}
        value={settings.turnSeconds}
        min={SETTINGS_LIMITS.turnSeconds.min}
        max={SETTINGS_LIMITS.turnSeconds.max}
        suffix="s"
        onChange={(turnSeconds) => onChange({ turnSeconds })}
        disabled={disabled}
      />
      <Toggle
        label="SUDDEN DEATH"
        hint="Wrong or repeated answers cost a heart and pass the turn"
        checked={settings.wrongAnswer === "life"}
        onChange={(on) => onChange({ wrongAnswer: on ? "life" : "retry" })}
        disabled={disabled}
      />
      <Toggle
        label="MYSTERY FUSE"
        hint="One hidden fuse for the whole table. Pass it on fast: whatever's left goes to the next player"
        checked={settings.mysteryFuse}
        onChange={(mysteryFuse) => onChange({ mysteryFuse })}
        disabled={disabled}
      />
      <Toggle label="SPEED UP" hint="Turns get 1s shorter every lap (min 6s)" checked={settings.speedUp} onChange={(speedUp) => onChange({ speedUp })} disabled={disabled} />
    </div>
  );
}

/** How long the game is: question count and how long each question stays up. */
export function DeckSettings({ settings, onChange, disabled }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void; disabled?: boolean }) {
  return (
    <div className="timed-settings">
      <Stepper
        label="QUESTIONS"
        value={settings.questionCount}
        min={SETTINGS_LIMITS.questionCount.min}
        max={SETTINGS_LIMITS.questionCount.max}
        onChange={(questionCount) => onChange({ questionCount })}
        disabled={disabled}
      />
      <Stepper
        label="ROUNDS EACH"
        value={settings.roundsPerQuestion}
        min={SETTINGS_LIMITS.roundsPerQuestion.min}
        max={SETTINGS_LIMITS.roundsPerQuestion.max}
        onChange={(roundsPerQuestion) => onChange({ roundsPerQuestion })}
        disabled={disabled}
      />
      <p className="small muted deck-hint">
        A question moves on after {settings.roundsPerQuestion} {settings.roundsPerQuestion === 1 ? "trip" : "trips"} round the table, or sooner if it
        stumps people.
      </p>
    </div>
  );
}

export function settingsSummary(s: GameSettings): ReactNode {
  const deck = `${s.questionCount} questions · up to ${s.roundsPerQuestion} ${s.roundsPerQuestion === 1 ? "round" : "rounds"} each`;
  const parts = [s.mysteryFuse ? `~${s.turnSeconds}s mystery fuse` : `${s.turnSeconds}s turns`, deck];
  if (s.wrongAnswer === "life") parts.push("sudden death");
  if (s.speedUp) parts.push("speed up");
  return (
    <>
      {s.lives}
      <Icon name="heart" font="body" className="heart-glyph" /> · {parts.join(" · ")}
    </>
  );
}
