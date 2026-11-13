import { type ReactNode, useEffect, useRef, useState } from "react";
import { MAX_ANSWER_LENGTH, ROUNDS_PER_QUESTION } from "../../shared/constants.ts";
import { EMOTES, type ClientMessage, type PublicState, type Verdict } from "../../shared/protocol.ts";
import { AnswerWall, QuestionTrail } from "../components/AnswerWall.tsx";
import { Countdown, Fuse } from "../components/Countdown.tsx";
import { EMOTE_LABELS, EmoteArt, Icon, JevBot, type JevMood, Sprite } from "../components/Pixel.tsx";
import { PlayerRail } from "../components/PlayerRail.tsx";
import { Blink, PixelButton } from "../components/ui.tsx";

interface GameProps {
  state: PublicState;
  meId: string;
  offset: number;
  typing: Record<string, string>;
  send: (m: ClientMessage) => void;
  mood: JevMood;
  freshAnswerId: string | null;
  inputShakeKey: number;
}

function verdictLine(v: Verdict, name: string): ReactNode {
  const said = `${name}: "${v.text}" `;
  if (v.accepted) return <>{said}<Icon name="check" font="body" /></>;
  switch (v.reason) {
    case "duplicate":
      return <>{said}<Icon name="close" font="body" /> repeat{v.duplicateOf ? ` of "${v.duplicateOf}"` : ""}</>;
    case "invalid":
      return <>{said}<Icon name="close" font="body" /> doesn't fit</>;
    case "judge_error":
      return <>{said}<Icon name="warn" font="body" /> Jev glitched</>;
    case null:
      return said;
    default: {
      const unknown: never = v.reason;
      return String(unknown);
    }
  }
}

/** The current question, its topic and how much life it has left. */
function QuestionCard({ state }: { state: PublicState }) {
  const q = state.question;
  if (!q) return null;
  const total = state.deck.ready;
  const final = q.index === total - 1;
  const roundsLeft = Math.max(1, Math.ceil((q.maxTurns - q.turns) / Math.max(1, q.maxTurns / ROUNDS_PER_QUESTION)));
  return (
    <div className="question-card" key={q.index}>
      <div className="question-meta">
        <span className="label">
          Q{q.index + 1}/{total}
          {final && <span className="tag final">FINAL</span>}
        </span>
        <span className="question-topic">{q.topic}</span>
      </div>
      <p className="question-text">{q.text}</p>
      <div className="question-meta small muted">
        <span>
          FOUND <b className="glow-cyan">{q.answered}</b>/{q.cap}
        </span>
        <span>
          {roundsLeft} {roundsLeft === 1 ? "ROUND" : "ROUNDS"} LEFT
          {q.stumped.length > 0 && <span className="glow-pink"> · STUMPED {q.stumped.length}</span>}
        </span>
      </div>
    </div>
  );
}

export function Game({ state, meId, offset, typing, send, mood, freshAnswerId, inputShakeKey }: GameProps) {
  const me = state.players.find((p) => p.id === meId);
  const turn = state.turn;
  const current = state.players.find((p) => p.id === turn?.playerId);
  const myTurn = !!turn && turn.playerId === meId;
  const isHost = state.hostId === meId;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const canSend = myTurn && !turn?.judging;

  useEffect(() => {
    if (!canSend) return;
    inputRef.current?.focus();
    // Anything typed ahead while waiting becomes the live preview once the turn starts.
    if (draft) send({ type: "typing", text: draft });
  }, [canSend, turn?.id]);

  const onType = (value: string) => {
    const next = value.slice(0, MAX_ANSWER_LENGTH);
    setDraft(next);
    const now = Date.now();
    // Typing ahead stays private until it's your turn.
    if (canSend && now - lastTyping.current > 120) {
      lastTyping.current = now;
      send({ type: "typing", text: next });
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    send({ type: "submit", text });
    setDraft("");
  };

  const lastVerdict = state.log[state.log.length - 1];
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";
  const liveText = turn?.judging?.text ?? (turn ? typing[turn.playerId] : undefined);
  const out = me?.status === "eliminated";
  const question = state.question;
  const questionAnswers = question ? state.answers.filter((a) => a.question === question.index) : [];
  const stumpedMe = !!question && question.stumped.includes(meId);

  return (
    <div className={`game ${isHost ? "with-host-bar" : ""}`}>
      <QuestionCard state={state} />

      <section className={`stage ${myTurn ? "my-turn" : ""}`} style={{ ["--pc" as string]: current?.color ?? "#fff" }}>
        {current && turn ? (
          <>
            <div className="stage-who">
              <Sprite avatar={current.avatar} color={current.color} size={56} className="bob" />
              <div>
                <p className="stage-name">{myTurn ? <Blink>YOUR TURN!</Blink> : `${current.name}'S TURN`}</p>
                <p className="small muted">ATTEMPT {turn.attempts + (turn.judging ? 0 : 1)}</p>
              </div>
            </div>
            {state.settings.mysteryFuse ? (
              <Fuse turn={turn} offset={offset} averageMs={state.settings.turnSeconds * 1000} />
            ) : (
              <Countdown turn={turn} offset={offset} audible={myTurn} />
            )}
            <div className="jev-row">
              <JevBot mood={turn.judging ? "thinking" : mood} size={52} />
              <div className={`bubble ${turn.judging ? "judging" : ""}`}>
                {turn.judging ? (
                  <>
                    <span className="muted small">JEV IS JUDGING…</span>
                    <span className="bubble-text">"{turn.judging.text}"</span>
                  </>
                ) : liveText && !myTurn ? (
                  <span className="bubble-text typing">
                    {liveText}
                    <span className="caret" aria-hidden="true" />
                  </span>
                ) : lastVerdict ? (
                  <span className={`small ${lastVerdict.accepted ? "glow-green" : "glow-pink"}`}>{verdictLine(lastVerdict, nameOf(lastVerdict.playerId))}</span>
                ) : (
                  <span className="small muted">{question?.text ?? "Name something that fits!"}</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">…</p>
        )}
      </section>

      <div className="dock">
        {me?.role === "spectator" ? (
          <div className="dock-msg">
            <span>
              <Icon name="eye" /> SPECTATING — YOU'RE IN NEXT GAME
            </span>
          </div>
        ) : out ? (
          <div className="dock-msg">
            <span>
              <Icon name="skull" /> K.O. — YOU'RE SPECTATING NOW
            </span>
          </div>
        ) : (
          <form
            key={inputShakeKey}
            className={`answer-form ${myTurn ? "armed" : ""} ${inputShakeKey > 0 ? "shake-once" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              className="answer-input"
              value={draft}
              onChange={(e) => onType(e.target.value)}
              placeholder={myTurn ? (turn?.judging ? "JEV IS THINKING…" : "TYPE AN ANSWER") : stumpedMe ? "THIS ONE GOT YOU. NEXT ONE!" : "GET AN ANSWER READY…"}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={MAX_ANSWER_LENGTH}
            />
            <PixelButton tone="green" type="submit" disabled={!canSend || !draft.trim()}>
              SEND
            </PixelButton>
          </form>
        )}
      </div>

      <div className="game-grid">
        <AnswerWall answers={questionAnswers} cap={question?.cap ?? null} players={state.players} highlightId={freshAnswerId} />
        <div className="side">
          <PlayerRail state={state} meId={meId} onKick={isHost ? (id) => send({ type: "kick", playerId: id }) : undefined} />
          <QuestionTrail history={state.history} answers={state.answers} />
        </div>
      </div>

      <div className="emote-bar" role="group" aria-label="Reactions">
        {EMOTES.map((e) => (
          <button key={e} type="button" className="emote-btn" onClick={() => send({ type: "emote", emote: e })} aria-label={EMOTE_LABELS[e]} title={EMOTE_LABELS[e]}>
            <EmoteArt emote={e} />
          </button>
        ))}
      </div>
      {isHost && (
        <div className="host-bar" role="group" aria-label="Host controls">
          <PixelButton tone="cyan" onClick={() => send({ type: "skip" })} disabled={!turn || !!turn.judging}>
            <Icon name="skip" /> SKIP TURN
          </PixelButton>
          <PixelButton tone="red" onClick={() => confirm("End the game for everyone?") && send({ type: "end" })}>
            <Icon name="stop" /> END GAME
          </PixelButton>
        </div>
      )}
    </div>
  );
}
