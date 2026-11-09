import { useState } from "react";
import { DEFAULT_SETTINGS, MAX_NAME_LENGTH, mergeSettings } from "../../shared/constants.ts";
import type { CreateRoomRequest, CreateRoomResponse, GameSettings } from "../../shared/protocol.ts";
import { sanitizeName } from "../../shared/sanitize.ts";
import { Icon } from "../components/Pixel.tsx";
import { TopicEditor, pickSuggestions, withDraft } from "../components/TopicChips.tsx";
import { Panel, PixelButton } from "../components/ui.tsx";
import { getSavedName, getToken, saveName } from "../lib/identity.ts";
import { navigate } from "../lib/router.ts";
import { sfx } from "../lib/sfx.ts";
import { DeckSettings, TimedSettings } from "./SettingsForm.tsx";

export function Host() {
  const [topics, setTopics] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(getSavedName());
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions] = useState(() => pickSuggestions());

  const cleanName = sanitizeName(name);
  const allTopics = withDraft(topics, draft);
  const patch = (p: Partial<GameSettings>) => setSettings((s) => mergeSettings(s, p));

  const create = async () => {
    if (!cleanName || allTopics.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const body: CreateRoomRequest = { topics: allTopics, settings, token: getToken() };
      const res = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as CreateRoomResponse;
      if (data.ok) {
        saveName(cleanName);
        sfx.coin();
        navigate(`/r/${data.code}`);
        return;
      }
      setError(data.message);
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
          <Icon name="left" /> BACK
        </button>
        <h1 className="screen-title">NEW GAME</h1>
        <span />
      </header>

      <form
        className="host-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Panel title="1 · TOPICS" accent="yellow">
          <TopicEditor topics={topics} onChange={setTopics} draft={draft} onDraft={setDraft} suggestions={suggestions} autoFocus />
        </Panel>

        <Panel title="2 · GAME" accent="pink">
          <DeckSettings settings={settings} onChange={patch} />
          <TimedSettings settings={settings} onChange={patch} />
        </Panel>

        <Panel title="3 · YOUR NAME" accent="cyan">
          <input className="name-input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))} placeholder="PLAYER 1" autoComplete="nickname" maxLength={MAX_NAME_LENGTH} />
        </Panel>

        {error && <p className="error-text">{error}</p>}
        <PixelButton big tone="green" type="submit" disabled={!cleanName || allTopics.length === 0 || busy}>
          {busy ? "OPENING…" : <><Icon name="right" /> CREATE ROOM</>}
        </PixelButton>
      </form>
    </main>
  );
}
