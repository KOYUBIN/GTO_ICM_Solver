'use client';

// Tiny Web-Audio sound effects (no asset files). Lazily creates one
// AudioContext on first use so it respects the browser's autoplay policy.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function tone(freq: number, durMs: number, type: OscillatorType = 'sine', gain = 0.05, delayMs = 0): void {
  const ac = getCtx();
  if (!ac) return;
  const start = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durMs / 1000 + 0.02);
}

export type Sfx = 'turn' | 'action' | 'check' | 'win' | 'deal' | 'levelup';

export function sfx(kind: Sfx): void {
  switch (kind) {
    case 'turn': // your turn — a friendly two-note prompt
      tone(660, 120, 'sine', 0.06);
      tone(880, 140, 'sine', 0.06, 110);
      break;
    case 'action': // someone bet/raised — a soft chip click
      tone(320, 70, 'triangle', 0.05);
      break;
    case 'check':
      tone(240, 60, 'sine', 0.04);
      break;
    case 'deal': // new hand dealt
      tone(520, 90, 'triangle', 0.05);
      tone(700, 90, 'triangle', 0.05, 70);
      break;
    case 'win': // hand won — a little flourish
      tone(660, 130, 'sine', 0.06);
      tone(880, 130, 'sine', 0.06, 120);
      tone(1180, 200, 'sine', 0.06, 240);
      break;
    case 'levelup': // blinds went up
      tone(440, 160, 'sawtooth', 0.05);
      tone(587, 220, 'sawtooth', 0.05, 150);
      break;
  }
}

/** Resume the AudioContext after a user gesture (browsers require this). */
export function primeAudio(): void {
  const ac = getCtx();
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
}
