// WebSocket + HTTP protocol shared by the Worker and the browser client.

export type Phase = "lobby" | "playing" | "over";

export interface GameSettings {
  /** Starting lives per player. */
  lives: number;
  /** Seconds per turn (or the average fuse when `mysteryFuse`). */
  turnSeconds: number;
  /** One hidden fuse shared by the table that carries over when you pass it on (Puffer Party style). */
  mysteryFuse: boolean;
  /** How many questions the deck holds. */
  questionCount: number;
}

/** lastStanding: one player left; allOut: everyone eliminated; questionsDone: the deck ran out. */
export type EndReason = "lastStanding" | "allOut" | "host" | "questionsDone";

/**
 * Why a question was retired.
 * cleared: it took its full share of answers. rounds: it went round the table ROUNDS_PER_QUESTION times.
 * stumped: it beat too many players, or was about to come back to someone it already beat.
 */
export type QuestionEndReason = "cleared" | "rounds" | "stumped";

/** The question being played right now. Future questions never leave the server. */
export interface PublicQuestion {
  /** 0-based position in the deck. */
  index: number;
  text: string;
  topic: string;
  /** Answers it takes before it's cleared. */
  cap: number;
  answered: number;
  turns: number;
  /** Turns before it moves on (ROUNDS_PER_QUESTION × players still in). */
  maxTurns: number;
  /** Players this question has beaten (the fuse popped on them). */
  stumped: string[];
  startedAt: number;
}

export interface PlayedQuestion {
  index: number;
  text: string;
  topic: string;
  /** False for questions revealed once the game is over that it never reached. */
  played: boolean;
  /** Null when the game ended while this question was up, or it was never reached. */
  endedBy: QuestionEndReason | null;
}

/** ok: enough good questions. thin: fewer than its share (other topics fill in). unusable: none. error: the writer failed. */
export type TopicStatus = "ok" | "thin" | "unusable" | "error";

export interface TopicReport {
  topic: string;
  status: TopicStatus;
  /** This topic's share of the deck. */
  wanted: number;
  /** Questions it actually has in the deck. */
  got: number;
  /** A short note for the host when the topic is thin or unusable. */
  reason: string | null;
  /** A broader topic to try instead. */
  suggestion: string | null;
}

export interface DeckInfo {
  /** idle: not written yet, or the topics/count changed since (the host presses WRITE QUESTIONS). */
  status: "idle" | "generating" | "ready" | "failed";
  /** Questions in the deck (not shown until played). */
  ready: number;
  wanted: number;
  reports: TopicReport[];
}

export type TierId = "basic" | "solid" | "rare" | "superrare" | "jevillion";

export type RejectReason = "invalid" | "duplicate" | "judge_error";

export type PlayerRole = "player" | "spectator";
export type PlayerStatus = "waiting" | "alive" | "eliminated";

export interface PlayerStats {
  accepted: number;
  rejected: number;
  duplicates: number;
  timeouts: number;
  livesLost: number;
  livesEarned: number;
  /** ms from turn start to accepted answer, summed (for averages). */
  totalAnswerMs: number;
  fastestMs: number | null;
  /** Best tier achieved, highest index into TIERS. */
  bestTier: TierId | null;
  bestAnswer: string | null;
  turnsSurvived: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: number;
  color: string;
  role: PlayerRole;
  status: PlayerStatus;
  lives: number;
  points: number;
  /** Progress towards the next bonus life, 0..BONUS_LIFE_POINTS. */
  meter: number;
  connected: boolean;
  joinedAt: number;
  /** When this player was eliminated. */
  outAt: number | null;
  /** Finishing place, 1 = winner; set when the game ends. */
  place: number | null;
  stats: PlayerStats;
}

export interface AcceptedAnswer {
  id: string;
  /** Deck index of the question it answers. */
  question: number;
  text: string;
  playerId: string;
  tier: TierId;
  points: number;
  at: number;
  /** Raw Jev validity probability (0..1); shown as a confidence pip. */
  confidence: number;
}

export interface TurnInfo {
  id: number;
  playerId: string;
  startedAt: number;
  /** Absolute server epoch ms the turn ends. Null with a mystery fuse, or while Jev is judging. */
  deadline: number | null;
  /** Visible length of the turn in ms (null with a mystery fuse). */
  durationMs: number | null;
  /** Remaining ms frozen while Jev judges (visible clock only). */
  frozenRemainingMs: number | null;
  judging: { text: string } | null;
  attempts: number;
}

export interface Verdict {
  id: string;
  playerId: string;
  text: string;
  accepted: boolean;
  reason: RejectReason | null;
  duplicateOf: string | null;
  confidence: number;
  tier: TierId | null;
  at: number;
  turnId: number;
}

export interface Award {
  id: string;
  title: string;
  blurb: string;
  playerId: string;
}

export interface PublicState {
  code: string;
  topics: string[];
  deck: DeckInfo;
  phase: Phase;
  settings: GameSettings;
  hostId: string | null;
  players: PublicPlayer[];
  turn: TurnInfo | null;
  turnOrder: string[];
  lap: number;
  question: PublicQuestion | null;
  /** Questions already played (plus, once the game is over, the ones it never reached). */
  history: PlayedQuestion[];
  /** Every accepted answer this game, across all questions. */
  answers: AcceptedAnswer[];
  /** Most recent verdicts, newest last. */
  log: Verdict[];
  startedAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
  endReason: EndReason | null;
  awards: Award[];
  judge: JudgeKind;
  /** Epoch ms when the room will be wiped if nothing happens. */
  expiresAt: number;
}

export type JudgeKind = "jev" | "mock";
export type GeneratorKind = "openai" | "mock";

/** Wrong answers never cost a heart (the fuse is the penalty), so the only way to lose one is the fuse popping. */
export type LifeLostReason = "timeout";

export type GameEvent =
  | { type: "playerJoined"; playerId: string }
  | { type: "playerLeft"; playerId: string }
  | { type: "playerKicked"; playerId: string }
  | { type: "hostChanged"; playerId: string }
  | { type: "gameStarted" }
  | { type: "turnStarted"; playerId: string; turnId: number }
  | { type: "questionStarted"; index: number; why: "start" | QuestionEndReason }
  | { type: "judging"; playerId: string; text: string }
  | { type: "accepted"; answer: AcceptedAnswer }
  | { type: "rejected"; verdict: Verdict }
  | { type: "lifeLost"; playerId: string; reason: LifeLostReason; livesLeft: number }
  | { type: "lifeEarned"; playerId: string; lives: number }
  | { type: "eliminated"; playerId: string }
  | { type: "skipped"; playerId: string }
  | { type: "gameOver"; winnerId: string | null; reason: EndReason }
  | { type: "backToLobby" };

export type Emote = "clap" | "lol" | "fire" | "shock" | "hmm" | "eyes";
export const EMOTES: readonly Emote[] = ["clap", "lol", "fire", "shock", "hmm", "eyes"];

export type ClientMessage =
  | { type: "hello"; token: string; name: string | null }
  | { type: "start" }
  | { type: "configure"; settings: Partial<GameSettings>; topics?: string[] }
  /** Host: write the deck for the current topics and question count. */
  | { type: "generate" }
  | { type: "submit"; text: string }
  | { type: "typing"; text: string }
  | { type: "kick"; playerId: string }
  | { type: "skip" }
  | { type: "end" }
  | { type: "rematch" }
  | { type: "emote"; emote: Emote }
  | { type: "becomePlayer" };

export interface You {
  playerId: string;
  role: PlayerRole;
}

export type ErrorCode =
  | "bad_message"
  | "not_host"
  | "not_your_turn"
  | "rate_limited"
  | "room_full"
  | "not_found"
  | "bad_name"
  | "bad_answer"
  | "already_judging"
  | "wrong_phase"
  | "deck_not_ready"
  | "kicked";

export type ServerMessage =
  | { type: "welcome"; you: You; state: PublicState; serverNow: number }
  | { type: "state"; state: PublicState; events: GameEvent[]; serverNow: number }
  | { type: "typing"; playerId: string; text: string }
  | { type: "emote"; playerId: string; emote: Emote }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "closed"; reason: "expired" | "kicked" };

// HTTP API

/** Rooms start empty: the host picks topics and settings in the lobby. */
export interface CreateRoomRequest {
  token: string;
}

export type CreateRoomResponse = { ok: true; code: string } | { ok: false; error: "bad_topic" | "bad_request" | "unavailable"; message: string };

export type RoomInfoResponse =
  | { ok: true; code: string; topics: string[]; phase: Phase; players: number; maxPlayers: number }
  | { ok: false; error: "not_found" };

export interface HealthResponse {
  ok: true;
  judge: JudgeKind;
  model: string | null;
  generator: GeneratorKind;
  generatorModel: string | null;
}
