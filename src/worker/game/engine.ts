import {
  AVATAR_COUNT,
  BONUS_LIFE_POINTS,
  DEFAULT_SETTINGS,
  EMPTY_ROOM_MS,
  FUSE_FLOOR_FACTOR,
  FUSE_FLOOR_MIN_MS,
  FUSE_MAX_FACTOR,
  FUSE_MIN_FACTOR,
  HOST_GRACE_MS,
  LOBBY_IDLE_MS,
  LOG_LIMIT,
  MAX_ATTEMPTS_PER_TURN,
  MAX_LIVES,
  MAX_SPECTATORS,
  MIN_SUBMIT_INTERVAL_MS,
  OVER_TTL_MS,
  PLAYER_COLORS,
  PLAYING_IDLE_MS,
  QUESTION_REVEAL_MS,
  TIERS,
  mergeSettings,
  tierById,
  tierIndex,
} from "../../shared/constants.ts";
import type {
  AcceptedAnswer,
  Award,
  DeckInfo,
  EndReason,
  ErrorCode,
  GameEvent,
  GameSettings,
  JudgeKind,
  LifeLostReason,
  Phase,
  PlayedQuestion,
  PlayerRole,
  PlayerStats,
  PlayerStatus,
  PublicPlayer,
  PublicQuestion,
  PublicState,
  QuestionEndReason,
  TierId,
  TopicReport,
  TurnInfo,
  Verdict,
} from "../../shared/protocol.ts";
import { normalizeAnswer, sanitizeAnswer, sanitizeName, sanitizeTopics, topicKey } from "../../shared/sanitize.ts";
import type { JudgeInput, JudgeOutput, Thresholds } from "../judge/types.ts";
import { type DeckQuestion, buildDeck, topicsToGenerate } from "../questions/deck.ts";
import type { GenerateRequest, TopicPool } from "../questions/types.ts";

/** A stuck judge call is treated as an error after this long. */
export const JUDGE_STUCK_MS = 15_000;
/** A deck still "generating" after this long (e.g. the object was evicted mid-call) is restarted. */
export const GENERATION_STUCK_MS = 75_000;
/** Pools kept for topics no longer in the room, so toggling a topic back is free. */
const SPARE_POOLS = 6;

export interface Ctx {
  now: number;
  rng: () => number;
  newId: () => string;
}

export interface PlayerRecord {
  id: string;
  token: string;
  name: string;
  avatar: number;
  color: string;
  role: PlayerRole;
  status: PlayerStatus;
  lives: number;
  points: number;
  meter: number;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
  outAt: number | null;
  place: number | null;
  lastSubmitAt: number;
  stats: PlayerStats;
}

interface TurnRecord {
  id: number;
  playerId: string;
  startedAt: number;
  /** Real deadline; hidden from clients when the fuse is a mystery. */
  deadline: number | null;
  durationMs: number | null;
  judging: { text: string; startedAt: number; remainingMs: number | null } | null;
  attempts: number;
}

interface CurrentQuestion {
  index: number;
  startedAt: number;
  /** Turns finished on this question (answered, failed or skipped). */
  turns: number;
  /** Players it has beaten, in order. */
  failedBy: string[];
}

export interface Generation {
  /** Bumped every time a new round of writing starts. */
  id: number;
  status: DeckInfo["status"];
  startedAt: number | null;
}

export interface RoomState {
  version: 2;
  code: string;
  topics: string[];
  phase: Phase;
  settings: GameSettings;
  judge: JudgeKind;
  maxPlayers: number;
  /** The creator's token; whoever connects with it gets the host crown. */
  hostToken: string | null;
  hostId: string | null;
  players: PlayerRecord[];
  kickedTokens: string[];
  /** Everything the writer produced, per topic. Never sent to clients. */
  pools: TopicPool[];
  /** This game's questions in play order. Never sent to clients ahead of time. */
  deck: DeckQuestion[];
  deckReports: TopicReport[];
  generation: Generation;
  /** Every question played in this room, so rematches don't repeat them. */
  played: string[];
  question: CurrentQuestion | null;
  history: PlayedQuestion[];
  turn: TurnRecord | null;
  turnCounter: number;
  turnOrder: string[];
  lap: number;
  /** Mystery fuse: when the shared fuse pops (paused while Jev judges). */
  fuseEndsAt: number | null;
  startingPlayers: number;
  answers: AcceptedAnswer[];
  log: Verdict[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
  endReason: EndReason | null;
  awards: Award[];
  lastActivityAt: number;
  emptySince: number | null;
}

export type Fail = { ok: false; code: ErrorCode; message: string };
export type Result<T = object> = ({ ok: true; events: GameEvent[] } & T) | Fail;

function fail(code: ErrorCode, message: string): Fail {
  return { ok: false, code, message };
}

function emptyStats(): PlayerStats {
  return {
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    timeouts: 0,
    livesLost: 0,
    livesEarned: 0,
    totalAnswerMs: 0,
    fastestMs: null,
    bestTier: null,
    bestAnswer: null,
    turnsSurvived: 0,
  };
}

export interface CreateRoomOptions {
  code: string;
  topics: string[];
  settings?: Partial<GameSettings>;
  judge: JudgeKind;
  maxPlayers: number;
  hostToken?: string;
}

export function createRoom(opts: CreateRoomOptions, ctx: Pick<Ctx, "now">): RoomState {
  const settings = mergeSettings(DEFAULT_SETTINGS, opts.settings);
  return {
    version: 2,
    code: opts.code,
    topics: sanitizeTopics(opts.topics) ?? [],
    phase: "lobby",
    settings,
    judge: opts.judge,
    maxPlayers: opts.maxPlayers,
    hostToken: opts.hostToken ?? null,
    hostId: null,
    players: [],
    kickedTokens: [],
    pools: [],
    deck: [],
    deckReports: [],
    generation: { id: 0, status: "generating", startedAt: null },
    played: [],
    question: null,
    history: [],
    turn: null,
    turnCounter: 0,
    turnOrder: [],
    lap: 0,
    fuseEndsAt: null,
    startingPlayers: 0,
    answers: [],
    log: [],
    createdAt: ctx.now,
    startedAt: null,
    endedAt: null,
    winnerId: null,
    endReason: null,
    awards: [],
    lastActivityAt: ctx.now,
    emptySince: ctx.now,
  };
}

export function findPlayer(state: RoomState, id: string | null | undefined): PlayerRecord | undefined {
  return id ? state.players.find((p) => p.id === id) : undefined;
}

function contestants(state: RoomState): PlayerRecord[] {
  return state.players.filter((p) => p.role === "player");
}

function activePlayers(state: RoomState): PlayerRecord[] {
  return state.players.filter((p) => p.role === "player" && p.status === "alive");
}

function isHost(state: RoomState, playerId: string): boolean {
  return state.hostId === playerId;
}

function touch(state: RoomState, ctx: Pick<Ctx, "now">): void {
  state.lastActivityAt = ctx.now;
}

// ─── Membership ─────────────────────────────────────────────────────────────

export function join(
  state: RoomState,
  input: { token: string; name: string | null },
  ctx: Ctx,
): Result<{ player: PlayerRecord; reconnected: boolean }> {
  if (state.kickedTokens.includes(input.token)) return fail("kicked", "The host removed you from this room.");
  const events: GameEvent[] = [];
  const existing = state.players.find((p) => p.token === input.token);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    state.emptySince = null;
    touch(state, ctx);
    return { ok: true, events, player: existing, reconnected: true };
  }

  const name = sanitizeName(input.name);
  if (!name) return fail("bad_name", "Pick a display name (letters or numbers).");

  // Mid-game joiners watch until the next game.
  const canPlay = state.phase === "lobby" && contestants(state).length < state.maxPlayers;
  if (!canPlay && state.players.filter((p) => p.role === "spectator").length >= MAX_SPECTATORS) {
    return fail("room_full", "This room is packed. Try again later.");
  }

  const usedColors = new Set(state.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[state.players.length % PLAYER_COLORS.length]!;
  const player: PlayerRecord = {
    id: ctx.newId(),
    token: input.token,
    name: dedupeName(state, name),
    avatar: state.players.length % AVATAR_COUNT,
    color,
    role: canPlay ? "player" : "spectator",
    status: "waiting",
    lives: 0,
    points: 0,
    meter: 0,
    connected: true,
    disconnectedAt: null,
    joinedAt: ctx.now,
    outAt: null,
    place: null,
    lastSubmitAt: 0,
    stats: emptyStats(),
  };
  state.players.push(player);
  if (!state.hostId || input.token === state.hostToken) {
    if (state.hostId && state.hostId !== player.id) events.push({ type: "hostChanged", playerId: player.id });
    state.hostId = player.id;
  }
  state.emptySince = null;
  touch(state, ctx);
  events.push({ type: "playerJoined", playerId: player.id });
  return { ok: true, events, player, reconnected: false };
}

function dedupeName(state: RoomState, name: string): string {
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, 13)}#${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function disconnect(state: RoomState, playerId: string, ctx: Ctx): GameEvent[] {
  const player = findPlayer(state, playerId);
  if (!player || !player.connected) return [];
  player.connected = false;
  player.disconnectedAt = ctx.now;
  if (!state.players.some((p) => p.connected)) state.emptySince = ctx.now;
  return [{ type: "playerLeft", playerId }];
}

/** Reconciles connection flags after a restart, given the ids with live sockets. */
export function syncConnections(state: RoomState, connectedIds: Set<string>, ctx: Pick<Ctx, "now">): void {
  for (const p of state.players) {
    const live = connectedIds.has(p.id);
    if (p.connected && !live) p.disconnectedAt = ctx.now;
    p.connected = live;
  }
  state.emptySince = state.players.some((p) => p.connected) ? null : (state.emptySince ?? ctx.now);
}

function promoteHost(state: RoomState): GameEvent[] {
  const candidates = state.players.filter((p) => p.connected && p.id !== state.hostId);
  const next = candidates.find((p) => p.role === "player") ?? candidates[0];
  if (!next) {
    if (!findPlayer(state, state.hostId)) state.hostId = null;
    return [];
  }
  state.hostId = next.id;
  return [{ type: "hostChanged", playerId: next.id }];
}

export function becomePlayer(state: RoomState, playerId: string, ctx: Ctx): Result {
  const player = findPlayer(state, playerId);
  if (!player) return fail("not_found", "Unknown player.");
  if (player.role === "player") return { ok: true, events: [] };
  if (state.phase !== "lobby") return fail("wrong_phase", "Wait for the next game to jump in.");
  if (contestants(state).length >= state.maxPlayers) return fail("room_full", "All seats are taken.");
  player.role = "player";
  touch(state, ctx);
  return { ok: true, events: [{ type: "playerJoined", playerId }] };
}

export function kick(state: RoomState, actorId: string, targetId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can do that.");
  if (actorId === targetId) return fail("bad_message", "You can't kick yourself.");
  const target = findPlayer(state, targetId);
  if (!target) return fail("not_found", "Unknown player.");
  state.kickedTokens.push(target.token);
  const events: GameEvent[] = [{ type: "playerKicked", playerId: targetId }];
  const wasTurn = state.turn?.playerId === targetId;
  // Keep the order intact until we've found who's next after the kicked player.
  state.players = state.players.filter((p) => p.id !== targetId);
  if (state.phase === "playing") {
    if (wasTurn) {
      state.turn = null;
      events.push(...advanceTurn(state, targetId, ctx));
    } else {
      events.push(...checkGameOver(state, ctx));
    }
  }
  state.turnOrder = state.turnOrder.filter((id) => id !== targetId);
  touch(state, ctx);
  return { ok: true, events };
}

// ─── Lobby & deck ───────────────────────────────────────────────────────────

/** What the deck needs from the question writer right now (empty when the pools already cover it). */
export function deckPlan(state: RoomState): GenerateRequest[] {
  return topicsToGenerate({ topics: state.topics, pools: state.pools, count: state.settings.questionCount, played: state.played });
}

/** Marks the deck as being written and returns the new generation id. */
export function beginGeneration(state: RoomState, ctx: Pick<Ctx, "now">): number {
  state.generation = { id: state.generation.id + 1, status: "generating", startedAt: ctx.now };
  return state.generation.id;
}

/** Stores freshly written topic pools (replacing older ones for the same topic). */
export function applyPools(state: RoomState, pools: TopicPool[]): void {
  for (const pool of pools) {
    state.pools = state.pools.filter((p) => p.key !== pool.key);
    state.pools.push(pool);
  }
  const live = new Set(state.topics.map(topicKey));
  const spare = state.pools.filter((p) => !live.has(p.key));
  if (spare.length > SPARE_POOLS) {
    const drop = new Set(spare.slice(0, spare.length - SPARE_POOLS).map((p) => p.key));
    state.pools = state.pools.filter((p) => !drop.has(p.key));
  }
}

/** Deals the deck from the pools. Only in the lobby: a game in progress keeps its deck. */
export function rebuildDeck(state: RoomState, ctx: Pick<Ctx, "rng">): void {
  if (state.phase !== "lobby") return;
  const { questions, reports } = buildDeck({
    topics: state.topics,
    pools: state.pools,
    count: state.settings.questionCount,
    played: state.played,
    rng: ctx.rng,
  });
  state.deck = questions;
  state.deckReports = reports;
  const writerDown = questions.length === 0 && reports.length > 0 && reports.every((r) => r.status === "error");
  state.generation = { ...state.generation, status: writerDown ? "failed" : "ready", startedAt: null };
}

/** Host asks for another go at topics that came back thin, unusable or failed. */
export function regenerate(state: RoomState, actorId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can do that.");
  if (state.phase !== "lobby") return fail("wrong_phase", "The game already started.");
  const retry = new Set(state.deckReports.filter((r) => r.status !== "ok").map((r) => topicKey(r.topic)));
  state.pools = state.pools.filter((p) => !retry.has(p.key));
  touch(state, ctx);
  return { ok: true, events: [] };
}

/** True when topics or question count changed, so the room should top up the deck. */
export function configure(
  state: RoomState,
  actorId: string,
  patch: Partial<GameSettings>,
  topics: string[] | undefined,
  ctx: Ctx,
): Result<{ deckChanged: boolean }> {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can change settings.");
  if (state.phase !== "lobby") return fail("wrong_phase", "Settings are locked once the game starts.");
  const before = `${state.topics.join("\n")}|${state.settings.questionCount}`;
  if (topics !== undefined) {
    const clean = sanitizeTopics(topics);
    if (!clean) return fail("bad_message", "Add at least one topic (3+ characters).");
    state.topics = clean;
  }
  state.settings = mergeSettings(state.settings, patch);
  touch(state, ctx);
  return { ok: true, events: [], deckChanged: before !== `${state.topics.join("\n")}|${state.settings.questionCount}` };
}

// ─── Game flow ──────────────────────────────────────────────────────────────

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function start(state: RoomState, actorId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can start the game.");
  if (state.phase !== "lobby") return fail("wrong_phase", "The game already started.");
  if (state.generation.status === "generating") return fail("deck_not_ready", "Still writing the questions…");
  if (state.deck.length === 0) return fail("deck_not_ready", "No playable questions yet. Try different topics.");
  // Whoever wandered off from the lobby doesn't get dealt in.
  state.players = state.players.filter((p) => p.connected || p.id === actorId);
  const roster = contestants(state);
  if (roster.length === 0) return fail("wrong_phase", "Need at least one player.");
  for (const p of roster) {
    p.status = "alive";
    p.lives = state.settings.lives;
  }
  state.phase = "playing";
  state.startedAt = ctx.now;
  state.startingPlayers = roster.length;
  state.turnOrder = shuffle(
    roster.map((p) => p.id),
    ctx.rng,
  );
  state.lap = 1;
  state.fuseEndsAt = null;
  state.history = [];
  touch(state, ctx);
  const events: GameEvent[] = [{ type: "gameStarted" }, ...openQuestion(state, 0, "start", ctx)];
  events.push(...beginTurn(state, state.turnOrder[0]!, ctx, { freshFuse: true, reveal: true }));
  return { ok: true, events };
}

function openQuestion(state: RoomState, index: number, why: "start" | QuestionEndReason, ctx: Pick<Ctx, "now">): GameEvent[] {
  state.question = { index, startedAt: ctx.now, turns: 0, failedBy: [] };
  const q = state.deck[index]!;
  if (!state.played.includes(q.text)) state.played.push(q.text);
  return [{ type: "questionStarted", index, why }];
}

function retireQuestion(state: RoomState, endedBy: QuestionEndReason | null): void {
  const current = state.question;
  if (!current) return;
  const q = state.deck[current.index]!;
  state.history.push({ index: current.index, text: q.text, topic: q.topic, played: true, endedBy });
  state.question = null;
}

/** Retires the current question and opens the next one, or ends the game when the deck is spent. */
function rotateQuestion(state: RoomState, why: QuestionEndReason, ctx: Ctx): GameEvent[] {
  const index = state.question ? state.question.index + 1 : 0;
  retireQuestion(state, why);
  if (index >= state.deck.length) return finish(state, ctx, "questionsDone");
  return openQuestion(state, index, why, ctx);
}

function answersFor(state: RoomState, index: number): AcceptedAnswer[] {
  return state.answers.filter((a) => a.question === index);
}

function maxTurns(state: RoomState): number {
  return state.settings.roundsPerQuestion * Math.max(1, activePlayers(state).length);
}

/**
 * Puffer Party's rotation, as measured on krillion.io: a question that beats people moves on fast,
 * and nobody faces a question that already beat them.
 */
export function questionEndReason(state: RoomState, nextPlayerId: string): QuestionEndReason | null {
  const q = state.question;
  if (!q) return null;
  if (answersFor(state, q.index).length >= state.deck[q.index]!.cap) return "cleared";
  if (q.turns >= maxTurns(state)) return "rounds";
  const stumpLimit = activePlayers(state).length <= 2 ? 1 : 2;
  if (q.failedBy.length >= stumpLimit || q.failedBy.includes(nextPlayerId)) return "stumped";
  return null;
}

function fuseFloorMs(state: RoomState): number {
  return Math.max(FUSE_FLOOR_MIN_MS, Math.round(state.settings.turnSeconds * 1000 * FUSE_FLOOR_FACTOR));
}

function beginTurn(state: RoomState, playerId: string, ctx: Ctx, opts: { freshFuse?: boolean; reveal?: boolean } = {}): GameEvent[] {
  const base = state.settings.turnSeconds * 1000;
  const reveal = opts.reveal ? QUESTION_REVEAL_MS : 0;
  let deadline: number;
  let durationMs: number;
  if (state.settings.mysteryFuse) {
    // One fuse for the whole table: passing it on keeps what's left, topped up to a floor.
    if (opts.freshFuse || state.fuseEndsAt === null) {
      state.fuseEndsAt = ctx.now + Math.round(base * (FUSE_MIN_FACTOR + ctx.rng() * (FUSE_MAX_FACTOR - FUSE_MIN_FACTOR)));
    }
    deadline = Math.max(state.fuseEndsAt, ctx.now + fuseFloorMs(state)) + reveal;
    state.fuseEndsAt = deadline;
    durationMs = deadline - ctx.now;
  } else {
    durationMs = base + reveal;
    deadline = ctx.now + durationMs;
  }
  state.turnCounter += 1;
  state.turn = {
    id: state.turnCounter,
    playerId,
    startedAt: ctx.now,
    deadline,
    durationMs,
    judging: null,
    attempts: 0,
  };
  return [{ type: "turnStarted", playerId, turnId: state.turnCounter }];
}

/** Picks the next player after `afterId` in turn order. */
function nextPlayerId(state: RoomState, afterId: string): { id: string; wrapped: boolean } | null {
  const order = state.turnOrder;
  const active = new Set(activePlayers(state).map((p) => p.id));
  if (active.size === 0) return null;
  const startIdx = order.indexOf(afterId);
  for (let step = 1; step <= order.length; step++) {
    const idx = (startIdx + step) % order.length;
    const id = order[idx]!;
    if (active.has(id)) return { id, wrapped: startIdx === -1 ? false : idx <= startIdx };
  }
  return null;
}

/** Ends the current turn: counts it against the question, rotates the question if it's done, and hands over. */
function advanceTurn(state: RoomState, fromId: string, ctx: Ctx, opts: { freshFuse?: boolean } = {}): GameEvent[] {
  const over = checkGameOver(state, ctx);
  if (over.length > 0) return over;
  if (state.question) state.question.turns += 1;
  const next = nextPlayerId(state, fromId);
  if (!next) return finish(state, ctx, "allOut");
  const events: GameEvent[] = [];
  const why = questionEndReason(state, next.id);
  if (why) {
    events.push(...rotateQuestion(state, why, ctx));
    if (state.phase !== "playing") return events;
  }
  if (next.wrapped) state.lap += 1;
  events.push(...beginTurn(state, next.id, ctx, { freshFuse: opts.freshFuse, reveal: why !== null }));
  return events;
}

function checkGameOver(state: RoomState, ctx: Ctx): GameEvent[] {
  if (state.phase !== "playing") return [];
  const alive = activePlayers(state);
  // Last one standing wins a multiplayer game; solo games play to the last heart.
  const lastStanding = state.startingPlayers > 1 && alive.length === 1 && contestants(state).length > 1;
  if (alive.length === 0) return finish(state, ctx, "allOut");
  if (lastStanding) return finish(state, ctx, "lastStanding");
  return [];
}

export function finish(state: RoomState, ctx: Pick<Ctx, "now">, reason: EndReason): GameEvent[] {
  if (state.phase !== "playing") return [];
  state.phase = "over";
  state.endedAt = ctx.now;
  state.endReason = reason;
  state.turn = null;
  state.fuseEndsAt = null;
  retireQuestion(state, null);
  // The mystery is over: reveal the questions the game never reached.
  const reached = new Set(state.history.map((h) => h.index));
  state.deck.forEach((q, index) => {
    if (!reached.has(index)) state.history.push({ index, text: q.text, topic: q.topic, played: false, endedBy: null });
  });
  const roster = contestants(state);
  // Survivors first (by points), then by how late they were knocked out.
  const ranked = [...roster].sort((a, b) => {
    const aOut = a.status === "alive" ? Infinity : (a.outAt ?? 0);
    const bOut = b.status === "alive" ? Infinity : (b.outAt ?? 0);
    if (aOut !== bOut) return bOut - aOut;
    if (a.points !== b.points) return b.points - a.points;
    return b.stats.accepted - a.stats.accepted;
  });
  ranked.forEach((p, i) => {
    p.place = i + 1;
  });
  const top = ranked[0];
  state.winnerId = top?.id ?? null;
  state.awards = computeAwards(state);
  return [{ type: "gameOver", winnerId: state.winnerId, reason }];
}

function computeAwards(state: RoomState): Award[] {
  const roster = contestants(state);
  const awards: Award[] = [];
  const best = <T>(score: (p: PlayerRecord) => T | null, better: (a: T, b: T) => boolean) => {
    let winner: PlayerRecord | null = null;
    let value: T | null = null;
    for (const p of roster) {
      const v = score(p);
      if (v === null) continue;
      if (value === null || better(v, value)) {
        winner = p;
        value = v;
      }
    }
    return winner && value !== null ? { winner, value } : null;
  };

  if (state.endReason === "lastStanding") {
    const survivor = roster.find((p) => p.status === "alive");
    if (survivor) awards.push({ id: "survivor", title: "LAST ONE STANDING", blurb: "Outlasted everyone.", playerId: survivor.id });
  }
  const high = best(
    (p) => (p.points > 0 ? p.points : null),
    (a, b) => a > b,
  );
  if (high) awards.push({ id: "highscore", title: "HIGH SCORE", blurb: `${high.value} pts`, playerId: high.winner.id });
  // Range: answered the most different questions.
  const range = best(
    (p) => {
      const n = new Set(state.answers.filter((a) => a.playerId === p.id).map((a) => a.question)).size;
      return n >= 3 ? n : null;
    },
    (a, b) => a > b,
  );
  if (range) awards.push({ id: "allrounder", title: "ALL-ROUNDER", blurb: `scored on ${range.value} questions`, playerId: range.winner.id });
  const rarest = best(
    (p) => (p.stats.bestTier ? tierIndex(p.stats.bestTier) : null),
    (a, b) => a > b,
  );
  if (rarest && rarest.value >= 2) {
    awards.push({
      id: "rarest",
      title: "RAREST FIND",
      blurb: `"${rarest.winner.stats.bestAnswer}" — ${TIERS[rarest.value]!.name}`,
      playerId: rarest.winner.id,
    });
  }
  const fast = best(
    (p) => p.stats.fastestMs,
    (a, b) => a < b,
  );
  if (fast) {
    awards.push({ id: "speed", title: "SPEED DEMON", blurb: `${(fast.value / 1000).toFixed(1)}s answer`, playerId: fast.winner.id });
  }
  const nemesis = best(
    (p) => (p.stats.rejected >= 2 ? p.stats.rejected : null),
    (a, b) => a > b,
  );
  if (nemesis) awards.push({ id: "nemesis", title: "JEV'S NEMESIS", blurb: `${nemesis.value} answers bounced`, playerId: nemesis.winner.id });
  return awards;
}

// ─── Answers ────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true; events: GameEvent[]; judge: JudgeInput; turnId: number }
  | { ok: true; events: GameEvent[]; judge: null }
  | Fail;

export function submit(state: RoomState, playerId: string, rawText: string, ctx: Ctx): SubmitResult {
  if (state.phase !== "playing" || !state.turn || !state.question) return fail("wrong_phase", "No game in progress.");
  const turn = state.turn;
  if (turn.playerId !== playerId) return fail("not_your_turn", "Hold on — it's not your turn.");
  if (turn.judging) return fail("already_judging", "Jev is still thinking…");
  const player = findPlayer(state, playerId);
  if (!player) return fail("not_found", "Unknown player.");
  if (ctx.now - player.lastSubmitAt < MIN_SUBMIT_INTERVAL_MS || turn.attempts >= MAX_ATTEMPTS_PER_TURN) {
    return fail("rate_limited", "Whoa, slow down!");
  }
  if (turn.deadline !== null && ctx.now >= turn.deadline) return fail("wrong_phase", "Too late!");
  const text = sanitizeAnswer(rawText);
  if (!text) return fail("bad_answer", "Type an answer first.");

  player.lastSubmitAt = ctx.now;
  turn.attempts += 1;
  touch(state, ctx);

  const prior = answersFor(state, state.question.index);
  const key = normalizeAnswer(text);
  const original = key ? prior.find((a) => normalizeAnswer(a.text) === key) : undefined;
  if (original) {
    const verdict = recordRejection(state, player, text, "duplicate", original.text, 1, null, ctx);
    return { ok: true, events: [{ type: "rejected", verdict }], judge: null };
  }

  // The clock freezes while Jev thinks so judging latency never costs a life.
  const remainingMs = turn.deadline === null ? null : turn.deadline - ctx.now;
  turn.judging = { text, startedAt: ctx.now, remainingMs };
  turn.deadline = null;
  return {
    ok: true,
    events: [{ type: "judging", playerId, text }],
    turnId: turn.id,
    judge: {
      question: state.deck[state.question.index]!.text,
      answer: text,
      prior: prior.map((a) => ({ id: a.id, text: a.text })),
    },
  };
}

export interface Decision {
  accepted: boolean;
  reason: Verdict["reason"];
  duplicateOf: string | null;
  confidence: number;
  tier: TierId;
}

export function decide(output: JudgeOutput, thresholds: Thresholds, answers: AcceptedAnswer[]): Decision {
  if (!output.ok) {
    return { accepted: false, reason: "judge_error", duplicateOf: null, confidence: 0, tier: "basic" };
  }
  const tierLevel = Math.min(TIERS.length - 1, Math.max(0, Math.round(output.obscurity)));
  const tier = TIERS[tierLevel]!.id;
  let dup: { id: string; probability: number } | null = null;
  for (const d of output.duplicates) {
    if (d.probability >= thresholds.duplicate && (!dup || d.probability > dup.probability)) dup = d;
  }
  if (dup) {
    const original = answers.find((a) => a.id === dup.id);
    return { accepted: false, reason: "duplicate", duplicateOf: original?.text ?? null, confidence: output.validity, tier };
  }
  const accepted = output.validity >= thresholds.accept;
  return { accepted, reason: accepted ? null : "invalid", duplicateOf: null, confidence: output.validity, tier };
}

export function resolve(state: RoomState, turnId: number, decision: Decision, ctx: Ctx): GameEvent[] {
  const turn = state.turn;
  if (state.phase !== "playing" || !turn || turn.id !== turnId || !turn.judging) return [];
  const player = findPlayer(state, turn.playerId);
  const text = turn.judging.text;
  const remaining = turn.judging.remainingMs;
  turn.judging = null;
  turn.deadline = remaining === null ? null : ctx.now + Math.max(remaining, 1000);
  if (state.settings.mysteryFuse && turn.deadline !== null) state.fuseEndsAt = turn.deadline;
  touch(state, ctx);
  if (!player) return advanceTurn(state, turn.playerId, ctx);

  if (decision.accepted) {
    return acceptAnswer(state, player, text, decision, ctx);
  }
  if (decision.reason === "judge_error") {
    const verdict = recordRejection(state, player, text, "judge_error", null, 0, null, ctx);
    return [{ type: "rejected", verdict }];
  }
  const verdict = recordRejection(
    state,
    player,
    text,
    decision.reason ?? "invalid",
    decision.duplicateOf,
    decision.confidence,
    decision.tier,
    ctx,
  );
  return [{ type: "rejected", verdict }];
}

function acceptAnswer(state: RoomState, player: PlayerRecord, text: string, decision: Pick<Decision, "tier" | "confidence">, ctx: Ctx): GameEvent[] {
  const tier = tierById(decision.tier);
  const answer: AcceptedAnswer = {
    id: ctx.newId(),
    question: state.question?.index ?? 0,
    text,
    playerId: player.id,
    tier: tier.id,
    points: tier.points,
    at: ctx.now,
    confidence: decision.confidence,
  };
  state.answers.push(answer);
  player.points += tier.points;
  const s = player.stats;
  s.accepted += 1;
  if (!s.bestTier || tierIndex(tier.id) > tierIndex(s.bestTier)) {
    s.bestTier = tier.id;
    s.bestAnswer = text;
  }
  const isCurrentTurn = state.turn?.playerId === player.id;
  if (isCurrentTurn && state.turn) {
    const elapsed = ctx.now - state.turn.startedAt;
    s.totalAnswerMs += elapsed;
    s.fastestMs = s.fastestMs === null ? elapsed : Math.min(s.fastestMs, elapsed);
    s.turnsSurvived += 1;
  }
  pushLog(state, {
    id: ctx.newId(),
    playerId: player.id,
    text,
    accepted: true,
    reason: null,
    duplicateOf: null,
    confidence: decision.confidence,
    tier: tier.id,
    at: ctx.now,
    turnId: state.turn?.id ?? 0,
  });

  const events: GameEvent[] = [{ type: "accepted", answer }];
  player.meter += tier.points;
  while (player.meter >= BONUS_LIFE_POINTS) {
    player.meter -= BONUS_LIFE_POINTS;
    if (player.lives < MAX_LIVES && player.status === "alive") {
      player.lives += 1;
      s.livesEarned += 1;
      events.push({ type: "lifeEarned", playerId: player.id, lives: player.lives });
    }
  }
  if (isCurrentTurn) {
    state.turn = null;
    events.push(...advanceTurn(state, player.id, ctx));
  }
  return events;
}

function recordRejection(
  state: RoomState,
  player: PlayerRecord,
  text: string,
  reason: NonNullable<Verdict["reason"]>,
  duplicateOf: string | null,
  confidence: number,
  tier: TierId | null,
  ctx: Ctx,
): Verdict {
  if (reason === "duplicate") player.stats.duplicates += 1;
  if (reason !== "judge_error") player.stats.rejected += 1;
  const verdict: Verdict = {
    id: ctx.newId(),
    playerId: player.id,
    text,
    accepted: false,
    reason,
    duplicateOf,
    confidence,
    tier,
    at: ctx.now,
    turnId: state.turn?.id ?? 0,
  };
  pushLog(state, verdict);
  return verdict;
}

function pushLog(state: RoomState, verdict: Verdict): void {
  state.log.push(verdict);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

/** The current question beat this player. */
function markStumped(state: RoomState, playerId: string): void {
  const q = state.question;
  if (q && !q.failedBy.includes(playerId)) q.failedBy.push(playerId);
}

function loseLife(state: RoomState, player: PlayerRecord, reason: LifeLostReason, ctx: Ctx): GameEvent[] {
  player.lives = Math.max(0, player.lives - 1);
  player.stats.livesLost += 1;
  if (reason === "timeout") player.stats.timeouts += 1;
  markStumped(state, player.id);
  const events: GameEvent[] = [{ type: "lifeLost", playerId: player.id, reason, livesLeft: player.lives }];
  if (player.lives === 0) {
    player.status = "eliminated";
    player.outAt = ctx.now;
    events.push({ type: "eliminated", playerId: player.id });
  }
  if (state.turn?.playerId === player.id) {
    state.turn = null;
    // A pop lights a brand-new fuse.
    events.push(...advanceTurn(state, player.id, ctx, { freshFuse: true }));
  } else {
    events.push(...checkGameOver(state, ctx));
  }
  return events;
}

export function skip(state: RoomState, actorId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can skip a turn.");
  if (state.phase !== "playing" || !state.turn) return fail("wrong_phase", "Nothing to skip.");
  if (state.turn.judging) return fail("already_judging", "Wait for Jev's verdict first.");
  const skipped = state.turn.playerId;
  state.turn = null;
  touch(state, ctx);
  return { ok: true, events: [{ type: "skipped", playerId: skipped }, ...advanceTurn(state, skipped, ctx)] };
}

export function end(state: RoomState, actorId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can end the game.");
  if (state.phase !== "playing") return fail("wrong_phase", "No game in progress.");
  touch(state, ctx);
  return { ok: true, events: finish(state, ctx, "host") };
}

export function rematch(state: RoomState, actorId: string, topics: string[] | undefined, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can start a rematch.");
  if (state.phase !== "over") return fail("wrong_phase", "Finish this game first.");
  if (topics !== undefined) {
    const clean = sanitizeTopics(topics);
    if (!clean) return fail("bad_message", "Add at least one topic (3+ characters).");
    state.topics = clean;
  }
  state.players = state.players.filter((p) => p.connected);
  for (const p of state.players) {
    p.status = "waiting";
    p.lives = 0;
    p.points = 0;
    p.meter = 0;
    p.outAt = null;
    p.place = null;
    p.lastSubmitAt = 0;
    p.stats = emptyStats();
  }
  Object.assign(state, {
    phase: "lobby",
    deck: [],
    deckReports: [],
    question: null,
    history: [],
    turn: null,
    turnOrder: [],
    lap: 0,
    fuseEndsAt: null,
    startingPlayers: 0,
    answers: [],
    log: [],
    startedAt: null,
    endedAt: null,
    winnerId: null,
    endReason: null,
    awards: [],
  } satisfies Partial<RoomState>);
  // The room deals a fresh deck (without repeats) right after this.
  state.generation = { ...state.generation, status: "generating", startedAt: ctx.now };
  if (!findPlayer(state, state.hostId)) promoteHost(state);
  touch(state, ctx);
  return { ok: true, events: [{ type: "backToLobby" }] };
}

// ─── Time ───────────────────────────────────────────────────────────────────

/** Handles everything time-driven. Safe to call at any moment. */
export function tick(state: RoomState, ctx: Ctx): GameEvent[] {
  const events: GameEvent[] = [];
  const host = findPlayer(state, state.hostId);
  if (host && !host.connected && host.disconnectedAt !== null && ctx.now - host.disconnectedAt >= HOST_GRACE_MS) {
    events.push(...promoteHost(state));
  }
  const turn = state.turn;
  if (state.phase !== "playing" || !turn) return events;
  const player = findPlayer(state, turn.playerId);

  if (turn.judging) {
    if (ctx.now - turn.judging.startedAt >= JUDGE_STUCK_MS && player) {
      events.push(...resolve(state, turn.id, decide({ ok: false, error: "timeout" }, { accept: 1, duplicate: 1 }, []), ctx));
    }
    return events;
  }
  if (turn.deadline !== null && ctx.now >= turn.deadline) {
    if (!player) {
      state.turn = null;
      return [...events, ...advanceTurn(state, turn.playerId, ctx)];
    }
    return [...events, ...loseLife(state, player, "timeout", ctx)];
  }
  return events;
}

export function expiresAt(state: RoomState): number {
  if (state.phase === "over" && state.endedAt !== null) return state.endedAt + OVER_TTL_MS;
  const idle = state.lastActivityAt + (state.phase === "lobby" ? LOBBY_IDLE_MS : PLAYING_IDLE_MS);
  return state.emptySince === null ? idle : Math.min(idle, state.emptySince + EMPTY_ROOM_MS);
}

/** When a deck that's still being written should be considered stuck and restarted. */
export function generationStuckAt(state: RoomState): number | null {
  return state.generation.status === "generating" && state.generation.startedAt !== null ? state.generation.startedAt + GENERATION_STUCK_MS : null;
}

/** When the Durable Object alarm should next fire. */
export function nextAlarmAt(state: RoomState): number {
  const times = [expiresAt(state)];
  const stuck = generationStuckAt(state);
  if (stuck !== null) times.push(stuck);
  const turn = state.turn;
  if (state.phase === "playing" && turn) {
    if (turn.judging) times.push(turn.judging.startedAt + JUDGE_STUCK_MS);
    else if (turn.deadline !== null) times.push(turn.deadline);
  }
  const host = findPlayer(state, state.hostId);
  if (host && !host.connected && host.disconnectedAt !== null && state.players.some((p) => p.connected)) {
    times.push(host.disconnectedAt + HOST_GRACE_MS);
  }
  return Math.min(...times);
}

// ─── Views ──────────────────────────────────────────────────────────────────

function publicTurn(state: RoomState): TurnInfo | null {
  const t = state.turn;
  if (!t) return null;
  const hidden = state.settings.mysteryFuse;
  return {
    id: t.id,
    playerId: t.playerId,
    startedAt: t.startedAt,
    deadline: hidden ? null : t.deadline,
    durationMs: hidden ? null : t.durationMs,
    frozenRemainingMs: hidden ? null : (t.judging?.remainingMs ?? null),
    judging: t.judging ? { text: t.judging.text } : null,
    attempts: t.attempts,
  };
}

function publicQuestion(state: RoomState): PublicQuestion | null {
  const q = state.question;
  if (!q || state.phase !== "playing") return null;
  const card = state.deck[q.index]!;
  return {
    index: q.index,
    text: card.text,
    topic: card.topic,
    cap: card.cap,
    answered: answersFor(state, q.index).length,
    turns: q.turns,
    maxTurns: maxTurns(state),
    stumped: [...q.failedBy],
    startedAt: q.startedAt,
  };
}

export function toPublic(state: RoomState): PublicState {
  const players: PublicPlayer[] = state.players.map(({ token: _token, disconnectedAt: _d, lastSubmitAt: _l, ...rest }) => rest);
  return {
    code: state.code,
    topics: state.topics,
    deck: {
      status: state.generation.status,
      ready: state.deck.length,
      wanted: state.settings.questionCount,
      reports: state.deckReports,
    },
    phase: state.phase,
    settings: state.settings,
    hostId: state.hostId,
    players,
    turn: publicTurn(state),
    turnOrder: state.turnOrder,
    lap: state.lap,
    question: publicQuestion(state),
    history: state.history,
    answers: state.answers,
    log: state.log,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    winnerId: state.winnerId,
    endReason: state.endReason ?? null,
    awards: state.awards,
    judge: state.judge,
    expiresAt: expiresAt(state),
  };
}
