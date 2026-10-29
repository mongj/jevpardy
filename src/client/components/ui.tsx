import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { isMuted, onMuteChange, setMuted, sfx, unlockAudio } from "../lib/sfx.ts";
import { Icon } from "./Pixel.tsx";

type Tone = "yellow" | "cyan" | "pink" | "green" | "red" | "ghost";

interface PixelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  big?: boolean;
}

export function PixelButton({ tone = "yellow", big, className, onClick, children, ...rest }: PixelButtonProps) {
  return (
    <button
      type="button"
      className={`px-btn tone-${tone} ${big ? "big" : ""} ${className ?? ""}`}
      onClick={(e) => {
        unlockAudio();
        sfx.click();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ title, children, className, accent = "cyan" }: { title?: ReactNode; children: ReactNode; className?: string; accent?: Tone }) {
  return (
    <section className={`panel accent-${accent} ${className ?? ""}`}>
      {title && <h2 className="panel-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" className="step-btn" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`less ${label}`}>
          −
        </button>
        <span className="stepper-value">
          {value}
          {suffix}
        </span>
        <button type="button" className="step-btn" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`more ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" aria-hidden="true" />
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal panel accent-pink" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function MuteButton() {
  const [muted, setLocal] = useState(isMuted());
  useEffect(() => onMuteChange(setLocal), []);
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        setMuted(!muted);
        if (muted) {
          unlockAudio();
          sfx.coin();
        }
      }}
      aria-label={muted ? "Unmute" : "Mute"}
      title={muted ? "Sound off" : "Sound on"}
    >
      <Icon name={muted ? "soundOff" : "soundOn"} />
    </button>
  );
}

export function Blink({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`blink ${className ?? ""}`}>{children}</span>;
}
