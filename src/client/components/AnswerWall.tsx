import { tierById } from "../../shared/constants.ts";
import type { AcceptedAnswer, PublicPlayer } from "../../shared/protocol.ts";

export function AnswerWall({ answers, players, highlightId }: { answers: AcceptedAnswer[]; players: PublicPlayer[]; highlightId: string | null }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return (
    <div className="answer-wall">
      <div className="answer-wall-head">
        <span>FOUND</span>
        <span className="answer-count">{answers.length}</span>
      </div>
      {answers.length === 0 ? (
        <p className="muted small">No answers yet. Be the first!</p>
      ) : (
        <ul className="chips">
          {[...answers].reverse().map((a) => {
            const tier = tierById(a.tier);
            const who = byId.get(a.playerId);
            return (
              <li
                key={a.id}
                className={`chip tier-${a.tier} ${a.id === highlightId ? "fresh" : ""}`}
                style={{ ["--tier" as string]: tier.color, ["--who" as string]: who?.color ?? "#fff" }}
                title={`${who?.name ?? "?"} · ${tier.name} · +${a.points}${a.typo ? " · typo forgiven" : ""}`}
              >
                <span className="chip-dot" aria-hidden="true" />
                <span className="chip-text">{a.text}</span>
                {a.typo && <span className="chip-typo" title="typo forgiven">~</span>}
                {a.tier !== "basic" && a.tier !== "solid" && <span className="chip-tier">{tier.name}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
