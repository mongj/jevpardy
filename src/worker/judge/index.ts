import { JevJudge } from "./jev.ts";
import { MockJudge } from "./mock.ts";
import { DEFAULT_ACCEPT_THRESHOLD, DEFAULT_DUPLICATE_THRESHOLD, DEFAULT_EXHAUSTED_THRESHOLD } from "./questions.ts";
import type { Judge, Thresholds } from "./types.ts";

let warnedMock = false;

export function createJudge(env: Env): Judge {
  const key = env.TYPESAFE_API_KEY?.trim();
  if (env.JUDGE_MODE !== "mock" && key) return new JevJudge(key, env.JEV_MODEL || "jev-latest");
  if (!warnedMock) {
    warnedMock = true;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "judge.mock",
        detail:
          env.JUDGE_MODE === "mock"
            ? "JUDGE_MODE=mock: answers are judged by the offline mock judge."
            : "TYPESAFE_API_KEY is not set: answers are judged by the offline mock judge. Set it with `wrangler secret put TYPESAFE_API_KEY` (or .dev.vars locally).",
      }),
    );
  }
  return new MockJudge();
}

function threshold(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

export function thresholdsFromEnv(env: Env): Thresholds {
  return {
    accept: threshold(env.ACCEPT_THRESHOLD, DEFAULT_ACCEPT_THRESHOLD),
    duplicate: threshold(env.DUPLICATE_THRESHOLD, DEFAULT_DUPLICATE_THRESHOLD),
    exhausted: threshold(env.EXHAUSTED_THRESHOLD, DEFAULT_EXHAUSTED_THRESHOLD),
  };
}
