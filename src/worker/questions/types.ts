import type { GeneratorKind } from "../../shared/protocol.ts";

export type TopicVerdict = "great" | "ok" | "narrow" | "unusable";

export interface QuestionCandidate {
  /** "Name a …" instruction shown to players. */
  text: string;
  topic: string;
  /** The writer's estimate of how many valid answers a regular person could name. */
  pool: number;
  /** 1 = easy … 3 = hard. Decks run easy → hard. */
  difficulty: number;
  /** Three answers the writer expects to be valid. Never shown to players; used to vet the question. */
  examples: string[];
  /** Jev's P(the question has fewer than ~20 answers). Null when it wasn't vetted. */
  short: number | null;
}

/** Everything the writer produced for one topic, cached in the room so edits only regenerate what changed. */
export interface TopicPool {
  topic: string;
  /** topicKey(topic) */
  key: string;
  verdict: TopicVerdict;
  reason: string | null;
  suggestion: string | null;
  candidates: QuestionCandidate[];
  /** Questions asked for so far, over all batches. */
  asked: number;
  batches: number;
  /** Set when the last batch failed outright. */
  error: string | null;
}

export interface GenerateRequest {
  topic: string;
  count: number;
  /** Questions not to repeat or closely rephrase (already in the pool, or played in an earlier game). */
  avoid: string[];
  /** The other topics in the same game, so questions don't overlap. */
  otherTopics: string[];
}

export interface GeneratedBatch {
  verdict: TopicVerdict;
  reason: string | null;
  suggestion: string | null;
  candidates: QuestionCandidate[];
}

export interface QuestionGenerator {
  readonly kind: GeneratorKind;
  readonly model: string | null;
  /** Throws when the writer is unavailable. */
  generate(req: GenerateRequest): Promise<GeneratedBatch>;
}
