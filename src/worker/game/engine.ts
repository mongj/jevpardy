import {
  AVATAR_COUNT,
  BONUS_LIFE_POINTS,
  DEFAULT_SETTINGS,
  EMPTY_ROOM_MS,
  FREE_DISCONNECT_GRACE_MS,
  HOST_GRACE_MS,
  LOBBY_IDLE_MS,
  LOG_LIMIT,
  MAX_ATTEMPTS_PER_TURN,
  MAX_LIVES,
  MAX_SPECTATORS,
  MIN_SUBMIT_INTERVAL_MS,
  MYSTERY_FUSE_SPREAD,
  OVER_TTL_MS,
  PLAYER_COLORS,
  PLAYING_IDLE_MS,
  SPEED_UP_MIN_SECONDS,
  SPEED_UP_STEP_SECONDS,
  TIERS,
  mergeSettings,
  tierById,
  tierIndex,
} from "../../shared/constants.ts";
import type {
  AcceptedAnswer,
  Award,
  ErrorCode,
  GameEvent,
  GameSettings,
  JudgeKind,
  LifeLostReason,
  Phase,
  PlayerRole,
  PlayerStats,
  PlayerStatus,
  PublicPlayer,
  PublicState,
  TierId,
  TurnInfo,
  Verdict,
} from "../../shared/protocol.ts";
import { normalizeAnswer, sanitizeAnswer, sanitizeName, sanitizeTopic } from "../../shared/sanitize.ts";
import type { JudgeInput, JudgeOutput, Thresholds } from "../judge/types.ts";

/** A stuck judge call is treated as an error after this long. */
export const JUDGE_STUCK_MS = 15_000;

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

interface VerdictRecord extends Verdict {
  /** Whether this rejection cost a life (so an overrule can refund it). */
  costLife: boolean;
}

export interface RoomState {
  version: 1;
  code: string;
  topic: string;
  phase: Phase;
  settings: GameSettings;
  judge: JudgeKind;
  maxPlayers: number;
  /** The creator's token; whoever connects with it gets the host crown. */
  hostToken: string | null;
  hostId: string | null;
  players: PlayerRecord[];
  kickedTokens: string[];
  turn: TurnRecord | null;
  turnCounter: number;
  turnOrder: string[];
  lap: number;
  currentTurnSeconds: number;
  startingPlayers: number;
  answers: AcceptedAnswer[];
  answerKeys: string[];
  log: VerdictRecord[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  winnerId: string | null;
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
    typosForgiven: 0,
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
  topic: string;
  settings?: Partial<GameSettings>;
  judge: JudgeKind;
  maxPlayers: number;
  hostToken?: string;
}

export function createRoom(opts: CreateRoomOptions, ctx: Pick<Ctx, "now">): RoomState {
  const settings = mergeSettings(DEFAULT_SETTINGS, opts.settings);
  return {
    version: 1,
    code: opts.code,
    topic: opts.topic,
    phase: "lobby",
    settings,
    judge: opts.judge,
    maxPlayers: opts.maxPlayers,
    hostToken: opts.hostToken ?? null,
    hostId: null,
    players: [],
    kickedTokens: [],
    turn: null,
    turnCounter: 0,
    turnOrder: [],
    lap: 0,
    currentTurnSeconds: settings.turnSeconds,
    startingPlayers: 0,
    answers: [],
    answerKeys: [],
    log: [],
    createdAt: ctx.now,
    startedAt: null,
    endedAt: null,
    winnerId: null,
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

  const seatsLeft = contestants(state).length < state.maxPlayers;
  const canPlay = seatsLeft && (state.phase === "lobby" || (state.phase === "playing" && state.settings.mode === "free"));
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
    status: state.phase === "playing" && canPlay ? "alive" : "waiting",
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
  if (player.role === "player" && state.phase === "playing") state.turnOrder.push(player.id);
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
  const joinable = state.phase === "lobby" || (state.phase === "playing" && state.settings.mode === "free");
  if (!joinable) return fail("wrong_phase", "Wait for the next game to jump in.");
  if (contestants(state).length >= state.maxPlayers) return fail("room_full", "All seats are taken.");
  player.role = "player";
  if (state.phase === "playing") {
    player.status = "alive";
    state.turnOrder.push(player.id);
  }
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
  state.players = state.players.filter((p) => p.id !== targetId);
  state.turnOrder = state.turnOrder.filter((id) => id !== targetId);
  if (state.phase === "playing") {
    if (wasTurn) {
      state.turn = null;
      events.push(...advanceTurn(state, targetId, ctx));
    } else {
      events.push(...checkGameOver(state, ctx));
    }
  }
  touch(state, ctx);
  return { ok: true, events };
}

export function configure(
  state: RoomState,
  actorId: string,
  patch: Partial<GameSettings>,
  topic: string | undefined,
  ctx: Ctx,
): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can change settings.");
  if (state.phase !== "lobby") return fail("wrong_phase", "Settings are locked once the game starts.");
  if (topic !== undefined) {
    const clean = sanitizeTopic(topic);
    if (!clean) return fail("bad_message", "Topic is too short.");
    state.topic = clean;
  }
  state.settings = mergeSettings(state.settings, patch);
  state.currentTurnSeconds = state.settings.turnSeconds;
  touch(state, ctx);
  return { ok: true, events: [] };
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
  // Whoever wandered off from the lobby doesn't get dealt in.
  state.players = state.players.filter((p) => p.connected || p.id === actorId);
  const roster = contestants(state);
  if (roster.length === 0) return fail("wrong_phase", "Need at least one player.");
  const timed = state.settings.mode === "timed";
  for (const p of roster) {
    p.status = "alive";
    p.lives = timed ? state.settings.lives : 0;
  }
  state.phase = "playing";
  state.startedAt = ctx.now;
  state.startingPlayers = roster.length;
  state.turnOrder = shuffle(
    roster.map((p) => p.id),
    ctx.rng,
  );
  state.lap = 1;
  state.currentTurnSeconds = state.settings.turnSeconds;
  touch(state, ctx);
  const events: GameEvent[] = [{ type: "gameStarted" }];
  events.push(...beginTurn(state, state.turnOrder[0]!, ctx));
  return { ok: true, events };
}

function beginTurn(state: RoomState, playerId: string, ctx: Ctx): GameEvent[] {
  const timed = state.settings.mode === "timed";
  let durationMs: number | null = null;
  if (timed) {
    const base = state.currentTurnSeconds * 1000;
    durationMs = state.settings.mysteryFuse
      ? Math.round(base * (1 - MYSTERY_FUSE_SPREAD + ctx.rng() * MYSTERY_FUSE_SPREAD * 2))
      : base;
  }
  state.turnCounter += 1;
  state.turn = {
    id: state.turnCounter,
    playerId,
    startedAt: ctx.now,
    deadline: durationMs === null ? null : ctx.now + durationMs,
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
  const preferConnected = state.settings.mode === "free";
  const startIdx = order.indexOf(afterId);
  const pick = (requireConnected: boolean) => {
    for (let step = 1; step <= order.length; step++) {
      const idx = (startIdx + step) % order.length;
      const id = order[idx]!;
      if (!active.has(id)) continue;
      if (requireConnected && !findPlayer(state, id)?.connected) continue;
      return { id, wrapped: startIdx === -1 ? false : idx <= startIdx };
    }
    return null;
  };
  return (preferConnected ? pick(true) : null) ?? pick(false);
}

function advanceTurn(state: RoomState, fromId: string, ctx: Ctx): GameEvent[] {
  const over = checkGameOver(state, ctx);
  if (over.length > 0) return over;
  const next = nextPlayerId(state, fromId);
  if (!next) return finish(state, ctx);
  const events: GameEvent[] = [];
  if (next.wrapped) {
    state.lap += 1;
    if (state.settings.mode === "timed" && state.settings.speedUp) {
      const faster = Math.max(SPEED_UP_MIN_SECONDS, state.currentTurnSeconds - SPEED_UP_STEP_SECONDS);
      if (faster !== state.currentTurnSeconds) {
        state.currentTurnSeconds = faster;
        events.push({ type: "speedUp", turnSeconds: faster });
      }
    }
  }
  events.push(...beginTurn(state, next.id, ctx));
  return events;
}

function checkGameOver(state: RoomState, ctx: Ctx): GameEvent[] {
  if (state.phase !== "playing") return [];
  const alive = activePlayers(state);
  const timed = state.settings.mode === "timed";
  // Last one floating wins in a multiplayer timed game; solo games play to the last heart.
  const lastStanding = timed && state.startingPlayers > 1 && alive.length === 1 && contestants(state).length > 1;
  if (alive.length === 0 || lastStanding) return finish(state, ctx);
  return [];
}

export function finish(state: RoomState, ctx: Pick<Ctx, "now">): GameEvent[] {
  if (state.phase !== "playing") return [];
  state.phase = "over";
  state.endedAt = ctx.now;
  state.turn = null;
  const roster = contestants(state);
  const timed = state.settings.mode === "timed";
  const ranked = [...roster].sort((a, b) => {
    if (timed) {
      const aOut = a.status === "alive" ? Infinity : (a.outAt ?? 0);
      const bOut = b.status === "alive" ? Infinity : (b.outAt ?? 0);
      if (aOut !== bOut) return bOut - aOut;
    }
    if (a.points !== b.points) return b.points - a.points;
    return b.stats.accepted - a.stats.accepted;
  });
  ranked.forEach((p, i) => {
    p.place = i + 1;
  });
  const top = ranked[0];
  state.winnerId = top && (top.points > 0 || timed) ? top.id : null;
  state.awards = computeAwards(state);
  return [{ type: "gameOver", winnerId: state.winnerId }];
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

  if (state.settings.mode === "timed" && state.startingPlayers > 1) {
    const survivor = roster.find((p) => p.status === "alive");
    if (survivor) awards.push({ id: "survivor", title: "LAST ONE FLOATING", blurb: "Outlasted everyone.", playerId: survivor.id });
  }
  const high = best(
    (p) => (p.points > 0 ? p.points : null),
    (a, b) => a > b,
  );
  if (high) awards.push({ id: "highscore", title: "HIGH SCORE", blurb: `${high.value} pts`, playerId: high.winner.id });
  const deep = best(
    (p) => (p.stats.bestTier ? tierIndex(p.stats.bestTier) : null),
    (a, b) => a > b,
  );
  if (deep && deep.value >= 2) {
    awards.push({
      id: "deepdiver",
      title: "DEEP DIVER",
      blurb: `"${deep.winner.stats.bestAnswer}" — ${TIERS[deep.value]!.name}`,
      playerId: deep.winner.id,
    });
  }
  const fast = best(
    (p) => p.stats.fastestMs,
    (a, b) => a < b,
  );
  if (fast) {
    awards.push({ id: "speed", title: "SPEED DEMON", blurb: `${(fast.value / 1000).toFixed(1)}s answer`, playerId: fast.winner.id });
  }
  const typo = best(
    (p) => (p.stats.typosForgiven > 0 ? p.stats.typosForgiven : null),
    (a, b) => a > b,
  );
  if (typo) awards.push({ id: "typo", title: "TYPO TYRANT", blurb: `${typo.value} typo${typo.value === 1 ? "" : "s"} forgiven`, playerId: typo.winner.id });
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
  if (state.phase !== "playing" || !state.turn) return fail("wrong_phase", "No game in progress.");
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

  const key = normalizeAnswer(text);
  const exactIdx = key ? state.answerKeys.indexOf(key) : -1;
  if (exactIdx !== -1) {
    const original = state.answers[exactIdx]!;
    const verdict = recordRejection(state, player, text, "duplicate", original.text, 1, null, false, ctx);
    return { ok: true, events: [{ type: "rejected", verdict }, ...applyWrongAnswerRule(state, player, verdict, ctx)], judge: null };
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
      topic: state.topic,
      answer: text,
      prior: state.answers.map((a) => ({ id: a.id, text: a.text })),
    },
  };
}

export interface Decision {
  accepted: boolean;
  reason: Verdict["reason"];
  duplicateOf: string | null;
  confidence: number;
  tier: TierId;
  typo: boolean;
}

export function decide(output: JudgeOutput, thresholds: Thresholds, answers: AcceptedAnswer[]): Decision {
  if (!output.ok) {
    return { accepted: false, reason: "judge_error", duplicateOf: null, confidence: 0, tier: "basic", typo: false };
  }
  const tierLevel = Math.min(TIERS.length - 1, Math.max(0, Math.round(output.obscurity)));
  const tier = TIERS[tierLevel]!.id;
  let dup: { id: string; probability: number } | null = null;
  for (const d of output.duplicates) {
    if (d.probability >= thresholds.duplicate && (!dup || d.probability > dup.probability)) dup = d;
  }
  if (dup) {
    const original = answers.find((a) => a.id === dup.id);
    return { accepted: false, reason: "duplicate", duplicateOf: original?.text ?? null, confidence: output.validity, tier, typo: false };
  }
  const accepted = output.validity >= thresholds.accept;
  return {
    accepted,
    reason: accepted ? null : "invalid",
    duplicateOf: null,
    confidence: output.validity,
    tier,
    typo: accepted && output.spelledCorrectly < thresholds.typo,
  };
}

export function resolve(state: RoomState, turnId: number, decision: Decision, ctx: Ctx): GameEvent[] {
  const turn = state.turn;
  if (state.phase !== "playing" || !turn || turn.id !== turnId || !turn.judging) return [];
  const player = findPlayer(state, turn.playerId);
  const text = turn.judging.text;
  const remaining = turn.judging.remainingMs;
  turn.judging = null;
  turn.deadline = remaining === null ? null : ctx.now + Math.max(remaining, 1000);
  touch(state, ctx);
  if (!player) return advanceTurn(state, turn.playerId, ctx);

  if (decision.accepted) {
    return acceptAnswer(state, player, text, decision, false, ctx);
  }
  if (decision.reason === "judge_error") {
    const verdict = recordRejection(state, player, text, "judge_error", null, 0, null, false, ctx);
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
    false,
    ctx,
  );
  return [{ type: "rejected", verdict }, ...applyWrongAnswerRule(state, player, verdict, ctx)];
}

function acceptAnswer(
  state: RoomState,
  player: PlayerRecord,
  text: string,
  decision: Pick<Decision, "tier" | "typo" | "confidence">,
  overruled: boolean,
  ctx: Ctx,
): GameEvent[] {
  const tier = tierById(decision.tier);
  const answer: AcceptedAnswer = {
    id: ctx.newId(),
    text,
    playerId: player.id,
    tier: tier.id,
    points: tier.points,
    typo: decision.typo,
    at: ctx.now,
    confidence: decision.confidence,
  };
  state.answers.push(answer);
  state.answerKeys.push(normalizeAnswer(text));
  player.points += tier.points;
  const s = player.stats;
  s.accepted += 1;
  if (decision.typo) s.typosForgiven += 1;
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
    typo: decision.typo,
    at: ctx.now,
    turnId: state.turn?.id ?? 0,
    overruled,
    costLife: false,
  });

  const events: GameEvent[] = [{ type: "accepted", answer, overruled }];
  if (state.settings.mode === "timed") {
    player.meter += tier.points;
    while (player.meter >= BONUS_LIFE_POINTS) {
      player.meter -= BONUS_LIFE_POINTS;
      if (player.lives < MAX_LIVES && player.status === "alive") {
        player.lives += 1;
        s.livesEarned += 1;
        events.push({ type: "lifeEarned", playerId: player.id, lives: player.lives });
      }
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
  costLife: boolean,
  ctx: Ctx,
): VerdictRecord {
  if (reason === "duplicate") player.stats.duplicates += 1;
  if (reason !== "judge_error") player.stats.rejected += 1;
  const verdict: VerdictRecord = {
    id: ctx.newId(),
    playerId: player.id,
    text,
    accepted: false,
    reason,
    duplicateOf,
    confidence,
    tier,
    typo: false,
    at: ctx.now,
    turnId: state.turn?.id ?? 0,
    overruled: false,
    costLife,
  };
  pushLog(state, verdict);
  return verdict;
}

function pushLog(state: RoomState, verdict: VerdictRecord): void {
  state.log.push(verdict);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function applyWrongAnswerRule(state: RoomState, player: PlayerRecord, verdict: VerdictRecord, ctx: Ctx): GameEvent[] {
  if (state.settings.mode !== "timed" || state.settings.wrongAnswer !== "life") return [];
  verdict.costLife = true;
  return loseLife(state, player, verdict.reason === "duplicate" ? "duplicate" : "wrong", ctx);
}

function loseLife(state: RoomState, player: PlayerRecord, reason: LifeLostReason, ctx: Ctx): GameEvent[] {
  player.lives = Math.max(0, player.lives - 1);
  player.stats.livesLost += 1;
  if (reason === "timeout") player.stats.timeouts += 1;
  const events: GameEvent[] = [{ type: "lifeLost", playerId: player.id, reason, livesLeft: player.lives }];
  if (player.lives === 0) {
    player.status = "eliminated";
    player.outAt = ctx.now;
    events.push({ type: "eliminated", playerId: player.id });
  }
  if (state.turn?.playerId === player.id) {
    state.turn = null;
    events.push(...advanceTurn(state, player.id, ctx));
  } else {
    events.push(...checkGameOver(state, ctx));
  }
  return events;
}

export function tapOut(state: RoomState, playerId: string, ctx: Ctx): Result {
  if (state.phase !== "playing" || state.settings.mode !== "free") return fail("wrong_phase", "You can only tap out in Free & Easy mode.");
  const player = findPlayer(state, playerId);
  if (!player || player.status !== "alive") return fail("wrong_phase", "You're already out.");
  if (state.turn?.judging && state.turn.playerId === playerId) return fail("already_judging", "Wait for Jev's verdict first.");
  player.status = "tappedOut";
  player.outAt = ctx.now;
  touch(state, ctx);
  const events: GameEvent[] = [{ type: "tappedOut", playerId }];
  if (state.turn?.playerId === playerId) {
    state.turn = null;
    events.push(...advanceTurn(state, playerId, ctx));
  } else {
    events.push(...checkGameOver(state, ctx));
  }
  return { ok: true, events };
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

/** Host overturns the latest rejection: credits the answer and refunds any life it cost. */
export function overrule(state: RoomState, actorId: string, verdictId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can overrule Jev.");
  if (state.phase !== "playing") return fail("wrong_phase", "No game in progress.");
  const last = state.log[state.log.length - 1];
  if (!last || last.id !== verdictId || last.accepted || last.reason === "judge_error") {
    return fail("bad_message", "Only the latest rejection can be overruled.");
  }
  const player = findPlayer(state, last.playerId);
  if (!player) return fail("not_found", "Unknown player.");
  if (state.turn?.judging) return fail("already_judging", "Wait for Jev's verdict first.");
  last.overruled = true;
  player.stats.rejected = Math.max(0, player.stats.rejected - 1);
  if (last.reason === "duplicate") player.stats.duplicates = Math.max(0, player.stats.duplicates - 1);
  if (last.costLife) {
    player.lives += 1;
    player.stats.livesLost = Math.max(0, player.stats.livesLost - 1);
    if (player.status === "eliminated") {
      player.status = "alive";
      player.outAt = null;
    }
  }
  state.log.pop();
  touch(state, ctx);
  const events = acceptAnswer(state, player, last.text, { tier: last.tier ?? "basic", typo: false, confidence: last.confidence }, true, ctx);
  return { ok: true, events };
}

export function end(state: RoomState, actorId: string, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can end the game.");
  if (state.phase !== "playing") return fail("wrong_phase", "No game in progress.");
  touch(state, ctx);
  return { ok: true, events: finish(state, ctx) };
}

export function rematch(state: RoomState, actorId: string, topic: string | undefined, ctx: Ctx): Result {
  if (!isHost(state, actorId)) return fail("not_host", "Only the host can start a rematch.");
  if (state.phase !== "over") return fail("wrong_phase", "Finish this game first.");
  if (topic !== undefined) {
    const clean = sanitizeTopic(topic);
    if (!clean) return fail("bad_message", "Topic is too short.");
    state.topic = clean;
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
    turn: null,
    turnOrder: [],
    lap: 0,
    currentTurnSeconds: state.settings.turnSeconds,
    startingPlayers: 0,
    answers: [],
    answerKeys: [],
    log: [],
    startedAt: null,
    endedAt: null,
    winnerId: null,
    awards: [],
  } satisfies Partial<RoomState>);
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
      events.push(...resolve(state, turn.id, decide({ ok: false, error: "timeout" }, { accept: 1, duplicate: 1, typo: 0 }, []), ctx));
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
  if (
    state.settings.mode === "free" &&
    player &&
    !player.connected &&
    player.disconnectedAt !== null &&
    ctx.now - player.disconnectedAt >= FREE_DISCONNECT_GRACE_MS &&
    activePlayers(state).some((p) => p.connected)
  ) {
    state.turn = null;
    events.push({ type: "skipped", playerId: player.id }, ...advanceTurn(state, player.id, ctx));
  }
  return events;
}

export function expiresAt(state: RoomState): number {
  if (state.phase === "over" && state.endedAt !== null) return state.endedAt + OVER_TTL_MS;
  const idle = state.lastActivityAt + (state.phase === "lobby" ? LOBBY_IDLE_MS : PLAYING_IDLE_MS);
  return state.emptySince === null ? idle : Math.min(idle, state.emptySince + EMPTY_ROOM_MS);
}

/** When the Durable Object alarm should next fire. */
export function nextAlarmAt(state: RoomState): number {
  const times = [expiresAt(state)];
  const turn = state.turn;
  if (state.phase === "playing" && turn) {
    if (turn.judging) times.push(turn.judging.startedAt + JUDGE_STUCK_MS);
    else if (turn.deadline !== null) times.push(turn.deadline);
    const p = findPlayer(state, turn.playerId);
    if (state.settings.mode === "free" && p && !p.connected && p.disconnectedAt !== null) {
      times.push(p.disconnectedAt + FREE_DISCONNECT_GRACE_MS);
    }
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

export function toPublic(state: RoomState): PublicState {
  const players: PublicPlayer[] = state.players.map(({ token: _token, disconnectedAt: _d, lastSubmitAt: _l, ...rest }) => rest);
  return {
    code: state.code,
    topic: state.topic,
    phase: state.phase,
    settings: state.settings,
    hostId: state.hostId,
    players,
    turn: publicTurn(state),
    turnOrder: state.turnOrder,
    lap: state.lap,
    answers: state.answers,
    log: state.log.map(({ costLife: _c, ...v }) => v),
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    winnerId: state.winnerId,
    awards: state.awards,
    judge: state.judge,
    expiresAt: expiresAt(state),
  };
}
