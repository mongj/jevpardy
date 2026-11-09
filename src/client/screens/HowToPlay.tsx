import { BONUS_LIFE_POINTS, TIERS } from "../../shared/constants.ts";
import { Icon, JevBot } from "../components/Pixel.tsx";
import { Modal, PixelButton } from "../components/ui.tsx";

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="howto">
        <div className="howto-head">
          <JevBot mood="happy" size={56} />
          <h2>HOW TO PLAY</h2>
        </div>
        <ol className="rules">
          <li>The host picks one or more topics ("the 1990s", "cheese", "Taylor Swift"). A secret deck of questions about them is written for the game. Nobody sees a question until it's played, not even the host.</li>
          <li>Each question asks you to name something: "Name a 90s cartoon". Players take turns, each naming one answer. Jev judges in a blink and forgives small typos.</li>
          <li>No repeats on the same question! "München" after "Munich" counts as a repeat.</li>
          <li>A question moves on after a few rounds, once it's had plenty of answers, or as soon as it stumps people. It never comes back to someone it already beat.</li>
          <li>
            Answer before the fuse pops or lose a <Icon name="heart" font="body" className="heart-glyph" />. With the <i>mystery fuse</i>, one hidden fuse is passed round the table: answer fast and the next player inherits what's left. Wrong answers cost nothing but time: keep trying until the fuse pops. Zero hearts = K.O. Last one standing, or the top scorer still in when the questions run out, wins.
          </li>
          <li>Rarer answers score more and fill your 1UP meter (+1 <Icon name="heart" font="body" className="heart-glyph" /> every {BONUS_LIFE_POINTS} pts):</li>
        </ol>
        <ul className="tier-legend">
          {TIERS.map((t) => (
            <li key={t.id} style={{ color: t.color }}>
              <b>{t.name}</b> <span className="muted">+{t.points}</span> — {t.blurb}
            </li>
          ))}
        </ul>
        <PixelButton tone="cyan" onClick={onClose}>
          GOT IT
        </PixelButton>
      </div>
    </Modal>
  );
}
