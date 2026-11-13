import { useState } from "react";
import type { ClientMessage, PublicState, TopicReport } from "../../shared/protocol.ts";
import { Crown, Icon, JevBot, Sprite } from "../components/Pixel.tsx";
import { QRCode } from "../components/QRCode.tsx";
import { TopicEditor, TopicList, pickSuggestions, withDraft } from "../components/TopicChips.tsx";
import { Blink, Panel, PixelButton } from "../components/ui.tsx";
import { GameOptions, settingsSummary } from "./SettingsForm.tsx";

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

  if (deck.status === "idle") {
    // The host's next step is on the big button; everyone else just waits.
    return isHost ? null : (
      <p className="deck-line muted">
        <JevBot mood="idle" size={36} />
        <span>{state.topics.length === 0 ? "THE HOST IS PICKING TOPICS…" : "WAITING FOR THE HOST TO WRITE THE QUESTIONS…"}</span>
      </p>
    );
  }

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
                  <PixelButton tone="cyan" onClick={() => send({ type: "generate" })}>
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
    </div>
  );
}

/** The host's one big button: write the questions, then start. */
function HostAction({ state, draft, clearDraft, canStart, send }: { state: PublicState; draft: string; clearDraft: () => void; canStart: boolean; send: (m: ClientMessage) => void }) {
  const { deck } = state;
  // A topic typed but not yet added counts.
  const topics = withDraft(state.topics, draft);
  const write = () => {
    if (topics.length !== state.topics.length) {
      send({ type: "configure", settings: {}, topics });
      clearDraft();
    }
    send({ type: "generate" });
  };
  if (topics.length === 0) {
    return (
      <PixelButton big tone="green" disabled>
        ADD A TOPIC
      </PixelButton>
    );
  }
  if (deck.status === "generating") {
    return (
      <PixelButton big tone="green" disabled>
        WRITING QUESTIONS…
      </PixelButton>
    );
  }
  if (deck.status === "idle" || topics.length !== state.topics.length) {
    return (
      <PixelButton big tone="yellow" onClick={write}>
        <Icon name="right" /> WRITE QUESTIONS
      </PixelButton>
    );
  }
  if (deck.status === "failed") {
    return (
      <PixelButton big tone="yellow" onClick={write}>
        <Icon name="replay" /> TRY AGAIN
      </PixelButton>
    );
  }
  return (
    <PixelButton big tone="green" onClick={() => send({ type: "start" })} disabled={!canStart || deck.ready === 0}>
      <Icon name="right" /> START GAME
    </PixelButton>
  );
}

export function Lobby({ state, meId, send }: { state: PublicState; meId: string; send: (m: ClientMessage) => void }) {
  const isHost = state.hostId === meId;
  const me = state.players.find((p) => p.id === meId);
  const link = `${location.origin}/r/${state.code}`;
  const [copied, setCopied] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [suggestions] = useState(() => pickSuggestions());
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
            onChange={(topics) => send({ type: "configure", settings: {}, topics })}
            draft={topicDraft}
            onDraft={setTopicDraft}
            suggestions={suggestions}
            autoFocus={state.topics.length === 0}
          />
        ) : (
          state.topics.length > 0 && <TopicList topics={state.topics} />
        )}
        <DeckStatus state={state} isHost={isHost} send={send} />
        {isHost ? (
          <GameOptions settings={state.settings} onChange={(patch) => send({ type: "configure", settings: patch })} />
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
          <HostAction state={state} draft={topicDraft} clearDraft={() => setTopicDraft("")} canStart={online.length > 0} send={send} />
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
