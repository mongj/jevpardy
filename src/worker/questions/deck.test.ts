import { describe, expect, it } from "vitest";
import { QUESTION_CAP_MAX, QUESTION_CAP_MIN, SHORT_QUESTION_CAP } from "../../shared/constants.ts";
import { EXTRA_PER_TOPIC, MAX_BATCHES, OVERWRITE_FACTOR, applyReview, applyVetting, buildDeck, failedPool, mergeBatch, questionCap, topicShares, topicsToGenerate } from "./deck.ts";
import { MockGenerator } from "./mock.ts";
import { parseReviewerOutput, parseWriterOutput } from "./openai.ts";
import type { GeneratedBatch, QuestionCandidate, TopicPool } from "./types.ts";

function q(text: string, topic: string, extra: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return { text, topic, pool: 40, difficulty: 2, examples: ["a", "b", "c"], short: null, fun: null, ...extra };
}

function pool(topic: string, texts: string[], extra: Partial<GeneratedBatch> = {}, asked = texts.length): TopicPool {
  return mergeBatch(undefined, topic, asked, { verdict: "great", reason: null, suggestion: null, candidates: texts.map((t) => q(t, topic)), ...extra });
}

const rng = () => 0;

describe("topicShares", () => {
  it("splits evenly with the remainder up front", () => {
    expect(topicShares(10, 3)).toEqual([4, 3, 3]);
    expect(topicShares(3, 5)).toEqual([1, 1, 1, 0, 0]);
    expect(topicShares(5, 0)).toEqual([]);
  });
});

describe("questionCap", () => {
  it("takes ~60% of the answer pool within bounds, small for short lists", () => {
    expect(questionCap({ pool: 25, short: null })).toBe(15);
    expect(questionCap({ pool: 200, short: 0.1 })).toBe(QUESTION_CAP_MAX);
    expect(questionCap({ pool: 3, short: null })).toBe(QUESTION_CAP_MIN);
    expect(questionCap({ pool: 40, short: 0.8 })).toBe(SHORT_QUESTION_CAP);
  });
});

describe("buildDeck", () => {
  it("deals round-robin across topics, each topic easy → hard", () => {
    const a = mergeBatch(undefined, "A", 3, {
      verdict: "great",
      reason: null,
      suggestion: null,
      candidates: [q("Name A hard", "A", { difficulty: 3 }), q("Name A easy", "A", { difficulty: 1 })],
    });
    const b = pool("B", ["Name B1", "Name B2"]);
    const { questions, reports } = buildDeck({ topics: ["A", "B"], pools: [a, b], count: 4, played: [], rng });
    expect(questions.map((x) => x.text)).toEqual(["Name B1", "Name A easy", "Name B2", "Name A hard"]);
    expect(reports.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("fills a thin topic's gap from the others and says so", () => {
    const thin = pool("Thin", ["Name T1"], { verdict: "narrow", reason: "Too niche.", suggestion: "Broader" });
    const big = pool("Big", ["Name B1", "Name B2", "Name B3", "Name B4", "Name B5"]);
    const { questions, reports } = buildDeck({ topics: ["Thin", "Big"], pools: [thin, big], count: 4, played: [], rng });
    expect(questions).toHaveLength(4);
    expect(questions.filter((x) => x.topic === "Big")).toHaveLength(3);
    expect(reports[0]).toMatchObject({ status: "thin", wanted: 2, got: 1, reason: "Too niche.", suggestion: "Broader" });
    expect(reports[1]).toMatchObject({ status: "ok", got: 3, suggestion: null });
  });

  it("drops unusable topics and reports writer errors", () => {
    const nope = pool("My cat", [], { verdict: "unusable", reason: "Too personal.", suggestion: "Cats" });
    const down = failedPool(undefined, "Down", "HTTP 503");
    const ok = pool("Ok", ["Name O1", "Name O2", "Name O3"]);
    const { questions, reports } = buildDeck({ topics: ["My cat", "Down", "Ok"], pools: [nope, down, ok], count: 3, played: [], rng });
    expect(questions.map((x) => x.topic)).toEqual(["Ok", "Ok", "Ok"]);
    expect(reports.map((r) => r.status)).toEqual(["unusable", "error", "ok"]);
    expect(reports[0]).toMatchObject({ reason: "Too personal.", suggestion: "Cats" });
  });

  it("returns a short deck rather than padding it", () => {
    const { questions } = buildDeck({ topics: ["A"], pools: [pool("A", ["Name A1", "Name A2"])], count: 5, played: [], rng });
    expect(questions).toHaveLength(2);
  });

  it("skips questions already played in this room, and puts short lists last", () => {
    const a = mergeBatch(undefined, "A", 3, {
      verdict: "great",
      reason: null,
      suggestion: null,
      candidates: [q("Name A short", "A", { short: 0.9 }), q("Name A1", "A"), q("Name A2", "A")],
    });
    const { questions } = buildDeck({ topics: ["A"], pools: [a], count: 2, played: ["name a1"], rng });
    expect(questions.map((x) => x.text)).toEqual(["Name A2", "Name A short"]);
    expect(questions[1]!.cap).toBe(SHORT_QUESTION_CAP);
  });
});

describe("topicsToGenerate", () => {
  it("asks for missing topics with spares, telling the writer about the others", () => {
    const reqs = topicsToGenerate({ topics: ["A", "B"], pools: [pool("A", ["Name A1", "Name A2", "Name A3"])], count: 4, played: [] });
    expect(reqs).toEqual([{ topic: "B", count: 2 * OVERWRITE_FACTOR + EXTRA_PER_TOPIC, avoid: [], otherTopics: ["A"] }]);
  });

  it("tops up a pool that could have done better, but not a genuinely thin one", () => {
    // Asked for 5, kept 1 after vetting: ask again, avoiding what we have.
    const vetted = pool("A", ["Name A1"], {}, 5);
    expect(topicsToGenerate({ topics: ["A"], pools: [vetted], count: 2, played: [] })).toMatchObject([{ topic: "A", avoid: ["Name A1"] }]);
    // The count went up past what was ever asked for: ask again.
    const small = pool("A", ["Name A1", "Name A2"], {}, 2);
    expect(topicsToGenerate({ topics: ["A"], pools: [small], count: 4, played: [] })).toHaveLength(1);
    // A topic the writer called narrow when asked for enough is just thin.
    const narrow = pool("A", ["Name A1"], { verdict: "narrow" }, 20);
    expect(topicsToGenerate({ topics: ["A"], pools: [narrow], count: 2, played: [] })).toEqual([]);
    // Unusable topics and exhausted batch budgets are left alone.
    const nope = pool("A", [], { verdict: "unusable" });
    expect(topicsToGenerate({ topics: ["A"], pools: [nope], count: 2, played: [] })).toEqual([]);
    const tired = { ...vetted, batches: MAX_BATCHES };
    expect(topicsToGenerate({ topics: ["A"], pools: [tired], count: 2, played: [] })).toEqual([]);
  });

  it("hands an unusable topic's share to the others", () => {
    const nope = pool("Nope", [], { verdict: "unusable" });
    const a = pool("A", ["Name A1", "Name A2", "Name A3", "Name A4", "Name A5"], {}, 5);
    expect(topicsToGenerate({ topics: ["Nope", "A"], pools: [nope, a], count: 8, played: [] })).toMatchObject([{ topic: "A", count: 8 * OVERWRITE_FACTOR + EXTRA_PER_TOPIC - 5 }]);
  });

  it("retries a failed topic and passes played questions to avoid", () => {
    const down = failedPool(undefined, "A", "HTTP 500");
    expect(topicsToGenerate({ topics: ["A"], pools: [down], count: 2, played: ["Name X"] })).toMatchObject([{ topic: "A", avoid: ["Name X"] }]);
  });
});

describe("vetting and merging", () => {
  it("drops questions Jev can't judge and records P(short)", () => {
    const cands = [q("Name ok", "A"), q("Name unlistable", "A"), q("Name bad examples", "A"), q("Name unvetted", "A")];
    const out = applyVetting(cands, [
      { listable: 0.9, short: 0.7, examples: 0.95 },
      { listable: 0.2, short: 0.1, examples: 0.95 },
      { listable: 0.9, short: 0.1, examples: 0.3 },
      null,
    ]);
    expect(out.map((c) => [c.text, c.short])).toEqual([
      ["Name ok", 0.7],
      ["Name unvetted", null],
    ]);
    expect(applyVetting(cands, null)).toBe(cands);
  });

  it("cuts what the reviewer cuts, records fun, and keeps everything if the reviewer is down", () => {
    const cands = [q("Name a dud", "A"), q("Name a gem", "A"), q("Name unreviewed", "A")];
    const out = applyReview(cands, [
      { verdict: "cut", problem: "too_few", note: "", fun: 2 },
      { verdict: "keep", problem: "none", note: "", fun: 5 },
    ]);
    expect(out.map((c) => [c.text, c.fun])).toEqual([
      ["Name a gem", 5],
      ["Name unreviewed", null],
    ]);
    expect(applyReview(cands, null)).toBe(cands);
  });

  it("deals the most fun questions first", () => {
    const a = mergeBatch(undefined, "A", 3, {
      verdict: "great",
      reason: null,
      suggestion: null,
      candidates: [q("Name meh", "A", { fun: 3 }), q("Name great", "A", { fun: 5 }), q("Name ok", "A", { fun: 4 })],
    });
    expect(buildDeck({ topics: ["A"], pools: [a], count: 2, played: [], rng }).questions.map((x) => x.text)).toEqual(["Name great", "Name ok"]);
  });

  it("merges batches without duplicates and keeps a productive topic usable", () => {
    const first = pool("A", ["Name A1"]);
    const second = mergeBatch(first, "A", 3, { verdict: "unusable", reason: null, suggestion: null, candidates: [q("name a1", "A"), q("Name A2", "A")] });
    expect(second.candidates.map((c) => c.text)).toEqual(["Name A1", "Name A2"]);
    expect(second).toMatchObject({ verdict: "narrow", asked: 4, batches: 2 });
  });
});

describe("parseWriterOutput", () => {
  const req = { topic: "Pixar", count: 3, avoid: ["Name a Pixar movie"], otherTopics: [] };

  it("keeps good questions and drops ones that break the rules", () => {
    const batch = parseWriterOutput(
      {
        topic_verdict: "great",
        topic_reason: "",
        suggestion: "",
        questions: [
          { question: "Name a Pixar character.", answer_pool: 60, difficulty: 1, examples: ["Woody", "Buzz", "Remy"] },
          { question: "Name a Pixar movie", answer_pool: 27, difficulty: 1, examples: [] },
          { question: "Which Pixar film won first?", answer_pool: 1, difficulty: 3, examples: [] },
          { question: "Name a Pixar director", answer_pool: 4, difficulty: 3, examples: [] },
          { question: "Name a Pixar character", answer_pool: 60, difficulty: 7, examples: [] },
        ],
      },
      req,
    );
    expect(batch.candidates.map((c) => [c.text, c.difficulty])).toEqual([["Name a Pixar character", 1]]);
    expect(batch).toMatchObject({ verdict: "great", reason: null, suggestion: null });
  });

  it("treats an unusable topic as having no questions", () => {
    const batch = parseWriterOutput(
      { topic_verdict: "unusable", topic_reason: "That's private.", suggestion: "Cats", questions: [{ question: "Name a thing Fluffy likes", answer_pool: 20, difficulty: 1, examples: [] }] },
      req,
    );
    expect(batch).toMatchObject({ verdict: "unusable", reason: "That's private.", suggestion: "Cats", candidates: [] });
    expect(() => parseWriterOutput({ nope: true }, req)).toThrow();
  });
});

describe("parseReviewerOutput", () => {
  it("matches reviews by id and keeps anything skipped or malformed", () => {
    const out = parseReviewerOutput(
      {
        reviews: [
          { id: 1, verdict: "cut", problem: "subjective", note: "opinion", fun: 2 },
          { id: 0, verdict: "keep", problem: "none", note: "", fun: 9 },
          { id: 2, verdict: "maybe", problem: "none", note: "", fun: 3 },
        ],
      },
      4,
    );
    expect(out.map((r) => [r.verdict, r.problem, r.fun])).toEqual([
      ["keep", "none", 5],
      ["cut", "subjective", 2],
      ["keep", "unreviewed", 3],
      ["keep", "unreviewed", 3],
    ]);
    expect(() => parseReviewerOutput({}, 1)).toThrow();
  });
});

describe("MockGenerator", () => {
  it("honours the (N) sizing convention", async () => {
    const gen = new MockGenerator();
    expect((await gen.generate({ topic: "cats (0)", count: 4, avoid: [], otherTopics: [] })).verdict).toBe("unusable");
    const two = await gen.generate({ topic: "cats (2)", count: 4, avoid: [], otherTopics: [] });
    expect(two).toMatchObject({ verdict: "narrow" });
    expect(two.candidates).toHaveLength(2);
    expect((await gen.generate({ topic: "dogs", count: 12, avoid: [], otherTopics: [] })).candidates).toHaveLength(12);
  });
});
