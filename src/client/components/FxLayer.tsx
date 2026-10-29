import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface Burst {
  id: number;
  text: string;
  sub?: string;
  color: string;
  kind: "pop" | "big" | "float";
}

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
}

export interface FxHandle {
  burst: (b: Omit<Burst, "id">) => void;
  confetti: (colors: string[], count?: number) => void;
  flash: (color: string) => void;
  shake: () => void;
}

let nextId = 0;

/** Overlay for floating text, pixel confetti, screen flashes and shakes. */
export const FxLayer = forwardRef<FxHandle>(function FxLayer(_, ref) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    burst(b) {
      const id = ++nextId;
      // Newest burst replaces the previous one so texts never pile up.
      setBursts([{ ...b, id }]);
      setTimeout(() => setBursts((all) => all.filter((x) => x.id !== id)), b.kind === "big" ? 2200 : 1400);
    },
    confetti(colors, count = 36) {
      const fresh: Particle[] = Array.from({ length: count }, () => {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 180;
        return {
          id: ++nextId,
          x: 50 + (Math.random() - 0.5) * 10,
          y: 40 + (Math.random() - 0.5) * 10,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 60,
          color: colors[Math.floor(Math.random() * colors.length)] ?? "#fff",
        };
      });
      setParticles((p) => [...p.slice(-120), ...fresh]);
      const ids = new Set(fresh.map((p) => p.id));
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.has(x.id))), 1300);
    },
    flash(color) {
      clearTimeout(flashTimer.current);
      setFlash({ id: ++nextId, color });
      flashTimer.current = setTimeout(() => setFlash(null), 450);
    },
    shake() {
      const root = document.getElementById("root");
      root?.classList.remove("shake");
      void root?.offsetWidth;
      root?.classList.add("shake");
    },
  }));

  return (
    <div className="fx-layer" aria-live="polite">
      {flash && <div key={flash.id} className="fx-flash" style={{ background: flash.color }} />}
      {particles.map((p) => (
        <span
          key={p.id}
          className="fx-particle"
          style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color, ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px` }}
        />
      ))}
      {bursts.map((b) => (
        <div key={b.id} className={`fx-burst fx-${b.kind}`} style={{ color: b.color }}>
          <span className="fx-text">{b.text}</span>
          {b.sub && <span className="fx-sub">{b.sub}</span>}
        </div>
      ))}
    </div>
  );
});
