import { useState } from "react";
import type { ClientMessage, PublicState, TopicReport } from "../../shared/protocol.ts";
import { Crown, Icon, JevBot, Sprite } from "../components/Pixel.tsx";
import { QRCode } from "../components/QRCode.tsx";
import { TopicEditor, TopicList } from "../components/TopicChips.tsx";
import { Blink, Panel, PixelButton } from "../components/ui.tsx";
import { DeckSettings, TimedSettings, settingsSummary } from "./SettingsForm.tsx";

const STATUS_LABEL: Record<Exclude<TopicReport["status"], "ok">, string> = {
  thin: "THIN",
  unusable: "NO GOOD",
  error: "FAILED",
};

/** Where the secret deck is at. Everyone sees the count; only the host sees per-topic warnings. */
function DeckStatus({ state, isHost, send }: { state: PublicState; isHost: boolean; send: (m: ClientMessage) => void }) {
  const { deck } = state;
  const warnings = deck.reports.filter((r) => r.status !== "ok");
  const replace = (from: string, to: string | null) =>
    send({ type: "configure", settings: {}, topics: to === null ? state.topics.filter((t) => t !== from) : state.topics.map((t) => (t === from ? to : t)) });

  return (
    <div className={`deck-status ${deck.status}`}>
      {deck.status === "generating" ? (
        <p className="deck-line">
          <JevBot mood="thinking" size={36} className="float" />
          <Blink>WRITING MYSTERY QUESTIONS…</Blink>
        </p>
      ) : deck.status === "failed" ? (
        <p className="deck-line glow-pink">
          <JevBot mood="shocked" size={36} />
          <span>The question writer isn't answering.</span>
        </p>
      ) : (
        <p className="deck-line">
          <JevBot mood={deck.ready > 0 ? "happy" : "angry"} size={36} />
          <span className={deck.ready > 0 ? "glow-green" : "glow-pink"}>
            {deck.ready === 0
              ? "NO PLAYABLE QUESTIONS YET"
              : deck.ready < deck.wanted
                ? `${deck.ready} OF ${deck.wanted} MYSTERY QUESTIONS READY`
                : `${deck.ready} MYSTERY QUESTIONS READY`}
          </span>
        </p>
      )}
      {isHost && deck.status !== "generating" && warnings.length > 0 && (
        <ul className="deck-warnings" aria-label="Topic warnings">
          {warnings.map((w) => (
            <li key={w.topic} className={`deck-warning ${w.status}`}>
              <p>
                <Icon name="warn" font="body" /> <b>{w.topic}</b> <span className="tag">{STATUS_LABEL[w.status as keyof typeof STATUS_LABEL]}</span>
                <span className="muted"> · {w.got}/{w.wanted} questions</span>
              </p>
              {w.reason && <p className="small muted">{w.reason}</p>}
              <div className="row">
                {w.suggestion && state.topics.every((t) => t.toLowerCase() !== w.suggestion!.toLowerCase()) && (
                  <PixelButton tone="yellow" onClick={() => replace(w.topic, w.suggestion)}>
                    TRY "{w.suggestion}"
                  </PixelButton>
                )}
                {w.status === "error" && (
                  <PixelButton tone="cyan" onClick={() => send({ type: "regenerate" })}>
                    <Icon name="replay" /> RETRY
                  </PixelButton>
                )}
                {state.topics.length > 1 && (
                  <PixelButton tone="ghost" onClick={() => replace(w.topic, null)}>
                    REMOVE
                  </PixelButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isHost && deck.status === "failed" && warnings.every((w) => w.status !== "error") && (
        <PixelButton tone="cyan" onClick={() => send({ type: "regenerate" })}>
          <Icon name="replay" /> RETRY
        </PixelButton>
      )}
    </div>
  );
}

export function Lobby({ state, meId, send }: { state: PublicState; meId: string; send: (m: ClientMessage) => void }) {
  const isHost = state.hostId === meId;
  const me = state.players.find((p) => p.id === meId);
  const link = `${location.origin}/r/${state.code}`;
  const [copied, setCopied] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const contestants = state.players.filter((p) => p.role === "player");
  const online = contestants.filter((p) => p.connected);
  const spectators = state.players.filter((p) => p.role === "spectator");

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "JEVPARDY!", text: `Join my Jevpardy game (${state.topics.join(", ")}) — code ${state.code}`, url: link });
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

      <Panel title="TOPICS" accent="pink">
        {isHost ? (
          <TopicEditor
            topics={state.topics}
            onChange={(topics) => topics.length > 0 && send({ type: "configure", settings: {}, topics })}
            draft={topicDraft}
            onDraft={setTopicDraft}
          />
        ) : (
          <TopicList topics={state.topics} />
        )}
        <DeckStatus state={state} isHost={isHost} send={send} />
        {isHost ? (
          <div className="lobby-settings">
            <DeckSettings settings={state.settings} onChange={(patch) => send({ type: "configure", settings: patch })} />
            <TimedSettings settings={state.settings} onChange={(patch) => send({ type: "configure", settings: patch })} />
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
                  <Icon name="close" />
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
        {spectators.length > 0 && <p className="small muted">
            <Icon name="eye" font="body" /> {spectators.map((s) => s.name).join(", ")} watching
          </p>}
        {me?.role === "spectator" && (
          <PixelButton tone="cyan" onClick={() => send({ type: "becomePlayer" })}>
            JOIN AS PLAYER
          </PixelButton>
        )}
      </Panel>

      <div className="lobby-cta">
        {isHost ? (
          <PixelButton big tone="green" onClick={() => send({ type: "start" })} disabled={online.length === 0 || state.deck.status !== "ready" || state.deck.ready === 0}>
            {state.deck.status === "generating" ? (
              "WRITING QUESTIONS…"
            ) : (
              <>
                <Icon name="right" /> START GAME {online.length > 1 ? `(${online.length})` : "(SOLO)"}
              </>
            )}
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
