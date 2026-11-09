import { tierById } from "../../shared/constants.ts";
import type { AcceptedAnswer, PlayedQuestion, PublicPlayer, QuestionEndReason } from "../../shared/protocol.ts";

function Chips({ answers, players, highlightId }: { answers: AcceptedAnswer[]; players: PublicPlayer[]; highlightId: string | null }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return (
    <ul className="chips">
      {[...answers].reverse().map((a) => {
        const tier = tierById(a.tier);
        const who = byId.get(a.playerId);
        return (
          <li
            key={a.id}
            className={`chip tier-${a.tier} ${a.id === highlightId ? "fresh" : ""}`}
            style={{ ["--tier" as string]: tier.color, ["--who" as string]: who?.color ?? "#fff" }}
            title={`${who?.name ?? "?"} · ${tier.name} · +${a.points}`}
          >
            <span className="chip-dot" aria-hidden="true" />
            <span className="chip-text">{a.text}</span>
            {a.tier !== "basic" && a.tier !== "solid" && <span className="chip-tier">{tier.name}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Answers to the current question. */
export function AnswerWall({ answers, cap, players, highlightId }: { answers: AcceptedAnswer[]; cap: number | null; players: PublicPlayer[]; highlightId: string | null }) {
  return (
    <div className="answer-wall">
      <div className="answer-wall-head">
        <span>FOUND</span>
        <span className="answer-count">
          {answers.length}
          {cap !== null && <span className="muted">/{cap}</span>}
        </span>
      </div>
      {answers.length === 0 ? <p className="muted small">No answers yet. Be the first!</p> : <Chips answers={answers} players={players} highlightId={highlightId} />}
    </div>
  );
}

export const END_LABEL: Record<QuestionEndReason, string> = {
  cleared: "CLEARED",
  rounds: "ROUNDS UP",
  stumped: "STUMPED",
};

const TRAIL_LENGTH = 5;

/** The last few questions played this game, newest first. */
export function QuestionTrail({ history, answers }: { history: PlayedQuestion[]; answers: AcceptedAnswer[] }) {
  const played = history.filter((h) => h.played).slice(-TRAIL_LENGTH);
  if (played.length === 0) return null;
  return (
    <div className="question-trail">
      <p className="label">EARLIER QUESTIONS</p>
      <ol>
        {[...played].reverse().map((h) => (
          <li key={h.index}>
            <span className="trail-text">{h.text}</span>
            <span className="small muted">
              {answers.filter((a) => a.question === h.index).length} found{h.endedBy ? ` · ${END_LABEL[h.endedBy]}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** End screen: every question with what was found, then the ones nobody reached. */
export function QuestionRecap({ history, answers, players }: { history: PlayedQuestion[]; answers: AcceptedAnswer[]; players: PublicPlayer[] }) {
  const played = history.filter((h) => h.played).sort((a, b) => a.index - b.index);
  const unplayed = history.filter((h) => !h.played).sort((a, b) => a.index - b.index);
  return (
    <div className="recap">
      {played.map((h) => {
        const found = answers.filter((a) => a.question === h.index);
        return (
          <section key={h.index} className="answer-wall recap-question">
            <div className="answer-wall-head">
              <span>
                Q{h.index + 1} · {h.topic.toUpperCase()}
              </span>
              <span className="answer-count">
                {found.length}
                {h.endedBy && <span className="muted"> · {END_LABEL[h.endedBy]}</span>}
              </span>
            </div>
            <p className="recap-text">{h.text}</p>
            {found.length === 0 ? <p className="muted small">Nobody got one!</p> : <Chips answers={found} players={players} highlightId={null} />}
          </section>
        );
      })}
      {unplayed.length > 0 && (
        <section className="answer-wall recap-unplayed">
          <div className="answer-wall-head">
            <span>NEVER REACHED</span>
            <span className="answer-count">{unplayed.length}</span>
          </div>
          <ol>
            {unplayed.map((h) => (
              <li key={h.index}>
                {h.text} <span className="small muted">· {h.topic}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
