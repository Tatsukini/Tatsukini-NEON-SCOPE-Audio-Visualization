/**
 * Standard MIDI File parser (format 0/1) + a small offline General-MIDI-ish
 * synthesizer. The synth is intentionally lightweight: one or two oscillators
 * per note, filtered, panned and sent into a synthetic reverb. It turns a .mid
 * into an AudioBuffer so the exact same visualizer pipeline can analyze it.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi) {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

function readU32(view, offset) {
  return (view.getUint8(offset) << 24) | (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
}

function readU16(view, offset) {
  return (view.getUint8(offset) << 8) | view.getUint8(offset + 1);
}

function readString(view, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readVarLen(view, state) {
  let value = 0, count = 0, byte = 0;
  do {
    if (state.p >= state.end) throw new Error('MIDI 数据意外结束');
    byte = view.getUint8(state.p++);
    value = (value << 7) | (byte & 0x7f);
    count++;
    if (count > 5) throw new Error('MIDI 可变长度数据损坏');
  } while (byte & 0x80);
  return value;
}

/** Parse an ArrayBuffer containing a .mid file. */
export function parseMidi(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 14) throw new Error('MIDI 文件过小');
  if (readString(view, 0, 4) !== 'MThd') throw new Error('不是标准 MIDI 文件（缺少 MThd）');
  const headerLength = readU32(view, 4);
  const format = readU16(view, 8);
  const trackCount = readU16(view, 10);
  const divisionRaw = readU16(view, 12);
  if (divisionRaw & 0x8000) throw new Error('暂不支持 SMPTE 时间格式的 MIDI');
  const ppq = divisionRaw & 0x7fff;
  if (!ppq) throw new Error('MIDI PPQ 无效');
  if (format === 2) throw new Error('暂不支持 MIDI Format 2');

  let p = 8 + headerLength;
  const tracks = [];
  const tempoEvents = [];
  const timeSignatures = [];
  const trackNames = [];

  for (let t = 0; t < trackCount && p + 8 <= view.byteLength; t++) {
    const id = readString(view, p, 4);
    const length = readU32(view, p + 4);
    const start = p + 8;
    const end = Math.min(view.byteLength, start + length);
    if (id !== 'MTrk') { p = end; continue; }

    const state = { p: start, end };
    let status = 0;
    let absTick = 0;
    let running = true;
    const active = new Map();
    const notes = [];
    let name = '';
    const programs = new Array(16).fill(0);
    const pans = new Array(16).fill(64);
    const volumes = new Array(16).fill(100);

    while (state.p < end) {
      let delta;
      try { delta = readVarLen(view, state); } catch { break; }
      absTick += delta;
      if (state.p >= end) break;
      let byte = view.getUint8(state.p);
      if (byte >= 0x80) {
        status = byte;
        state.p++;
        running = status < 0xF0;
      } else if (!running || !status) {
        // Invalid running status; skip a byte to avoid an infinite loop.
        state.p++;
        continue;
      } else {
        status = status;
      }

      if (status === 0xFF) {
        if (state.p >= end) break;
        const metaType = view.getUint8(state.p++);
        const len = readVarLen(view, state);
        const dataStart = state.p;
        if (dataStart + len > end) break;
        if (metaType === 0x51 && len >= 3) {
          const us = (view.getUint8(dataStart) << 16) | (view.getUint8(dataStart + 1) << 8) | view.getUint8(dataStart + 2);
          if (us > 0) tempoEvents.push({ tick: absTick, us });
        } else if (metaType === 0x58 && len >= 2) {
          timeSignatures.push({ tick: absTick, numerator: view.getUint8(dataStart), denominator: Math.pow(2, view.getUint8(dataStart + 1)) });
        } else if (metaType === 0x03 && len > 0 && !name) {
          name = readString(view, dataStart, len).replace(/\0/g, '').trim();
        } else if (metaType === 0x2F) {
          state.p = dataStart + len;
          break;
        }
        state.p = dataStart + len;
        continue;
      }

      if (status === 0xF0 || status === 0xF7) {
        const len = readVarLen(view, state);
        state.p += len;
        continue;
      }

      const command = status & 0xF0;
      const channel = status & 0x0F;
      const d1 = state.p < end ? view.getUint8(state.p++) : 0;
      let d2 = 0;
      if (command !== 0xC0 && command !== 0xD0) d2 = state.p < end ? view.getUint8(state.p++) : 0;

      if (command === 0x90 && d2 > 0) {
        const key = channel * 128 + d1;
        if (!active.has(key)) active.set(key, []);
        active.get(key).push({ tick: absTick, velocity: d2, program: programs[channel], pan: pans[channel], volume: volumes[channel] });
      } else if (command === 0x80 || (command === 0x90 && d2 === 0)) {
        const key = channel * 128 + d1;
        const stack = active.get(key);
        if (stack && stack.length) {
          const on = stack.pop();
          notes.push({
            startTick: on.tick, endTick: absTick, pitch: d1, velocity: on.velocity,
            channel, track: t, program: on.program, pan: on.pan, volume: on.volume,
          });
        }
      } else if (command === 0xC0) {
        programs[channel] = d1;
      } else if (command === 0xB0) {
        if (d1 === 10) pans[channel] = d2;
        else if (d1 === 7) volumes[channel] = d2;
      }
    }

    // Close hanging notes at the end of the track.
    for (const [key, stack] of active) {
      const hangChannel = Math.floor(key / 128);
      const hangPitch = key % 128;
      while (stack.length) {
        const on = stack.pop();
        notes.push({
          startTick: on.tick, endTick: absTick, pitch: hangPitch, velocity: on.velocity,
          channel: hangChannel, track: t, program: on.program, pan: on.pan, volume: on.volume,
        });
      }
    }

    if (notes.length) tracks.push({ index: t, name: name || `Track ${t + 1}`, notes });
    trackNames[t] = name || `Track ${t + 1}`;
  }

  if (!tracks.length) throw new Error('MIDI 中没有可用的音符');

  tempoEvents.sort((a, b) => a.tick - b.tick || b.us - a.us);
  const segments = [{ tick: 0, sec: 0, us: 500000 }];
  for (const ev of tempoEvents) {
    const last = segments[segments.length - 1];
    if (ev.tick === last.tick) {
      last.us = ev.us;
      continue;
    }
    const sec = last.sec + (ev.tick - last.tick) * 1e-6 * last.us / ppq;
    segments.push({ tick: ev.tick, sec, us: ev.us });
  }
  if (segments.length === 1 && tempoEvents.length) segments[0].us = tempoEvents[0].us;

  const tickToSec = (tick) => {
    let lo = 0, hi = segments.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].tick <= tick) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const seg = segments[best];
    return seg.sec + (tick - seg.tick) * 1e-6 * seg.us / ppq;
  };

  const notes = [];
  let maxTick = 0;
  for (const track of tracks) {
    for (const n of track.notes) {
      const start = tickToSec(n.startTick);
      const end = Math.max(start + 0.03, tickToSec(Math.max(n.endTick, n.startTick + 1)));
      if (end <= 0) continue;
      notes.push({
        pitch: n.pitch,
        velocity: n.velocity,
        channel: n.channel,
        track: n.track,
        trackName: trackNames[n.track],
        program: n.program,
        start,
        end,
        duration: end - start,
        pan: (n.pan - 64) / 64,
        volume: n.volume / 127,
        name: noteName(n.pitch),
      });
      if (n.endTick > maxTick) maxTick = n.endTick;
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const duration = Math.max(0.1, tickToSec(maxTick));
  const bpm = 60000000 / segments[0].us;
  const ts = timeSignatures[0] || { numerator: 4, denominator: 4 };

  return {
    format,
    ppq,
    bpm,
    duration,
    notes,
    trackNames: trackNames.filter(Boolean),
    tempoSegments: segments,
    timeSignature: ts,
    noteCount: notes.length,
    trackCount: tracks.length,
    maxTick,
    tickToSec,
  };
}

// ── Synthesis ────────────────────────────────────────────────────────────────

function normalizeBuffer(buffer, target = 0.9) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > peak) peak = a;
    }
  }
  if (peak < 1e-6) return;
  const scale = Math.min(24, target / peak);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= scale;
  }
}

function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

const mtof = midiToFreq;

function programVoice(program) {
  // General MIDI family → oscillator / envelope profile.
  const p = program;
  if (p < 8) return { type: 'triangle', attack: 0.004, decay: 0.28, sustain: 0.22, release: 0.12, cutoff: 5200, q: 0.5, harmonics: 2, reverb: 0.2 };
  if (p < 16) return { type: 'sine', attack: 0.003, decay: 0.22, sustain: 0.15, release: 0.1, cutoff: 4200, q: 0.6, harmonics: 2, reverb: 0.25 };
  if (p < 24) return { type: 'sine', attack: 0.03, decay: 0.1, sustain: 0.65, release: 0.2, cutoff: 5000, q: 0.4, harmonics: 2, reverb: 0.4 };
  if (p < 32) return { type: 'sawtooth', attack: 0.006, decay: 0.5, sustain: 0.16, release: 0.2, cutoff: 2400, q: 1.1, harmonics: 1, reverb: 0.22 };
  if (p < 40) return { type: 'triangle', attack: 0.008, decay: 0.4, sustain: 0.26, release: 0.16, cutoff: 900, q: 0.8, harmonics: 1, reverb: 0.12 };
  if (p < 48) return { type: 'sawtooth', attack: 0.15, decay: 0.25, sustain: 0.7, release: 0.5, cutoff: 2100, q: 0.5, harmonics: 2, reverb: 0.55 };
  if (p < 56) return { type: 'sawtooth', attack: 0.12, decay: 0.3, sustain: 0.6, release: 0.45, cutoff: 2600, q: 0.7, harmonics: 2, reverb: 0.45 };
  if (p < 64) return { type: 'sawtooth', attack: 0.04, decay: 0.2, sustain: 0.55, release: 0.25, cutoff: 3200, q: 0.9, harmonics: 2, reverb: 0.35 };
  if (p < 72) return { type: 'square', attack: 0.025, decay: 0.15, sustain: 0.5, release: 0.2, cutoff: 2800, q: 1.0, harmonics: 1, reverb: 0.35 };
  if (p < 80) return { type: 'sine', attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.25, cutoff: 4200, q: 0.5, harmonics: 2, reverb: 0.5 };
  if (p < 88) return { type: 'sawtooth', attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.2, cutoff: 3800, q: 1.4, harmonics: 1, reverb: 0.35 };
  if (p < 96) return { type: 'triangle', attack: 0.18, decay: 0.3, sustain: 0.75, release: 0.6, cutoff: 2300, q: 0.5, harmonics: 2, reverb: 0.6 };
  if (p < 104) return { type: 'triangle', attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.3, cutoff: 3000, q: 0.8, harmonics: 1, reverb: 0.5 };
  if (p < 112) return { type: 'triangle', attack: 0.01, decay: 0.2, sustain: 0.35, release: 0.16, cutoff: 2400, q: 0.9, harmonics: 1, reverb: 0.3 };
  return { type: 'sine', attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.3, cutoff: 2800, q: 0.6, harmonics: 1, reverb: 0.4 };
}

export async function renderMidiToBuffer(midi, targetSampleRate = 44100) {
  const tail = 2.5;
  const duration = Math.min(600, Math.max(1, midi.duration + tail));
  if (midi.duration > 600) throw new Error('MIDI 时长超过 10 分钟，暂不支持合成');
  const sampleRate = targetSampleRate || 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.65;
  master.gain.setValueAtTime(0.0001, 0);
  master.gain.exponentialRampToValueAtTime(0.72, 0.03);
  master.gain.setValueAtTime(0.72, Math.max(0.05, duration - 1.8));
  master.gain.exponentialRampToValueAtTime(0.0001, duration - 0.05);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15;
  comp.knee.value = 20;
  comp.ratio.value = 3.4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master.connect(comp).connect(ctx.destination);

  // Synthetic reverb.
  const reverb = ctx.createConvolver();
  const impulseLength = Math.floor(Math.min(3.2, duration) * sampleRate);
  const impulse = ctx.createBuffer(2, impulseLength, sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) * 0.5;
    }
  }
  reverb.buffer = impulse;
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.3;
  reverb.connect(reverbGain).connect(master);

  const noise = ctx.createBuffer(1, sampleRate * 2, sampleRate);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  const melodicBus = ctx.createGain();
  melodicBus.gain.value = 0.55;
  melodicBus.connect(master);
  const drumBus = ctx.createGain();
  drumBus.gain.value = 0.55;
  drumBus.connect(master);

  const notes = midi.notes;
  const drumNotes = [];
  const melodic = [];
  for (const n of notes) {
    if (n.channel === 9) drumNotes.push(n);
    else melodic.push(n);
  }

  for (const note of melodic) {
    const voice = programVoice(note.program);
    const start = note.start;
    const end = Math.min(duration - 0.04, note.end);
    if (start >= duration - 0.1 || end <= start) continue;
    const dur = Math.max(0.025, end - start);
    const attack = Math.min(voice.attack, dur * 0.3);
    const decay = Math.min(voice.decay, Math.max(0.04, dur * 0.6));
    const release = Math.min(voice.release, 1.4);
    const peak = Math.max(0.0008, Math.min(0.16, (note.velocity / 127) * 0.12 * (note.volume || 1)));

    const panner = ctx.createStereoPanner();
    const pan = Number.isFinite(note.pan) && Math.abs(note.pan) > 0.01
      ? note.pan
      : Math.sin((note.track + 1) * 2.39 + note.pitch * 0.11) * 0.32;
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    panner.connect(melodicBus);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(12000, voice.cutoff + note.velocity * 18), start);
    filter.Q.value = voice.q;
    filter.connect(panner);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    const sustainAt = Math.min(end, start + attack + decay);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * voice.sustain), sustainAt);
    if (end > sustainAt) {
      env.gain.setValueAtTime(Math.max(0.0001, peak * voice.sustain), Math.max(sustainAt, end - release));
    }
    env.gain.exponentialRampToValueAtTime(0.0001, Math.min(duration - 0.01, end + release * 0.35));
    env.connect(filter);

    const oscCount = dur > 0.35 && voice.harmonics > 1 ? 2 : 1;
    for (let h = 0; h < oscCount; h++) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.value = mtof(note.pitch);
      osc.detune.value = h === 0 ? -5 : 6;
      osc.connect(env);
      osc.start(start);
      osc.stop(Math.min(duration - 0.02, end + release));
    }

    const send = ctx.createGain();
    send.gain.value = voice.reverb * (dur > 1 ? 1 : 0.55);
    panner.connect(send).connect(reverb);
  }

  for (const note of drumNotes) {
    if (note.start >= duration - 0.1) continue;
    const t = note.start;
    const vel = Math.max(0.15, note.velocity / 127);
    const kind = note.pitch;
    if (kind === 35 || kind === 36) {
      // Kick.
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(g).connect(drumBus);
      osc.start(t);
      osc.stop(t + 0.35);
    } else if (kind === 38 || kind === 40 || kind === 39) {
      // Snare / clap.
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = kind === 39 ? 'bandpass' : 'highpass';
      bp.frequency.value = kind === 39 ? 1400 : 900;
      if (kind === 39) bp.Q.value = 1.4;
      const g = ctx.createGain();
      const len = kind === 39 ? 0.17 : 0.20;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18 * vel, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(bp).connect(g).connect(drumBus);
      src.start(t);
      src.stop(t + len + 0.02);
      const body = ctx.createOscillator();
      const bg = ctx.createGain();
      body.type = 'triangle';
      body.frequency.value = 185;
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.08 * vel, t + 0.002);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      body.connect(bg).connect(drumBus);
      body.start(t);
      body.stop(t + 0.1);
    } else if (kind === 42 || kind === 44 || kind === 46) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const g = ctx.createGain();
      const len = kind === 46 ? 0.24 : 0.045;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035 * vel, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(hp).connect(g).connect(drumBus);
      src.start(t, Math.random() * 1);
      src.stop(t + len + 0.02);
    } else if (kind === 49 || kind === 51 || kind === 52 || kind === 55 || kind === 57) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.065 * vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      src.connect(hp).connect(g).connect(drumBus);
      src.start(t);
      src.stop(t + 1.45);
    } else {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = mtof(note.pitch);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g).connect(drumBus);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  }

  const rendered = await ctx.startRendering();
  normalizeBuffer(rendered, 0.9);
  return rendered;
}

export function describeMidi(midi) {
  const tracks = Math.max(1, midi.trackCount);
  const bpm = midi.bpm ? Math.round(midi.bpm * 10) / 10 : 0;
  return `${tracks} 轨 · ${midi.noteCount} 音符 · ${bpm} BPM`;
}
