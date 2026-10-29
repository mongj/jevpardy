import type { CreateRoomRequest, CreateRoomResponse, HealthResponse, RoomInfoResponse } from "../shared/protocol.ts";
import { sanitizeTopic } from "../shared/sanitize.ts";
import { createJudge } from "./judge/index.ts";
import { SHORT_TOPIC_THRESHOLD, TOPIC_WARNING_THRESHOLD } from "./judge/questions.ts";
import { ROOM_CODE_PATTERN, log, randomRoomCode } from "./util.ts";

export { GameRoom } from "./room.ts";

const MAX_BODY_BYTES = 4096;
const CODE_ATTEMPTS = 8;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function createRoomHandler(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as Partial<CreateRoomRequest> | null;
  if (!body || typeof body !== "object" || typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) {
    return json<CreateRoomResponse>({ ok: false, error: "bad_request", message: "Malformed request." }, 400);
  }
  const topic = sanitizeTopic(body.topic);
  if (!topic) return json<CreateRoomResponse>({ ok: false, error: "bad_topic", message: "Give Jev a topic (3+ characters)." }, 400);

  const check = await createJudge(env).checkTopic(topic);
  if (!body.force && check && check.listable < TOPIC_WARNING_THRESHOLD) {
    return json<CreateRoomResponse>({
      ok: false,
      error: "topic_warning",
      listability: check.listable,
      message: "Jev isn't sure players can name many examples of that. Play it anyway?",
    });
  }
  const shortList = check ? check.short >= SHORT_TOPIC_THRESHOLD : null;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = randomRoomCode();
    const stub = env.GAME_ROOM.getByName(code);
    const created = await stub.create({ code, topic, settings: body.settings ?? {}, hostToken: body.token, shortList });
    if (created.ok) return json<CreateRoomResponse>({ ok: true, code });
  }
  log("error", "room.code_exhausted");
  return json<CreateRoomResponse>({ ok: false, error: "unavailable", message: "Couldn't find a free room code. Try again." }, 503);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/health") {
        const judge = createJudge(env);
        return json<HealthResponse>({ ok: true, judge: judge.kind, model: judge.model });
      }
      if (path === "/api/rooms" && request.method === "POST") return await createRoomHandler(request, env);

      const match = path.match(/^\/api\/rooms\/([A-Za-z]+)(\/ws)?$/);
      if (match) {
        const code = match[1]!.toUpperCase();
        if (!ROOM_CODE_PATTERN.test(code)) return json<RoomInfoResponse>({ ok: false, error: "not_found" }, 404);
        const stub = env.GAME_ROOM.getByName(code);
        if (match[2]) {
          if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
          return stub.fetch(request);
        }
        if (request.method === "GET") {
          const info = await stub.info();
          return json(info, info.ok ? 200 : 404);
        }
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (err) {
      log("error", "request.failed", { path, error: err instanceof Error ? err.message : String(err) });
      return json({ ok: false, error: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
