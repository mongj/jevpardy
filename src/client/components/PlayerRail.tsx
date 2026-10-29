import { BONUS_LIFE_POINTS } from "../../shared/constants.ts";
import type { PublicPlayer, PublicState } from "../../shared/protocol.ts";
import { Crown, Hearts, Icon, Sprite } from "./Pixel.tsx";

export function PlayerChip({ player, state, meId, active, onKick }: { player: PublicPlayer; state: PublicState; meId: string; active: boolean; onKick?: () => void }) {
  const out = player.status === "eliminated" || player.status === "tappedOut";
  const timed = state.settings.mode === "timed";
  return (
    <li className={`player ${active ? "active" : ""} ${out ? "out" : ""} ${player.connected ? "" : "offline"} ${player.id === meId ? "me" : ""}`} style={{ ["--pc" as string]: player.color }}>
      <span className="player-sprite">
        <Sprite avatar={player.avatar} color={player.color} size={34} dead={player.status === "eliminated"} className={active ? "bob" : ""} />
        {state.hostId === player.id && <Crown />}
      </span>
      <span className="player-info">
        <span className="player-name">
          {player.name}
          {player.id === meId && <span className="you-tag">YOU</span>}
        </span>
        {state.phase !== "lobby" &&
          (timed ? (
            <span className="player-meta">
              {player.status === "eliminated" ? <span className="tag red">K.O.</span> : <Hearts lives={player.lives} max={state.settings.lives} size={12} />}
              <span className="meter" title="1UP meter">
                <span style={{ width: `${(player.meter / BONUS_LIFE_POINTS) * 100}%` }} />
              </span>
            </span>
          ) : (
            <span className="player-meta">{player.status === "tappedOut" ? <span className="tag dim">TAPPED OUT</span> : <span className="tag green">IN</span>}</span>
          ))}
        {!player.connected && <span className="tag dim">OFFLINE</span>}
      </span>
      {state.phase !== "lobby" && <span className="player-points">{player.points}</span>}
      {onKick && (
        <button type="button" className="kick-btn" onClick={onKick} aria-label={`Kick ${player.name}`} title="Kick">
          <Icon name="close" />
        </button>
      )}
    </li>
  );
}

export function PlayerRail({ state, meId, onKick }: { state: PublicState; meId: string; onKick?: (id: string) => void }) {
  const order = state.turnOrder.length > 0 ? state.turnOrder : state.players.map((p) => p.id);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const contestants = order.map((id) => byId.get(id)).filter((p): p is PublicPlayer => !!p && p.role === "player");
  const spectators = state.players.filter((p) => p.role === "spectator");
  return (
    <div className="player-rail">
      <ul className="players">
        {contestants.map((p) => (
          <PlayerChip
            key={p.id}
            player={p}
            state={state}
            meId={meId}
            active={state.turn?.playerId === p.id}
            onKick={onKick && p.id !== meId ? () => onKick(p.id) : undefined}
          />
        ))}
      </ul>
      {spectators.length > 0 && (
        <p className="spectators small muted">
          <Icon name="eye" font="body" /> {spectators.length} watching: {spectators.map((s) => s.name).join(", ")}
        </p>
      )}
    </div>
  );
}
