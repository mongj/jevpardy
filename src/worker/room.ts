import { DurableObject } from "cloudflare:workers";
import { EMOTES, type ClientMessage, type ErrorCode, type GameEvent, type GameSettings, type RoomInfoResponse, type ServerMessage } from "../shared/protocol.ts";
import {
  type Ctx,
  type Result,
  type RoomState,
  applyPools,
  becomePlayer,
  beginGeneration,
  configure,
  createRoom,
  decide,
  deckPlan,
  disconnect,
  end,
  expiresAt,
  findPlayer,
  generationStuckAt,
  join,
  kick,
  nextAlarmAt,
  rebuildDeck,
  regenerate,
  rematch,
  resolve,
  skip,
  start,
  submit,
  syncConnections,
  tick,
  toPublic,
} from "./game/engine.ts";
import { MAX_ANSWER_LENGTH, MIN_TYPING_INTERVAL_MS } from "../shared/constants.ts";
import { topicKey } from "../shared/sanitize.ts";
import { createJudge, thresholdsFromEnv } from "./judge/index.ts";
import type { Judge } from "./judge/types.ts";
import { applyReview, applyVetting, failedPool, mergeBatch } from "./questions/deck.ts";
import { createGenerator, createReviewer } from "./questions/index.ts";
import type { GenerateRequest, QuestionGenerator, QuestionReviewer, TopicPool } from "./questions/types.ts";
import { log, randomId } from "./util.ts";

const STORAGE_KEY = "room";
const MAX_MESSAGE_BYTES = 2048;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

interface Attachment {
  playerId: string | null;
}

export interface CreateOptions {
  code: string;
  topics: string[];
  settings: Partial<GameSettings>;
  hostToken: string;
}

export class GameRoom extends DurableObject<Env> {
  private room: RoomState | null;
  private readonly judge: Judge;
  private readonly generator: QuestionGenerator;
  private readonly reviewer: QuestionReviewer;
  private readonly lastTypingAt = new Map<string, number>();
  /** The deck-writing job in flight, if any; edits made meanwhile set `deckDirty` so it runs again. */
  private writing: Promise<void> | null = null;
  private deckDirty = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.judge = createJudge(env);
    this.generator = createGenerator(env);
    this.reviewer = createReviewer(env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    const stored = ctx.storage.kv.get<RoomState>(STORAGE_KEY) ?? null;
    // Rooms from before question decks can't be resumed; they're short-lived anyway.
    this.room = stored?.version === 2 ? stored : null;
    if (this.room) {
      // After an eviction (deploy, crash) sockets are gone; after hibernation they're still here.
      syncConnections(this.room, this.connectedPlayerIds(), { now: Date.now() });
      // Evicted mid-write: start again.
      if (this.room.generation.status === "generating") this.ensureDeck();
    }
  }

  private ctxNow(): Ctx {
    return { now: Date.now(), rng: Math.random, newId: () => randomId(10) };
  }

  private connectedPlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.playerId) ids.add(att.playerId);
    }
    return ids;
  }

  // ─── RPC from the Worker ──────────────────────────────────────────────────

  async create(opts: CreateOptions): Promise<{ ok: boolean }> {
    if (this.room && Date.now() < expiresAt(this.room)) return { ok: false };
    if (this.room) await this.wipe();
    const maxPlayers = Number(this.env.MAX_PLAYERS) || 12;
    this.room = createRoom(
      { code: opts.code, topics: opts.topics, settings: opts.settings, judge: this.judge.kind, maxPlayers, hostToken: opts.hostToken },
      { now: Date.now() },
    );
    await this.persist();
    log("info", "room.created", {
      code: opts.code,
      topics: this.room.topics.length,
      questions: this.room.settings.questionCount,
      judge: this.judge.kind,
      generator: this.generator.kind,
    });
    // The host lands in the lobby straight away while the questions are written.
    this.ensureDeck();
    return { ok: true };
  }

  async info(): Promise<RoomInfoResponse> {
    const room = this.room;
    if (!room) return { ok: false, error: "not_found" };
    return {
      ok: true,
      code: room.code,
      topics: room.topics,
      phase: room.phase,
      players: room.players.filter((p) => p.role === "player").length,
      maxPlayers: room.maxPlayers,
    };
  }

  // ─── WebSockets ───────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (!this.room) return new Response("Room not found", { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return this.sendError(ws, "bad_message", "Message too large.");
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.sendError(ws, "bad_message", "Malformed message.");
    }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return this.sendError(ws, "bad_message", "Malformed message.");
    const room = this.room;
    if (!room) {
      this.send(ws, { type: "closed", reason: "expired" });
      ws.close(4404, "room expired");
      return;
    }
    if (msg.type === "hello") return this.onHello(ws, room, msg);

    const playerId = (ws.deserializeAttachment() as Attachment | null)?.playerId;
    if (!playerId || !findPlayer(room, playerId)) return this.sendError(ws, "bad_message", "Say hello first.");
    const ctx = this.ctxNow();

    switch (msg.type) {
      case "start":
        return this.apply(ws, start(room, playerId, ctx));
      case "configure": {
        const topics = Array.isArray(msg.topics) ? msg.topics : undefined;
        const result = configure(room, playerId, msg.settings ?? {}, topics, ctx);
        await this.apply(ws, result);
        if (result.ok && result.deckChanged) this.ensureDeck();
        return;
      }
      case "regenerate": {
        const result = regenerate(room, playerId, ctx);
        await this.apply(ws, result);
        if (result.ok) this.ensureDeck();
        return;
      }
      case "submit":
        return this.onSubmit(ws, room, playerId, typeof msg.text === "string" ? msg.text : "");
      case "typing":
        return this.onTyping(room, playerId, typeof msg.text === "string" ? msg.text : "");
      case "kick": {
        const target = typeof msg.playerId === "string" ? msg.playerId : "";
        const result = kick(room, playerId, target, ctx);
        if (result.ok) this.closePlayerSockets(target, "kicked");
        return this.apply(ws, result);
      }
      case "skip":
        return this.apply(ws, skip(room, playerId, ctx));
      case "end":
        return this.apply(ws, end(room, playerId, ctx));
      case "rematch": {
        const result = rematch(room, playerId, Array.isArray(msg.topics) ? msg.topics : undefined, ctx);
        await this.apply(ws, result);
        if (result.ok) this.ensureDeck();
        return;
      }
      case "becomePlayer":
        return this.apply(ws, becomePlayer(room, playerId, ctx));
      case "emote":
        if (!EMOTES.includes(msg.emote)) return;
        return this.broadcastRaw({ type: "emote", playerId, emote: msg.emote });
      default: {
        const unknown: never = msg;
        return this.sendError(ws, "bad_message", `Unknown message ${(unknown as { type: string }).type}`);
      }
    }
  }

  private async onHello(ws: WebSocket, room: RoomState, msg: Extract<ClientMessage, { type: "hello" }>): Promise<void> {
    if (typeof msg.token !== "string" || !TOKEN_PATTERN.test(msg.token)) return this.sendError(ws, "bad_message", "Bad token.");
    const result = join(room, { token: msg.token, name: typeof msg.name === "string" ? msg.name : null }, this.ctxNow());
    if (!result.ok) {
      this.sendError(ws, result.code, result.message);
      if (result.code === "kicked" || result.code === "room_full") ws.close(4403, result.code);
      return;
    }
    ws.serializeAttachment({ playerId: result.player.id } satisfies Attachment);
    await this.persist();
    this.send(ws, {
      type: "welcome",
      you: { playerId: result.player.id, role: result.player.role },
      state: toPublic(room),
      serverNow: Date.now(),
    });
    if (result.events.length > 0 || result.reconnected) this.broadcast(result.events);
  }

  private async onSubmit(ws: WebSocket, room: RoomState, playerId: string, text: string): Promise<void> {
    const result = submit(room, playerId, text, this.ctxNow());
    if (!result.ok) return this.sendError(ws, result.code, result.message);
    await this.commit(result.events);
    if (!result.judge) return;

    const output = await this.judge.judge(result.judge);
    // The room may have moved on (or been wiped) while Jev was thinking.
    const current = this.room;
    if (!current) return;
    const decision = decide(output, thresholdsFromEnv(this.env), current.answers);
    log("info", "answer.judged", {
      code: current.code,
      question: result.judge.question,
      answer: result.judge.answer,
      accepted: decision.accepted,
      reason: decision.reason,
      confidence: Number(decision.confidence.toFixed(3)),
      tier: decision.tier,
      judge: this.judge.kind,
      ...(output.ok ? {} : { error: output.error }),
    });
    await this.commit(resolve(current, result.turnId, decision, this.ctxNow()));
  }

  // ─── Question deck ────────────────────────────────────────────────────────

  /** Brings the deck in line with the lobby's topics and question count, writing questions if needed. */
  private ensureDeck(): void {
    if (this.writing) {
      this.deckDirty = true;
      return;
    }
    this.deckDirty = false;
    this.writing = this.writeDeck()
      .catch((err) => log("error", "deck.failed", { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        this.writing = null;
        if (this.deckDirty) this.ensureDeck();
      });
    this.ctx.waitUntil(this.writing);
  }

  private async writeDeck(): Promise<void> {
    const room = this.room;
    if (!room || room.phase !== "lobby") return;
    const requests = deckPlan(room);
    if (requests.length === 0) {
      rebuildDeck(room, this.ctxNow());
      return this.commit([]);
    }
    beginGeneration(room, this.ctxNow());
    await this.commit([]);
    const started = Date.now();
    const pools = await Promise.all(requests.map((req) => this.writeTopic(room, req)));
    const current = this.room;
    if (!current || current !== room) return;
    applyPools(current, pools);
    log("info", "deck.written", {
      code: current.code,
      topics: pools.map((p) => ({ topic: p.topic, verdict: p.verdict, kept: p.candidates.length, error: p.error })),
      ms: Date.now() - started,
    });
    // The host changed something mid-write: the next pass deals the deck.
    if (this.deckDirty) return this.persist();
    // Pools still short (e.g. vetting dropped a few): another batch, bounded by MAX_BATCHES. Errors go
    // to the host instead (RETRY), so a writer outage doesn't loop.
    if (pools.every((p) => !p.error) && deckPlan(current).length > 0) {
      this.deckDirty = true;
      return this.persist();
    }
    rebuildDeck(current, this.ctxNow());
    await this.commit([]);
  }

  /** Writes, vets (Jev) and reviews (dud rubric) one topic's questions. Never throws: a failure becomes an errored pool. */
  private async writeTopic(room: RoomState, req: GenerateRequest): Promise<TopicPool> {
    const previous = room.pools.find((p) => p.key === topicKey(req.topic));
    try {
      const batch = await this.generator.generate(req);
      const vetting = await this.judge.vetQuestions(batch.candidates.map((c) => ({ text: c.text, examples: c.examples })));
      const vetted = applyVetting(batch.candidates, vetting);
      // The reviewer sees the topic's earlier questions too, so it can cut near-duplicates of them.
      const earlier = previous?.candidates.map((c) => c.text) ?? [];
      const reviews = await this.reviewer.review(req.topic, [...earlier, ...vetted.map((c) => c.text)]);
      const kept = applyReview(vetted, reviews ? reviews.slice(earlier.length) : null);
      return mergeBatch(previous, req.topic, req.count, { ...batch, candidates: kept });
    } catch (err) {
      return failedPool(previous, req.topic, err instanceof Error ? err.message : String(err));
    }
  }

  private onTyping(room: RoomState, playerId: string, text: string): void {
    if (room.turn?.playerId !== playerId || room.turn.judging) return;
    const now = Date.now();
    if (now - (this.lastTypingAt.get(playerId) ?? 0) < MIN_TYPING_INTERVAL_MS) return;
    this.lastTypingAt.set(playerId, now);
    this.broadcastRaw({ type: "typing", playerId, text: text.slice(0, MAX_ANSWER_LENGTH) }, playerId);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const playerId = (ws.deserializeAttachment() as Attachment | null)?.playerId;
    ws.serializeAttachment({ playerId: null } satisfies Attachment);
    const room = this.room;
    if (!room || !playerId) return;
    // Another tab/device for the same player may still be connected.
    const stillHere = this.ctx.getWebSockets().some((other) => other !== ws && (other.deserializeAttachment() as Attachment | null)?.playerId === playerId);
    if (stillHere) return;
    await this.commit(disconnect(room, playerId, this.ctxNow()));
  }

  // ─── Alarms ───────────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (Date.now() >= expiresAt(room)) {
      log("info", "room.expired", { code: room.code, phase: room.phase });
      await this.wipe();
      return;
    }
    const stuck = generationStuckAt(room);
    if (stuck !== null && Date.now() >= stuck && !this.writing) {
      log("warn", "deck.restarted", { code: room.code });
      room.generation.startedAt = Date.now();
      this.ensureDeck();
    }
    await this.commit(tick(room, this.ctxNow()));
  }

  // ─── Plumbing ─────────────────────────────────────────────────────────────

  private async apply(ws: WebSocket, result: Result): Promise<void> {
    if (!result.ok) return this.sendError(ws, result.code, result.message);
    await this.commit(result.events);
  }

  /** Persist first, then tell everyone. */
  private async commit(events: GameEvent[]): Promise<void> {
    await this.persist();
    this.broadcast(events);
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    this.ctx.storage.kv.put(STORAGE_KEY, this.room);
    await this.ctx.storage.setAlarm(nextAlarmAt(this.room));
  }

  private async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: "closed", reason: "expired" });
      try {
        ws.close(4410, "room expired");
      } catch {
        // already closing
      }
    }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private closePlayerSockets(playerId: string, reason: "kicked"): void {
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId !== playerId) continue;
      ws.serializeAttachment({ playerId: null } satisfies Attachment);
      this.send(ws, { type: "closed", reason });
      ws.close(4403, reason);
    }
  }

  private broadcast(events: GameEvent[]): void {
    if (!this.room) return;
    const payload = JSON.stringify({ type: "state", state: toPublic(this.room), events, serverNow: Date.now() } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.playerId) continue;
      this.sendRaw(ws, payload);
    }
  }

  private broadcastRaw(msg: ServerMessage, exceptPlayerId?: string): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.playerId || att.playerId === exceptPlayerId) continue;
      this.sendRaw(ws, payload);
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      // Socket closed mid-send; webSocketClose will clean up.
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, { type: "error", code, message });
  }
}
