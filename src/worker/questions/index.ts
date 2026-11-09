import { MockGenerator } from "./mock.ts";
import { OpenAIGenerator } from "./openai.ts";
import type { QuestionGenerator } from "./types.ts";

export const DEFAULT_WRITER_MODEL = "gpt-5.4-mini";
export const DEFAULT_WRITER_EFFORT = "low";

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
