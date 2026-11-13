import { describe, expect, it } from "vitest";
import { BONUS_LIFE_POINTS, DEFAULT_SETTINGS, EMPTY_ROOM_MS, OVER_TTL_MS, QUESTION_REVEAL_MS, ROUNDS_PER_QUESTION, mergeSettings } from "../../shared/constants.ts";
import type { GameSettings } from "../../shared/protocol.ts";
import { normalizeAnswer, sanitizeAnswer, sanitizeName, sanitizeTopics } from "../../shared/sanitize.ts";
import type { JudgeOutput } from "../judge/types.ts";
import { mergeBatch } from "../questions/deck.ts";
import type { QuestionCandidate } from "../questions/types.ts";
import {
  type Ctx,
  type Decision,
  type RoomState,
  applyPools,
  beginGeneration,
  configure,
  createRoom,
  deckPlan,
  decide,
  deckOutOfDate,
  disconnect,
  expiresAt,
  generate,
  join,
  kick,
  nextAlarmAt,
  rebuildDeck,
  rematch,
  resolve,
  start,
  submit,
  tick,
  toPublic,
} from "./engine.ts";

const THRESHOLDS = { accept: 0.7, duplicate: 0.75 };

function makeCtx(): Ctx & { advance: (ms: number) => void } {
  let id = 0;
  const ctx = {
    now: 1_000_000,
    rng: () => 0, // deterministic: shuffles are stable, fresh fuses are the shortest
    newId: () => `id${++id}`,
    advance(ms: number) {
      ctx.now += ms;
    },
  };
  return ctx;
}

const ACCEPT: Decision = { accepted: true, reason: null, duplicateOf: null, confidence: 0.95, tier: "basic" };
const REJECT: Decision = { accepted: false, reason: "invalid", duplicateOf: null, confidence: 0.1, tier: "basic" };

function candidate(text: string, pool = 50, difficulty = 1, short: number | null = null): QuestionCandidate {
  return { text, topic: "Europe", pool, difficulty, examples: [], short, fun: null };
}

/** Gives the room a written deck of `count` questions without any I/O. */
function giveDeck(state: RoomState, ctx: Ctx, opts: { count?: number; pool?: number } = {}) {
  const count = opts.count ?? state.settings.questionCount;
  state.settings = mergeSettings(state.settings, { questionCount: count });
  const pools = state.topics.map((topic) =>
    mergeBatch(undefined, topic, count + 3, {
      verdict: "great",
      reason: null,
      suggestion: null,
      candidates: Array.from({ length: count + 3 }, (_, i) => ({ ...candidate(`Name ${topic} thing ${i + 1}`, opts.pool ?? 50), topic })),
    }),
  );
  beginGeneration(state, ctx);
  applyPools(state, pools);
  rebuildDeck(state, ctx);
}

/** Answers `n` times in a row with distinct answers, 1 s apart. */
function answerTimes(state: RoomState, ctx: Ctx & { advance: (ms: number) => void }, n: number, prefix = "A") {
  let events: ReturnType<typeof answer> = [];
  for (let i = 0; i < n; i++) {
    ctx.advance(1000);
    events = answer(state, ctx, `${prefix}${i}`);
  }
  return events;
}

function setup(settings: Partial<GameSettings>, names = ["Ada", "Bo"], deck: { count?: number; pool?: number } = {}) {
  const ctx = makeCtx();
  const state = createRoom({ code: "ABCD", topics: ["Europe"], settings, judge: "mock", maxPlayers: 12 }, ctx);
  const ids = names.map((name, i) => {
    const r = join(state, { token: `tok-${i}`, name }, ctx);
    if (!r.ok) throw new Error(r.message);
    return r.player.id;
  });
  giveDeck(state, ctx, deck);
  return { ctx, state, ids };
}

function current(state: RoomState): string {
  if (!state.turn) throw new Error("no turn");
  return state.turn.playerId;
}

function answer(state: RoomState, ctx: Ctx, text: string, decision: Decision = ACCEPT) {
  const pid = current(state);
  const r = submit(state, pid, text, ctx);
  if (!r.ok) throw new Error(r.message);
  if (!r.judge) return r.events;
  return [...r.events, ...resolve(state, r.turnId, decision, ctx)];
}

/** Lets the current player's clock run out. */
function timeout(state: RoomState, ctx: Ctx & { advance: (ms: number) => void }) {
  ctx.advance(state.turn!.deadline! - ctx.now);
  return tick(state, ctx);
}

describe("lobby", () => {
  it("makes the first joiner host and reconnects by token", () => {
    const { state, ctx, ids } = setup({});
    expect(state.hostId).toBe(ids[0]);
    disconnect(state, ids[0]!, ctx);
    const again = join(state, { token: "tok-0", name: null }, ctx);
    expect(again.ok && again.reconnected && again.player.id === ids[0]).toBe(true);
    expect(state.hostId).toBe(ids[0]);
  });

  it("only lets the host start and rejects kicked tokens", () => {
    const { state, ctx, ids } = setup({});
    expect(start(state, ids[1]!, ctx)).toMatchObject({ ok: false, code: "not_host" });
    expect(kick(state, ids[0]!, ids[1]!, ctx).ok).toBe(true);
    expect(join(state, { token: "tok-1", name: "Bo" }, ctx)).toMatchObject({ ok: false, code: "kicked" });
  });

  it("dedupes names and caps seats", () => {
    const ctx = makeCtx();
    const state = createRoom({ code: "ABCD", topics: ["x y z"], judge: "mock", maxPlayers: 2 }, ctx);
    join(state, { token: "a", name: "Sam" }, ctx);
    const b = join(state, { token: "b", name: "sam" }, ctx);
    const c = join(state, { token: "c", name: "Cy" }, ctx);
    expect(b.ok && b.player.name).toBe("sam#2");
    expect(c.ok && c.player.role).toBe("spectator");
  });

  it("seats mid-game joiners as spectators", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    const late = join(state, { token: "late", name: "Late" }, ctx);
    expect(late.ok && late.player.role).toBe("spectator");
    expect(state.turnOrder).toHaveLength(2);
  });

  it("starts rooms empty; only the host can ask for questions, and only with a topic", () => {
    const ctx = makeCtx();
    const state = createRoom({ code: "ABCD", judge: "mock", maxPlayers: 12 }, ctx);
    const host = join(state, { token: "a", name: "Ada" }, ctx);
    const guest = join(state, { token: "b", name: "Bo" }, ctx);
    if (!host.ok || !guest.ok) throw new Error("join failed");
    expect(toPublic(state)).toMatchObject({ topics: [], deck: { status: "idle", ready: 0 } });
    expect(generate(state, host.player.id, ctx)).toMatchObject({ ok: false, code: "bad_message" });
    expect(configure(state, host.player.id, {}, ["Europe"], ctx).ok).toBe(true);
    expect(generate(state, guest.player.id, ctx)).toMatchObject({ ok: false, code: "not_host" });
    expect(generate(state, host.player.id, ctx).ok).toBe(true);
  });

  it("won't start until the deck is written", () => {
    const ctx = makeCtx();
    const state = createRoom({ code: "ABCD", topics: ["Europe"], judge: "mock", maxPlayers: 12 }, ctx);
    const host = join(state, { token: "a", name: "Ada" }, ctx);
    if (!host.ok) throw new Error("join failed");
    expect(start(state, host.player.id, ctx)).toMatchObject({ ok: false, code: "deck_not_ready" });
    beginGeneration(state, ctx);
    expect(toPublic(state).deck.status).toBe("generating");
    expect(generate(state, host.player.id, ctx)).toMatchObject({ ok: false, code: "deck_not_ready" });
    expect(start(state, host.player.id, ctx)).toMatchObject({ ok: false, code: "deck_not_ready" });
    giveDeck(state, ctx, { count: 5 });
    expect(toPublic(state).deck).toMatchObject({ status: "ready", ready: 5, wanted: 5 });
    expect(start(state, host.player.id, ctx).ok).toBe(true);
  });

  it("marks the deck out of date when topics or the question count change", () => {
    const { state, ctx, ids } = setup({});
    const host = ids[0]!;
    expect(configure(state, host, { lives: 2 }, undefined, ctx)).toMatchObject({ ok: true, deckChanged: false });
    expect(toPublic(state).deck.status).toBe("ready");
    expect(configure(state, host, { questionCount: 12 }, undefined, ctx)).toMatchObject({ ok: true, deckChanged: true });
    expect(toPublic(state).deck).toMatchObject({ status: "idle", ready: 0 });
    expect(start(state, host, ctx)).toMatchObject({ ok: false, code: "deck_not_ready" });
    expect(configure(state, host, {}, ["Europe", "  europe ", "Pixar"], ctx)).toMatchObject({ ok: true, deckChanged: true });
    expect(state.topics).toEqual(["Europe", "Pixar"]);
    // Cached pools mean only the new topic needs writing.
    expect(deckPlan(state).map((r) => r.topic)).toEqual(["Pixar"]);
    expect(configure(state, host, {}, [], ctx)).toMatchObject({ ok: true });
    expect(state.topics).toEqual([]);
    expect(configure(state, host, {}, ["  "], ctx)).toMatchObject({ ok: false });
  });

  it("doesn't deal a deck the host edited while it was being written", () => {
    const { state, ctx, ids } = setup({});
    beginGeneration(state, ctx);
    configure(state, ids[0]!, {}, ["Pixar"], ctx);
    expect(toPublic(state).deck.status).toBe("generating");
    expect(deckOutOfDate(state)).toBe(true);
    rebuildDeck(state, ctx);
    expect(toPublic(state).deck).toMatchObject({ status: "idle", ready: 0 });
  });

  it("never sends unplayed questions to clients", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo"], { count: 4 });
    const lobby = JSON.stringify(toPublic(state));
    for (const q of state.deck) expect(lobby).not.toContain(q.text);
    start(state, state.hostId!, ctx);
    const playing = JSON.stringify(toPublic(state));
    expect(playing).toContain(state.deck[0]!.text);
    for (const q of state.deck.slice(1)) expect(playing).not.toContain(q.text);
  });
});

describe("turns", () => {
  it("costs a life on timeout and passes the turn", () => {
    const { state, ctx } = setup({ lives: 3, turnSeconds: 10, mysteryFuse: false });
    start(state, state.hostId!, ctx);
    const first = current(state);
    expect(state.turn!.deadline).toBe(ctx.now + 10_000 + QUESTION_REVEAL_MS);
    const events = timeout(state, ctx);
    expect(events.map((e) => e.type)).toEqual(["lifeLost", "questionStarted", "turnStarted"]);
    expect(state.players.find((p) => p.id === first)!.lives).toBe(2);
    expect(current(state)).not.toBe(first);
  });

  it("ends with the last player standing", () => {
    const { state, ctx } = setup({ lives: 1, turnSeconds: 5 });
    start(state, state.hostId!, ctx);
    const loser = current(state);
    const events = timeout(state, ctx);
    expect(events.map((e) => e.type)).toEqual(["lifeLost", "eliminated", "gameOver"]);
    expect(state.phase).toBe("over");
    expect(state.winnerId).not.toBe(loser);
    expect(state.players.find((p) => p.id === state.winnerId)!.place).toBe(1);
    expect(state.endReason).toBe("lastStanding");
    expect(state.awards.some((a) => a.id === "survivor")).toBe(true);
  });

  it("plays a solo game until the last heart", () => {
    const { state, ctx } = setup({ lives: 2, turnSeconds: 5 }, ["Solo"]);
    start(state, state.hostId!, ctx);
    timeout(state, ctx);
    expect(state.phase).toBe("playing");
    timeout(state, ctx);
    expect(state.phase).toBe("over");
  });

  it("accepts an answer, scores it and rotates", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    const first = current(state);
    const events = answer(state, ctx, "Paris", { ...ACCEPT, tier: "rare" });
    expect(events.map((e) => e.type)).toEqual(["judging", "accepted", "turnStarted"]);
    expect(state.players.find((p) => p.id === first)!.points).toBe(50);
    expect(state.answers.map((a) => [a.text, a.question])).toEqual([["Paris", 0]]);
    expect(current(state)).not.toBe(first);
  });

  it("rejects exact duplicates of this question's answers without calling the judge", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    answer(state, ctx, "München");
    ctx.advance(1000);
    const r = submit(state, current(state), "  munchen ", ctx);
    expect(r.ok && r.judge).toBe(null);
    expect(r.ok && r.events[0]).toMatchObject({ type: "rejected", verdict: { reason: "duplicate", duplicateOf: "München" } });
  });

  it("only sends Jev the current question and its answers; repeats across questions are fine", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    answerTimes(state, ctx, 2 * ROUNDS_PER_QUESTION);
    expect(state.question!.index).toBe(1);
    ctx.advance(1000);
    const r = submit(state, current(state), "A0", ctx);
    expect(r.ok && r.judge).toMatchObject({ question: state.deck[1]!.text, answer: "A0", prior: [] });
  });

  it("wrong and repeated answers cost nothing: keep trying while the fuse burns", () => {
    const { state, ctx } = setup({ lives: 3 });
    start(state, state.hostId!, ctx);
    const first = current(state);
    expect(answer(state, ctx, "Gotham", REJECT).map((e) => e.type)).toEqual(["judging", "rejected"]);
    expect(current(state)).toBe(first);
    ctx.advance(1000);
    answer(state, ctx, "Paris");
    ctx.advance(1000);
    answer(state, ctx, "Lyon");
    ctx.advance(1000);
    expect(submit(state, current(state), "paris", ctx)).toMatchObject({ ok: true, events: [{ type: "rejected" }] });
    expect(state.players.every((x) => x.lives === 3)).toBe(true);
    expect(state.question!.failedBy).toEqual([]);
  });

  it("freezes the clock while Jev judges", () => {
    const { state, ctx } = setup({ turnSeconds: 10, mysteryFuse: false });
    start(state, state.hostId!, ctx);
    const deadline = state.turn!.deadline!;
    ctx.advance(6_000);
    const r = submit(state, current(state), "Lyon", ctx);
    expect(r.ok).toBe(true);
    expect(state.turn!.deadline).toBeNull();
    ctx.advance(20_000); // judge is very slow...
    expect(tick(state, ctx).map((e) => e.type)).toEqual(["rejected"]); // ...and gets treated as an error
    expect(state.turn!.deadline).toBe(ctx.now + (deadline - (ctx.now - 20_000)));
  });

  it("enforces turn order and rate limits", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    const other = state.players.find((p) => p.id !== current(state))!.id;
    expect(submit(state, other, "Rome", ctx)).toMatchObject({ ok: false, code: "not_your_turn" });
    answer(state, ctx, "Nope", REJECT);
    expect(submit(state, current(state), "Rome", ctx)).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("fills the 1UP meter for a bonus life", () => {
    const { state, ctx } = setup({ lives: 3 }, ["Solo"]);
    start(state, state.hostId!, ctx);
    const pid = current(state);
    for (let i = 0; i < 4; i++) {
      ctx.advance(1000);
      answer(state, ctx, `City ${i}`, { ...ACCEPT, tier: "jevillion" });
    }
    const p = state.players.find((x) => x.id === pid)!;
    expect(p.lives).toBe(4);
    expect(p.meter).toBe(4 * 100 - BONUS_LIFE_POINTS);
  });

  it("skips past a kicked current player", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo", "Cy"]);
    start(state, state.hostId!, ctx);
    let target = current(state);
    if (target === state.hostId) {
      answer(state, ctx, "Oslo");
      target = current(state);
    }
    kick(state, state.hostId!, target, ctx);
    expect(state.turn!.playerId).not.toBe(target);
    expect(state.phase).toBe("playing");
  });
});

describe("mystery fuse", () => {
  // turnSeconds 20 → fresh fuse 12–36 s (rng=0 → 12 s), floor 10 s.
  const fuse = { mysteryFuse: true, turnSeconds: 20 } as const;

  it("hides the deadline from clients", () => {
    const { state, ctx } = setup(fuse);
    start(state, state.hostId!, ctx);
    expect(state.turn!.deadline).toBe(ctx.now + 12_000 + QUESTION_REVEAL_MS);
    expect(toPublic(state).turn!.deadline).toBeNull();
    expect(nextAlarmAt(state)).toBe(state.turn!.deadline);
  });

  it("is shared: passing it on keeps the time left, topped up to the floor", () => {
    const { state, ctx } = setup(fuse, ["Ada", "Bo", "Cy"]);
    start(state, state.hostId!, ctx);
    const popsAt = state.turn!.deadline!;
    ctx.advance(1_000);
    answer(state, ctx, "Paris");
    expect(state.turn!.deadline).toBe(popsAt); // 12.8 s left: inherited as-is
    ctx.advance(5_000);
    answer(state, ctx, "Rome");
    expect(state.turn!.deadline).toBe(ctx.now + 10_000); // 7.8 s left: topped up to the floor
  });

  it("lights a fresh fuse after a pop", () => {
    const { state, ctx } = setup(fuse, ["Ada", "Bo", "Cy"]);
    start(state, state.hostId!, ctx);
    timeout(state, ctx);
    expect(state.turn!.deadline).toBe(ctx.now + 12_000);
  });
});

describe("question rotation", () => {
  it("moves on after three rounds", () => {
    const { state, ctx } = setup({ mysteryFuse: false, turnSeconds: 10 });
    start(state, state.hostId!, ctx);
    answerTimes(state, ctx, 2 * ROUNDS_PER_QUESTION - 1);
    expect(state.question!.index).toBe(0);
    ctx.advance(1000);
    const events = answer(state, ctx, "last");
    expect(events).toContainEqual({ type: "questionStarted", index: 1, why: "rounds" });
    expect(state.history).toMatchObject([{ index: 0, endedBy: "rounds", played: true }]);
    // The new question's first turn gets time to read it.
    expect(state.turn!.deadline).toBe(ctx.now + 10_000 + QUESTION_REVEAL_MS);
  });

  it("is cleared once it has taken its share of answers", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo"], { pool: 8 });
    expect(state.deck[0]!.cap).toBe(5);
    start(state, state.hostId!, ctx);
    for (let i = 0; i < 4; i++) {
      ctx.advance(1000);
      answer(state, ctx, `A${i}`);
    }
    ctx.advance(1000);
    expect(answer(state, ctx, "A4")).toContainEqual({ type: "questionStarted", index: 1, why: "cleared" });
  });

  it("never hands a question back to someone it already beat", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo", "Cy"]);
    start(state, state.hostId!, ctx);
    const beaten = current(state);
    timeout(state, ctx);
    expect(state.question!.index).toBe(0);
    answer(state, ctx, "Paris");
    ctx.advance(1000);
    const events = answer(state, ctx, "Rome");
    expect(events).toContainEqual({ type: "questionStarted", index: 1, why: "stumped" });
    expect(current(state)).toBe(beaten);
  });

  it("moves on as soon as it beats two players", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo", "Cy", "Di"]);
    start(state, state.hostId!, ctx);
    timeout(state, ctx);
    expect(state.question!.index).toBe(0);
    const events = timeout(state, ctx);
    expect(events).toContainEqual({ type: "questionStarted", index: 1, why: "stumped" });
  });

  it("with two players left, one miss is enough", () => {
    const { state, ctx } = setup({});
    start(state, state.hostId!, ctx);
    expect(timeout(state, ctx)).toContainEqual({ type: "questionStarted", index: 1, why: "stumped" });
  });

  it("ends the game when the deck runs out, survivors ranked by points", () => {
    const { state, ctx } = setup({}, ["Ada", "Bo"], { count: 3 });
    start(state, state.hostId!, ctx);
    const perQuestion = 2 * ROUNDS_PER_QUESTION;
    for (let i = 0; i < 3 * perQuestion - 1; i++) {
      ctx.advance(1000);
      answer(state, ctx, `A${i}`, { ...ACCEPT, tier: i === 0 ? "rare" : "basic" });
    }
    expect(state.question!.index).toBe(2);
    ctx.advance(1000);
    const events = answer(state, ctx, "last");
    expect(events.at(-1)).toMatchObject({ type: "gameOver", reason: "questionsDone" });
    expect(state.history.map((h) => [h.index, h.played, h.endedBy])).toEqual([
      [0, true, "rounds"],
      [1, true, "rounds"],
      [2, true, "rounds"],
    ]);
    const winner = state.players.find((p) => p.id === state.winnerId)!;
    expect(winner.points).toBe(Math.max(...state.players.map((p) => p.points)));
  });

  it("reveals the questions it never reached when the game ends early", () => {
    const { state, ctx, ids } = setup({ lives: 1 }, ["Ada", "Bo"], { count: 4 });
    start(state, ids[0]!, ctx);
    timeout(state, ctx);
    expect(state.phase).toBe("over");
    const pub = toPublic(state);
    expect(pub.question).toBeNull();
    expect(pub.history.map((h) => [h.index, h.played])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
    ]);
  });
});

describe("rematch", () => {
  it("returns to the lobby and deals fresh questions, never repeating played ones", () => {
    const { state, ctx, ids } = setup({ lives: 1 }, ["Ada", "Bo"], { count: 3 });
    start(state, ids[0]!, ctx);
    const played = state.deck[0]!.text;
    timeout(state, ctx);
    expect(rematch(state, ids[1]!, ctx)).toMatchObject({ ok: false, code: "not_host" });
    expect(rematch(state, ids[0]!, ctx).ok).toBe(true);
    expect(state.phase).toBe("lobby");
    // Same topics, no deck until the host writes one.
    expect(toPublic(state)).toMatchObject({ topics: ["Europe"], deck: { status: "idle", ready: 0 } });
    expect(deckPlan(state)).toEqual([]);
    beginGeneration(state, ctx);
    rebuildDeck(state, ctx);
    expect(toPublic(state).deck.status).toBe("ready");
    expect(state.deck.map((q) => q.text)).not.toContain(played);
  });
});

describe("decide", () => {
  const answers = [{ id: "a1", question: 0, text: "München", playerId: "p", tier: "basic" as const, points: 10, at: 0, confidence: 1 }];
  const base: Extract<JudgeOutput, { ok: true }> = { ok: true, validity: 0.9, obscurity: 2.4, duplicates: [] };

  it("applies thresholds and tiers", () => {
    expect(decide(base, THRESHOLDS, answers)).toMatchObject({ accepted: true, tier: "rare" });
    expect(decide({ ...base, validity: 0.5 }, THRESHOLDS, answers)).toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("prefers duplicate over validity", () => {
    const d = decide({ ...base, duplicates: [{ id: "a1", probability: 0.97 }] }, THRESHOLDS, answers);
    expect(d).toMatchObject({ accepted: false, reason: "duplicate", duplicateOf: "München" });
  });

  it("maps judge failures to a no-penalty error", () => {
    expect(decide({ ok: false, error: "boom" }, THRESHOLDS, answers)).toMatchObject({ reason: "judge_error" });
  });
});

describe("shared helpers", () => {
  it("sanitizes input", () => {
    expect(sanitizeName("  <b>Zoë</b>​ ")).toBe("bZoëb");
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeAnswer("x".repeat(500))).toHaveLength(60);
    expect(normalizeAnswer("The Hague")).toBe(normalizeAnswer("hague"));
    expect(normalizeAnswer("Kraków")).toBe("krakow");
  });

  it("cleans topic lists", () => {
    expect(sanitizeTopics(["  Pixar  movies ", "pixar movies", "", "ab", "Cheese"])).toEqual(["Pixar movies", "Cheese"]);
    expect(sanitizeTopics(["a", "b"])).toBeNull();
    expect(sanitizeTopics("Pixar")).toBeNull();
    expect(sanitizeTopics(["one1", "two2", "three", "four", "five", "six"])).toHaveLength(5);
  });

  it("clamps settings", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { lives: 99, turnSeconds: -4, mysteryFuse: "yes" as never, questionCount: 500 })).toMatchObject({
      lives: 5,
      turnSeconds: 5,
      mysteryFuse: true,
      questionCount: 30,
    });
  });
});

describe("room lifetime", () => {
  it("schedules the wipe after the end screen and for empty rooms", () => {
    const { state, ctx, ids } = setup({ lives: 1 }, ["Ada", "Bo"], { count: 3 });
    start(state, ids[0]!, ctx);
    timeout(state, ctx);
    expect(expiresAt(state)).toBe(state.endedAt! + OVER_TTL_MS);

    const lobby = setup({});
    for (const id of lobby.ids) disconnect(lobby.state, id, lobby.ctx);
    expect(nextAlarmAt(lobby.state)).toBe(lobby.ctx.now + EMPTY_ROOM_MS);
  });
});
