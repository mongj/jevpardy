// Benchmarks question writers: every model writes questions for the same topics with the production prompt,
// the production filters and Jev vetting run on top, and a blind grader labels each surviving question against
// the dud rubric (src/worker/questions/prompt.ts).
//
//   node --env-file=.env scripts/bench-questions.ts [--models a,b,c] [--effort low] [--grader gpt-6.1-sol]
//        [--phase write|vet|grade|report|all] [--out bench-out] [--count 6] [--reviewer model]
//
// Results are cached per phase in --out, so grading or reporting can be re-run without re-writing.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { JevJudge } from "../src/worker/judge/jev.ts";
import { applyVetting } from "../src/worker/questions/deck.ts";
import { parseWriterOutput } from "../src/worker/questions/openai.ts";
import { REVIEWER_SCHEMA, REVIEWER_SYSTEM_PROMPT, WRITER_SCHEMA, WRITER_SYSTEM_PROMPT, reviewerUserMessage, writerUserMessage } from "../src/worker/questions/prompt.ts";
import type { GeneratedBatch } from "../src/worker/questions/types.ts";

const ALL_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-5-nano",
  "gpt-5-mini",
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6.1-terra",
  "gpt-6.1-sol",
];
/** Models without reasoning_effort. */
const NO_REASONING = new Set(["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]);
// Kept apart from the topics used as examples in the prompts, so nothing leaks.
const TOPICS = [
  "famous celebrities",
  "space",
  "football",
  "Harry Potter",
  "the human body",
  "Japan",
  "dinosaurs",
  "board games",
  "programming",
  "the ocean",
  "Ancient Rome",
  "Broadway musicals",
];
const TRAPS: Record<string, "narrow" | "unusable"> = { "left-handed Belgian dentists": "unusable", "my cat Fluffy": "unusable" };

const { values } = parseArgs({
  options: {
    models: { type: "string", default: ALL_MODELS.join(",") },
    effort: { type: "string", default: "low" },
    grader: { type: "string", default: "gpt-6.1-sol" },
    "grader-effort": { type: "string", default: "medium" },
    reviewer: { type: "string" },
    "reviewer-effort": { type: "string", default: "low" },
    phase: { type: "string", default: "all" },
    out: { type: "string", default: "bench-out" },
    count: { type: "string", default: "6" },
    concurrency: { type: "string", default: "8" },
  },
});

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const JEV_KEY = process.env.TYPESAFE_API_KEY ?? "";
const models = values.models!.split(",").map((m) => m.trim()).filter(Boolean);
const topics = [...TOPICS, ...Object.keys(TRAPS)];
const count = Number(values.count);
const out = values.out!;
mkdirSync(out, { recursive: true });

interface WriteResult {
  model: string;
  topic: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  batch: GeneratedBatch | null;
  error: string | null;
}
interface Review {
  question: string;
  verdict: "keep" | "cut";
  problem: string;
  note: string;
  fun: number;
}
interface Graded extends WriteResult {
  /** After the production filters + Jev vetting. */
  kept: string[];
  reviews: Review[];
}

function load<T>(name: string): T | null {
  const p = join(out, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
function save(name: string, data: unknown): void {
  writeFileSync(join(out, name), JSON.stringify(data, null, 1));
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

async function chat(model: string, effort: string | null, system: string, user: string, schema: unknown, name: string) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...(effort && !NO_REASONING.has(model) ? { reasoning_effort: effort } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e: unknown) => e as Error);
    if (res instanceof Error || (!res.ok && [429, 500, 502, 503, 504].includes(res.status) && attempt < 4)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      if (res instanceof Error && attempt >= 4) throw res;
      continue;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; error?: { message: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return { ms: Date.now() - started, content: JSON.parse(json.choices?.[0]?.message?.content ?? "null"), usage: json.usage };
  }
}

async function phaseWrite(): Promise<WriteResult[]> {
  const cached = load<WriteResult[]>("write.json") ?? [];
  const have = new Set(cached.map((r) => `${r.model}|${r.topic}`));
  const jobs = models.flatMap((model) => topics.map((topic) => ({ model, topic }))).filter((j) => !have.has(`${j.model}|${j.topic}`));
  console.log(`writing: ${jobs.length} calls (${cached.length} cached)`);
  let done = 0;
  const fresh = await pool(jobs, Number(values.concurrency), async ({ model, topic }): Promise<WriteResult> => {
    const req = { topic, count, avoid: [], otherTopics: [] };
    try {
      const r = await chat(model, values.effort!, WRITER_SYSTEM_PROMPT, writerUserMessage(topic, count, [], []), WRITER_SCHEMA, "jevpardy_questions");
      const batch = parseWriterOutput(r.content, req);
      process.stdout.write(`\r  ${++done}/${jobs.length}`);
      return { model, topic, ms: r.ms, inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0, batch, error: null };
    } catch (err) {
      process.stdout.write(`\r  ${++done}/${jobs.length}`);
      return { model, topic, ms: 0, inputTokens: 0, outputTokens: 0, batch: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
  console.log("");
  const all = [...cached, ...fresh];
  save("write.json", all);
  return all;
}

async function phaseVet(written: WriteResult[]): Promise<Graded[]> {
  const jev = new JevJudge(JEV_KEY, "jev-latest");
  const cached = load<Graded[]>("vet.json") ?? [];
  const have = new Map(cached.map((r) => [`${r.model}|${r.topic}`, r]));
  const out = await pool(written, 4, async (w): Promise<Graded> => {
    const prior = have.get(`${w.model}|${w.topic}`);
    if (prior) return prior;
    const candidates = w.batch?.candidates ?? [];
    const vetting = await jev.vetQuestions(candidates.map((c) => ({ text: c.text, examples: c.examples })));
    return { ...w, kept: applyVetting(candidates, vetting).map((c) => c.text), reviews: [] };
  });
  save("vet.json", out);
  return out;
}

async function review(model: string, effort: string, topic: string, questions: string[]): Promise<Review[]> {
  if (questions.length === 0) return [];
  const r = await chat(model, effort, REVIEWER_SYSTEM_PROMPT, reviewerUserMessage(topic, questions), REVIEWER_SCHEMA, "jevpardy_review");
  const reviews = (r.content?.reviews ?? []) as { id: number; verdict: "keep" | "cut"; problem: string; note: string; fun: number }[];
  return questions.map((question, id) => {
    const rv = reviews.find((x) => x.id === id);
    return rv ? { question, verdict: rv.verdict, problem: rv.problem, note: rv.note, fun: rv.fun } : { question, verdict: "keep", problem: "unreviewed", note: "", fun: 3 };
  });
}

async function phaseGrade(vetted: Graded[], file: string, model: string, effort: string): Promise<Graded[]> {
  const cached = load<Graded[]>(file) ?? [];
  const have = new Map(cached.filter((r) => r.reviews.length > 0 || r.kept.length === 0).map((r) => [`${r.model}|${r.topic}`, r]));
  let done = 0;
  const todo = vetted.filter((v) => !have.has(`${v.model}|${v.topic}`));
  console.log(`grading with ${model}: ${todo.length} calls (${have.size} cached)`);
  const graded = await pool(vetted, Number(values.concurrency), async (v): Promise<Graded> => {
    const prior = have.get(`${v.model}|${v.topic}`);
    if (prior) return prior;
    try {
      const reviews = await review(model, effort, v.topic, v.kept);
      process.stdout.write(`\r  ${++done}/${todo.length}`);
      return { ...v, reviews };
    } catch (err) {
      console.error(`\n  grade failed ${v.model} ${v.topic}: ${err instanceof Error ? err.message : err}`);
      return { ...v, reviews: [] };
    }
  });
  console.log("");
  save(file, graded);
  return graded;
}

function pct(n: number, d: number): string {
  return d === 0 ? "  –  " : `${((100 * n) / d).toFixed(0).padStart(3)}%`;
}
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

function report(graded: Graded[]): void {
  const rows = models.map((model) => {
    const mine = graded.filter((g) => g.model === model);
    const normal = mine.filter((g) => !(g.topic in TRAPS));
    const traps = mine.filter((g) => g.topic in TRAPS);
    const written = normal.reduce((n, g) => n + (g.batch?.candidates.length ?? 0), 0);
    const kept = normal.flatMap((g) => g.reviews);
    const duds = kept.filter((r) => r.verdict === "cut");
    const good = kept.filter((r) => r.verdict === "keep");
    const topicsFull = normal.filter((g) => g.reviews.filter((r) => r.verdict === "keep").length >= Math.ceil(count * 0.67)).length;
    const trapsCaught = traps.filter((g) => g.batch?.verdict === "unusable" || g.batch?.verdict === "narrow").length;
    const ms = normal.filter((g) => !g.error).map((g) => g.ms);
    const problems: Record<string, number> = {};
    for (const d of duds) problems[d.problem] = (problems[d.problem] ?? 0) + 1;
    return {
      model,
      errors: mine.filter((g) => g.error).length,
      written,
      vetted: kept.length,
      good: good.length,
      dudRate: kept.length ? duds.length / kept.length : 1,
      fun: good.length ? good.reduce((n, r) => n + r.fun, 0) / good.length : 0,
      topicsFull,
      trapsCaught,
      p50: quantile(ms, 0.5),
      p90: quantile(ms, 0.9),
      outTok: normal.length ? normal.reduce((n, g) => n + g.outputTokens, 0) / normal.length : 0,
      problems,
    };
  });
  rows.sort((a, b) => a.dudRate - b.dudRate || b.fun - a.fun);
  console.log(`\nwriter effort=${values.effort} · ${TOPICS.length} topics × ${count} questions + ${Object.keys(TRAPS).length} trap topics · grader ${values.grader}`);
  console.log("model           err  wrote vetted  good  DUDS  fun  full-topics traps  p50ms  p90ms  outTok  top problems");
  for (const r of rows) {
    const top = Object.entries(r.problems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}×${v}`)
      .join(" ");
    console.log(
      `${r.model.padEnd(15)} ${String(r.errors).padStart(3)} ${String(r.written).padStart(6)} ${String(r.vetted).padStart(6)} ${String(r.good).padStart(5)} ${pct(r.dudRate * r.vetted, r.vetted)} ${r.fun.toFixed(2).padStart(4)} ${String(r.topicsFull).padStart(6)}/${TOPICS.length} ${String(r.trapsCaught).padStart(4)}/${Object.keys(TRAPS).length} ${String(r.p50).padStart(6)} ${String(r.p90).padStart(6)} ${r.outTok.toFixed(0).padStart(7)}  ${top}`,
    );
  }
}

const phase = values.phase!;
let written = load<WriteResult[]>("write.json") ?? [];
if (phase === "write" || phase === "all") written = await phaseWrite();
let vetted = load<Graded[]>("vet.json") ?? [];
if (phase === "vet" || phase === "all") vetted = await phaseVet(written.filter((w) => models.includes(w.model)));
let graded = load<Graded[]>("grade.json") ?? [];
if (phase === "grade" || phase === "all") graded = await phaseGrade(vetted.filter((v) => models.includes(v.model)), "grade.json", values.grader!, values["grader-effort"]!);
if (values.reviewer) {
  // How well would a cheaper production reviewer agree with the grader?
  const byKey = new Map(graded.map((g) => [`${g.model}|${g.topic}`, g]));
  const reviewed = await phaseGrade(vetted.filter((v) => models.includes(v.model)), `review-${values.reviewer}.json`, values.reviewer, values["reviewer-effort"]!);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of reviewed) {
    const truth = byKey.get(`${r.model}|${r.topic}`)?.reviews ?? [];
    r.reviews.forEach((rv, i) => {
      const dud = truth[i]?.verdict === "cut";
      const cut = rv.verdict === "cut";
      if (dud && cut) tp++;
      else if (!dud && cut) fp++;
      else if (dud && !cut) fn++;
      else tn++;
    });
  }
  console.log(`\nreviewer ${values.reviewer} (${values["reviewer-effort"]}) vs grader: catches ${pct(tp, tp + fn)} of duds, cuts ${pct(fp, fp + tn)} of good questions (tp ${tp} fp ${fp} fn ${fn} tn ${tn})`);
}
if (graded.length > 0) report(graded.filter((g) => models.includes(g.model)));
