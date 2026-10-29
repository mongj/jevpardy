import { useCallback, useEffect, useRef, useState } from "react";
import { tierById, tierIndex } from "../../shared/constants.ts";
import type { Emote, GameEvent, PublicState } from "../../shared/protocol.ts";
import { sanitizeName } from "../../shared/sanitize.ts";
import { FxLayer, type FxHandle } from "../components/FxLayer.tsx";
import { EmoteArt, Icon, JevBot, type JevMood } from "../components/Pixel.tsx";
import { MuteButton } from "../components/ui.tsx";
import { getSavedName, saveName } from "../lib/identity.ts";
import { navigate } from "../lib/router.ts";
import { sfx, vibrate } from "../lib/sfx.ts";
import { useRoom } from "../lib/useRoom.ts";
import { Game } from "./Game.tsx";
import { GameOver } from "./GameOver.tsx";
import { JoinGate, NoRoom } from "./JoinGate.tsx";
import { Lobby } from "./Lobby.tsx";

interface FloatingEmote {
  id: number;
  emote: Emote;
  x: number;
  name: string;
}

export function RoomScreen({ code, onWarp }: { code: string; onWarp: (on: boolean) => void }) {
  const [name, setName] = useState(() => sanitizeName(getSavedName()));
  if (!name) {
    return (
      <JoinGate
        code={code}
        onJoin={(n) => {
          saveName(n);
          setName(n);
        }}
      />
    );
  }
  return <LiveRoom code={code} name={name} onWarp={onWarp} />;
}

let emoteId = 0;

function LiveRoom({ code, name, onWarp }: { code: string; name: string; onWarp: (on: boolean) => void }) {
  const fx = useRef<FxHandle>(null);
  const [mood, setMood] = useState<JevMood>("idle");
  const [fresh, setFresh] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRef = useRef<PublicState | null>(null);

  const flashMood = useCallback((m: JevMood) => {
    setMood(m);
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood("idle"), 1600);
  }, []);

  const onEvents = useCallback(
    (events: GameEvent[], state: PublicState, meId: string) => {
      const f = fx.current;
      const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";
      for (const e of events) {
        switch (e.type) {
          case "playerJoined":
            if (e.playerId !== meId) sfx.join();
            break;
          case "playerLeft":
          case "hostChanged":
          case "backToLobby":
            break;
          case "playerKicked":
            f?.burst({ text: "BOOTED!", sub: "a player was kicked", color: "var(--red)", kind: "float" });
            break;
          case "gameStarted":
            sfx.coin();
            onWarp(true);
            setTimeout(() => onWarp(false), 1200);
            f?.burst({ text: "READY?", sub: state.topic, color: "var(--yellow)", kind: "big" });
            break;
          case "turnStarted":
            if (e.playerId === meId) {
              sfx.yourTurn();
              vibrate(60);
              f?.burst({ text: "YOUR TURN!", color: "var(--yellow)", kind: "pop" });
            }
            break;
          case "judging":
            sfx.judging();
            break;
          case "accepted": {
            const tier = tierById(e.answer.tier);
            const idx = tierIndex(e.answer.tier);
            sfx.accept(idx);
            setFresh(e.answer.id);
            flashMood(idx >= 3 ? "shocked" : "happy");
            f?.burst({
              text: `+${e.answer.points}`,
              sub: tier.name,
              color: tier.color,
              kind: idx >= 2 ? "big" : "pop",
            });
            f?.confetti(idx >= 2 ? [tier.color, "#fff", "#ffd23f"] : [tier.color], idx >= 3 ? 64 : idx >= 2 ? 40 : 14);
            break;
          }
          case "rejected": {
            const mine = e.verdict.playerId === meId;
            flashMood(e.verdict.reason === "judge_error" ? "shocked" : "angry");
            if (e.verdict.reason === "duplicate") {
              sfx.duplicate();
              f?.burst({ text: "REPEAT!", sub: e.verdict.duplicateOf ? `already said "${e.verdict.duplicateOf}"` : "already taken", color: "var(--orange)", kind: "pop" });
            } else if (e.verdict.reason === "judge_error") {
              f?.burst({ text: "GLITCH!", sub: "Jev hiccuped — try again", color: "var(--purple)", kind: "pop" });
            } else {
              sfx.reject();
              f?.burst({ text: "NOPE!", sub: `"${e.verdict.text}"`, color: "var(--red)", kind: "pop" });
            }
            if (mine) {
              setShakeKey((k) => k + 1);
              vibrate([40, 30, 40]);
            }
            break;
          }
          case "lifeLost":
            sfx.lifeLost();
            f?.flash("rgba(255, 79, 109, 0.35)");
            if (e.playerId === meId) {
              f?.shake();
              vibrate([90, 40, 90]);
            }
            f?.burst({
              text: e.reason === "timeout" ? "TIME'S UP!" : "-1 ♥",
              sub: `${e.playerId === meId ? "YOU" : nameOf(e.playerId)} · ${e.livesLeft} ♥ LEFT`,
              color: "var(--red)",
              kind: "big",
            });
            break;
          case "lifeEarned":
            sfx.oneUp();
            f?.burst({ text: "1UP!", sub: `${nameOf(e.playerId)} +1 ♥`, color: "var(--green)", kind: "pop" });
            break;
          case "eliminated":
            setTimeout(() => {
              sfx.eliminated();
              fx.current?.burst({ text: "K.O.!", sub: `${e.playerId === meId ? "YOU'RE" : `${nameOf(e.playerId)} IS`} OUT`, color: "var(--pink)", kind: "big" });
            }, 700);
            break;
          case "tappedOut":
            f?.burst({ text: "TAPPED OUT", sub: nameOf(e.playerId), color: "var(--cyan)", kind: "float" });
            break;
          case "skipped":
            f?.burst({ text: "SKIP", sub: nameOf(e.playerId), color: "var(--dim)", kind: "float" });
            break;
          case "speedUp":
            sfx.speedUp();
            f?.burst({ text: "SPEED UP!", sub: `${e.turnSeconds}s turns`, color: "var(--cyan)", kind: "pop" });
            break;
          case "gameOver": {
            const won = e.winnerId === meId;
            if (e.reason === "cleared") f?.burst({ text: "BOARD CLEARED!", sub: "nothing left to name", color: "var(--green)", kind: "big" });
            setTimeout(() => {
              sfx.gameOver(won);
              fx.current?.confetti(["#ffd23f", "#3ef0ff", "#ff4fd8", "#7dff6b"], 90);
            }, 900);
            break;
          }
          default: {
            const unknown: never = e;
            console.warn("unhandled event", unknown);
          }
        }
      }
    },
    [flashMood, onWarp],
  );

  const onEmote = useCallback((playerId: string, emote: Emote) => {
    sfx.emote();
    const player = stateRef.current?.players.find((p) => p.id === playerId);
    const id = ++emoteId;
    setEmotes((list) => [...list.slice(-12), { id, emote, x: 10 + Math.random() * 80, name: player?.name ?? "" }]);
    setTimeout(() => setEmotes((list) => list.filter((x) => x.id !== id)), 2200);
  }, []);

  const conn = useRoom(code, name, { onEvents, onEmote });
  stateRef.current = conn.state;

  useEffect(() => () => clearTimeout(moodTimer.current), []);

  if (conn.closed) return <NoRoom code={code} reason={conn.closed} />;
  const { state, meId } = conn;

  return (
    <main className={`screen room phase-${state?.phase ?? "loading"}`}>
      <header className="topbar">
        <button type="button" className="link-btn" onClick={() => navigate("/")}>
          <Icon name="left" /> EXIT
        </button>
        <span className="code-badge" title="Room code">
          {code}
        </span>
        <MuteButton />
      </header>

      {!state || !meId ? (
        <div className="center loading">
          <JevBot mood="thinking" size={72} />
          <p className="blink">CONNECTING…</p>
        </div>
      ) : state.phase === "lobby" ? (
        <Lobby state={state} meId={meId} send={conn.send} />
      ) : state.phase === "playing" ? (
        <Game state={state} meId={meId} offset={conn.offset} typing={conn.typing} send={conn.send} mood={mood} freshAnswerId={fresh} inputShakeKey={shakeKey} />
      ) : (
        <GameOver state={state} meId={meId} offset={conn.offset} send={conn.send} />
      )}

      {state?.judge === "mock" && <div className="mock-badge">MOCK JUDGE</div>}
      {conn.status === "reconnecting" && <div className="reconnecting blink">RECONNECTING…</div>}
      {conn.toast && (
        <div key={conn.toast.id} className="toast">
          {conn.toast.message}
        </div>
      )}
      <div className="emote-layer" aria-hidden="true">
        {emotes.map((e) => (
          <span key={e.id} className="floating-emote" style={{ left: `${e.x}%` }}>
            <EmoteArt emote={e.emote} size={44} />
            <small>{e.name}</small>
          </span>
        ))}
      </div>
      <FxLayer ref={fx} />
    </main>
  );
}
