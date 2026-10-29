import { useState } from "react";
import { CLEAR_BONUS_POINTS, MAX_TOPIC_LENGTH, tierById } from "../../shared/constants.ts";
import type { ClientMessage, EndReason, PublicPlayer, PublicState } from "../../shared/protocol.ts";
import { AnswerWall } from "../components/AnswerWall.tsx";
import { Crown, Icon, JevBot, Sprite } from "../components/Pixel.tsx";
import { Blink, Panel, PixelButton } from "../components/ui.tsx";
import { useTicker } from "../lib/clock.ts";
import { navigate } from "../lib/router.ts";

function survival(p: PublicPlayer, state: PublicState): string {
  if (!state.startedAt) return "–";
  const end = p.outAt ?? state.endedAt ?? state.startedAt;
  const s = Math.max(0, Math.round((end - Math.max(state.startedAt, p.joinedAt)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function endLine(reason: EndReason | null, winner: PublicPlayer): string {
  switch (reason) {
    case "lastStanding":
      return "Last one standing";
    case "cleared":
      return "Board cleared";
    case "allOut":
    case "host":
    case null:
      return `${winner.points} points`;
    default: {
      const unknown: never = reason;
      return String(unknown);
    }
  }
}

function Selfdestruct({ at, offset }: { at: number; offset: number }) {
  const now = useTicker(1000) + offset;
  const s = Math.max(0, Math.round((at - now) / 1000));
  return (
    <span>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export function GameOver({ state, meId, offset, send }: { state: PublicState; meId: string; offset: number; send: (m: ClientMessage) => void }) {
  const isHost = state.hostId === meId;
  const [topic, setTopic] = useState(state.topic);
  const ranked = state.players.filter((p) => p.role === "player").sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const winner = state.players.find((p) => p.id === state.winnerId);
  const timed = state.settings.mode === "timed";

  return (
    <div className="game-over">
      {state.endReason === "cleared" ? (
        <>
          <h1 className="game-over-title cleared">BOARD CLEARED!</h1>
          <p className="cleared-note small muted">Jev reckons there's nothing left to name. Everyone still in got +{CLEAR_BONUS_POINTS}.</p>
        </>
      ) : (
        <h1 className="game-over-title">GAME OVER</h1>
      )}
      <div className="podium">
        {winner ? (
          <>
            <div className="winner-sprite">
              <Crown size={36} />
              <Sprite avatar={winner.avatar} color={winner.color} size={96} className="bob" />
            </div>
            <p className="winner-name" style={{ color: winner.color }}>
              {winner.id === meId ? "YOU WIN!" : `${winner.name} WINS!`}
            </p>
            <p className="small muted">
              {endLine(state.endReason, winner)} · {state.answers.length} answers found
            </p>
          </>
        ) : (
          <>
            <JevBot mood="sleepy" size={80} />
            <p className="winner-name">NOBODY SCORED</p>
          </>
        )}
      </div>

      {state.awards.length > 0 && (
        <ul className="awards">
          {state.awards.map((a) => {
            const p = state.players.find((x) => x.id === a.playerId);
            return (
              <li key={a.id} className="award" style={{ ["--pc" as string]: p?.color ?? "#fff" }}>
                <span className="award-title">{a.title}</span>
                <span className="award-who">
                  {p && <Sprite avatar={p.avatar} color={p.color} size={22} />} {p?.name}
                </span>
                <span className="award-blurb small muted">{a.blurb}</span>
              </li>
            );
          })}
        </ul>
      )}

      <Panel title="HIGH SCORES" accent="yellow">
        <table className="scores">
          <thead>
            <tr>
              <th>#</th>
              <th>NAME</th>
              <th>PTS</th>
              <th aria-label="accepted">
                <Icon name="check" />
              </th>
              <th aria-label="bounced">
                <Icon name="close" />
              </th>
              <th>{timed ? "ALIVE" : "TIME"}</th>
              <th className="hide-sm">BEST</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={p.id === meId ? "me" : ""} style={{ color: p.color }}>
                <td>{p.place}</td>
                <td className="score-name">
                  <Sprite avatar={p.avatar} color={p.color} size={18} dead={p.status === "eliminated"} /> {p.name}
                </td>
                <td>{p.points}</td>
                <td>{p.stats.accepted}</td>
                <td>{p.stats.rejected}</td>
                <td>{survival(p, state)}</td>
                <td className="hide-sm">{p.stats.bestAnswer ? <span style={{ color: tierById(p.stats.bestTier ?? "basic").color }}>{p.stats.bestAnswer}</span> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <AnswerWall answers={state.answers} players={state.players} highlightId={null} />

      <div className="over-actions">
        {isHost ? (
          <form
            className="panel accent-green rematch"
            onSubmit={(e) => {
              e.preventDefault();
              send({ type: "rematch", topic });
            }}
          >
            <label className="label" htmlFor="rematch-topic">
              NEXT TOPIC
            </label>
            <input id="rematch-topic" className="name-input" value={topic} maxLength={MAX_TOPIC_LENGTH} onChange={(e) => setTopic(e.target.value)} />
            <PixelButton big tone="green" type="submit">
              <Icon name="replay" /> PLAY AGAIN
            </PixelButton>
          </form>
        ) : (
          <Blink>WAITING FOR HOST…</Blink>
        )}
        <PixelButton tone="ghost" onClick={() => navigate("/")}>
          <Icon name="left" /> LEAVE
        </PixelButton>
        <p className="small muted">
          This room self-destructs in <Selfdestruct at={state.expiresAt} offset={offset} />
        </p>
      </div>
    </div>
  );
}
