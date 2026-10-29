// Drives full games against a running server with bot players over WebSocket.
//   node scripts/simulate.ts [--url http://localhost:5173] [--mode timed|free|cleared|all] [--topic "..."]

import { parseArgs } from "node:util";
import type { ClientMessage, CreateRoomResponse, GameEvent, HealthResponse, PublicState, ServerMessage } from "../src/shared/protocol.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173" },
    mode: { type: "string", default: "all" },
    topic: { type: "string", default: "cities in continental Europe" },
    quiet: { type: "boolean", default: false },
  },
});
const BASE = values.url!.replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

const GOOD = ["Paris", "Berlin", "Madrid", "Rome", "Vienna", "Prague", "Lisbon", "Warsaw", "Budapest", "Krakow", "Lyon", "Munich", "Oslo", "Stockholm", "Helsinki", "Zurich", "Porto", "Seville", "Milan", "Naples", "Brussels", "Amsterdam", "Copenhagen", "Tartu", "Szombathely"];

type Strategy = "ace" | "sloppy" | "sleepy";

interface BotOptions {
  name: string;
  strategy: Strategy;
  pool: string[];
}

const highlight = "\x1b[33m";
const reset = "\x1b[0m";

function token(): string {
  return `sim-${crypto.randomUUID().replace(/-/g, "")}`;
}

class Bot {
  ws!: WebSocket;
  id = "";
  state: PublicState | null = null;
  readonly token = token();
  private lastActedTurn = "";
  private sloppyStep = 0;
  events: GameEvent[] = [];
  errors: string[] = [];
  done: Promise<PublicState>;
  private resolveDone!: (s: PublicState) => void;
  paused = false;
  code: string;
  readonly opts: BotOptions;

  constructor(code: string, opts: BotOptions) {
    this.code = code;
    this.opts = opts;
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/api/rooms/${this.code}/ws`);
      this.ws.onopen = () => this.send({ type: "hello", token: this.token, name: this.opts.name });
      this.ws.onerror = () => reject(new Error(`${this.opts.name}: socket error`));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === "welcome") {
          this.id = msg.you.playerId;
          this.state = msg.state;
          resolve();
        }
        this.onMessage(msg);
      };
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        break;
      case "state":
        this.state = msg.state;
        this.events.push(...msg.events);
        if (msg.state.phase === "over") this.resolveDone(msg.state);
        this.maybeAct();
        break;
      case "error":
        this.errors.push(`${msg.code}: ${msg.message}`);
        break;
      case "typing":
      case "emote":
      case "closed":
        break;
      default: {
        const unknown: never = msg;
        throw new Error(`unexpected ${JSON.stringify(unknown)}`);
      }
    }
  }

  private maybeAct(): void {
    const s = this.state;
    if (!s || s.phase !== "playing" || this.paused) return;
    const turn = s.turn;
    if (!turn || turn.playerId !== this.id || turn.judging) return;
    const key = `${turn.id}:${turn.attempts}`;
    if (this.lastActedTurn === key) return;
    this.lastActedTurn = key;
    const used = new Set(s.answers.map((a) => a.text.toLowerCase()));
    const fresh = this.opts.pool.find((a) => !used.has(a.toLowerCase()));
    let text: string | null = fresh ?? null;
    if (this.opts.strategy === "sleepy") text = null;
    if (this.opts.strategy === "sloppy") {
      // Cycle: a duplicate, a wrong answer, a semantic duplicate, then a real one.
      const step = this.sloppyStep++ % 4;
      if (step === 0 && s.answers.length > 0) text = s.answers[0]!.text.toUpperCase();
      else if (step === 1) text = "wrong answer lol";
      else if (step === 2 && s.answers.some((a) => a.text === "Munich")) text = "München";
    }
    if (!text) return;
    const typed = text;
    setTimeout(() => {
      this.send({ type: "typing", text: typed.slice(0, 3) });
      setTimeout(() => this.send({ type: "submit", text: typed }), 250);
    }, 300 + Math.random() * 400);
  }
}

function describe(e: GameEvent, s: PublicState): string | null {
  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
  switch (e.type) {
    case "playerJoined":
      return `+ ${name(e.playerId)} joined`;
    case "playerLeft":
      return `- ${name(e.playerId)} disconnected`;
    case "playerKicked":
      return `! ${e.playerId} kicked`;
    case "hostChanged":
      return `♛ host is now ${name(e.playerId)}`;
    case "gameStarted":
      return "▶ GAME START";
    case "turnStarted":
      return `  → turn ${e.turnId}: ${name(e.playerId)}`;
    case "judging":
      return `    ? ${name(e.playerId)} says "${e.text}"`;
    case "accepted":
      return `    ✔ "${e.answer.text}" ACCEPTED (${e.answer.tier}, +${e.answer.points}, p=${e.answer.confidence.toFixed(2)})`;
    case "rejected":
      return `    ✘ "${e.verdict.text}" REJECTED: ${e.verdict.reason}${e.verdict.duplicateOf ? ` (dup of ${e.verdict.duplicateOf})` : ""} p=${e.verdict.confidence.toFixed(2)}`;
    case "lifeLost":
      return `    ♥ ${name(e.playerId)} lost a life (${e.reason}) → ${e.livesLeft} left`;
    case "lifeEarned":
      return `    ♥+ ${name(e.playerId)} earned a 1UP → ${e.lives}`;
    case "eliminated":
      return `    ☠ ${name(e.playerId)} ELIMINATED`;
    case "tappedOut":
      return `    ✋ ${name(e.playerId)} tapped out`;
    case "skipped":
      return `    ⏭ ${name(e.playerId)} skipped`;
    case "speedUp":
      return `    ⚡ speed up: ${e.turnSeconds}s`;
    case "gameOver":
      return `■ GAME OVER (${e.reason}) — winner: ${e.winnerId ? name(e.winnerId) : "nobody"}`;
    case "backToLobby":
      return "↺ back to lobby";
    default: {
      const unknown: never = e;
      return String(unknown);
    }
  }
}

async function createRoom(settings: Record<string, unknown>, hostToken: string, topic = values.topic!): Promise<string> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, settings, token: hostToken, force: true }),
  });
  const body = (await res.json()) as CreateRoomResponse;
  if (!body.ok) throw new Error(`create failed: ${body.message}`);
  return body.code;
}

function check(label: string, ok: boolean, failures: string[]): void {
  console.log(`  ${ok ? "\x1b[32m✔" : "\x1b[31m✘"} ${label}${reset}`);
  if (!ok) failures.push(label);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachLogger(observer: Bot): void {
  if (values.quiet) return;
  const original = observer.ws.onmessage;
  observer.ws.onmessage = (ev) => {
    original?.call(observer.ws, ev);
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.type !== "state") return;
    for (const e of msg.events) {
      const line = describe(e, msg.state);
      if (line) console.log(`${highlight}${line}${reset}`);
    }
  };
}

async function runTimed(): Promise<string[]> {
  console.log("\n\x1b[1m=== TIMED MODE (3 bots, 2 lives, 6s turns, wrong answers retry) ===\x1b[0m");
  const host = new Bot("", { name: "AceBot", strategy: "ace", pool: GOOD });
  const code = await createRoom({ mode: "timed", lives: 2, turnSeconds: 6, wrongAnswer: "retry" }, host.token);
  console.log(`room ${code} — ${BASE}/r/${code}`);
  host.code = code;
  const bots = [
    host,
    new Bot(code, { name: "SloppyBot", strategy: "sloppy", pool: [...GOOD].reverse() }),
    new Bot(code, { name: "SleepyBot", strategy: "sleepy", pool: [] }),
  ];
  for (const b of bots) await b.connect();
  attachLogger(bots[0]!);
  const failures: string[] = [];
  check("first joiner with creator token is host", bots[0]!.state!.hostId === bots[0]!.id, failures);
  bots[1]!.send({ type: "start" });
  await wait(300);
  check("non-host cannot start", bots[1]!.errors.some((e) => e.startsWith("not_host")), failures);
  bots[0]!.send({ type: "start" });

  // Mid-game reconnect: SloppyBot drops and comes back with the same token.
  setTimeout(async () => {
    const sloppy = bots[1]!;
    const oldId = sloppy.id;
    sloppy.paused = true;
    sloppy.ws.close();
    await wait(500);
    await sloppy.connect();
    sloppy.paused = false;
    check("reconnect with same token keeps player id", sloppy.id === oldId, failures);
  }, 4_000);

  const final = await Promise.race([bots[0]!.done, wait(150_000).then(() => null)]);
  if (!final) {
    failures.push("timed game did not finish within 150s");
    return failures;
  }
  const events = bots[0]!.events;
  const sleepy = final.players.find((p) => p.name === "SleepyBot")!;
  check("game ended with the last one floating", final.phase === "over" && final.endReason === "lastStanding", failures);
  check("sleepy bot timed out and was eliminated", sleepy.status === "eliminated" && sleepy.stats.timeouts === 2, failures);
  check("an exact duplicate was rejected", events.some((e) => e.type === "rejected" && e.verdict.reason === "duplicate"), failures);
  check("a wrong answer was rejected", events.some((e) => e.type === "rejected" && e.verdict.reason === "invalid"), failures);
  check("answers were accepted", final.answers.length >= 3, failures);
  check("winner has place 1", final.players.find((p) => p.id === final.winnerId)?.place === 1, failures);
  check("awards were computed", final.awards.length > 0, failures);
  printSummary(final);
  for (const b of bots) b.ws.close();
  return failures;
}

async function runFree(): Promise<string[]> {
  console.log("\n\x1b[1m=== FREE & EASY MODE (2 bots + late joiner, tap out) ===\x1b[0m");
  const host = new Bot("", { name: "Hosty", strategy: "ace", pool: GOOD.slice(0, 4) });
  const code = await createRoom({ mode: "free" }, host.token);
  console.log(`room ${code} — ${BASE}/r/${code}`);
  host.code = code;
  const guest = new Bot(code, { name: "Guesty", strategy: "sloppy", pool: GOOD.slice(10, 14) });
  await host.connect();
  await guest.connect();
  attachLogger(host);
  const failures: string[] = [];
  host.send({ type: "start" });
  await wait(1_500);
  const late = new Bot(code, { name: "Latecomer", strategy: "ace", pool: GOOD.slice(20) });
  await late.connect();
  check("late joiner is a player in free mode", late.state!.players.find((p) => p.id === late.id)?.role === "player", failures);
  check("free mode has no deadline", host.state!.turn?.deadline === null, failures);

  // Each bot taps out once its pool runs dry.
  const tapper = setInterval(() => {
    for (const b of [host, guest, late]) {
      const s = b.state;
      if (!s || s.phase !== "playing") continue;
      const me = s.players.find((p) => p.id === b.id);
      const used = new Set(s.answers.map((a) => a.text.toLowerCase()));
      if (me?.status === "alive" && s.turn?.playerId === b.id && !s.turn.judging && b.opts.pool.every((a) => used.has(a.toLowerCase()))) {
        b.send({ type: "tapOut" });
      }
    }
  }, 700);
  const final = await Promise.race([host.done, wait(120_000).then(() => null)]);
  clearInterval(tapper);
  if (!final) {
    failures.push("free game did not finish within 120s");
    return failures;
  }
  check("game ended when everyone tapped out", final.players.filter((p) => p.role === "player").every((p) => p.status === "tappedOut"), failures);
  check("all pools were used", final.answers.length >= 10, failures);
  check("nobody lost lives", final.players.every((p) => p.stats.livesLost === 0), failures);
  printSummary(final);
  for (const b of [host, guest, late]) b.ws.close();
  return failures;
}

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

async function runCleared(): Promise<string[]> {
  // Against the real Jev the topic is a genuine short list; the mock judge reads the size from "(8)".
  const topic = health.judge === "mock" ? "planets in the solar system (8)" : "planets in the solar system";
  console.log(`\n\x1b[1m=== BOARD CLEARED (2 bots, timed, "${topic}") ===\x1b[0m`);
  const host = new Bot("", { name: "Astro", strategy: "ace", pool: PLANETS.filter((_, i) => i % 2 === 0) });
  const code = await createRoom({ mode: "timed", lives: 3, turnSeconds: 15 }, host.token, topic);
  console.log(`room ${code} — ${BASE}/r/${code}`);
  host.code = code;
  const guest = new Bot(code, { name: "Nova", strategy: "ace", pool: PLANETS.filter((_, i) => i % 2 === 1) });
  await host.connect();
  await guest.connect();
  attachLogger(host);
  const failures: string[] = [];
  check("lobby flags the topic as a short list", host.state!.shortList === true, failures);
  host.send({ type: "start" });
  const final = await Promise.race([host.done, wait(90_000).then(() => null)]);
  if (!final) {
    failures.push("cleared game did not finish within 90s");
    return failures;
  }
  check("game ended because the board was cleared", final.endReason === "cleared", failures);
  check("all eight planets were named", final.answers.length === PLANETS.length, failures);
  check("nobody was knocked out", final.players.every((p) => p.status === "alive"), failures);
  check("the closer got the FINAL ANSWER award", final.awards.find((a) => a.id === "closer")?.playerId === final.answers.at(-1)?.playerId, failures);
  printSummary(final);
  for (const b of [host, guest]) b.ws.close();
  return failures;
}

function printSummary(s: PublicState): void {
  console.log("\n  STANDINGS");
  for (const p of [...s.players].filter((x) => x.role === "player").sort((a, b) => (a.place ?? 99) - (b.place ?? 99))) {
    console.log(`   #${p.place} ${p.name.padEnd(10)} ${String(p.points).padStart(4)} pts  ${p.stats.accepted} ok / ${p.stats.rejected} bounced  ${p.status}`);
  }
  console.log(`  AWARDS: ${s.awards.map((a) => `${a.title} → ${s.players.find((p) => p.id === a.playerId)?.name}`).join(", ")}`);
  console.log(`  ANSWERS: ${s.answers.map((a) => a.text).join(", ")}\n`);
}

const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as HealthResponse;
console.log(`server ${BASE} judge=${JSON.stringify(health)}`);
const failures: string[] = [];
if (values.mode === "timed" || values.mode === "all") failures.push(...(await runTimed()));
if (values.mode === "free" || values.mode === "all") failures.push(...(await runFree()));
if (values.mode === "cleared" || values.mode === "all") failures.push(...(await runCleared()));
if (failures.length > 0) {
  console.log(`\x1b[31m${failures.length} check(s) failed:\n - ${failures.join("\n - ")}${reset}`);
  process.exit(1);
}
console.log("\x1b[32mALL CHECKS PASSED\x1b[0m");
process.exit(0);
