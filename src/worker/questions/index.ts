import { MockGenerator } from "./mock.ts";
import { OpenAIGenerator, OpenAIReviewer } from "./openai.ts";
import type { QuestionGenerator, QuestionReviewer } from "./types.ts";

// Picked by scripts/bench-questions.ts; see the README for the numbers.
export const DEFAULT_WRITER_MODEL = "gpt-6-sol";
export const DEFAULT_WRITER_EFFORT = "low";
export const DEFAULT_REVIEWER_MODEL = "gpt-6-sol";
export const DEFAULT_REVIEWER_EFFORT = "low";

const NO_REVIEWER: QuestionReviewer = { model: null, review: async () => null };

/** Cuts dud questions with OpenAI; with the mock writer (or no key) there's nothing to review. */
export function createReviewer(env: Env): QuestionReviewer {
  const key = env.OPENAI_API_KEY?.trim();
  if (env.GENERATOR_MODE === "mock" || !key) return NO_REVIEWER;
  return new OpenAIReviewer(key, env.REVIEWER_MODEL || DEFAULT_REVIEWER_MODEL, env.REVIEWER_REASONING_EFFORT ?? DEFAULT_REVIEWER_EFFORT);
}

let warnedMock = false;

/** OpenAI when OPENAI_API_KEY is set (and GENERATOR_MODE isn't "mock"), otherwise the offline mock writer. */
export function createGenerator(env: Env): QuestionGenerator {
  const key = env.OPENAI_API_KEY?.trim();
  if (env.GENERATOR_MODE !== "mock" && key) {
    return new OpenAIGenerator(key, env.OPENAI_MODEL || DEFAULT_WRITER_MODEL, env.OPENAI_REASONING_EFFORT ?? DEFAULT_WRITER_EFFORT);
  }
  if (!warnedMock) {
    warnedMock = true;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "generator.mock",
        detail:
          env.GENERATOR_MODE === "mock"
            ? "GENERATOR_MODE=mock: questions come from the offline mock writer."
            : "OPENAI_API_KEY is not set: questions come from the offline mock writer. Set it with `wrangler secret put OPENAI_API_KEY` (or .dev.vars locally).",
      }),
    );
  }
  return new MockGenerator();
}
