import { normalizeAnswer } from "../../shared/sanitize.ts";
import { WRITER_SCHEMA, WRITER_SYSTEM_PROMPT, writerUserMessage } from "./prompt.ts";
import type { GenerateRequest, GeneratedBatch, QuestionCandidate, QuestionGenerator, TopicVerdict } from "./types.ts";

const API_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
/** Questions estimated below this many answers run dry too fast to be fun. */
export const MIN_ANSWER_POOL = 10;
const MAX_QUESTION_LENGTH = 90;

interface WriterOutput {
  topic_verdict: TopicVerdict;
  topic_reason: string;
  suggestion: string;
  questions: { question: string; answer_pool: number; difficulty: number; examples: string[] }[];
}

const VERDICTS: readonly TopicVerdict[] = ["great", "ok", "narrow", "unusable"];

function clip(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim().slice(0, max);
  return t.length > 0 ? t : null;
}

/** Validates the writer's JSON and drops questions that break the house rules. Exported for tests. */
export function parseWriterOutput(raw: unknown, req: GenerateRequest): GeneratedBatch {
  const out = raw as Partial<WriterOutput> | null;
  if (!out || typeof out !== "object" || !Array.isArray(out.questions)) throw new Error("writer returned no questions array");
  const verdict = VERDICTS.includes(out.topic_verdict as TopicVerdict) ? (out.topic_verdict as TopicVerdict) : "ok";
  const seen = new Set(req.avoid.map(normalizeAnswer));
  const candidates: QuestionCandidate[] = [];
  for (const q of out.questions) {
    const text = clip(q?.question, MAX_QUESTION_LENGTH);
    if (!text || !/^name\b/i.test(text)) continue;
    const pool = Number(q.answer_pool);
    if (!Number.isFinite(pool) || pool < MIN_ANSWER_POOL) continue;
    const key = normalizeAnswer(text);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      text: text.replace(/[.?!]+$/, ""),
      topic: req.topic,
      pool: Math.round(pool),
      difficulty: Math.min(3, Math.max(1, Math.round(Number(q.difficulty) || 2))),
      examples: (Array.isArray(q.examples) ? q.examples : []).map((e) => clip(e, 60)).filter((e): e is string => !!e).slice(0, 3),
      short: null,
    });
  }
  return {
    verdict: verdict === "unusable" ? "unusable" : candidates.length === 0 ? "unusable" : verdict,
    reason: clip(out.topic_reason, 200),
    suggestion: clip(out.suggestion, 60),
    candidates: verdict === "unusable" ? [] : candidates,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatJson {
  choices?: { message?: { content?: string; refusal?: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** One structured-output chat call with a retry. Returns the parsed JSON and token usage. */
async function structuredChat(
  apiKey: string,
  model: string,
  reasoningEffort: string,
  system: string,
  user: string,
  schemaName: string,
  schema: unknown,
): Promise<{ content: unknown; usage: ChatJson["usage"]; ms: number }> {
  const body = JSON.stringify({
    model,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
  });
  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const json = (await res.json()) as ChatJson;
        const message = json.choices?.[0]?.message;
        if (message?.refusal) throw new Error(`refused: ${message.refusal.slice(0, 200)}`);
        return { content: JSON.parse(message?.content ?? "null"), usage: json.usage, ms: Date.now() - started };
      }
      lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (!RETRYABLE.has(res.status)) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
  }
  throw new Error(lastError);
}

/** Writes questions with OpenAI structured outputs (one request per topic, run in parallel by the caller). */
export class OpenAIGenerator implements QuestionGenerator {
  readonly kind = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly reasoningEffort: string;

  constructor(apiKey: string, model: string, reasoningEffort: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
  }

  async generate(req: GenerateRequest): Promise<GeneratedBatch> {
    try {
      const { content, usage, ms } = await structuredChat(
        this.apiKey,
        this.model,
        this.reasoningEffort,
        WRITER_SYSTEM_PROMPT,
        writerUserMessage(req.topic, req.count, req.avoid, req.otherTopics),
        "jevpardy_questions",
        WRITER_SCHEMA,
      );
      const batch = parseWriterOutput(content, req);
      console.log(
        JSON.stringify({
          level: "info",
          message: "writer.call",
          model: this.model,
          topic: req.topic,
          asked: req.count,
          kept: batch.candidates.length,
          verdict: batch.verdict,
          ms,
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
        }),
      );
      return batch;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ level: "error", message: "writer.failed", topic: req.topic, error }));
      throw err;
    }
  }
}
