import { useState } from "react";
import { DEFAULT_SETTINGS, MAX_NAME_LENGTH, MAX_TOPIC_LENGTH, mergeSettings } from "../../shared/constants.ts";
import type { CreateRoomRequest, CreateRoomResponse, GameSettings } from "../../shared/protocol.ts";
import { sanitizeName, sanitizeTopic } from "../../shared/sanitize.ts";
import { JevBot } from "../components/Pixel.tsx";
import { Modal, Panel, PixelButton } from "../components/ui.tsx";
import { getSavedName, getToken, saveName } from "../lib/identity.ts";
import { navigate } from "../lib/router.ts";
import { sfx } from "../lib/sfx.ts";
import { ModePicker, TimedSettings } from "./SettingsForm.tsx";

const SUGGESTIONS = [
  "cities in continental Europe",
  "Pokémon",
  "things you'd find in a fridge",
  "Pixar movies",
  "programming languages",
  "dog breeds",
  "words that rhyme with 'cat'",
  "Olympic sports",
  "Taylor Swift songs",
  "chemical elements",
  "board games",
  "famous painters",
  "cheeses",
  "Marvel superheroes",
  "countries in Africa",
  "musical instruments",
];

function pickSuggestions(): string[] {
  return [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 5);
}

export function Host() {
  const [topic, setTopic] = useState("");
  const [name, setName] = useState(getSavedName());
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ message: string; listability: number } | null>(null);
  const [suggestions] = useState(pickSuggestions);

  const cleanName = sanitizeName(name);
  const cleanTopic = sanitizeTopic(topic);

  const create = async (force: boolean) => {
    if (!cleanName || !cleanTopic) return;
    setBusy(true);
    setError(null);
    try {
      const body: CreateRoomRequest = { topic: cleanTopic, settings, token: getToken(), force };
      const res = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as CreateRoomResponse;
      if (data.ok) {
        saveName(cleanName);
        sfx.coin();
        navigate(`/r/${data.code}`);
        return;
      }
      if (data.error === "topic_warning") setWarning({ message: data.message, listability: data.listability });
      else setError(data.message);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen host">
      <header className="topbar">
        <button type="button" className="link-btn" onClick={() => navigate("/")}>
          ◀ BACK
        </button>
        <h1 className="screen-title">NEW GAME</h1>
        <span />
      </header>

      <form
        className="host-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create(false);
        }}
      >
        <Panel title="1 · TOPIC" accent="yellow">
          <textarea
            className="topic-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, MAX_TOPIC_LENGTH))}
            placeholder="cities in continental Europe"
            rows={2}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void create(false);
              }
            }}
          />
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" className="suggestion" onClick={() => setTopic(s)}>
                {s}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="2 · MODE" accent="pink">
          <ModePicker mode={settings.mode} onChange={(mode) => setSettings((s) => ({ ...s, mode }))} />
          {settings.mode === "timed" && <TimedSettings settings={settings} onChange={(patch) => setSettings((s) => mergeSettings(s, patch))} />}
        </Panel>

        <Panel title="3 · YOUR NAME" accent="cyan">
          <input className="name-input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))} placeholder="PLAYER 1" autoComplete="nickname" maxLength={MAX_NAME_LENGTH} />
        </Panel>

        {error && <p className="error-text">{error}</p>}
        <PixelButton big tone="green" type="submit" disabled={!cleanName || !cleanTopic || busy}>
          {busy ? "ASKING JEV…" : "▶ CREATE ROOM"}
        </PixelButton>
      </form>

      {warning && (
        <Modal onClose={() => setWarning(null)}>
          <div className="warning-modal">
            <JevBot mood="thinking" size={64} />
            <p>{warning.message}</p>
            <p className="muted small">Listability score: {Math.round(warning.listability * 100)}%</p>
            <div className="row">
              <PixelButton tone="ghost" onClick={() => setWarning(null)}>
                EDIT TOPIC
              </PixelButton>
              <PixelButton
                tone="yellow"
                onClick={() => {
                  setWarning(null);
                  void create(true);
                }}
              >
                PLAY ANYWAY
              </PixelButton>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
