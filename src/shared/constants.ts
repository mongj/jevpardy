import type { GameSettings, TierId } from "./protocol.ts";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export const MAX_NAME_LENGTH = 16;
export const MAX_TOPIC_LENGTH = 60;
export const MIN_TOPIC_LENGTH = 3;
/** Topics per room. Questions are spread evenly across them. */
export const MAX_TOPICS = 5;
export const MAX_ANSWER_LENGTH = 60;

export const DEFAULT_MAX_PLAYERS = 12;
export const MAX_SPECTATORS = 40;
export const MAX_LIVES = 5;
/** Points that fill the 1UP meter for a bonus life. Games now run many questions, so hearts are earned slower than before. */
export const BONUS_LIFE_POINTS = 300;

export const MIN_SUBMIT_INTERVAL_MS = 600;
export const MAX_ATTEMPTS_PER_TURN = 30;
export const MIN_TYPING_INTERVAL_MS = 80;


/** Extra time on the first turn of a new question, so everyone can read it. */
export const QUESTION_REVEAL_MS = 1_800;

/** A question moves on after this many trips round the table, at the latest (sooner if it's cleared or stumps people). */
export const ROUNDS_PER_QUESTION = 3;

/** Bounds on how many answers one question takes before it's "cleared" (set per question from its answer pool). */
export const QUESTION_CAP_MIN = 5;
export const QUESTION_CAP_MAX = 20;
/** Cap for questions Jev reckons have under ~20 answers in total. */
export const SHORT_QUESTION_CAP = 6;

export const LOBBY_IDLE_MS = 30 * 60_000;
export const PLAYING_IDLE_MS = 30 * 60_000;
/** How long the end screen stays available before the room is wiped. */
export const OVER_TTL_MS = 15 * 60_000;
/** Empty rooms (nobody connected) are wiped after this. */
export const EMPTY_ROOM_MS = 5 * 60_000;
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
  { id: "basic", name: "BASIC", points: 10, blurb: "The one everybody blurts out.", color: "#9fb3d9" },
  { id: "solid", name: "SOLID", points: 25, blurb: "Well known. Good pick.", color: "#3ef0ff" },
  { id: "rare", name: "RARE", points: 50, blurb: "Genuinely uncommon. Nice one.", color: "#ff4fd8" },
  { id: "superrare", name: "SUPER RARE", points: 80, blurb: "True obscurity. Few ever find it.", color: "#b48cff" },
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
  lives: 3,
  turnSeconds: 15,
  questionCount: 10,
};

export const SETTINGS_LIMITS = {
  lives: { min: 1, max: MAX_LIVES },
  turnSeconds: { min: 5, max: 60 },
  questionCount: { min: 3, max: 30 },
} as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merges untrusted partial settings onto a base, clamping every field. */
export function mergeSettings(base: GameSettings, patch: Partial<GameSettings> | undefined): GameSettings {
  const p: Partial<Record<keyof GameSettings, unknown>> = patch ?? {};
  return {
    lives: clampInt(p.lives, SETTINGS_LIMITS.lives.min, SETTINGS_LIMITS.lives.max, base.lives),
    turnSeconds: clampInt(p.turnSeconds, SETTINGS_LIMITS.turnSeconds.min, SETTINGS_LIMITS.turnSeconds.max, base.turnSeconds),
    questionCount: clampInt(p.questionCount, SETTINGS_LIMITS.questionCount.min, SETTINGS_LIMITS.questionCount.max, base.questionCount),
  };
}
