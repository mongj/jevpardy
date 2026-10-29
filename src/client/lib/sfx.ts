import { getMuted, saveMuted } from "./identity.ts";

// Tiny chiptune synth: every sound is a few square/triangle oscillator blips.

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let muted = getMuted();
const muteListeners = new Set<(m: boolean) => void>();

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Browsers only allow audio after a gesture; call from the first tap. */
export function unlockAudio(): void {
  audio();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  saveMuted(next);
  for (const l of muteListeners) l(next);
}

export function onMuteChange(listener: (m: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

function tone(freq: number, start: number, dur: number, wave: Wave = "square", gain = 0.08, slideTo?: number): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function arp(notes: number[], step: number, dur: number, wave: Wave = "square", gain = 0.07): void {
  notes.forEach((f, i) => tone(f, i * step, dur, wave, gain));
}

function noise(dur: number, gain = 0.1): void {
  const ac = audio();
  if (!ac) return;
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = gain;
  src.buffer = buffer;
  src.connect(g).connect(ac.destination);
  src.start();
}

export const sfx = {
  coin: () => arp([988, 1319], 0.08, 0.25),
  click: () => tone(660, 0, 0.05, "square", 0.04),
  join: () => arp([523, 659, 784], 0.06, 0.12, "triangle", 0.1),
  yourTurn: () => arp([784, 988, 1175, 1568], 0.07, 0.14),
  judging: () => tone(440, 0, 0.18, "triangle", 0.05, 880),
  accept: (tierIdx: number) => {
    const base = [523, 659, 784, 1047, 1319];
    arp(base.slice(0, 3 + Math.min(2, tierIdx)), 0.06, 0.14);
    if (tierIdx >= 3) arp([1568, 2093], 0.08, 0.2, "triangle", 0.06);
  },
  reject: () => {
    tone(220, 0, 0.12, "sawtooth", 0.06);
    tone(165, 0.12, 0.22, "sawtooth", 0.06);
  },
  duplicate: () => arp([392, 392], 0.12, 0.09, "square", 0.06),
  tick: () => tone(1200, 0, 0.03, "square", 0.025),
  urgent: () => tone(1600, 0, 0.05, "square", 0.05),
  lifeLost: () => {
    noise(0.25, 0.12);
    tone(660, 0, 0.5, "square", 0.07, 110);
  },
  oneUp: () => arp([659, 784, 1319, 1047, 1175, 1568], 0.07, 0.12),
  eliminated: () => arp([494, 466, 440, 415, 392, 349, 330, 294], 0.11, 0.16, "triangle", 0.1),
  speedUp: () => arp([880, 1175, 880, 1175], 0.05, 0.06),
  gameOver: (won: boolean) =>
    won ? arp([523, 659, 784, 1047, 784, 1047, 1319], 0.12, 0.2) : arp([392, 330, 262, 196], 0.18, 0.3, "triangle", 0.1),
  emote: () => tone(1046, 0, 0.06, "triangle", 0.05),
};

export function vibrate(pattern: number | number[]): void {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported
  }
}
