import { TIERS } from "../../shared/constants.ts";
import { normalizeAnswer } from "../../shared/sanitize.ts";
import type { Judge, JudgeInput, JudgeOutput, TopicCheck } from "./types.ts";

/** A topic like "planets (8)" tells the mock judge exactly how many answers exist. */
const SIZED_TOPIC = /\((\d+)\)\s*$/;
const NOPE_WORDS = /\b(wrong|nope|fake|bad|asdf|qwerty|lol)\b/i;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/**
 * Offline stand-in for Jev so the game is playable without an API key.
 * Accepts anything word-like except obvious junk ("wrong", "nope", no vowels),
 * flags near-identical spellings as duplicates and ranks longer answers as rarer.
 * Topics ending in "(N)" are treated as having exactly N answers.
 */
export class MockJudge implements Judge {
  readonly kind = "mock";
  readonly model = null;

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 250));
    const key = normalizeAnswer(input.answer);
    const junk = NOPE_WORDS.test(input.answer) || !/[aeiouyäöüéèáíóú]/i.test(input.answer) || /^\d+$/.test(key);
    const letters = key.length;
    const size = input.topic.match(SIZED_TOPIC);
    return {
      ok: true,
      validity: junk ? 0.04 : 0.93,
      obscurity: Math.min(TIERS.length - 1, Math.max(0, (letters - 3) / 3)),
      exhausted: input.askExhausted && size && input.prior.length + 1 >= Number(size[1]) ? 0.95 : 0.02,
      duplicates: input.prior.map((p) => ({ id: p.id, probability: similarity(key, normalizeAnswer(p.text)) >= 0.8 ? 0.92 : 0.03 })),
    };
  }

  async checkTopic(topic: string): Promise<TopicCheck | null> {
    const size = topic.match(SIZED_TOPIC);
    if (!size) return null;
    return { listable: 0.95, short: Number(size[1]) < 20 ? 0.95 : 0.05 };
  }
}
