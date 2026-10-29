import type { GameSettings, TierId } from "./protocol.ts";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export const MAX_NAME_LENGTH = 16;
export const MAX_TOPIC_LENGTH = 120;
export const MIN_TOPIC_LENGTH = 3;
export const MAX_ANSWER_LENGTH = 60;

export const DEFAULT_MAX_PLAYERS = 12;
export const MAX_SPECTATORS = 40;
export const MAX_LIVES = 5;
/** Timed mode: points that fill the 1UP meter for a bonus life. */
export const BONUS_LIFE_POINTS = 200;
/** Given to every player still in when Jev declares the board cleared. */
export const CLEAR_BONUS_POINTS = 50;

export const MIN_SUBMIT_INTERVAL_MS = 600;
export const MAX_ATTEMPTS_PER_TURN = 30;
export const MIN_TYPING_INTERVAL_MS = 80;

export const SPEED_UP_STEP_SECONDS = 1;
export const SPEED_UP_MIN_SECONDS = 6;
export const MYSTERY_FUSE_SPREAD = 0.6;

export const LOBBY_IDLE_MS = 30 * 60_000;
export const PLAYING_IDLE_MS = 30 * 60_000;
/** How long the end screen stays available before the room is wiped. */
export const OVER_TTL_MS = 15 * 60_000;
/** Empty rooms (nobody connected) are wiped after this. */
export const EMPTY_ROOM_MS = 5 * 60_000;
/** Free mode: a disconnected current player is skipped after this. */
export const FREE_DISCONNECT_GRACE_MS = 20_000;
/** A disconnected host hands over the crown after this. */
export const HOST_GRACE_MS = 20_000;
export const LOG_LIMIT = 30;

export interface Tier {
  id: TierId;
  name: string;
  points: number;
  blurb: string;
  color: string;
}

/** Ordered common → obscure; index matches Jev's Score level. */
export const TIERS: readonly Tier[] = [
  { id: "npc", name: "NPC", points: 10, blurb: "The one everybody blurts out.", color: "#9fb3d9" },
  { id: "powerup", name: "POWER-UP", points: 25, blurb: "Well known. A solid pick.", color: "#3ef0ff" },
  { id: "sidequest", name: "SIDE QUEST", points: 50, blurb: "Off the beaten path. Nice one.", color: "#ff4fd8" },
  { id: "easteregg", name: "EASTER EGG", points: 80, blurb: "Hidden in the code. Few ever find it.", color: "#b48cff" },
  { id: "jevillion", name: "1 IN A JEVILLION", points: 100, blurb: "Absurd. Even Jev is impressed.", color: "#ffd23f" },
];

export function tierById(id: TierId): Tier {
  const tier = TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`unknown tier ${id}`);
  return tier;
}

export function tierIndex(id: TierId): number {
  return TIERS.findIndex((t) => t.id === id);
}

export const PLAYER_COLORS = [
  "#ffd23f",
  "#3ef0ff",
  "#ff4fd8",
  "#7dff6b",
  "#ff8a3d",
  "#b48cff",
  "#ff4f6d",
  "#4f8bff",
  "#f5f5f5",
  "#00e5a0",
  "#ffb3e6",
  "#c8ff3d",
] as const;

export const AVATAR_COUNT = 8;

export const DEFAULT_SETTINGS: GameSettings = {
  mode: "timed",
  lives: 3,
  turnSeconds: 15,
  wrongAnswer: "retry",
  mysteryFuse: false,
  speedUp: false,
};

export const SETTINGS_LIMITS = {
  lives: { min: 1, max: MAX_LIVES },
  turnSeconds: { min: 5, max: 60 },
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merges untrusted partial settings onto a base, clamping every field. */
export function mergeSettings(base: GameSettings, patch: Partial<GameSettings> | undefined): GameSettings {
  const p: Partial<Record<keyof GameSettings, unknown>> = patch ?? {};
  return {
    mode: p.mode === "timed" || p.mode === "free" ? p.mode : base.mode,
    lives: clampInt(p.lives, SETTINGS_LIMITS.lives.min, SETTINGS_LIMITS.lives.max, base.lives),
    turnSeconds: clampInt(p.turnSeconds, SETTINGS_LIMITS.turnSeconds.min, SETTINGS_LIMITS.turnSeconds.max, base.turnSeconds),
    wrongAnswer: p.wrongAnswer === "retry" || p.wrongAnswer === "life" ? p.wrongAnswer : base.wrongAnswer,
    mysteryFuse: typeof p.mysteryFuse === "boolean" ? p.mysteryFuse : base.mysteryFuse,
    speedUp: typeof p.speedUp === "boolean" ? p.speedUp : base.speedUp,
  };
}
