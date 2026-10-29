import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  twinkle: number;
  color: string;
}

const STAR_COLORS = ["#ffffff", "#ffffff", "#ffffff", "#3ef0ff", "#ff4fd8", "#ffd23f"];
const PIXEL = 2;

/** Pixel starfield drifting downward with occasional shooting stars. */
export function Starfield({ warp = false }: { warp?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const warpRef = useRef(warp);
  warpRef.current = warp;

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    let shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

    const resize = () => {
      w = Math.ceil(innerWidth / PIXEL);
      h = Math.ceil(innerHeight / PIXEL);
      canvas.width = w;
      canvas.height = h;
      const count = Math.round((w * h) / 260);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.9 + 0.1,
        twinkle: Math.random() * Math.PI * 2,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]!,
      }));
    };
    resize();
    addEventListener("resize", resize);

    let frame = 0;
    let last = performance.now();
    const draw = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const speed = warpRef.current ? 9 : 1;
      g.fillStyle = "#05040f";
      g.fillRect(0, 0, w, h);
      for (const s of stars) {
        if (!reduced) {
          s.y += s.z * 6 * speed * dt;
          if (s.y > h) {
            s.y = 0;
            s.x = Math.random() * w;
          }
        }
        const tw = 0.55 + 0.45 * Math.sin(t / 400 + s.twinkle);
        g.globalAlpha = s.z * tw;
        g.fillStyle = s.color;
        const len = warpRef.current ? Math.ceil(s.z * 4) : 1;
        g.fillRect(Math.floor(s.x), Math.floor(s.y), s.z > 0.85 ? 2 : 1, s.z > 0.85 ? Math.max(2, len) : len);
      }
      g.globalAlpha = 1;
      if (!reduced) {
        if (!shooting && Math.random() < 0.004) {
          shooting = { x: Math.random() * w, y: Math.random() * h * 0.4, vx: -60 - Math.random() * 60, vy: 30 + Math.random() * 20, life: 1 };
        }
        if (shooting) {
          shooting.x += shooting.vx * dt;
          shooting.y += shooting.vy * dt;
          shooting.life -= dt * 1.2;
          for (let i = 0; i < 8; i++) {
            g.globalAlpha = Math.max(0, shooting.life) * (1 - i / 8);
            g.fillStyle = i < 2 ? "#ffffff" : "#3ef0ff";
            g.fillRect(Math.floor(shooting.x - (shooting.vx / 60) * i), Math.floor(shooting.y - (shooting.vy / 60) * i), 1, 1);
          }
          g.globalAlpha = 1;
          if (shooting.life <= 0) shooting = null;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
