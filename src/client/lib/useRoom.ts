import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, Emote, ErrorCode, GameEvent, PublicState, RoomInfoResponse, ServerMessage } from "../../shared/protocol.ts";
import { getToken } from "./identity.ts";

export type ConnStatus = "connecting" | "open" | "reconnecting";
export type ClosedReason = "expired" | "kicked" | "not_found" | "full";

export interface Toast {
  id: number;
  code: ErrorCode;
  message: string;
}

export interface RoomHandlers {
  onEvents?: (events: GameEvent[], state: PublicState, meId: string) => void;
  onEmote?: (playerId: string, emote: Emote) => void;
}

export interface RoomConnection {
  status: ConnStatus;
  state: PublicState | null;
  meId: string | null;
  closed: ClosedReason | null;
  toast: Toast | null;
  typing: Record<string, string>;
  /** serverNow - clientNow, so `Date.now() + offset` ≈ server time. */
  offset: number;
  send: (msg: ClientMessage) => void;
}

const PING_MS = 25_000;

export function useRoom(code: string, name: string, handlers: RoomHandlers): RoomConnection {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<PublicState | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [closed, setClosed] = useState<ClosedReason | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const meRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let toastId = 0;

    const stop = (reason: ClosedReason) => {
      disposed = true;
      setClosed(reason);
      wsRef.current?.close();
    };

    const connect = async () => {
      if (disposed) return;
      if (attempt > 0) {
        // A failed upgrade looks like a generic close; check whether the room still exists.
        const info = (await fetch(`/api/rooms/${code}`).then((r) => r.json()).catch(() => null)) as RoomInfoResponse | null;
        if (info && !info.ok) return stop("not_found");
      }
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", token: getToken(), name } satisfies ClientMessage));
        clearInterval(pingTimer);
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "welcome":
            attempt = 0;
            meRef.current = msg.you.playerId;
            setMeId(msg.you.playerId);
            setState(msg.state);
            setOffset(msg.serverNow - Date.now());
            setStatus("open");
            break;
          case "state": {
            setState(msg.state);
            setOffset(msg.serverNow - Date.now());
            if (msg.events.some((e) => e.type === "turnStarted" || e.type === "judging")) setTyping({});
            const me = meRef.current;
            if (me && msg.events.length > 0) handlersRef.current.onEvents?.(msg.events, msg.state, me);
            break;
          }
          case "typing":
            setTyping((t) => ({ ...t, [msg.playerId]: msg.text }));
            break;
          case "emote":
            handlersRef.current.onEmote?.(msg.playerId, msg.emote);
            break;
          case "error":
            if (msg.code === "kicked") return stop("kicked");
            if (msg.code === "room_full") return stop("full");
            setToast({ id: ++toastId, code: msg.code, message: msg.message });
            break;
          case "closed":
            stop(msg.reason);
            break;
          default: {
            const unknown: never = msg;
            console.warn("unknown message", unknown);
          }
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (disposed) return;
        setStatus("reconnecting");
        attempt += 1;
        retryTimer = setTimeout(() => void connect(), Math.min(5000, 300 * 2 ** attempt));
      };
    };

    void connect();
    const onVisible = () => {
      // Phones freeze background tabs; reconnect immediately when we come back.
      if (document.visibilityState === "visible" && wsRef.current?.readyState !== WebSocket.OPEN && !disposed) {
        clearTimeout(retryTimer);
        wsRef.current?.close();
        attempt = Math.max(attempt, 1);
        void connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, [code, name]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { status, state, meId, closed, toast, typing, offset, send };
}
