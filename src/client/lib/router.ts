import { useSyncExternalStore } from "react";

export type Route = { name: "home" } | { name: "host" } | { name: "join"; code: string } | { name: "room"; code: string };

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.scrollTo(0, 0);
  for (const l of listeners) l();
}

export function parseRoute(path: string): Route {
  const room = path.match(/^\/r\/([A-Za-z]{4})\/?$/);
  if (room) return { name: "room", code: room[1]!.toUpperCase() };
  const join = path.match(/^\/join(?:\/([A-Za-z]{0,4}))?\/?$/);
  if (join) return { name: "join", code: (join[1] ?? "").toUpperCase() };
  if (path.startsWith("/host")) return { name: "host" };
  return { name: "home" };
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(path);
}
