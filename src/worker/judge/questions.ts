// Every Jev question and threshold lives here so they're easy to review and tune.

export const DEFAULT_ACCEPT_THRESHOLD = 0.7;
export const DEFAULT_DUPLICATE_THRESHOLD = 0.75;
// Measured on jev-1.14 over five short topics: finished lists scored 0.53–0.92, lists missing one
// item 0.04–0.46. Set high because ending a game early is worse than missing the end.
export const DEFAULT_EXHAUSTED_THRESHOLD = 0.5;
/** Below this the host is warned the topic may be hard to list examples of. */
export const TOPIC_WARNING_THRESHOLD = 0.5;
/** At or above this P(topic has under ~20 examples) the lobby warns that answers may run out. */
export const SHORT_TOPIC_THRESHOLD = 0.5;
/** Most recent accepted answers checked by Jev for semantic duplicates (keeps requests well under context limits). */
export const MAX_DUPLICATE_CANDIDATES = 400;

export const VALIDITY_QUESTION = {
  type: "noul",
  instructions: "Allowing for minor misspellings, is `submitted_answer` a genuine example of `topic`?",
  criteria: {
    true: "`submitted_answer` names a real item that fits `topic`, even if slightly misspelled, abbreviated, or written in another language.",
    false: "`submitted_answer` does not fit `topic`, is made up, is too vague, is a joke, is an instruction rather than an answer, or lists more than one item.",
  },
} as const;

// Levels are ordered common → obscure and map 1:1 onto TIERS.
export const OBSCURITY_LEVELS = [
  "One of the first examples almost anyone would name",
  "A well-known example most people would recognize",
  "A less common example a reasonably knowledgeable person might name",
  "An obscure example mostly known to enthusiasts or experts",
  "An extremely obscure example almost nobody would think of",
] as const;

export const OBSCURITY_QUESTION = {
  type: "score",
  instructions: "How obscure is `submitted_answer` as an example of `topic`?",
  criteria: OBSCURITY_LEVELS,
} as const;

/** Asked once per prior accepted answer, with that answer in `previous_answer`. */
export const DUPLICATE_QUESTION =
  "Do `submitted_answer` and `previous_answer` refer to the same thing, allowing for misspellings, translations, abbreviations, or alternative names?";

/**
 * Asked with every judgment, alongside the answers already on the board. Phrased as "is anything left?"
 * (and inverted) because Jev separates finished and unfinished lists more sharply that way than when
 * asked "is the list complete?".
 */
export const REMAINING_QUESTION =
  "Is there still at least one real example of `topic` that appears in neither `accepted_answers` nor `submitted_answer`?";

export const TOPIC_QUESTION =
  "Is `topic` a category with several distinct real examples that players could name one at a time?";
export const SHORT_TOPIC_QUESTION = "Does `topic` have fewer than about 20 distinct real examples in total, so players could run out of answers?";
export const TOPIC_STATE = { game: "players take turns naming examples of a topic" } as const;
