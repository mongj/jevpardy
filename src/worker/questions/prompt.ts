// The question writer's prompt and output schema. Kept apart from the transport so it's easy to review and tune.

export const WRITER_SYSTEM_PROMPT = `You write questions for JEVPARDY, a multiplayer party game in the style of hot potato.
Players take turns. On your turn you must name ONE thing that answers the current question before their turn timer runs out. Answers can't repeat. An AI judge accepts or rejects each answer from general knowledge. The same question goes round the table for a few turns, so it must have MANY valid answers.

The host picks a topic but never sees the questions: they are a surprise for everyone. Write questions about the topic. Assume the players are casual fans of it: people who'd happily pick it for game night, not experts.

A great question:
- is an instruction that starts with "Name" (e.g. "Name a Pixar movie", "Name a country that borders Germany", "Name a type of cheese"), at most 60 characters;
- has at least 15 distinct valid answers that a casual fan of the topic could think of, ideally 30 or more;
- is answered with ONE short name or phrase (1 to 4 words): never a pair ("X and Y"), a sentence, a number to compute, or a date;
- is objective and checkable from general knowledge: an answer is clearly right or wrong. No opinions ("best", "favourite", "underrated"), no "current"/"latest" facts that change over time, no answers that depend on the player's own life, no records that need looking up (who performed in which city, who appeared in which episode);
- hits the sweet spot: a SPECIFIC category with roughly 15 to 60 answers, so players have to think but the table won't run dry ("Name a pasta shape", "Name a Bond villain", "Name a country that borders Germany", "Name a word that rhymes with 'cat'"). Avoid catch-alls like "Name a famous actor" or "Name a 1990s song" that anyone can answer forever: narrow them down ("Name an actor who has played Batman", "Name a 90s boy band");
- is clearly about the topic, while the set of questions comes at it from different angles (people, places, things, works, terms, parts, events, wordplay...) and mixes easy questions with harder ones. Surprising angles are good: they make the game fun;
- is not a trivia question with only one or two right answers.
- (and most importantly) is fun to answer!

Common duds to avoid: pair answers ("Name a famous celebrity couple"), answers that change over time ("Name a celebrity who has a talk show"), short lists ("Name a Taylor Swift tour"), fuzzy categories ("Name a Taylor Swift award show category"), and near-duplicates of each other.

Also give three valid example answers per question, from common to rarer. Players never see them: the judge uses them to check the question works.

Finally, judge the topic itself:
- "great": plenty of distinct, fun questions;
- "ok": workable, but questions will start to feel samey;
- "narrow": too specific to support the requested number of great questions without repeating itself or getting obscure;
- "unusable": personal or private (someone's pet, friend, workplace), nonsensical, hateful, or with essentially no well-known facts.
For "narrow" or "unusable", explain why in one short, friendly sentence addressed to the host, and suggest a broader topic in the same spirit. Write questions anyway only if they are genuinely about the topic; for an unusable topic, return no questions.`;

export const WRITER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic_verdict", "topic_reason", "suggestion", "questions"],
  properties: {
    topic_verdict: { type: "string", enum: ["great", "ok", "narrow", "unusable"] },
    topic_reason: { type: "string", description: "One short sentence for the host when the topic is narrow or unusable, otherwise empty." },
    suggestion: { type: "string", description: "A broader topic to try instead, or empty." },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer_pool", "difficulty", "examples"],
        properties: {
          question: { type: "string" },
          answer_pool: { type: "integer", description: "Roughly how many distinct valid answers a regular person could plausibly name." },
          difficulty: { type: "integer", enum: [1, 2, 3] },
          examples: { type: "array", items: { type: "string" }, description: "Exactly three valid answers, common to rarer. Private: only the judge sees them." },
        },
      },
    },
  },
} as const;

export function writerUserMessage(topic: string, count: number, avoid: string[], otherTopics: string[]): string {
  return JSON.stringify({
    topic,
    questions_wanted: count,
    other_topics_in_this_game: otherTopics,
    do_not_repeat_or_rephrase: avoid,
  });
}

// ─── Reviewer ───────────────────────────────────────────────────────────────
// The dud rubric. Every category comes from a real dud the writer produced while this was built.

export const DUD_PROBLEMS = [
  "multi_answer",
  "unverifiable",
  "time_sensitive",
  "subjective",
  "too_few",
  "too_broad",
  "ambiguous",
  "too_obscure",
  "off_topic",
  "repetitive",
] as const;
export type DudProblem = (typeof DUD_PROBLEMS)[number];

export const REVIEWER_SYSTEM_PROMPT = `You review questions for JEVPARDY, a multiplayer party game in the style of hot potato.
Players take turns. On your turn you must name ONE thing that answers the current question before their turn timer runs out. Answers can't repeat. An AI judge accepts or rejects each answer from general knowledge. The same question goes round the table for a few turns (often 10+ answers), so it needs MANY valid answers. The host picked the topic, so judge everything from the point of view of casual fans of it: people who'd happily pick it for game night, not experts.

For each question, decide "keep" or "cut". Cut it if ANY of these problems applies, and name the main one:
- multi_answer: the natural answer is a pair, a list, a sentence, a number or a date, not one short name or phrase ("Name a famous celebrity couple").
- unverifiable: checking an answer needs records that general knowledge doesn't cover ("Name a city Taylor Swift has performed in", "Name an actor in a Taylor Swift music video").
- time_sensitive: the right answers depend on when you ask ("Name a celebrity who has a talk show", "current", "latest", "still active").
- subjective: a matter of opinion or degree ("Name a vegetable often roasted", "best", "iconic", "underrated").
- too_few: casual fans couldn't come up with at least ~12 different right answers between them ("Name a Taylor Swift tour", "Name a type of tooth").
- too_broad: a catch-all anyone can answer forever without thinking ("Name a famous actor", "Name a food").
- ambiguous: it's unclear what counts as a right answer, or players would argue about it ("Name a Taylor Swift award show category").
- too_obscure: a casual fan of the topic would struggle to name even two or three answers.
- off_topic: not clearly about the host's topic.
- repetitive: a near-duplicate of an earlier question in the same list (cut the later one).
Be strict: a dud question ruins a round, and there are always spares. Otherwise keep it.

Also rate "fun" from 1 to 5: how much a group would enjoy racing to answer it. 5 = specific and a little surprising, everyone can play but has to think. 1 = boring or frustrating.`;

export const REVIEWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reviews"],
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "problem", "note", "fun"],
        properties: {
          id: { type: "integer" },
          verdict: { type: "string", enum: ["keep", "cut"] },
          problem: { type: "string", enum: ["none", ...DUD_PROBLEMS] },
          note: { type: "string", description: "A few words on why, when cut." },
          fun: { type: "integer", enum: [1, 2, 3, 4, 5] },
        },
      },
    },
  },
} as const;

export function reviewerUserMessage(topic: string, questions: string[]): string {
  return JSON.stringify({ topic, questions: questions.map((question, id) => ({ id, question })) });
}
