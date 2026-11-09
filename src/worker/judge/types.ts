import type { JudgeKind } from "../../shared/protocol.ts";

export interface PriorAnswer {
  id: string;
  text: string;
}

export interface JudgeInput {
  /** The question being answered, e.g. "Name a Pixar movie". */
  question: string;
  answer: string;
  /** Answers already accepted for this question. */
  prior: PriorAnswer[];
}

export type JudgeOutput =
  | {
      ok: true;
      /** P(answer is a valid example of the topic, forgiving typos). */
      validity: number;
      /** Expected obscurity level, 0 (most common) .. TIERS.length-1. */
      obscurity: number;
      /** P(answer names the same thing as each prior answer). */
      duplicates: { id: string; probability: number }[];
    }
  | { ok: false; error: string };

export interface QuestionToVet {
  text: string;
  examples: string[];
}

export interface Vetting {
  /** P(the question is a category players can name examples of one at a time). */
  listable: number;
  /** P(it has fewer than ~20 answers in total). */
  short: number;
  /** Mean P(each of the writer's examples is a valid answer); null without examples. */
  examples: number | null;
}

export interface Judge {
  readonly kind: JudgeKind;
  readonly model: string | null;
  judge(input: JudgeInput): Promise<JudgeOutput>;
  /** Checks freshly written questions in one go. Null when the judge can't tell (mock judge, API failure). */
  vetQuestions(questions: QuestionToVet[]): Promise<Vetting[] | null>;
}

export interface Thresholds {
  accept: number;
  duplicate: number;
}
