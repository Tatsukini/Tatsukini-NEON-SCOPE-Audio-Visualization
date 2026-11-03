/**
 * Built-in demo cue.
 *
 * Rather than scheduling hundreds of Web Audio nodes (which is slow and can
 * stall OfflineAudioContext in some environments), this synth writes straight
 * into stereo sample buffers. It is deterministic, dependency-free and runs in
 * a couple of hundred milliseconds on a normal machine.
 */
const TAU = Math.PI * 2;

export async function createDemoTrack(sampleRate = 48000) {
  const sr = Math.max(22050, Number(sampleRate) || 48000);
  const bpm = 112;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = 16;
  const duration = 36;
  const length = Math.ceil(duration * sr);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };

  const at = (b) => b * beat;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

  function panGains(pan) {
    const p = Math.max(-1, Math.min(1, pan));
    const angle = (p + 1) * Math.PI * 0.25;
    return [Math.cos(angle), Math.sin(angle)];
  }

  function oscillator(kind, phase) {
    const p = phase - Math.floor(phase);
    if (kind === 'sine') return Math.sin(TAU * p);
    if (kind === 'triangle') return 2 * Math.abs(2 * (p - 0.5)) - 1;
    if (kind === 'soft-saw') {
      // Two harmonics, band-limited enough for a demo pad.
      return Math.sin(TAU * p) * 0.72 + Math.sin(TAU * p * 2 + 0.4) * 0.18 + Math.sin(TAU * p * 3) * 0.08;
    }
    if (kind === 'pulse') return Math.sin(TAU * p) * 0.7 + Math.sin(TAU * p * 3) * 0.22;
    return Math.sin(TAU * p);
  }

  function envelope(t, dur, attack, decay, sustain, release) {
    if (t < 0) return 0;
    if (t < attack) return t / attack;
    if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
    if (t < dur) return sustain;
    if (t < dur + release) return sustain * (1 - (t - dur) / release);
    return 0;
  }

  /**
   * Write one synthesized voice.
   * `echo` creates a delayed, filtered repeat on the opposite side.
   */
  function addVoice({
    start, dur, freq, kind = 'sine', gain = 0.1, attack = 0.01,
    decay = 0.15, sustain = 0.5, release = 0.2, pan = 0,
    detune = 0, echo = false, echoGain = 0.22, bright = 1,
  }) {
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(length, Math.floor((start + dur + release) * sr));
    if (endSample <= startSample) return;
    let phase = Math.random() * 0.01;
    let phase2 = 0.37;
    const inc = freq / sr;
    const inc2 = (freq * Math.pow(2, detune / 1200)) / sr;
    const [gl, gr] = panGains(pan);
    for (let i = startSample; i < endSample; i++) {
      const t = i / sr - start;
      const e = envelope(t, dur, attack, decay, sustain, release);
      if (e <= 0) continue;
      const s1 = oscillator(kind, phase);
      const s2 = oscillator(kind, phase2);
      const env = e * gain;
      const brightMix = 1 + bright * 0.02;
      left[i] += s1 * env * gl * brightMix;
      right[i] += s2 * env * gr * brightMix;
      phase += inc;
      phase2 += inc2;
    }
    if (echo) addEcho(start, dur, freq, kind, gain, attack, decay, sustain, release, -pan, echoGain);
  }

  function addEcho(start, dur, freq, kind, gain, attack, decay, sustain, release, pan, echoGain) {
    const echoStart = start + beat * 0.75;
    const startSample = Math.max(0, Math.floor(echoStart * sr));
    const endSample = Math.min(length, Math.floor((echoStart + dur + release) * sr));
    if (endSample <= startSample) return;
    let phase = 0.17;
    const inc = freq / sr;
    const [gl, gr] = panGains(pan);
    for (let i = startSample; i < endSample; i++) {
      const t = i / sr - echoStart;
      const e = envelope(t, dur, Math.max(0.006, attack), decay, sustain, release);
      if (e <= 0) continue;
      const s = oscillator(kind, phase);
      // Darken the echo.
      const env = e * gain * echoGain;
      left[i] += s * env * gl * 0.8;
      right[i] += s * env * gr * 0.8;
      phase += inc * 0.9995;
    }
  }

  function kick(t, vel = 1) {
    const startSample = Math.floor(t * sr);
    const endSample = Math.min(length, startSample + Math.floor(0.4 * sr));
    let phase = 0;
    for (let i = startSample; i < endSample; i++) {
      const x = (i - startSample) / sr;
      const f = 42 + 110 * Math.exp(-x * 22);
      phase += f / sr;
      const e = Math.min(1, x / 0.004) * Math.exp(-x * 7.5);
      const s = Math.sin(TAU * phase) * e * 0.7 * vel;
      left[i] += s;
      right[i] += s;
    }
  }

  function snare(t, vel = 1) {
    const startSample = Math.floor(t * sr);
    const endSample = Math.min(length, startSample + Math.floor(0.28 * sr));
    let hpPrev = 0;
    for (let i = startSample; i < endSample; i++) {
      const x = (i - startSample) / sr;
      const noise = rand();
      hpPrev = noise * 0.6 + hpPrev * 0.4;
      const n = (noise - hpPrev) * Math.exp(-x * 18) * 0.23 * vel;
      const body = Math.sin(TAU * 185 * x) * Math.exp(-x * 24) * 0.09 * vel;
      const s = n + body;
      left[i] += s * 0.72;
      right[i] += s * 0.78;
    }
  }

  function hat(t, vel = 1, open = false) {
    const startSample = Math.floor(t * sr);
    const len = open ? 0.22 : 0.055;
    const endSample = Math.min(length, startSample + Math.floor(len * sr));
    let hp = 0;
    for (let i = startSample; i < endSample; i++) {
      const x = (i - startSample) / sr;
      const n = rand();
      const high = n - hp;
      hp = hp * 0.82 + n * 0.18;
      const s = high * Math.exp(-x * (open ? 18 : 72)) * 0.055 * vel;
      left[i] += s * 0.7;
      right[i] += s * 0.45;
    }
  }

  function crash(t, vel = 1) {
    const startSample = Math.floor(t * sr);
    const endSample = Math.min(length, startSample + Math.floor(1.8 * sr));
    let hp = 0;
    for (let i = startSample; i < endSample; i++) {
      const x = (i - startSample) / sr;
      const n = rand();
      const high = n - hp;
      hp = hp * 0.88 + n * 0.12;
      const s = high * Math.exp(-x * 2.4) * 0.07 * vel;
      left[i] += s * 0.9;
      right[i] += s * 0.65;
    }
  }

  const chords = [
    [57, 60, 64, 69], // Am
    [53, 57, 60, 65], // F
    [60, 64, 67, 72], // C
    [55, 59, 62, 67], // G
  ];
  const roots = [33, 29, 36, 31];
  const arpPattern = [0, 1, 2, 3, 2, 1, 2, 3, 1, 2, 3, 2, 0, 1, 3, 2];

  for (let b = 0; b < bars; b++) {
    const start = at(b * 4);
    const chordIdx = Math.floor(b / 2) % 4;
    const chord = chords[chordIdx];
    const root = roots[chordIdx];
    const section = b < 2 ? 'intro' : b < 8 ? 'main' : b < 10 ? 'break' : 'full';

    // Pad, one long chord every two bars.
    if (b % 2 === 0) {
      const dur = beat * 8 - 0.15;
      chord.forEach((midi, i) => {
        addVoice({
          start, dur, freq: mtof(midi), kind: 'soft-saw', gain: 0.026,
          attack: 0.55, decay: 1.1, sustain: 0.62, release: 1.2,
          pan: ((i % 2 ? 1 : -1) * (0.16 + i * 0.06)), detune: i % 2 ? 4 : -4,
        });
      });
      addVoice({
        start, dur, freq: mtof(root + 12), kind: 'sine', gain: 0.052,
        attack: 0.4, decay: 1.2, sustain: 0.8, release: 1.1,
      });
    }

    // Bass.
    if (section !== 'intro') {
      const pattern = [0, 0.5, 0.75, 1.5, 2, 2.5, 3, 3.5];
      for (const step of pattern) {
        const t = start + step * beat;
        const oct = step === 3.5 ? 12 : 0;
        addVoice({
          start: t, dur: beat * 0.3, freq: mtof(root + 12 + oct), kind: 'sine', gain: 0.16,
          attack: 0.005, decay: 0.12, sustain: 0.42, release: 0.06,
        });
        addVoice({
          start: t, dur: beat * 0.26, freq: mtof(root + 12 + oct), kind: 'soft-saw', gain: 0.045,
          attack: 0.006, decay: 0.1, sustain: 0.25, release: 0.05,
        });
      }
    }

    // Arpeggiator.
    if (section !== 'intro' || b === 1) {
      for (let s = 0; s < 16; s++) {
        if (section === 'break' && s % 2 === 1) continue;
        const midi = chord[arpPattern[s % arpPattern.length]] + 12;
        const t = start + (s / 4) * beat;
        addVoice({
          start: t, dur: beat * 0.19, freq: mtof(midi), kind: 'triangle', gain: 0.033,
          attack: 0.004, decay: 0.08, sustain: 0.1, release: 0.08,
          pan: Math.sin(s * 0.9 + b * 1.7) * 0.4, echo: true, echoGain: 0.26,
        });
      }
    }

    // Drums.
    if (section === 'main' || section === 'full') {
      for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
        if (section === 'full' || beatIdx !== 2) kick(start + beatIdx * beat, beatIdx === 0 ? 1 : 0.82);
      }
      snare(start + beat, 0.95);
      snare(start + beat * 3, 0.95);
      for (let s = 0; s < 8; s++) {
        if (section === 'main' && s % 2) continue;
        hat(start + (s / 2) * beat, s % 2 ? 0.7 : 1, s === 7 && b % 2 === 1);
      }
    }
    if (b === 2 || b === 10) crash(start, 0.8);

    // Lead motif.
    if (b >= 10) {
      const phrase = [0, 4, 7, 9, 7, 4, 2, 4];
      for (let n = 0; n < 4; n++) {
        const idx = phrase[(b * 2 + n) % phrase.length];
        addVoice({
          start: start + n * beat, dur: beat * 0.72, freq: mtof(chord[1] + 12 + idx),
          kind: 'pulse', gain: 0.026, attack: 0.035, decay: 0.22, sustain: 0.38,
          release: 0.25, pan: Math.sin(b + n) * 0.26, echo: true, echoGain: 0.2,
        });
      }
    }
    // Yield once per bar so the loading UI can breathe.
    if (b % 2 === 1) await new Promise((r) => setTimeout(r, 0));
  }

  // Master fade and gentle bus glue.
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    let fade = 1;
    if (t < 1.1) fade = t / 1.1;
    if (t > duration - 2.0) fade = Math.max(0, (duration - t) / 2.0);
    const soft = Math.tanh(1.15);
    void soft;
    left[i] *= fade;
    right[i] *= fade;
  }

  // Normalize to a comfortable peak.
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const al = Math.abs(left[i]);
    const ar = Math.abs(right[i]);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
  }
  const target = 0.9;
  if (peak > 0.001) {
    const scale = target / peak;
    if (scale < 1) {
      for (let i = 0; i < length; i++) { left[i] *= scale; right[i] *= scale; }
    }
  }

  const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: sr });
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  return buffer;
}
