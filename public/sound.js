// Sonidos sintetizados con Web Audio: el "clac" de bola contra bola y contra el cristal.
let ctx = null;
let noise = null;
let enabled = true;
let lastAt = 0;

export function setSoundEnabled(value) {
  enabled = value;
}

/** Los navegadores solo dejan sonar audio tras un gesto del usuario. */
export function unlockSound() {
  if (!enabled) return;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

/**
 * @param {number} intensity 0..1
 * @param {number} pitch     1 = bola contra bola; <1 suena más grave
 */
export function clack(intensity = 0.5, pitch = 1) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - lastAt < 0.03) return;
  lastAt = now;

  const level = 0.03 + 0.22 * Math.min(1, intensity);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.exponentialRampToValueAtTime(level, now + 0.003);
  out.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  out.connect(ctx.destination);

  const tone = ctx.createOscillator();
  tone.type = 'sine';
  const f = (1900 + Math.random() * 900) * pitch;
  tone.frequency.setValueAtTime(f, now);
  tone.frequency.exponentialRampToValueAtTime(f * 0.62, now + 0.09);
  tone.connect(out);
  tone.start(now);
  tone.stop(now + 0.12);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 3200 * pitch;
  band.Q.value = 1.2;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.6;
  src.connect(band).connect(noiseGain).connect(out);
  src.start(now);
}
