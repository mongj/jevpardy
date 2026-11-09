import { MAX_TOPICS, MAX_TOPIC_LENGTH } from "../../shared/constants.ts";
import { sanitizeTopic, topicKey } from "../../shared/sanitize.ts";
import { Icon } from "./Pixel.tsx";

export const TOPIC_SUGGESTIONS = [
  "the 1990s",
  "Pokémon",
  "things in a kitchen",
  "Pixar movies",
  "programming",
  "dogs",
  "the Olympics",
  "Taylor Swift",
  "space",
  "board games",
  "famous painters",
  "cheese",
  "Marvel",
  "Africa",
  "music",
  "famous celebrities",
  "the human body",
  "fast food",
];

export function pickSuggestions(n = 6): string[] {
  return [...TOPIC_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, n);
}

/** Adds `topic` unless it's empty, a repeat, or the list is full. */
export function addTopic(topics: string[], raw: string): string[] {
  const topic = sanitizeTopic(raw);
  if (!topic || topics.length >= MAX_TOPICS || topics.some((t) => topicKey(t) === topicKey(topic))) return topics;
  return [...topics, topic];
}

/**
 * Chip editor for the game's topics: type and press Enter (or comma) to add, × to remove.
 * Text still in the box when the form is submitted is picked up by `withDraft`.
 */
export function TopicEditor({
  topics,
  onChange,
  suggestions,
  autoFocus,
  draft,
  onDraft,
}: {
  topics: string[];
  onChange: (topics: string[]) => void;
  suggestions?: string[];
  autoFocus?: boolean;
  draft: string;
  onDraft: (draft: string) => void;
}) {
  const full = topics.length >= MAX_TOPICS;
  const commit = () => {
    const next = addTopic(topics, draft);
    if (next !== topics) onChange(next);
    onDraft("");
  };
  return (
    <div className="topic-editor">
      {topics.length > 0 && (
        <ul className="topic-chips" aria-label="Topics">
          {topics.map((t) => (
            <li key={t} className="topic-chip">
              <span>{t}</span>
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(topics.filter((x) => x !== t))}>
                <Icon name="close" font="body" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="topic-add">
          <input
            className="topic-input"
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              // A comma finishes a topic, like a tag field.
              if (v.endsWith(",")) {
                const next = addTopic(topics, v.slice(0, -1));
                if (next !== topics) onChange(next);
                onDraft("");
              } else onDraft(v.slice(0, MAX_TOPIC_LENGTH));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                e.preventDefault();
                commit();
              } else if (e.key === "Backspace" && !draft && topics.length > 0) {
                onChange(topics.slice(0, -1));
              }
            }}
            onBlur={() => draft.trim() && commit()}
            placeholder={topics.length === 0 ? "the 1990s" : "add another topic…"}
            maxLength={MAX_TOPIC_LENGTH}
            autoFocus={autoFocus}
            enterKeyHint="done"
            aria-label="Add a topic"
          />
          <button type="button" className="topic-add-btn" onClick={commit} disabled={!sanitizeTopic(draft)} aria-label="Add topic">
            <Icon name="plus" />
          </button>
        </div>
      )}
      <p className="small muted topic-hint">
        {full ? `That's the max: ${MAX_TOPICS} topics.` : `Up to ${MAX_TOPICS} topics. The questions stay secret until they're played, even from you.`}
      </p>
      {suggestions && !full && (
        <div className="suggestions">
          {suggestions
            .filter((s) => !topics.some((t) => topicKey(t) === topicKey(s)))
            .map((s) => (
              <button key={s} type="button" className="suggestion" onClick={() => onChange(addTopic(topics, s))}>
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** The topics plus whatever is still typed in the box. */
export function withDraft(topics: string[], draft: string): string[] {
  return addTopic(topics, draft);
}

export function TopicList({ topics }: { topics: string[] }) {
  return (
    <ul className="topic-chips readonly" aria-label="Topics">
      {topics.map((t) => (
        <li key={t} className="topic-chip">
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
