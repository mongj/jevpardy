// Drives full games against a running server with bot players over WebSocket.
//   node scripts/simulate.ts [--url http://localhost:5173] [--mode timed|deck|all]
// Bots can't know what Jev's secret questions will be, so run the server with the mock judge and writer:
//   JUDGE_MODE=mock GENERATOR_MODE=mock CLOUDFLARE_INCLUDE_PROCESS_ENV=true yarn dev

import { parseArgs } from "node:util";
import type { ClientMessage, CreateRoomResponse, GameEvent, HealthResponse, PublicState, ServerMessage } from "../src/shared/protocol.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173" },
    mode: { type: "string", default: "all" },
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
        // A rejected-too-soon submit changes no state, so nothing else would prompt the bot to try again.
        if (msg.code === "rate_limited") {
          this.lastActedTurn = "";
          setTimeout(() => this.maybeAct(), 700);
        }
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
    const onThisQuestion = s.answers.filter((a) => a.question === s.question?.index);
    const used = new Set(onThisQuestion.map((a) => a.text.toLowerCase()));
    const fresh = this.opts.pool.find((a) => !used.has(a.toLowerCase()));
    let text: string | null = fresh ?? null;
    if (this.opts.strategy === "sleepy") text = null;
    if (this.opts.strategy === "sloppy") {
      // Each turn: a duplicate (when this question has an answer to copy), a wrong answer, then a real one.
      if (turn.attempts === 0 && onThisQuestion.length > 0) text = onThisQuestion[0]!.text.toUpperCase();
      else if (turn.attempts <= 1) text = "wrong answer lol";
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
    case "questionStarted":
      return `◆ Q${e.index + 1} (${e.why}): ${s.question?.text ?? "?"}`;
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
    case "skipped":
      return `    ⏭ ${name(e.playerId)} skipped`;
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

/** Rooms start empty; the host picks topics and options in the lobby (see setUpDeck). */
async function createRoom(hostToken: string): Promise<string> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: hostToken }),
  });
  const body = (await res.json()) as CreateRoomResponse;
  if (!body.ok) throw new Error(`create failed: ${body.message}`);
  return body.code;
}

/** What the host does in the lobby: pick topics and options, then press WRITE QUESTIONS. */
function setUpDeck(host: Bot, topics: string[], settings: Record<string, unknown>): void {
  host.send({ type: "configure", settings, topics });
  host.send({ type: "generate" });
}

function check(label: string, ok: boolean, failures: string[]): void {
  console.log(`  ${ok ? "\x1b[32m✔" : "\x1b[31m✘"} ${label}${reset}`);
  if (!ok) failures.push(label);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a bot's view until `ok` holds (the deck is written in the background). */
async function until(bot: Bot, ok: (s: PublicState) => boolean, ms = 20_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (bot.state && ok(bot.state)) return true;
    await wait(100);
  }
  return false;
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
  console.log("\n\x1b[1m=== TIMED MODE (3 bots, 2 lives, 6s turns, 5 questions × 2 rounds) ===\x1b[0m");
  const host = new Bot("", { name: "AceBot", strategy: "ace", pool: GOOD });
  const code = await createRoom(host.token);
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
  check("rooms start empty, with no deck", bots[0]!.state!.topics.length === 0 && bots[0]!.state!.deck.status === "idle", failures);
  bots[1]!.send({ type: "generate" });
  await wait(300);
  check("non-host cannot write questions", bots[1]!.errors.some((e) => e.startsWith("not_host")), failures);
  setUpDeck(bots[0]!, ["European cities", "famous rivers"], { lives: 2, turnSeconds: 6, mysteryFuse: false, questionCount: 5 });
  check("deck gets written", await until(bots[0]!, (s) => s.deck.status === "ready" && s.deck.ready === 5), failures);
  check("lobby never shows the questions", !JSON.stringify(bots[1]!.state).includes("Name "), failures);
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
  const swaps = events.filter((e) => e.type === "questionStarted");
  check("game ended (last one standing or deck spent)", final.phase === "over" && (final.endReason === "lastStanding" || final.endReason === "questionsDone"), failures);
  check("sleepy bot timed out and was eliminated", sleepy.status === "eliminated" && sleepy.stats.timeouts === 2, failures);
  check("a question stumped someone and moved on", swaps.some((e) => e.type === "questionStarted" && e.why === "stumped"), failures);
  check("a question ran its rounds and moved on", swaps.some((e) => e.type === "questionStarted" && e.why === "rounds"), failures);
  check("an exact duplicate was rejected", events.some((e) => e.type === "rejected" && e.verdict.reason === "duplicate"), failures);
  check("a wrong answer was rejected", events.some((e) => e.type === "rejected" && e.verdict.reason === "invalid"), failures);
  check("answers were accepted", final.answers.length >= 3, failures);
  check("all questions are revealed at the end", final.history.length === 5, failures);
  check("winner has place 1", final.players.find((p) => p.id === final.winnerId)?.place === 1, failures);
  check("awards were computed", final.awards.length > 0, failures);
  printSummary(final);
  for (const b of bots) b.ws.close();
  return failures;
}

async function runDeck(): Promise<string[]> {
  // The mock writer reads "(N)" as "only N questions exist"; "(0)" is unusable.
  console.log("\n\x1b[1m=== DECK (topic warnings, suggestions, secrecy) ===\x1b[0m");
  const host = new Bot("", { name: "Quizzy", strategy: "ace", pool: GOOD });
  const code = await createRoom(host.token);
  console.log(`room ${code} — ${BASE}/r/${code}`);
  host.code = code;
  await host.connect();
  const failures: string[] = [];
  setUpDeck(host, ["my cat (0)", "dogs (2)", "space"], { questionCount: 6 });
  check("deck gets written", await until(host, (s) => s.deck.status === "ready"), failures);
  const reports = host.state!.deck.reports;
  check("unusable topic is flagged with a suggestion", reports[0]?.status === "unusable" && !!reports[0].suggestion, failures);
  check("thin topic is flagged", reports[1]?.status === "thin" && reports[1].got === 2, failures);
  check("other topics fill the gap", reports[2]?.status === "ok" && host.state!.deck.ready === 6, failures);
  const suggestion = reports[0]!.suggestion!;
  host.send({ type: "configure", settings: {}, topics: [suggestion, "dogs (2)", "space"] });
  check("editing topics marks the deck out of date", await until(host, (s) => s.topics[0] === suggestion && s.deck.status === "idle"), failures);
  host.send({ type: "generate" });
  check("writing again only fills in the new topic", await until(host, (s) => s.topics[0] === suggestion && s.deck.status === "ready" && s.deck.reports[0]?.status === "ok"), failures);
  host.send({ type: "start" });
  check("game starts", await until(host, (s) => s.phase === "playing"), failures);
  host.paused = true;
  check("only the first question is revealed", host.state!.question?.index === 0, failures);
  const midGame = JSON.stringify(host.state);
  host.send({ type: "end" });
  const final = await Promise.race([host.done, wait(10_000).then(() => null)]);
  const unplayed = final?.history.filter((h) => !h.played) ?? [];
  check("host can end the game; the rest of the deck is revealed", final?.history.length === 6 && unplayed.length === 5, failures);
  check("unplayed questions never reached clients mid-game", unplayed.every((h) => !midGame.includes(h.text)), failures);
  host.ws.close();
  return failures;
}

function printSummary(s: PublicState): void {
  console.log("\n  STANDINGS");
  for (const p of [...s.players].filter((x) => x.role === "player").sort((a, b) => (a.place ?? 99) - (b.place ?? 99))) {
    console.log(`   #${p.place} ${p.name.padEnd(10)} ${String(p.points).padStart(4)} pts  ${p.stats.accepted} ok / ${p.stats.rejected} bounced  ${p.status}`);
  }
  console.log(`  AWARDS: ${s.awards.map((a) => `${a.title} → ${s.players.find((p) => p.id === a.playerId)?.name}`).join(", ")}`);
  for (const h of s.history) {
    const found = s.answers.filter((a) => a.question === h.index).map((a) => a.text);
    console.log(`  Q${h.index + 1} ${h.played ? `[${h.endedBy ?? "ended"}]` : "[never reached]"} ${h.text}${found.length ? ` → ${found.join(", ")}` : ""}`);
  }
  console.log("");
}

const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as HealthResponse;
console.log(`server ${BASE} ${JSON.stringify(health)}`);
if (health.judge !== "mock" || health.generator !== "mock") {
  console.log("\x1b[31mThe simulator needs the mock judge and writer (bots can't know Jev's secret questions). Start the server with:\n  JUDGE_MODE=mock GENERATOR_MODE=mock CLOUDFLARE_INCLUDE_PROCESS_ENV=true yarn dev\x1b[0m");
  process.exit(1);
}
const failures: string[] = [];
if (values.mode === "timed" || values.mode === "all") failures.push(...(await runTimed()));
if (values.mode === "deck" || values.mode === "all") failures.push(...(await runDeck()));
if (failures.length > 0) {
  console.log(`\x1b[31m${failures.length} check(s) failed:\n - ${failures.join("\n - ")}${reset}`);
  process.exit(1);
}
console.log("\x1b[32mALL CHECKS PASSED\x1b[0m");
process.exit(0);
