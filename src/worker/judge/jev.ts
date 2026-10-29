import {
  DUPLICATE_QUESTION,
  MAX_DUPLICATE_CANDIDATES,
  OBSCURITY_QUESTION,
  SHORT_TOPIC_QUESTION,
  SPELLING_QUESTION,
  TOPIC_QUESTION,
  TOPIC_STATE,
  VALIDITY_QUESTION,
} from "./questions.ts";
import type { Judge, JudgeInput, JudgeOutput, TopicCheck } from "./types.ts";

const DEFAULT_API_URL = "https://api.typesafe.ai";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

type NoulAnswer = { type: "noul"; noul: number };
type ScoreAnswer = { type: "score"; score: number; confidence: number };
type Answer = NoulAnswer | ScoreAnswer | { type: "choice" | "box" };

interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

function noul(answers: Record<string, Answer>, key: string): number | null {
  const a = answers[key];
  return a?.type === "noul" && typeof a.noul === "number" ? a.noul : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JevJudge implements Judge {
  readonly kind = "jev";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
  ) {
    this.model = model;
  }

  private async systemOne(state: unknown, questions: Record<string, unknown>, purpose: string): Promise<SystemOneResponse> {
    const body = JSON.stringify({ model: this.model, state, questions });
    let lastError = "unknown";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(`${this.apiUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.ok) {
          const json = await res.json<SystemOneResponse>();
          console.log(
            JSON.stringify({
              level: "info",
              message: "jev.call",
              purpose,
              model: json.model,
              questions: Object.keys(questions).length,
              ms: Date.now() - started,
              inputTokens: json.usage?.input_tokens,
            }),
          );
          return json;
        }
        const detail = (await res.text()).slice(0, 300);
        lastError = `HTTP ${res.status}: ${detail}`;
        if (!RETRYABLE.has(res.status)) break;
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 250 * 2 ** attempt);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** attempt);
      }
    }
    console.error(JSON.stringify({ level: "error", message: "jev.failed", purpose, error: lastError }));
    throw new Error(lastError);
  }

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const prior = input.prior.slice(-MAX_DUPLICATE_CANDIDATES);
    const questions: Record<string, unknown> = {
      valid: VALIDITY_QUESTION,
      spelled: SPELLING_QUESTION,
      obscurity: OBSCURITY_QUESTION,
    };
    // Speculative fan-out: one Noul per prior answer, all in the same request.
    prior.forEach((p, i) => {
      questions[`dup_${i}`] = { type: "noul", instructions: { previous_answer: p.text, question: DUPLICATE_QUESTION } };
    });
    try {
      const res = await this.systemOne({ topic: input.topic, submitted_answer: input.answer }, questions, "judge");
      const validity = noul(res.answers, "valid");
      const obscurity = res.answers.obscurity;
      if (validity === null) return { ok: false, error: "missing validity answer" };
      return {
        ok: true,
        validity,
        spelledCorrectly: noul(res.answers, "spelled") ?? 1,
        obscurity: obscurity?.type === "score" && typeof obscurity.score === "number" ? obscurity.score : 0,
        duplicates: prior.map((p, i) => ({ id: p.id, probability: noul(res.answers, `dup_${i}`) ?? 0 })),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async checkTopic(topic: string): Promise<TopicCheck | null> {
    try {
      const res = await this.systemOne(
        TOPIC_STATE,
        {
          listable: { type: "noul", instructions: { topic, question: TOPIC_QUESTION } },
          short: { type: "noul", instructions: { topic, question: SHORT_TOPIC_QUESTION } },
        },
        "topic",
      );
      const listable = noul(res.answers, "listable");
      const short = noul(res.answers, "short");
      return listable === null || short === null ? null : { listable, short };
    } catch {
      return null;
    }
  }
}
