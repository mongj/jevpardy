const TOKEN_KEY = "jevpardy:token";
const NAME_KEY = "jevpardy:name";
const MUTE_KEY = "jevpardy:muted";

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the in-memory copy still works for this tab.
  }
}

/** Random per-browser secret used to reclaim your seat after a reconnect. Never shown to other players. */
export function getToken(): string {
  const existing = read(TOKEN_KEY);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const token = crypto.randomUUID().replace(/-/g, "");
  write(TOKEN_KEY, token);
  return token;
}

export function getSavedName(): string {
  return read(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

export function getMuted(): boolean {
  return read(MUTE_KEY) === "1";
}

export function saveMuted(muted: boolean): void {
  write(MUTE_KEY, muted ? "1" : "0");
}
