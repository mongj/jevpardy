import type { JudgeKind } from "../../shared/protocol.ts";

export interface PriorAnswer {
  id: string;
  text: string;
}

export interface JudgeInput {
  topic: string;
  answer: string;
  prior: PriorAnswer[];
  /** Ask whether this answer leaves nothing to name (short-list topics only). */
  askExhausted: boolean;
}

export type JudgeOutput =
  | {
      ok: true;
      /** P(answer is a valid example of the topic, forgiving typos). */
      validity: number;
      /** P(answer is spelled correctly). */
      spelledCorrectly: number;
      /** Expected obscurity level, 0 (most common) .. TIERS.length-1. */
      obscurity: number;
      /** P(nothing valid is left to name once this answer is counted). */
      exhausted: number;
      /** P(answer names the same thing as each prior answer). */
      duplicates: { id: string; probability: number }[];
    }
  | { ok: false; error: string };

export interface TopicCheck {
  /** P(topic is a category with several listable examples). */
  listable: number;
  /** P(topic has fewer than ~20 examples in total). */
  short: number;
}

export interface Judge {
  readonly kind: JudgeKind;
  readonly model: string | null;
  judge(input: JudgeInput): Promise<JudgeOutput>;
  /** Null when the judge can't tell (mock judge, API failure). */
  checkTopic(topic: string): Promise<TopicCheck | null>;
}

export interface Thresholds {
  accept: number;
  duplicate: number;
  /** At or above this P(exhausted) an accepted answer clears the board and ends the game. */
  exhausted: number;
  /** Below this P(spelled correctly) an accepted answer is flagged as a forgiven typo. */
  typo: number;
}
