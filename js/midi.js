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
    trackNames: trackNames.map((name, index) => name || `Track ${index + 1}`),
    tempoSegments: segments,
    timeSignature: ts,
    noteCount: notes.length,
    trackCount: tracks.length,
    maxTick,
    tickToSec,
  };
}
