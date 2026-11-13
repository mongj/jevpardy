import { useEffect, useState } from "react";
import { ROOM_CODE_LENGTH } from "../../shared/constants.ts";
import type { CreateRoomRequest, CreateRoomResponse, HealthResponse } from "../../shared/protocol.ts";
import { Icon, JevBot, Sprite } from "../components/Pixel.tsx";
import { PixelButton } from "../components/ui.tsx";
import { getToken } from "../lib/identity.ts";
import { navigate } from "../lib/router.ts";
import { sfx, unlockAudio } from "../lib/sfx.ts";
import { HowToPlay } from "./HowToPlay.tsx";

export function Logo() {
  return (
    <h1 className="logo" aria-label="Jevpardy!">
      {"JEVPARDY!".split("").map((ch, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.08}s` }}>
          {ch}
        </span>
      ))}
    </h1>
  );
}

export function Home() {
  const [code, setCode] = useState("");
  const [howTo, setHowTo] = useState(false);
  const [judge, setJudge] = useState<HealthResponse | null>(null);
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);

  // Hosting opens an empty room straight away; topics and options are picked in its lobby.
  const host = async () => {
    unlockAudio();
    sfx.coin();
    setHosting(true);
    setHostError(null);
    try {
      const body: CreateRoomRequest = { token: getToken() };
      const res = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as CreateRoomResponse;
      if (data.ok) return navigate(`/r/${data.code}`);
      setHostError(data.message);
    } catch {
      setHostError("Couldn't reach the server. Check your connection.");
    }
    setHosting(false);
  };

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setJudge)
      .catch(() => setJudge(null));
  }, []);

  const join = () => {
    if (code.length === ROOM_CODE_LENGTH) navigate(`/r/${code}`);
  };

  return (
    <main className="screen home">
      <div className="home-hero">
        <div className="invaders" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Sprite key={i} avatar={i * 2 + 1} color={["#ff4fd8", "#3ef0ff", "#ffd23f", "#7dff6b", "#ff8a3d"][i]!} size={30} className="march" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <Logo />
        <div className="home-jev">
          <JevBot mood="idle" size={88} className="float" />
          <div className="speech">Pick your topics. You get secret questions; I judge every answer!</div>
        </div>
      </div>

      <div className="home-actions">
        <PixelButton big tone="yellow" onClick={() => void host()} disabled={hosting}>
          {hosting ? (
            "OPENING…"
          ) : (
            <>
              <Icon name="right" /> HOST GAME
            </>
          )}
        </PixelButton>
        {hostError && <p className="error-text">{hostError}</p>}

        <form
          className="join-box panel accent-cyan"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <label htmlFor="code" className="label">
            JOIN WITH CODE
          </label>
          <div className="join-row">
            <input
              id="code"
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH))}
              placeholder="ABCD"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              maxLength={ROOM_CODE_LENGTH}
            />
            <PixelButton tone="cyan" type="submit" disabled={code.length !== ROOM_CODE_LENGTH} onClick={join}>
              GO
            </PixelButton>
          </div>
        </form>

        <button type="button" className="link-btn" onClick={() => setHowTo(true)}>
          ? HOW TO PLAY
        </button>
      </div>

      {judge?.judge === "mock" && (
        <footer className="home-foot small muted">
          <span className="glow-pink">MOCK JUDGE MODE — set TYPESAFE_API_KEY for the real Jev</span>
        </footer>
      )}
      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </main>
  );
}
