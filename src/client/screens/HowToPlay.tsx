import { TIERS } from "../../shared/constants.ts";
import { JevBot } from "../components/Pixel.tsx";
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
          <li>The host picks any topic — "cities in continental Europe", "Pixar movies", "things in a fridge".</li>
          <li>Players take turns naming something that fits. Jev, the AI judge, decides in a blink. Small typos are forgiven.</li>
          <li>No repeats! "München" after "Munich" counts as a repeat.</li>
          <li>
            <b>TIMED:</b> answer before the clock hits zero or lose a ♥. Wrong answers just burn time (unless the host turns on <i>sudden death</i>). Zero hearts = K.O. Last one standing wins.
          </li>
          <li>
            <b>FREE & EASY:</b> no clock, no hearts. Keep naming things until you're out of ideas, then tap out. Most points wins.
          </li>
          <li>Rarer answers score more and fill your 1UP meter (+1 ♥ every 200 pts):</li>
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
