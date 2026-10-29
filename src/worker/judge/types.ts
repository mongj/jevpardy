import type { JudgeKind } from "../../shared/protocol.ts";

export interface PriorAnswer {
  id: string;
  text: string;
}

export interface JudgeInput {
  topic: string;
  answer: string;
  prior: PriorAnswer[];
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
      /** P(answer names the same thing as each prior answer). */
      duplicates: { id: string; probability: number }[];
    }
  | { ok: false; error: string };

export interface Judge {
  readonly kind: JudgeKind;
  readonly model: string | null;
  judge(input: JudgeInput): Promise<JudgeOutput>;
  /** P(topic is a category with many listable examples); null if unknown. */
  checkTopic(topic: string): Promise<number | null>;
}

export interface Thresholds {
  accept: number;
  duplicate: number;
  /** Below this P(spelled correctly) an accepted answer is flagged as a forgiven typo. */
  typo: number;
}
