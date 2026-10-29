import { describe, expect, it } from "vitest";
import { BONUS_LIFE_POINTS, CLEAR_BONUS_POINTS, DEFAULT_SETTINGS, EMPTY_ROOM_MS, OVER_TTL_MS, mergeSettings } from "../../shared/constants.ts";
import type { GameSettings } from "../../shared/protocol.ts";
import { normalizeAnswer, sanitizeAnswer, sanitizeName } from "../../shared/sanitize.ts";
import type { JudgeOutput } from "../judge/types.ts";
import {
  type Ctx,
  type Decision,
  type RoomState,
  configure,
  createRoom,
  decide,
  disconnect,
  expiresAt,
  join,
  kick,
  nextAlarmAt,
  overrule,
  resolve,
  setShortList,
  start,
  submit,
  tapOut,
  tick,
  toPublic,
} from "./engine.ts";

const THRESHOLDS = { accept: 0.7, duplicate: 0.75, exhausted: 0.5 };

function makeCtx(): Ctx & { advance: (ms: number) => void } {
  let id = 0;
  const ctx = {
    now: 1_000_000,
    rng: () => 0, // deterministic: shuffle keeps join order reversed-stable, fuse = min
    newId: () => `id${++id}`,
    advance(ms: number) {
      ctx.now += ms;
    },
  };
  return ctx;
}

const ACCEPT: Decision = { accepted: true, reason: null, duplicateOf: null, confidence: 0.95, tier: "npc", boardCleared: false };
const CLEARS: Decision = { ...ACCEPT, boardCleared: true };
const REJECT: Decision = { accepted: false, reason: "invalid", duplicateOf: null, confidence: 0.1, tier: "npc", boardCleared: false };

function setup(settings: Partial<GameSettings>, names = ["Ada", "Bo"]) {
  const ctx = makeCtx();
  const state = createRoom({ code: "ABCD", topic: "European cities", settings, judge: "mock", maxPlayers: 12 }, ctx);
  const ids = names.map((name, i) => {
    const r = join(state, { token: `tok-${i}`, name }, ctx);
    if (!r.ok) throw new Error(r.message);
    return r.player.id;
  });
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
    const state = createRoom({ code: "ABCD", topic: "x y z", judge: "mock", maxPlayers: 2 }, ctx);
    join(state, { token: "a", name: "Sam" }, ctx);
    const b = join(state, { token: "b", name: "sam" }, ctx);
    const c = join(state, { token: "c", name: "Cy" }, ctx);
    expect(b.ok && b.player.name).toBe("sam#2");
    expect(c.ok && c.player.role).toBe("spectator");
  });
});

describe("timed mode", () => {
  it("costs a life on timeout and passes the turn", () => {
    const { state, ctx } = setup({ mode: "timed", lives: 3, turnSeconds: 10 });
    start(state, state.hostId!, ctx);
    const first = current(state);
    ctx.advance(10_000);
    const events = tick(state, ctx);
    expect(events.map((e) => e.type)).toEqual(["lifeLost", "turnStarted"]);
    expect(state.players.find((p) => p.id === first)!.lives).toBe(2);
    expect(current(state)).not.toBe(first);
  });

  it("ends with the last player standing", () => {
    const { state, ctx } = setup({ mode: "timed", lives: 1, turnSeconds: 5 });
    start(state, state.hostId!, ctx);
    const loser = current(state);
    ctx.advance(5_000);
    const events = tick(state, ctx);
    expect(events.map((e) => e.type)).toEqual(["lifeLost", "eliminated", "gameOver"]);
    expect(state.phase).toBe("over");
    expect(state.winnerId).not.toBe(loser);
    expect(state.players.find((p) => p.id === state.winnerId)!.place).toBe(1);
    expect(state.endReason).toBe("lastStanding");
    expect(state.awards.some((a) => a.id === "survivor")).toBe(true);
  });

  it("ends when Jev says the board is cleared", () => {
    const { state, ctx } = setup({ mode: "timed", lives: 2, turnSeconds: 10 }, ["Ada", "Bo", "Cy"]);
    start(state, state.hostId!, ctx);
    const out = current(state);
    ctx.advance(10_000);
    tick(state, ctx);
    ctx.advance(10_000);
    tick(state, ctx);
    answer(state, ctx, "Mercury");
    const closer = current(state);
    const events = answer(state, ctx, "Venus", CLEARS);
    expect(events.map((e) => e.type)).toEqual(["judging", "accepted", "gameOver"]);
    expect(events.at(-1)).toMatchObject({ type: "gameOver", reason: "cleared" });
    expect(state.phase).toBe("over");
    expect(state.turn).toBeNull();
    const alive = state.players.filter((p) => p.status === "alive");
    expect(alive.length).toBe(3);
    expect(alive.every((p) => p.points >= CLEAR_BONUS_POINTS)).toBe(true);
    expect(state.players.find((p) => p.id === out)!.lives).toBe(1);
    expect(state.awards.find((a) => a.id === "closer")?.playerId).toBe(closer);
    expect(state.awards.some((a) => a.id === "survivor")).toBe(false);
    expect(toPublic(state).endReason).toBe("cleared");
  });

  it("plays a solo game until the last heart", () => {
    const { state, ctx } = setup({ mode: "timed", lives: 2, turnSeconds: 5 }, ["Solo"]);
    start(state, state.hostId!, ctx);
    ctx.advance(5_000);
    tick(state, ctx);
    expect(state.phase).toBe("playing");
    ctx.advance(5_000);
    tick(state, ctx);
    expect(state.phase).toBe("over");
  });

  it("accepts an answer, scores it and rotates", () => {
    const { state, ctx } = setup({ mode: "timed" });
    start(state, state.hostId!, ctx);
    const first = current(state);
    const events = answer(state, ctx, "Paris", { ...ACCEPT, tier: "sidequest" });
    expect(events.map((e) => e.type)).toEqual(["judging", "accepted", "turnStarted"]);
    expect(state.players.find((p) => p.id === first)!.points).toBe(50);
    expect(state.answers.map((a) => a.text)).toEqual(["Paris"]);
    expect(current(state)).not.toBe(first);
  });

  it("rejects exact duplicates without calling the judge", () => {
    const { state, ctx } = setup({ mode: "timed" });
    start(state, state.hostId!, ctx);
    answer(state, ctx, "München");
    ctx.advance(1000);
    const r = submit(state, current(state), "  munchen ", ctx);
    expect(r.ok && r.judge).toBe(null);
    expect(r.ok && r.events[0]).toMatchObject({ type: "rejected", verdict: { reason: "duplicate", duplicateOf: "München" } });
  });

  it("'retry' rule keeps the turn; 'life' rule costs a heart and passes", () => {
    const retry = setup({ mode: "timed", wrongAnswer: "retry" });
    start(retry.state, retry.state.hostId!, retry.ctx);
    const p = current(retry.state);
    answer(retry.state, retry.ctx, "Gotham", REJECT);
    expect(current(retry.state)).toBe(p);

    const strict = setup({ mode: "timed", wrongAnswer: "life", lives: 3 });
    start(strict.state, strict.state.hostId!, strict.ctx);
    const q = current(strict.state);
    const events = answer(strict.state, strict.ctx, "Gotham", REJECT);
    expect(events.map((e) => e.type)).toEqual(["judging", "rejected", "lifeLost", "turnStarted"]);
    expect(strict.state.players.find((x) => x.id === q)!.lives).toBe(2);
  });

  it("freezes the clock while Jev judges", () => {
    const { state, ctx } = setup({ mode: "timed", turnSeconds: 10 });
    start(state, state.hostId!, ctx);
    ctx.advance(6_000);
    const r = submit(state, current(state), "Lyon", ctx);
    expect(r.ok).toBe(true);
    expect(state.turn!.deadline).toBeNull();
    ctx.advance(20_000); // judge is very slow...
    expect(tick(state, ctx).map((e) => e.type)).toEqual(["rejected"]); // ...and gets treated as an error
    expect(state.turn!.deadline).toBe(ctx.now + 4_000);
  });

  it("enforces turn order and rate limits", () => {
    const { state, ctx } = setup({ mode: "timed" });
    start(state, state.hostId!, ctx);
    const other = state.players.find((p) => p.id !== current(state))!.id;
    expect(submit(state, other, "Rome", ctx)).toMatchObject({ ok: false, code: "not_your_turn" });
    answer(state, ctx, "Nope", REJECT);
    expect(submit(state, current(state), "Rome", ctx)).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("fills the 1UP meter for a bonus life", () => {
    const { state, ctx } = setup({ mode: "timed", lives: 3 }, ["Solo"]);
    start(state, state.hostId!, ctx);
    const pid = current(state);
    for (let i = 0; i < 2; i++) {
      ctx.advance(1000);
      answer(state, ctx, `City ${i}`, { ...ACCEPT, tier: "jevillion" });
    }
    const p = state.players.find((x) => x.id === pid)!;
    expect(p.lives).toBe(4);
    expect(p.meter).toBe(2 * 100 - BONUS_LIFE_POINTS);
  });

  it("hides the deadline with a mystery fuse", () => {
    const { state, ctx } = setup({ mode: "timed", mysteryFuse: true, turnSeconds: 20 });
    start(state, state.hostId!, ctx);
    expect(state.turn!.deadline).toBe(ctx.now + 8_000); // rng=0 → shortest fuse
    expect(toPublic(state).turn!.deadline).toBeNull();
    expect(nextAlarmAt(state)).toBe(ctx.now + 8_000);
  });

  it("lets the host overrule and refunds the life", () => {
    const { state, ctx } = setup({ mode: "timed", wrongAnswer: "life", lives: 2 });
    start(state, state.hostId!, ctx);
    const victim = current(state);
    answer(state, ctx, "Zurich", REJECT);
    const verdict = state.log[state.log.length - 1]!;
    const r = overrule(state, state.hostId!, verdict.id, ctx);
    expect(r.ok).toBe(true);
    const p = state.players.find((x) => x.id === victim)!;
    expect(p.lives).toBe(2);
    expect(state.answers.map((a) => a.text)).toEqual(["Zurich"]);
  });

  it("skips past a kicked current player", () => {
    const { state, ctx } = setup({ mode: "timed" }, ["Ada", "Bo", "Cy"]);
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

describe("free mode", () => {
  it("has no timer and ends when everyone taps out", () => {
    const { state, ctx, ids } = setup({ mode: "free" });
    start(state, state.hostId!, ctx);
    expect(state.turn!.deadline).toBeNull();
    ctx.advance(10 * 60_000);
    expect(tick(state, ctx)).toEqual([]);
    expect(tapOut(state, ids[0]!, ctx).ok).toBe(true);
    expect(state.phase).toBe("playing");
    const r = tapOut(state, ids[1]!, ctx);
    expect(r.ok && r.events.map((e) => e.type)).toContain("gameOver");
  });

  it("lets latecomers join the rotation", () => {
    const { state, ctx } = setup({ mode: "free" });
    start(state, state.hostId!, ctx);
    const late = join(state, { token: "late", name: "Late" }, ctx);
    expect(late.ok && late.player.role).toBe("player");
    expect(state.turnOrder).toHaveLength(3);
  });

  it("skips a disconnected current player after a grace period", () => {
    const { state, ctx } = setup({ mode: "free" });
    start(state, state.hostId!, ctx);
    const gone = current(state);
    disconnect(state, gone, ctx);
    ctx.advance(25_000);
    expect(tick(state, ctx).map((e) => e.type)).toContain("skipped");
    expect(current(state)).not.toBe(gone);
  });
});

describe("decide", () => {
  const answers = [{ id: "a1", text: "München", playerId: "p", tier: "npc" as const, points: 10, at: 0, confidence: 1 }];
  const base: Extract<JudgeOutput, { ok: true }> = { ok: true, validity: 0.9, obscurity: 2.4, exhausted: 0.02, duplicates: [] };

  it("applies thresholds and tiers", () => {
    expect(decide(base, THRESHOLDS, answers)).toMatchObject({ accepted: true, tier: "sidequest" });
    expect(decide({ ...base, validity: 0.5 }, THRESHOLDS, answers)).toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("only clears the board with an accepted answer", () => {
    expect(decide(base, THRESHOLDS, answers).boardCleared).toBe(false);
    expect(decide({ ...base, exhausted: 0.6 }, THRESHOLDS, answers).boardCleared).toBe(true);
    expect(decide({ ...base, exhausted: 0.6, validity: 0.2 }, THRESHOLDS, answers).boardCleared).toBe(false);
    expect(decide({ ...base, exhausted: 0.6, duplicates: [{ id: "a1", probability: 0.97 }] }, THRESHOLDS, answers).boardCleared).toBe(false);
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

  it("clamps settings", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { lives: 99, turnSeconds: -4, mode: "bogus" as never })).toMatchObject({
      lives: 5,
      turnSeconds: 5,
      mode: "timed",
    });
  });
});

describe("overrule guard", () => {
  it("refuses to overrule an exact repeat", () => {
    const { state, ctx } = setup({ mode: "timed" });
    start(state, state.hostId!, ctx);
    answer(state, ctx, "Paris");
    ctx.advance(1000);
    answer(state, ctx, "paris");
    const verdict = state.log[state.log.length - 1]!;
    expect(overrule(state, state.hostId!, verdict.id, ctx)).toMatchObject({ ok: false });
  });
});

describe("room lifetime", () => {
  it("schedules the wipe after the end screen and for empty rooms", () => {
    const { state, ctx, ids } = setup({ mode: "free" });
    start(state, state.hostId!, ctx);
    for (const id of ids) tapOut(state, id, ctx);
    expect(state.phase).toBe("over");
    expect(expiresAt(state)).toBe(state.endedAt! + OVER_TTL_MS);

    const lobby = setup({});
    for (const id of lobby.ids) disconnect(lobby.state, id, lobby.ctx);
    expect(nextAlarmAt(lobby.state)).toBe(lobby.ctx.now + EMPTY_ROOM_MS);
  });
});

describe("short-list hint", () => {
  it("clears when the topic changes and ignores stale checks", () => {
    const { state, ctx } = setup({});
    expect(setShortList(state, "European cities", true)).toBe(true);
    expect(toPublic(state).shortList).toBe(true);
    configure(state, state.hostId!, {}, "planets", ctx);
    expect(state.shortList).toBeNull();
    expect(setShortList(state, "European cities", true)).toBe(false);
    expect(setShortList(state, "planets", true)).toBe(true);
    configure(state, state.hostId!, {}, "planets", ctx);
    expect(state.shortList).toBe(true);
  });

  it("only asks Jev whether the board is cleared on short-list topics", () => {
    const { state, ctx } = setup({ mode: "free" });
    start(state, state.hostId!, ctx);
    const first = submit(state, current(state), "Paris", ctx);
    expect(first.ok && first.judge?.askExhausted).toBe(false);
    if (first.ok && first.judge) resolve(state, first.turnId, ACCEPT, ctx);
    state.shortList = true;
    ctx.advance(1000);
    const second = submit(state, current(state), "Lyon", ctx);
    expect(second.ok && second.judge?.askExhausted).toBe(true);
  });
});
