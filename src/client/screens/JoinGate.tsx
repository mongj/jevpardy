import { useEffect, useState } from "react";
import { MAX_NAME_LENGTH } from "../../shared/constants.ts";
import type { RoomInfoResponse } from "../../shared/protocol.ts";
import { sanitizeName } from "../../shared/sanitize.ts";
import { Icon, JevBot } from "../components/Pixel.tsx";
import { Panel, PixelButton } from "../components/ui.tsx";
import { getSavedName } from "../lib/identity.ts";
import { navigate } from "../lib/router.ts";

export function JoinGate({ code, onJoin }: { code: string; onJoin: (name: string) => void }) {
  const [info, setInfo] = useState<RoomInfoResponse | null>(null);
  const [name, setName] = useState(getSavedName());
  const clean = sanitizeName(name);

  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json() as Promise<RoomInfoResponse>)
      .then(setInfo)
      .catch(() => setInfo({ ok: false, error: "not_found" }));
  }, [code]);

  if (info && !info.ok) return <NoRoom code={code} />;

  return (
    <main className="screen join">
      <header className="topbar">
        <button type="button" className="link-btn" onClick={() => navigate("/")}>
          <Icon name="left" /> BACK
        </button>
        <h1 className="screen-title">ROOM {code}</h1>
        <span />
      </header>
      <Panel accent="yellow" className="join-preview">
        {info?.ok ? (
          <>
            <p className="label">TOPIC</p>
            <p className="topic-big">{info.topic}</p>
            <p className="muted small">
              <Icon name={info.mode === "timed" ? "stopwatch" : "cup"} font="body" /> {info.mode === "timed" ? "TIMED" : "FREE & EASY"} · {info.players}/{info.maxPlayers} players · {info.phase === "lobby" ? "waiting to start" : info.phase === "playing" ? "in progress" : "finished"}
            </p>
            {info.phase !== "lobby" && (
              <p className="small glow-pink">{info.mode === "free" && info.phase === "playing" ? "You can jump straight in!" : "You'll join as a spectator."}</p>
            )}
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Panel>
      <form
        className="panel accent-cyan join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onJoin(clean);
        }}
      >
        <label className="label" htmlFor="name">
          YOUR NAME
        </label>
        <input id="name" className="name-input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))} placeholder="PLAYER 2" autoFocus autoComplete="nickname" maxLength={MAX_NAME_LENGTH} />
        <PixelButton big tone="green" type="submit" disabled={!clean || !info?.ok}>
          <Icon name="right" /> JOIN
        </PixelButton>
      </form>
    </main>
  );
}

export function NoRoom({ code, reason = "not_found" }: { code: string; reason?: "not_found" | "expired" | "kicked" | "full" }) {
  const text = {
    not_found: ["NO SUCH ROOM", `Room ${code} doesn't exist (or already self-destructed).`],
    expired: ["ROOM CLOSED", "This room self-destructed. Games leave no trace."],
    kicked: ["YOU'VE BEEN BOOTED", "The host removed you from this room."],
    full: ["ROOM FULL", "This room is packed. Try again later."],
  }[reason];
  return (
    <main className="screen center">
      <JevBot mood={reason === "kicked" ? "angry" : "sleepy"} size={96} />
      <h1 className="screen-title glow-pink">{text[0]}</h1>
      <p className="muted">{text[1]}</p>
      <PixelButton tone="yellow" onClick={() => navigate("/")}>
        <Icon name="left" /> HOME
      </PixelButton>
    </main>
  );
}
