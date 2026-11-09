import { MAX_ANSWER_LENGTH, MAX_NAME_LENGTH, MAX_TOPICS, MAX_TOPIC_LENGTH, MIN_TOPIC_LENGTH } from "./constants.ts";

// Control chars, zero-width/bidi overrides and other invisible formatting.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

function clean(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  return Array.from(input.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim())
    .slice(0, maxLength)
    .join("")
    .trim();
}

/** Returns a display-safe name or null if it has nothing usable left. */
export function sanitizeName(input: unknown): string | null {
  const name = clean(input, MAX_NAME_LENGTH).replace(/[^\p{L}\p{N}\p{Emoji_Presentation} _.'!?-]/gu, "");
  return /[\p{L}\p{N}\p{Emoji_Presentation}]/u.test(name) ? name.trim() : null;
}

export function sanitizeTopic(input: unknown): string | null {
  const topic = clean(input, MAX_TOPIC_LENGTH);
  return topic.length >= MIN_TOPIC_LENGTH ? topic : null;
}

/** Cleans a list of topics: drops empties and repeats, keeps at most MAX_TOPICS. Null if nothing usable is left. */
export function sanitizeTopics(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const topic = sanitizeTopic(raw);
    if (!topic) continue;
    const key = topicKey(topic);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
    if (out.length >= MAX_TOPICS) break;
  }
  return out.length > 0 ? out : null;
}

/** Case- and spacing-insensitive identity for a topic (its question pool is cached under this). */
export function topicKey(topic: string): string {
  return topic.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function sanitizeAnswer(input: unknown): string | null {
  const answer = clean(input, MAX_ANSWER_LENGTH);
  return /[\p{L}\p{N}]/u.test(answer) ? answer : null;
}

/**
 * Cheap canonical key for exact-duplicate detection before asking Jev:
 * case/diacritics/punctuation-insensitive, ignores a leading article.
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an|la|le|les|el|los|las|il|der|die|das) /, "")
    .replace(/ /g, "");
}
