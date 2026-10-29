// WebSocket + HTTP protocol shared by the Worker and the browser client.

export type GameMode = "timed" | "free";
export type Phase = "lobby" | "playing" | "over";
export type WrongAnswerRule = "retry" | "life";

export interface GameSettings {
  mode: GameMode;
  /** Timed mode: starting lives per player. */
  lives: number;
  /** Timed mode: seconds per turn (or the average fuse when `mysteryFuse`). */
  turnSeconds: number;
  /** Timed mode: what a rejected answer costs. "retry" keeps the clock running; "life" costs a heart and passes the turn. */
  wrongAnswer: WrongAnswerRule;
  /** Timed mode: hide the clock and pop at a random moment (Puffer Party style). */
  mysteryFuse: boolean;
  /** Timed mode: shave time off the turn clock after every full lap. */
  speedUp: boolean;
}

/** lastStanding: one timed player left; allOut: everyone eliminated or tapped out; cleared: Jev says nothing is left to name. */
export type EndReason = "lastStanding" | "allOut" | "host" | "cleared";

export type TierId = "basic" | "solid" | "rare" | "superrare" | "jevillion";

export type RejectReason = "invalid" | "duplicate" | "judge_error";

export type PlayerRole = "player" | "spectator";
export type PlayerStatus = "waiting" | "alive" | "eliminated" | "tappedOut";

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
  /** Timed mode: progress towards the next bonus life, 0..BONUS_LIFE_POINTS. */
  meter: number;
  connected: boolean;
  joinedAt: number;
  /** When this player was eliminated or tapped out. */
  outAt: number | null;
  /** Finishing place, 1 = winner; set when the game ends. */
  place: number | null;
  stats: PlayerStats;
}

export interface AcceptedAnswer {
  id: string;
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
  /** Absolute server epoch ms the turn ends. Null in free mode, with a mystery fuse, or while Jev is judging. */
  deadline: number | null;
  /** Visible length of the turn in ms (null in free mode / mystery fuse). */
  durationMs: number | null;
  /** Remaining ms frozen while Jev judges (timed mode, visible clock). */
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
  topic: string;
  phase: Phase;
  settings: GameSettings;
  hostId: string | null;
  players: PublicPlayer[];
  turn: TurnInfo | null;
  turnOrder: string[];
  lap: number;
  answers: AcceptedAnswer[];
  /** Most recent verdicts, newest last. */
  log: Verdict[];
  startedAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
  endReason: EndReason | null;
  awards: Award[];
  judge: JudgeKind;
  /** Jev thinks the topic has under ~20 answers, so the board may run dry. Null until checked. */
  shortList: boolean | null;
  /** Epoch ms when the room will be wiped if nothing happens. */
  expiresAt: number;
}

export type JudgeKind = "jev" | "mock";

export type LifeLostReason = "timeout" | "wrong" | "duplicate";

export type GameEvent =
  | { type: "playerJoined"; playerId: string }
  | { type: "playerLeft"; playerId: string }
  | { type: "playerKicked"; playerId: string }
  | { type: "hostChanged"; playerId: string }
  | { type: "gameStarted" }
  | { type: "turnStarted"; playerId: string; turnId: number }
  | { type: "judging"; playerId: string; text: string }
  | { type: "accepted"; answer: AcceptedAnswer }
  | { type: "rejected"; verdict: Verdict }
  | { type: "lifeLost"; playerId: string; reason: LifeLostReason; livesLeft: number }
  | { type: "lifeEarned"; playerId: string; lives: number }
  | { type: "eliminated"; playerId: string }
  | { type: "tappedOut"; playerId: string }
  | { type: "skipped"; playerId: string }
  | { type: "speedUp"; turnSeconds: number }
  | { type: "gameOver"; winnerId: string | null; reason: EndReason }
  | { type: "backToLobby" };

export type Emote = "👏" | "😂" | "🔥" | "😱" | "🤔" | "👀";
export const EMOTES: readonly Emote[] = ["👏", "😂", "🔥", "😱", "🤔", "👀"];

export type ClientMessage =
  | { type: "hello"; token: string; name: string | null }
  | { type: "start" }
  | { type: "configure"; settings: Partial<GameSettings>; topic?: string }
  | { type: "submit"; text: string }
  | { type: "typing"; text: string }
  | { type: "tapOut" }
  | { type: "kick"; playerId: string }
  | { type: "skip" }
  | { type: "end" }
  | { type: "rematch"; topic?: string }
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
  | "kicked";

export type ServerMessage =
  | { type: "welcome"; you: You; state: PublicState; serverNow: number }
  | { type: "state"; state: PublicState; events: GameEvent[]; serverNow: number }
  | { type: "typing"; playerId: string; text: string }
  | { type: "emote"; playerId: string; emote: Emote }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "closed"; reason: "expired" | "kicked" };

// HTTP API

export interface CreateRoomRequest {
  topic: string;
  settings: Partial<GameSettings>;
  token: string;
  /** Create even if Jev thinks the topic is hard to list examples of. */
  force?: boolean;
}

export type CreateRoomResponse =
  | { ok: true; code: string }
  | { ok: false; error: "bad_topic" | "bad_request" | "unavailable"; message: string }
  | { ok: false; error: "topic_warning"; message: string; listability: number };

export type RoomInfoResponse =
  | { ok: true; code: string; topic: string; phase: Phase; mode: GameMode; players: number; maxPlayers: number }
  | { ok: false; error: "not_found" };

export interface HealthResponse {
  ok: true;
  judge: JudgeKind;
  model: string | null;
}
