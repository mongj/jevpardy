// Every Jev question and threshold lives here so they're easy to review and tune.
// `topic` holds the current question ("Name a Pixar movie"); measured on jev-1.14 that phrasing judges
// answers to a "Name a …" question as well as it judged bare topics.

export const DEFAULT_ACCEPT_THRESHOLD = 0.7;
export const DEFAULT_DUPLICATE_THRESHOLD = 0.75;
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

// Vetting freshly written questions, all in one request. Measured on jev-1.14: "short" is the useful
// signal (Santa's reindeer 0.78, tooth types 0.80, Taylor Swift tours 0.71 vs. pasta shapes 0.16,
// Taylor Swift songs 0.05); "listable" and the writer's own examples catch broken questions.
export const LISTABLE_QUESTION =
  "Is `topic` a category with several distinct real examples that players could name one at a time?";
export const SHORT_QUESTION = "Does `topic` have fewer than about 20 distinct real examples in total, so players could run out of answers?";
export const EXAMPLE_QUESTION = "Allowing for minor misspellings, is `submitted_answer` a genuine example of `topic`?";
export const VETTING_STATE = { game: "players take turns naming examples of a topic" } as const;
