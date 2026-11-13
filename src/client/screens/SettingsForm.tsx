import type { ReactNode } from "react";
import { SETTINGS_LIMITS } from "../../shared/constants.ts";
import type { GameSettings } from "../../shared/protocol.ts";
import { Icon } from "../components/Pixel.tsx";
import { Stepper, Toggle } from "../components/ui.tsx";

/** The host's game options, folded away under a one-line summary. */
export function GameOptions({ settings, onChange, disabled }: { settings: GameSettings; onChange: (patch: Partial<GameSettings>) => void; disabled?: boolean }) {
  return (
    <details className="game-options">
      <summary>
        <span className="label">
          <Icon name="right" className="options-caret" />
          OPTIONS
        </span>
        <span className="small muted">{settingsSummary(settings)}</span>
      </summary>
      <div className="timed-settings">
        <Stepper
          label="QUESTIONS"
          value={settings.questionCount}
          min={SETTINGS_LIMITS.questionCount.min}
          max={SETTINGS_LIMITS.questionCount.max}
          onChange={(questionCount) => onChange({ questionCount })}
          disabled={disabled}
        />
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
          label="MYSTERY FUSE"
          hint="One hidden fuse for the whole table. Pass it on fast: whatever's left goes to the next player"
          checked={settings.mysteryFuse}
          onChange={(mysteryFuse) => onChange({ mysteryFuse })}
          disabled={disabled}
        />
      </div>
    </details>
  );
}

export function settingsSummary(s: GameSettings): ReactNode {
  return (
    <>
      {s.questionCount} questions · {s.lives}
      <Icon name="heart" font="body" className="heart-glyph" /> · {s.mysteryFuse ? `~${s.turnSeconds}s mystery fuse` : `${s.turnSeconds}s turns`}
    </>
  );
}
