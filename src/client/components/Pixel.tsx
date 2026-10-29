import type { CSSProperties } from "react";
import type { Emote } from "../../shared/protocol.ts";

// X = body colour, o = white, k = near-black. Rows must be equal width.
const SPRITES: readonly string[][] = [
  // squib
  ["....XX....", "...XXXX...", "..XXXXXX..", ".XXoXXoXX.", ".XXkXXkXX.", ".XXXXXXXX.", "..X.XX.X..", ".X.X..X.X.", "X..X..X..X"],
  // gloop
  ["...XXXX...", ".XXXXXXXX.", "XXooXXooXX", "XXokXXokXX", "XXXXXXXXXX", "XXXXkkXXXX", "XXXXXXXXXX", "XX.XXX.XXX", "X...X...XX"],
  // bolt
  ["....kk....", "....XX....", ".XXXXXXXX.", ".XooXXooX.", ".XkoXXkoX.", ".XXXXXXXX.", ".XkXkXkXX.", ".XXXXXXXX.", "..XX..XX.."],
  // orbit
  ["...XXXX...", "..XooooX..", "..XokkoX..", ".XXXXXXXX.", "XXoXXoXXoX", ".XXXXXXXX.", "..X.XX.X..", ".X..XX..X.", "X........X"],
  // munch
  ["...k......", "...kXXXX..", ".XXXXXXXX.", "XXXXkXXX..", "XXXXXXX...", "XXXXXo....", "XXXXXXX...", ".XXXXXXXX.", "..XXXXX..."],
  // kitty
  ["X........X", "XX......XX", "XXXXXXXXXX", "XoXXXXXXoX", "XkXXXXXXkX", "XXXXkkXXXX", ".XXXXXXXX.", ".XX.XX.XX.", ".X..X..X.."],
  // crab
  ["X........X", "XX.XXXX.XX", ".XXXXXXXX.", "..XoXXoX..", "..XkXXkX..", ".XXXXXXXX.", "X.XXXXXX.X", "..X....X..", ".X......X."],
  // zap
  ["....X.....", "...XXX....", "XXXXXXXXXX", ".XXoXXoXX.", ".XXkXXkXX.", "..XXXXXX..", "..XXkkXX..", ".XXX..XXX.", "XX......XX"],
];

function pixels(rows: readonly string[], palette: Record<string, string>) {
  const rects: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = palette[ch];
      if (fill) rects.push({ x, y, fill });
    });
  });
  return rects;
}

interface SpriteProps {
  avatar: number;
  color: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  dead?: boolean;
}

export function Sprite({ avatar, color, size = 40, className, style, dead }: SpriteProps) {
  const rows = SPRITES[avatar % SPRITES.length]!;
  const w = rows[0]!.length;
  const h = rows.length;
  const palette = { X: dead ? "#4a4766" : color, o: dead ? "#8a86b8" : "#ffffff", k: "#120f2e" };
  return (
    <svg
      className={`sprite ${className ?? ""}`}
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      style={style}
      aria-hidden="true"
    >
      {pixels(rows, palette).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
      {dead && (
        <g fill="#ff4f6d">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <g key={i}>
              <rect x={1.5 + i} y={1 + i} width={1} height={1} />
              <rect x={7.5 - i} y={1 + i} width={1} height={1} />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

const HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
const HEART_SHINE = [{ x: 1, y: 1 }];

export function Heart({ full, size = 18, className }: { full: boolean; size?: number; className?: string }) {
  return (
    <svg className={`heart ${full ? "full" : "empty"} ${className ?? ""}`} width={size} height={(size * 6) / 7} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true">
      {pixels(HEART, { X: full ? "#ff4f6d" : "#2a2650" }).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
      {full && HEART_SHINE.map((p) => <rect key={`s${p.x}`} x={p.x} y={p.y} width={1} height={1} fill="#ffc2cc" />)}
    </svg>
  );
}

export function Hearts({ lives, max, size }: { lives: number; max: number; size?: number }) {
  const slots = Math.max(lives, max);
  return (
    <span className="hearts" aria-label={`${lives} lives`}>
      {Array.from({ length: slots }, (_, i) => (
        <Heart key={i} full={i < lives} size={size} />
      ))}
    </span>
  );
}

export type JevMood = "idle" | "thinking" | "happy" | "angry" | "shocked" | "sleepy";

const JEV_BODY = [
  ".......kk.......",
  "......kYYk......",
  ".......XX.......",
  "..XXXXXXXXXXXX..",
  ".XooooooooooooX.",
  ".Xo..........oX.",
  ".Xo..........oX.",
  ".Xo..........oX.",
  ".Xo..........oX.",
  ".Xo..........oX.",
  ".Xo..........oX.",
  ".XooooooooooooX.",
  "..XXXXXXXXXXXX..",
  "....X......X....",
  "...XXX....XXX...",
];

// Face pixels drawn on the screen area (x 3..12, y 5..10).
const FACES: Record<JevMood, string[]> = {
  idle: ["..........", "..EE..EE..", "..EE..EE..", "..........", "...MMMM...", ".........."],
  thinking: ["..EE..EE..", "..EE..EE..", "..........", "..........", "....MMM...", ".........."],
  happy: ["..........", ".E..E.E..E", "..EE...EE.", "..........", "..M....M..", "...MMMM..."],
  angry: [".E......E.", "..EE..EE..", "..EE..EE..", "..........", "...MMMM...", "..M....M.."],
  shocked: ["..EE..EE..", ".E..EE..E.", "..EE..EE..", "....MM....", "...M..M...", "....MM...."],
  sleepy: ["..........", "..........", ".EEE..EEE.", "..........", "....MM....", ".........."],
};

const MOOD_COLORS: Record<JevMood, string> = {
  idle: "#3ef0ff",
  thinking: "#ffd23f",
  happy: "#7dff6b",
  angry: "#ff4f6d",
  shocked: "#ff4fd8",
  sleepy: "#8a86b8",
};

export function JevBot({ mood, size = 72, className }: { mood: JevMood; size?: number; className?: string }) {
  const face = FACES[mood];
  const glow = MOOD_COLORS[mood];
  const body = pixels(JEV_BODY, { X: "#b9b4e6", o: "#5c56a3", k: "#120f2e", Y: glow });
  const facePx = pixels(face, { E: glow, M: glow }).map((p) => ({ ...p, x: p.x + 3, y: p.y + 5 }));
  return (
    <svg className={`jev jev-${mood} ${className ?? ""}`} width={size} height={(size * 15) / 16} viewBox="0 0 16 15" shapeRendering="crispEdges" aria-label={`Jev looks ${mood}`}>
      {body.map((p) => (
        <rect key={`b${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
      <rect x={3} y={5} width={10} height={6} fill="#0a0820" />
      <g className="jev-face">
        {facePx.map((p) => (
          <rect key={`f${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
        ))}
      </g>
    </svg>
  );
}

export function Crown({ size = 14 }: { size?: number }) {
  const rows = ["X..X..X", "XX.X.XX", "XXXXXXX", "XoXoXoX", "XXXXXXX"];
  return (
    <svg className="crown" width={size} height={(size * 5) / 7} viewBox="0 0 7 5" shapeRendering="crispEdges" aria-label="host">
      {pixels(rows, { X: "#ffd23f", o: "#ff4f6d" }).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
    </svg>
  );
}

const ICONS = {
  right: ["X...", "XX..", "XXX.", "XXXX", "XXX.", "XX..", "X..."],
  left: ["...X", "..XX", ".XXX", "XXXX", ".XXX", "..XX", "...X"],
  replay: ["..XXX.X", ".X...XX", "X...XXX", "X......", "X.....X", ".X...X.", "..XXX.."],
  soundOn: ["...X...X.", "..XX.X..X", "XXXX..X.X", "XXXX..X.X", "XXXX..X.X", "..XX.X..X", "...X...X."],
  soundOff: ["...X.....", "..XX.....", "XXXX.X.X.", "XXXX..X..", "XXXX.X.X.", "..XX.....", "...X....."],
  hand: [".X.X.X.", ".X.X.X.", ".XXXXX.", "XXXXXX.", ".XXXXX.", ".XXXXX.", "..XXX.."],
  skip: ["X...X..X", "XX..XX.X", "XXX.XXXX", "XXXXXXXX", "XXX.XXXX", "XX..XX.X", "X...X..X"],
  stop: [".....", "XXXXX", "XXXXX", "XXXXX", "XXXXX", "XXXXX", "....."],
  close: ["XX...XX", "XXX.XXX", ".XXXXX.", "..XXX..", ".XXXXX.", "XXX.XXX", "XX...XX"],
  check: ["......X", ".....XX", "X...XX.", "XX.XX..", ".XXX...", "..X....", "......."],
  warn: ["...X...", "..XXX..", "..X.X..", ".XX.XX.", ".XXXXX.", "XXX.XXX", "XXXXXXX"],
  pause: ["XX.XX", "XX.XX", "XX.XX", "XX.XX", "XX.XX", "XX.XX", "XX.XX"],
  minus: [".....", ".....", ".....", "XXXXX", ".....", ".....", "....."],
  plus: [".....", "..X..", "..X..", "XXXXX", "..X..", "..X..", "....."],
  skull: [".XXXXX.", "XXXXXXX", "X..X..X", "XXXXXXX", ".XX.XX.", ".XXXXX.", ".X.X.X."],
  eye: [".......", "..XXX..", ".X...X.", "X..X..X", ".X...X.", "..XXX..", "......."],
  list: ["X.XXXXX", ".......", "X.XXXXX", ".......", "X.XXX..", ".......", "......."],
  stopwatch: ["..XXX..", "...X...", ".XXXXX.", "X..X..X", "X..XX.X", "X.....X", ".XXXXX."],
  cup: ["..X.X..", ".X.X...", "XXXXXX.", "XXXXX.X", "XXXXX.X", "XXXXXX.", ".XXXX.."],
  heart: [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."],
} as const;

export type IconName = keyof typeof ICONS;

/**
 * One-colour pixel glyphs; emoji and fallback-font symbols break the pixel style. "display" matches Press Start 2P
 * (one pixel = 1/8 em, capitals span 0.125–1em above the baseline); "body" matches VT323 (capitals span 0–0.56em).
 */
export function Icon({ name, font = "display", className }: { name: IconName; font?: "display" | "body"; className?: string }) {
  const rows = ICONS[name];
  const w = rows[0].length;
  const unit = font === "display" ? 0.125 : 0.1;
  const capCentre = font === "display" ? 0.5625 : 0.28;
  return (
    <svg
      className={`px-icon ${className ?? ""}`}
      width={`${w * unit}em`}
      height={`${rows.length * unit}em`}
      viewBox={`0 0 ${w} ${rows.length}`}
      style={{ verticalAlign: `${capCentre - (rows.length * unit) / 2}em` }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {pixels(rows, { X: "currentColor" }).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
    </svg>
  );
}

// O/k = outline and features, Y/y = skin and shade, w = white, b = blue, r = red, o = orange.
const EMOTE_PALETTE: Record<string, string> = { O: "#05040f", k: "#05040f", Y: "#ffd23f", y: "#d99a1e", w: "#ffffff", b: "#3ef0ff", r: "#ff4f6d", o: "#ff8a3d" };

const EMOTE_ART: Record<Emote, readonly string[]> = {
  clap: ["w..........w", ".w.O.O.O.Ow.", "..OYOYOYOYO.", "..OYOYOYOYO.", ".OYYYYOYYYYO", ".OYYYYOYYYYO", "..OYYYOYYYO.", "...OYYOYYO..", "....OYOYO...", ".....OOO...."],
  lol: ["..OOOOOO..", ".OYYYYYYO.", "OYkYYYYkYO", "OkYkYYkYkO", "bYYYYYYYYb", "bYkkkkkkYb", "OYkrrrrkYO", "OYYkkkkYYO", ".OYYYYYYO.", "..OOOOOO.."],
  fire: ["....r.....", "....rr....", "...rrr..r.", "..rroor.rr", ".rrooorrr.", ".rrooyorr.", "rrooyyyorr", "rroyyyyorr", ".rooyyyor.", "..rrrrrr.."],
  shock: ["..OOOOOO..", ".ObbbbbbO.", "ObwwbbwwbO", "OYwkYYwkYO", "OYYYYYYYYO", "OYYYkkYYYO", "OYYkkkkYYO", "OYYkkkkYYO", ".OYYkkYYO.", "..OOOOOO.."],
  hmm: ["..OOOOOO..", ".OYYYYYYO.", "OYkkYYYYYO", "OYYYYYkkYO", "OYkYYYYkYO", "OYYYYYYYYO", "OYYYYkkkYO", "OYYkkkYYYO", ".OYYYYYYO.", "..OOOOOO.."],
  eyes: ["............", ".OOOO..OOOO.", "OwwwwOOwwwwO", "OwwwwOOwwwwO", "OwkkwOOwkkwO", "OwkkwOOwkkwO", "OwwwwOOwwwwO", "OwwwwOOwwwwO", ".OOOO..OOOO.", "............"],
};

export const EMOTE_LABELS: Record<Emote, string> = { clap: "Clap", lol: "Laugh", fire: "Fire", shock: "Shock", hmm: "Hmm", eyes: "Eyes" };

export function EmoteArt({ emote, size = 28 }: { emote: Emote; size?: number }) {
  const rows = EMOTE_ART[emote];
  const w = rows[0]!.length;
  return (
    <svg className="emote-art" width={(size * w) / rows.length} height={size} viewBox={`0 0 ${w} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {pixels(rows, EMOTE_PALETTE).map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.fill} />
      ))}
    </svg>
  );
}

export const AVATAR_TOTAL = SPRITES.length;
