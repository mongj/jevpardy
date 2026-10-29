import { DurableObject } from "cloudflare:workers";
import { EMOTES, type ClientMessage, type ErrorCode, type GameEvent, type GameSettings, type RoomInfoResponse, type ServerMessage } from "../shared/protocol.ts";
import {
  type Ctx,
  type Result,
  type RoomState,
  becomePlayer,
  configure,
  createRoom,
  decide,
  disconnect,
  end,
  expiresAt,
  findPlayer,
  join,
  kick,
  nextAlarmAt,
  rematch,
  resolve,
  setShortList,
  skip,
  start,
  submit,
  syncConnections,
  tapOut,
  tick,
  toPublic,
} from "./game/engine.ts";
import { MAX_ANSWER_LENGTH, MIN_TYPING_INTERVAL_MS } from "../shared/constants.ts";
import { createJudge, thresholdsFromEnv } from "./judge/index.ts";
import { SHORT_TOPIC_THRESHOLD } from "./judge/questions.ts";
import type { Judge } from "./judge/types.ts";
import { log, randomId } from "./util.ts";

const STORAGE_KEY = "room";
const MAX_MESSAGE_BYTES = 2048;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

interface Attachment {
  playerId: string | null;
}

export interface CreateOptions {
  code: string;
  topic: string;
  settings: Partial<GameSettings>;
  hostToken: string;
  shortList: boolean | null;
}

export class GameRoom extends DurableObject<Env> {
  private room: RoomState | null;
  private readonly judge: Judge;
  private readonly lastTypingAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.judge = createJudge(env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.room = ctx.storage.kv.get<RoomState>(STORAGE_KEY) ?? null;
    if (this.room) {
      // After an eviction (deploy, crash) sockets are gone; after hibernation they're still here.
      syncConnections(this.room, this.connectedPlayerIds(), { now: Date.now() });
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
      { code: opts.code, topic: opts.topic, settings: opts.settings, judge: this.judge.kind, maxPlayers, hostToken: opts.hostToken, shortList: opts.shortList },
      { now: Date.now() },
    );
    await this.persist();
    log("info", "room.created", { code: opts.code, mode: this.room.settings.mode, judge: this.judge.kind });
    return { ok: true };
  }

  async info(): Promise<RoomInfoResponse> {
    const room = this.room;
    if (!room) return { ok: false, error: "not_found" };
    return {
      ok: true,
      code: room.code,
      topic: room.topic,
      phase: room.phase,
      mode: room.settings.mode,
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
        const before = room.topic;
        await this.apply(ws, configure(room, playerId, msg.settings ?? {}, typeof msg.topic === "string" ? msg.topic : undefined, ctx));
        return this.recheckTopic(before);
      }
      case "submit":
        return this.onSubmit(ws, room, playerId, typeof msg.text === "string" ? msg.text : "");
      case "typing":
        return this.onTyping(room, playerId, typeof msg.text === "string" ? msg.text : "");
      case "tapOut":
        return this.apply(ws, tapOut(room, playerId, ctx));
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
        const before = room.topic;
        await this.apply(ws, rematch(room, playerId, typeof msg.topic === "string" ? msg.topic : undefined, ctx));
        return this.recheckTopic(before);
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
      answer: result.judge.answer,
      accepted: decision.accepted,
      reason: decision.reason,
      confidence: Number(decision.confidence.toFixed(3)),
      tier: decision.tier,
      boardCleared: decision.boardCleared,
      judge: this.judge.kind,
      ...(output.ok ? { exhausted: Number(output.exhausted.toFixed(3)) } : { error: output.error }),
    });
    await this.commit(resolve(current, result.turnId, decision, this.ctxNow()));
  }

  /** After the host changes the topic, ask Jev again whether it's a short list. */
  private async recheckTopic(previousTopic: string): Promise<void> {
    const topic = this.room?.topic;
    if (!topic || topic === previousTopic) return;
    const check = await this.judge.checkTopic(topic);
    const room = this.room;
    if (room && setShortList(room, topic, check ? check.short >= SHORT_TOPIC_THRESHOLD : null)) await this.commit([]);
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
