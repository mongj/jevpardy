import {
  DUPLICATE_QUESTION,
  EXAMPLE_QUESTION,
  LISTABLE_QUESTION,
  MAX_DUPLICATE_CANDIDATES,
  OBSCURITY_QUESTION,
  SHORT_QUESTION,
  VALIDITY_QUESTION,
  VETTING_STATE,
} from "./questions.ts";
import type { Judge, JudgeInput, JudgeOutput, QuestionToVet, Vetting } from "./types.ts";

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
  private readonly apiKey: string;
  private readonly apiUrl: string;

  // Plain fields (no parameter properties) so scripts can import this under Node's type stripping.
  constructor(apiKey: string, model: string, apiUrl: string = DEFAULT_API_URL) {
    this.apiKey = apiKey;
    this.model = model;
    this.apiUrl = apiUrl;
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
          const json = (await res.json()) as SystemOneResponse;
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
      obscurity: OBSCURITY_QUESTION,
    };
    // Speculative fan-out: one Noul per prior answer, all in the same request.
    prior.forEach((p, i) => {
      questions[`dup_${i}`] = { type: "noul", instructions: { previous_answer: p.text, question: DUPLICATE_QUESTION } };
    });
    try {
      const res = await this.systemOne({ topic: input.question, submitted_answer: input.answer }, questions, "judge");
      const validity = noul(res.answers, "valid");
      const obscurity = res.answers.obscurity;
      if (validity === null) return { ok: false, error: "missing validity answer" };
      return {
        ok: true,
        validity,
        obscurity: obscurity?.type === "score" && typeof obscurity.score === "number" ? obscurity.score : 0,
        duplicates: prior.map((p, i) => ({ id: p.id, probability: noul(res.answers, `dup_${i}`) ?? 0 })),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async vetQuestions(list: QuestionToVet[]): Promise<Vetting[] | null> {
    if (list.length === 0) return [];
    // Fan-out: listable + short + one validity check per example, for every question, in one request.
    const questions: Record<string, unknown> = {};
    list.forEach((q, i) => {
      questions[`l_${i}`] = { type: "noul", instructions: { topic: q.text, question: LISTABLE_QUESTION } };
      questions[`s_${i}`] = { type: "noul", instructions: { topic: q.text, question: SHORT_QUESTION } };
      q.examples.forEach((example, j) => {
        questions[`e_${i}_${j}`] = { type: "noul", instructions: { topic: q.text, submitted_answer: example, question: EXAMPLE_QUESTION } };
      });
    });
    try {
      const res = await this.systemOne(VETTING_STATE, questions, "vet");
      return list.map((q, i) => {
        const examples = q.examples.map((_, j) => noul(res.answers, `e_${i}_${j}`)).filter((n): n is number => n !== null);
        return {
          listable: noul(res.answers, `l_${i}`) ?? 1,
          short: noul(res.answers, `s_${i}`) ?? 0,
          examples: examples.length > 0 ? examples.reduce((a, b) => a + b, 0) / examples.length : null,
        };
      });
    } catch {
      return null;
    }
  }
}
