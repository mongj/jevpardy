// Pure deck logic: which topics need questions written, and how pools become a deck. No I/O, so it's unit-tested.

import { QUESTION_CAP_MAX, QUESTION_CAP_MIN, SHORT_QUESTION_CAP } from "../../shared/constants.ts";
import type { TopicReport } from "../../shared/protocol.ts";
import { normalizeAnswer, topicKey } from "../../shared/sanitize.ts";
import type { GenerateRequest, GeneratedBatch, QuestionCandidate, Review, TopicPool } from "./types.ts";

/** Spare questions asked for per topic, so duds can be cut and rematches have fresh material. */
export const EXTRA_PER_TOPIC = 3;
/** The writer is asked for this many times a topic's share (plus spares): the reviewer cuts a lot. */
export const OVERWRITE_FACTOR = 2;
/** Batches per topic before we stop asking (bounds the cost of a topic that keeps coming up short). */
export const MAX_BATCHES = 3;
/** Jev's P(short list) at or above which a question gets the small cap and sorts last. */
export const SHORT_THRESHOLD = 0.5;
/** Vetting: Jev must find the question listable and accept the writer's own examples. */
export const LISTABLE_THRESHOLD = 0.5;
export const EXAMPLES_THRESHOLD = 0.6;

export interface DeckQuestion {
  text: string;
  topic: string;
  cap: number;
  difficulty: number;
}

export interface Vetting {
  listable: number;
  short: number;
  /** Mean validity of the writer's examples; null when it gave none. */
  examples: number | null;
}

/** Splits `count` questions as evenly as possible; earlier topics take the remainder. */
export function topicShares(count: number, topics: number): number[] {
  if (topics <= 0) return [];
  const base = Math.floor(count / topics);
  return Array.from({ length: topics }, (_, i) => base + (i < count % topics ? 1 : 0));
}

/** How many answers a question takes before it's cleared: ~60% of its answer pool, small for short lists. */
export function questionCap(c: Pick<QuestionCandidate, "pool" | "short">): number {
  const fromPool = Math.round(c.pool * 0.6);
  const cap = Math.min(QUESTION_CAP_MAX, Math.max(QUESTION_CAP_MIN, fromPool));
  return c.short !== null && c.short >= SHORT_THRESHOLD ? Math.min(cap, SHORT_QUESTION_CAP) : cap;
}

function usable(pool: TopicPool | undefined, avoid: Set<string>): QuestionCandidate[] {
  if (!pool || pool.error || pool.verdict === "unusable") return [];
  const ranked = pool.candidates.filter((c) => !avoid.has(normalizeAnswer(c.text)));
  // Most fun first, short lists last; otherwise the writer's own order.
  return ranked
    .map((c, i) => ({ c, i, s: c.short !== null && c.short >= SHORT_THRESHOLD ? 1 : 0, f: c.fun ?? 3 }))
    .sort((a, b) => a.s - b.s || b.f - a.f || a.i - b.i)
    .map((x) => x.c);
}

export interface PlanInput {
  topics: string[];
  pools: TopicPool[];
  count: number;
  /** Questions already played in this room (never dealt again). */
  played: string[];
}

/** Topics whose pools are missing, failed, or too small for their share. */
export function topicsToGenerate({ topics, pools, count, played }: PlanInput): GenerateRequest[] {
  const avoid = new Set(played.map(normalizeAnswer));
  const byKey = new Map(pools.map((p) => [p.key, p]));
  // Topics that can't contribute hand their share to the others.
  const dead = topics.map((t) => {
    const pool = byKey.get(topicKey(t));
    return !!pool && (pool.verdict === "unusable" || (pool.batches >= MAX_BATCHES && usable(pool, avoid).length === 0));
  });
  const liveShares = topicShares(count, Math.max(1, dead.filter((d) => !d).length));
  let next = 0;
  const shares = topics.map((_, i) => (dead[i] ? 0 : (liveShares[next++] ?? 0)));
  const requests: GenerateRequest[] = [];
  topics.forEach((topic, i) => {
    const pool = byKey.get(topicKey(topic));
    const want = shares[i]! * OVERWRITE_FACTOR + EXTRA_PER_TOPIC;
    const otherTopics = topics.filter((_, j) => j !== i);
    if (!pool || (pool.error && pool.candidates.length === 0)) {
      requests.push({ topic, count: want, avoid: avoidTexts(pool, played), otherTopics });
      return;
    }
    if (pool.verdict === "unusable" || pool.batches >= MAX_BATCHES) return;
    const have = usable(pool, avoid).length;
    // Short of its share: ask again, unless the writer already called the topic narrow when asked for
    // at least this many (then it's just thin, and other topics fill in).
    if (have < shares[i]! && (pool.verdict !== "narrow" || pool.asked < want)) {
      requests.push({ topic, count: Math.max(EXTRA_PER_TOPIC, want - have), avoid: avoidTexts(pool, played), otherTopics });
    }
  });
  return requests;
}

function avoidTexts(pool: TopicPool | undefined, played: string[]): string[] {
  return [...new Set([...(pool?.candidates ?? []).map((c) => c.text), ...played])];
}

/** Applies Jev's vetting: drops questions Jev can't judge, records P(short). */
export function applyVetting(candidates: QuestionCandidate[], vetting: (Vetting | null)[] | null): QuestionCandidate[] {
  if (!vetting) return candidates;
  const out: QuestionCandidate[] = [];
  candidates.forEach((c, i) => {
    const v = vetting[i];
    if (!v) return void out.push(c);
    if (v.listable < LISTABLE_THRESHOLD) return;
    if (v.examples !== null && v.examples < EXAMPLES_THRESHOLD) return;
    out.push({ ...c, short: v.short });
  });
  return out;
}

/** Applies the reviewer: cuts duds, records fun. Without reviews (reviewer down), everything stays. */
export function applyReview(candidates: QuestionCandidate[], reviews: Review[] | null): QuestionCandidate[] {
  if (!reviews) return candidates;
  return candidates.flatMap((c, i) => {
    const r = reviews[i];
    if (!r) return [c];
    return r.verdict === "cut" ? [] : [{ ...c, fun: r.fun }];
  });
}

/** Folds a new batch into a topic's pool (or starts one). */
export function mergeBatch(previous: TopicPool | undefined, topic: string, asked: number, batch: GeneratedBatch): TopicPool {
  const seen = new Set((previous?.candidates ?? []).map((c) => normalizeAnswer(c.text)));
  const fresh = batch.candidates.filter((c) => {
    const k = normalizeAnswer(c.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const candidates = [...(previous?.candidates ?? []), ...fresh];
  return {
    topic,
    key: topicKey(topic),
    // A topic that already produced questions isn't unusable just because a later batch came back empty.
    verdict: batch.verdict === "unusable" && candidates.length > 0 ? "narrow" : batch.verdict,
    reason: batch.reason,
    suggestion: batch.suggestion,
    candidates,
    asked: (previous?.asked ?? 0) + asked,
    batches: (previous?.batches ?? 0) + 1,
    error: null,
  };
}

export function failedPool(previous: TopicPool | undefined, topic: string, error: string): TopicPool {
  return {
    topic,
    key: topicKey(topic),
    verdict: previous?.verdict ?? "ok",
    reason: previous?.reason ?? null,
    suggestion: previous?.suggestion ?? null,
    candidates: previous?.candidates ?? [],
    asked: previous?.asked ?? 0,
    batches: (previous?.batches ?? 0) + 1,
    error,
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface BuildInput extends PlanInput {
  rng: () => number;
}

/**
 * Picks the deck: each topic's share of its best questions, gaps filled by topics with spares,
 * then dealt round-robin across topics with each topic going easy → hard.
 */
export function buildDeck({ topics, pools, count, played, rng }: BuildInput): { questions: DeckQuestion[]; reports: TopicReport[] } {
  const shares = topicShares(count, topics.length);
  const byKey = new Map(pools.map((p) => [p.key, p]));
  const avoid = new Set(played.map(normalizeAnswer));
  const lists = topics.map((t) => usable(byKey.get(topicKey(t)), avoid));
  const take = lists.map((list, i) => Math.min(shares[i]!, list.length));
  let missing = count - take.reduce((a, b) => a + b, 0);
  while (missing > 0) {
    let gave = false;
    for (let i = 0; i < topics.length && missing > 0; i++) {
      if (take[i]! < lists[i]!.length) {
        take[i]! += 1;
        missing -= 1;
        gave = true;
      }
    }
    if (!gave) break;
  }
  const picked = lists.map((list, i) =>
    list
      .slice(0, take[i])
      .map((c, j) => ({ c, j }))
      .sort((a, b) => a.c.difficulty - b.c.difficulty || a.j - b.j)
      .map((x) => x.c),
  );
  const order = shuffle(
    topics.map((_, i) => i),
    rng,
  );
  const questions: DeckQuestion[] = [];
  for (let round = 0; questions.length < count; round++) {
    let dealt = false;
    for (const i of order) {
      const c = picked[i]![round];
      if (!c || questions.length >= count) continue;
      questions.push({ text: c.text, topic: topics[i]!, cap: questionCap(c), difficulty: c.difficulty });
      dealt = true;
    }
    if (!dealt) break;
  }

  const reports: TopicReport[] = topics.map((topic, i) => {
    const pool = byKey.get(topicKey(topic));
    const got = take[i]!;
    const wanted = shares[i]!;
    const base = { topic, wanted, got, suggestion: pool?.suggestion ?? null };
    if (pool?.error && got === 0) return { ...base, status: "error", reason: "The question writer didn't answer. Try again.", suggestion: null };
    if (!pool || pool.verdict === "unusable" || got === 0) {
      return { ...base, status: "unusable", reason: pool?.reason ?? "Couldn't write fair questions about this." };
    }
    if (pool.verdict === "narrow" || got < wanted) {
      return { ...base, status: "thin", reason: pool.reason ?? `Only ${got} good question${got === 1 ? "" : "s"} for this one; other topics fill in.` };
    }
    return { ...base, status: "ok", reason: null, suggestion: null };
  });
  return { questions, reports };
}
