import type { GenerateRequest, GeneratedBatch, QuestionGenerator } from "./types.ts";

/** "cats (2)" → the mock writer can only come up with 2 questions; "(0)" makes the topic unusable. */
const SIZED_TOPIC = /\s*\((\d+)\)\s*$/;

const ANGLES = [
  "Name something you'd associate with {t}",
  "Name a famous name linked to {t}",
  "Name a place linked to {t}",
  "Name a word you'd hear when talking about {t}",
  "Name a thing every {t} fan knows",
  "Name an object connected to {t}",
  "Name a well-known example of {t}",
  "Name a classic from the world of {t}",
];

/**
 * Offline stand-in for the OpenAI question writer so the game runs without an API key.
 * Writes templated questions; a topic ending in "(N)" yields exactly N questions in total.
 */
export class MockGenerator implements QuestionGenerator {
  readonly kind = "mock";
  readonly model = null;

  async generate(req: GenerateRequest): Promise<GeneratedBatch> {
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
    const size = req.topic.match(SIZED_TOPIC);
    const subject = req.topic.replace(SIZED_TOPIC, "");
    const limit = size ? Number(size[1]) : Infinity;
    if (limit === 0) {
      return { verdict: "unusable", reason: "The mock writer has nothing on that one.", suggestion: `${subject} in general`, candidates: [] };
    }
    const avoid = new Set(req.avoid.map((a) => a.toLowerCase()));
    const candidates = [];
    for (let i = 0; candidates.length < req.count && candidates.length + avoid.size < limit && i < req.count + avoid.size + ANGLES.length; i++) {
      const lap = Math.floor(i / ANGLES.length);
      const text = ANGLES[i % ANGLES.length]!.replace("{t}", subject) + (lap > 0 ? ` (part ${lap + 1})` : "");
      if (avoid.has(text.toLowerCase())) continue;
      candidates.push({ text, topic: req.topic, pool: 30, difficulty: 1 + (i % 3), examples: ["alpha", "bravo", "charlie"], short: null, fun: null });
    }
    const thin = Number.isFinite(limit);
    return {
      verdict: thin ? "narrow" : "great",
      reason: thin ? "The mock writer ran out of ideas." : null,
      suggestion: thin ? `${subject} in general` : null,
      candidates,
    };
  }
}
