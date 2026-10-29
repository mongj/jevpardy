import { useEffect, useState } from "react";
import { MAX_TOPIC_LENGTH } from "../../shared/constants.ts";
import type { ClientMessage, PublicState } from "../../shared/protocol.ts";
import { Crown, JevBot, Sprite } from "../components/Pixel.tsx";
import { QRCode } from "../components/QRCode.tsx";
import { Blink, Panel, PixelButton } from "../components/ui.tsx";
import { ModePicker, TimedSettings, settingsSummary } from "./SettingsForm.tsx";

export function Lobby({ state, meId, send }: { state: PublicState; meId: string; send: (m: ClientMessage) => void }) {
  const isHost = state.hostId === meId;
  const me = state.players.find((p) => p.id === meId);
  const link = `${location.origin}/r/${state.code}`;
  const [copied, setCopied] = useState(false);
  const [topicDraft, setTopicDraft] = useState(state.topic);
  const contestants = state.players.filter((p) => p.role === "player");
  const online = contestants.filter((p) => p.connected);
  const spectators = state.players.filter((p) => p.role === "spectator");

  useEffect(() => setTopicDraft(state.topic), [state.topic]);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "JEVPARDY!", text: `Join my Jevpardy game: "${state.topic}" — code ${state.code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // user cancelled the share sheet
    }
  };

  return (
    <div className="lobby">
      <Panel accent="yellow" className="room-code-panel">
        <p className="label">ROOM CODE</p>
        <p className="room-code" aria-label={`Room code ${state.code.split("").join(" ")}`}>
          {state.code.split("").map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </p>
        <div className="share-row">
          <QRCode value={link} size={132} />
          <div className="share-actions">
            <p className="small muted break">{link.replace(/^https?:\/\//, "")}</p>
            <PixelButton tone="cyan" onClick={() => void share()}>
              {copied ? "COPIED!" : "SHARE LINK"}
            </PixelButton>
          </div>
        </div>
      </Panel>

      <Panel title="TOPIC" accent="pink">
        {isHost ? (
          <form
            className="topic-edit"
            onSubmit={(e) => {
              e.preventDefault();
              if (topicDraft.trim() !== state.topic) send({ type: "configure", settings: {}, topic: topicDraft });
            }}
          >
            <input className="name-input" value={topicDraft} maxLength={MAX_TOPIC_LENGTH} onChange={(e) => setTopicDraft(e.target.value)} onBlur={() => topicDraft.trim() !== state.topic && send({ type: "configure", settings: {}, topic: topicDraft })} />
          </form>
        ) : (
          <p className="topic-big">{state.topic}</p>
        )}
        {state.shortList && (
          <p className="short-list small" role="note">
            📏 SHORT LIST — Jev reckons this topic has under ~20 answers. When Jev thinks they've all been named, the game ends: BOARD CLEARED!
          </p>
        )}
        {isHost ? (
          <div className="lobby-settings">
            <ModePicker mode={state.settings.mode} onChange={(mode) => send({ type: "configure", settings: { mode } })} />
            {state.settings.mode === "timed" && <TimedSettings settings={state.settings} onChange={(patch) => send({ type: "configure", settings: patch })} />}
          </div>
        ) : (
          <p className="small muted">{settingsSummary(state.settings)}</p>
        )}
      </Panel>

      <Panel title={`PLAYERS ${contestants.length}`} accent="cyan">
        <ul className="lobby-players">
          {contestants.map((p, i) => (
            <li key={p.id} className={`lobby-player ${p.connected ? "" : "offline"} ${p.id === meId ? "me" : ""}`} style={{ ["--pc" as string]: p.color }}>
              <Sprite avatar={p.avatar} color={p.color} size={44} className="dance" style={{ animationDelay: `${i * 0.12}s` }} />
              <span className="lobby-name">
                {state.hostId === p.id && <Crown size={12} />} {p.name}
              </span>
              {isHost && p.id !== meId && (
                <button type="button" className="kick-btn" onClick={() => send({ type: "kick", playerId: p.id })} aria-label={`Kick ${p.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {contestants.length < 3 && (
            <li className="lobby-player empty">
              <span className="empty-slot">?</span>
              <span className="lobby-name muted">waiting…</span>
            </li>
          )}
        </ul>
        {spectators.length > 0 && <p className="small muted">👀 {spectators.map((s) => s.name).join(", ")} watching</p>}
        {me?.role === "spectator" && (
          <PixelButton tone="cyan" onClick={() => send({ type: "becomePlayer" })}>
            JOIN AS PLAYER
          </PixelButton>
        )}
      </Panel>

      <div className="lobby-cta">
        {isHost ? (
          <PixelButton big tone="green" onClick={() => send({ type: "start" })} disabled={online.length === 0}>
            ▶ START GAME {online.length > 1 ? `(${online.length})` : "(SOLO)"}
          </PixelButton>
        ) : (
          <div className="waiting">
            <JevBot mood="idle" size={48} className="float" />
            <Blink>WAITING FOR HOST TO START…</Blink>
          </div>
        )}
      </div>
    </div>
  );
}
