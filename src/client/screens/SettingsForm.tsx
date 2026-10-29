import type { ReactNode } from "react";
import { SETTINGS_LIMITS } from "../../shared/constants.ts";
import type { GameSettings } from "../../shared/protocol.ts";
import { Icon } from "../components/Pixel.tsx";
import { Stepper, Toggle } from "../components/ui.tsx";

export function ModePicker({ mode, onChange, disabled }: { mode: GameSettings["mode"]; onChange: (m: GameSettings["mode"]) => void; disabled?: boolean }) {
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Game mode">
      <button type="button" role="radio" aria-checked={mode === "timed"} disabled={disabled} className={`mode-card ${mode === "timed" ? "on" : ""}`} onClick={() => onChange("timed")}>
        <span className="mode-icon">
          <Icon name="stopwatch" />
        </span>
        <span className="mode-name">TIMED</span>
        <span className="mode-desc">Beat the clock. Hearts on the line. Last one standing wins.</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === "free"} disabled={disabled} className={`mode-card ${mode === "free" ? "on" : ""}`} onClick={() => onChange("free")}>
        <span className="mode-icon">
          <Icon name="cup" />
        </span>
        <span className="mode-name">FREE & EASY</span>
        <span className="mode-desc">No clock. No hearts. Tap out when you're stumped.</span>
      </button>
    </div>
  );
}

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
      <Toggle label="MYSTERY FUSE" hint="Hidden timer that pops at a random moment" checked={settings.mysteryFuse} onChange={(mysteryFuse) => onChange({ mysteryFuse })} disabled={disabled} />
      <Toggle label="SPEED UP" hint="Turns get 1s shorter every lap (min 6s)" checked={settings.speedUp} onChange={(speedUp) => onChange({ speedUp })} disabled={disabled} />
    </div>
  );
}

export function settingsSummary(s: GameSettings): ReactNode {
  if (s.mode === "free") return "FREE & EASY · no clock · tap out when stumped";
  const parts = [s.mysteryFuse ? `~${s.turnSeconds}s mystery fuse` : `${s.turnSeconds}s turns`];
  if (s.wrongAnswer === "life") parts.push("sudden death");
  if (s.speedUp) parts.push("speed up");
  return (
    <>
      TIMED · {s.lives}
      <Icon name="heart" font="body" className="heart-glyph" /> · {parts.join(" · ")}
    </>
  );
}
