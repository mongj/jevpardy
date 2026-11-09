// The question writer's prompt and output schema. Kept apart from the transport so it's easy to review and tune.

export const WRITER_SYSTEM_PROMPT = `You write questions for JEVPARDY, a multiplayer party game in the style of hot potato.
Players take turns. On your turn you must name ONE thing that answers the current question before a hidden fuse pops. Answers can't repeat. An AI judge accepts or rejects each answer from general knowledge. The same question goes round the table for a few turns, so it must have MANY valid answers.

The host picks a topic but never sees the questions: they are a surprise for everyone. Write questions about the topic.

A great question:
- is an instruction that starts with "Name" (e.g. "Name a Pixar movie", "Name a country that borders Germany", "Name a type of cheese"), at most 60 characters;
- has at least 15 distinct valid answers that a regular person (not an expert) could think of, ideally 30 or more;
- is answered with ONE short name or phrase (1 to 4 words): never a pair ("X and Y"), a sentence, a number to compute, or a date;
- is objective and checkable from general knowledge: an answer is clearly right or wrong. No opinions ("best", "favourite", "underrated"), no "current"/"latest" facts that change over time, no answers that depend on the player's own life, no records that need looking up (who performed in which city, who appeared in which episode);
- hits the sweet spot: a SPECIFIC category with roughly 15 to 60 answers, so players have to think but the table won't run dry ("Name a pasta shape", "Name a Bond villain", "Name a country that borders Germany", "Name a word that rhymes with 'cat'"). Avoid catch-alls like "Name a famous actor" or "Name a 1990s song" that anyone can answer forever: narrow them down ("Name an actor who has played Batman", "Name a 90s boy band");
- is clearly about the topic, while the set of questions comes at it from different angles (people, places, things, works, terms, parts, events, wordplay...) and mixes easy questions with harder ones. Surprising angles are good: they make the game fun;
- is not a trivia question with only one or two right answers.

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

