// Copyright (C) 2026 Tatsukini
/**
 * Shared music theory helpers: time signature resolution, chord / key
 * inference from MIDI note lists and General-MIDI drum mapping. Pure data
 * functions so both the canvas drawers and the settings UI can use them.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const DEFAULT_TIME_SIGNATURE = { numerator: 4, denominator: 4 };

export function pitchClass(pitch) {
  return ((Math.round(Number(pitch) || 0) % 12) + 12) % 12;
}

export function noteLabel(pitch) {
  const n = Math.round(Number(pitch) || 0);
  return `${NOTE_NAMES[pitchClass(n)]}${Math.floor(n / 12) - 1}`;
}

/** Parse "6/8", "3 / 4", "7" into a signature; invalid input returns null. */
export function parseTimeSignature(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\s*(?:\/|:|\|)\s*(\d{1,2})$/);
  let numerator;
  let denominator;
  if (match) {
    numerator = Number(match[1]);
    denominator = Number(match[2]);
  } else if (/^\d{1,2}$/.test(raw)) {
    numerator = Number(raw);
    denominator = 4;
  } else {
    return null;
  }
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 16) return null;
  if (![1, 2, 4, 8, 16, 32].includes(denominator)) return null;
  return { numerator, denominator };
}

export function formatTimeSignature(sig) {
  const s = sig || DEFAULT_TIME_SIGNATURE;
  return `${s.numerator}/${s.denominator}`;
}

/**
 * Resolve the effective signature: an explicit basic-info value wins, then the
 * MIDI metadata, then 4/4. `beats` counts denominator units (6 for 6/8) while
 * `quarterBeats` is the bar length measured in quarter notes.
 */
export function resolveTimeSignature(info, midi) {
  const manual = parseTimeSignature(info?.timeSignature);
  const fromMidi = midi?.timeSignature
    && Number(midi.timeSignature.numerator) > 0
    && Number(midi.timeSignature.denominator) > 0
    ? { numerator: Number(midi.timeSignature.numerator), denominator: Number(midi.timeSignature.denominator) }
    : null;
  const sig = manual || fromMidi || { ...DEFAULT_TIME_SIGNATURE };
  return {
    ...sig,
    source: manual ? 'manual' : fromMidi ? 'midi' : 'default',
    beats: sig.numerator,
    quarterBeats: sig.numerator * (4 / sig.denominator),
  };
}

export function barSeconds(sig, bpm) {
  const quarters = Math.max(0.25, Number(sig?.quarterBeats) || 4);
  const tempo = clampTempo(bpm);
  return quarters * 60 / tempo;
}

export function clampTempo(bpm) {
  const value = Number(bpm);
  return Number.isFinite(value) && value > 0 ? Math.min(400, Math.max(20, value)) : 120;
}

/** Bar / beat position of a playback time under a signature and tempo. */
export function beatPosition(time, sig, bpm) {
  const barSec = barSeconds(sig, bpm);
  const beats = Math.max(1, Number(sig?.beats) || 4);
  const total = Math.max(0, Number(time) || 0) / barSec;
  const bar = Math.floor(total);
  const barPhase = total - bar;
  return {
    bar,
    barPhase,
    beatInBar: Math.min(beats - 1, Math.floor(barPhase * beats)),
    beatPhase: (barPhase * beats) % 1,
    barSec,
    beats,
  };
}

// ── Chord templates ─────────────────────────────────────────────────────────

const CHORD_TEMPLATES = [
  { quality: '', label: '', intervals: [0, 4, 7], weight: 3 },
  { quality: 'm', label: 'm', intervals: [0, 3, 7], weight: 3 },
  { quality: '5', label: '5', intervals: [0, 7], weight: 2 },
  { quality: 'sus2', label: 'sus2', intervals: [0, 2, 7], weight: 3 },
  { quality: 'sus4', label: 'sus4', intervals: [0, 5, 7], weight: 3 },
  { quality: 'dim', label: 'dim', intervals: [0, 3, 6], weight: 3 },
  { quality: 'aug', label: 'aug', intervals: [0, 4, 8], weight: 3 },
  { quality: '6', label: '6', intervals: [0, 4, 7, 9], weight: 4 },
  { quality: 'm6', label: 'm6', intervals: [0, 3, 7, 9], weight: 4 },
  { quality: '7', label: '7', intervals: [0, 4, 7, 10], weight: 4 },
  { quality: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11], weight: 4 },
  { quality: 'm7', label: 'm7', intervals: [0, 3, 7, 10], weight: 4 },
  { quality: 'mMaj7', label: 'mMaj7', intervals: [0, 3, 7, 11], weight: 4 },
  { quality: 'dim7', label: 'dim7', intervals: [0, 3, 6, 9], weight: 4 },
  { quality: 'm7b5', label: 'm7♭5', intervals: [0, 3, 6, 10], weight: 4 },
  { quality: '7sus4', label: '7sus4', intervals: [0, 5, 7, 10], weight: 4 },
  { quality: 'add9', label: 'add9', intervals: [0, 4, 7, 2], weight: 4 },
  { quality: 'madd9', label: 'madd9', intervals: [0, 3, 7, 2], weight: 4 },
  { quality: '9', label: '9', intervals: [0, 4, 7, 10, 2], weight: 5 },
  { quality: 'maj9', label: 'maj9', intervals: [0, 4, 7, 11, 2], weight: 5 },
  { quality: 'm9', label: 'm9', intervals: [0, 3, 7, 10, 2], weight: 5 },
];

/**
 * Identify the chord sounding in a set of MIDI pitches. `bass` (lowest pitch)
 * breaks ties toward the actual root. Returns null when nothing convincing.
 */
export function detectChord(pitches, bass = null) {
  const pcs = new Set();
  for (const pitch of pitches || []) {
    if (Number.isFinite(Number(pitch))) pcs.add(pitchClass(pitch));
  }
  if (pcs.size < 2) {
    if (pcs.size === 1) {
      const root = [...pcs][0];
      return { root, quality: '', label: '', name: NOTE_NAMES[root], pitches: [root], score: 0.4, single: true };
    }
    return null;
  }
  const bassPc = Number.isFinite(Number(bass)) ? pitchClass(bass) : null;
  let best = null;
  for (let root = 0; root < 12; root += 1) {
    for (const template of CHORD_TEMPLATES) {
      const wanted = template.intervals.map((interval) => (root + interval) % 12);
      let matched = 0;
      for (const pc of wanted) if (pcs.has(pc)) matched += 1;
      if (matched < Math.min(2, wanted.length)) continue;
      const missing = wanted.length - matched;
      let extra = 0;
      for (const pc of pcs) if (!wanted.includes(pc)) extra += 1;
      const coverage = matched / wanted.length;
      if (coverage < 0.6) continue;
      let score = coverage * 2 - missing * 0.45 - extra * 0.5 + template.weight * 0.06;
      if (bassPc === root) score += 0.35;
      else if (bassPc !== null && wanted.includes(bassPc)) score += 0.08;
      if (!best || score > best.score + 1e-6) {
        best = {
          root,
          quality: template.quality,
          label: template.label,
          name: `${NOTE_NAMES[root]}${template.label}`,
          pitches: wanted.filter((pc) => pcs.has(pc)),
          score,
        };
      }
    }
  }
  return best && best.score > 0.5 ? best : null;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(hist, profile, shift) {
  let sum = 0;
  let histMean = 0;
  let profMean = 0;
  for (let i = 0; i < 12; i += 1) {
    histMean += hist[(i + shift) % 12];
    profMean += profile[i];
  }
  histMean /= 12;
  profMean /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i += 1) {
    const a = hist[(i + shift) % 12] - histMean;
    const b = profile[i] - profMean;
    num += a * b;
    da += a * a;
    db += b * b;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-9 ? num / den : 0;
}

/** Krumhansl-Schmuckler key estimate from weighted pitch classes. */
export function inferKey(notes) {
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const note of notes || []) {
    const weight = Math.max(0.02, Number(note.end) - Number(note.start)) * (0.4 + (Number(note.velocity) || 64) / 127);
    hist[pitchClass(note.pitch)] += weight;
    total += weight;
  }
  if (total <= 0) return null;
  let best = null;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const major = correlate(hist, MAJOR_PROFILE, tonic);
    const minor = correlate(hist, MINOR_PROFILE, tonic);
    if (!best || major > best.score) best = { tonic, mode: 'MAJOR', score: major };
    if (minor > best.score) best = { tonic, mode: 'MINOR', score: minor };
  }
  if (!best || best.score < 0.2) return null;
  return { ...best, name: `${NOTE_NAMES[best.tonic]} ${best.mode}` };
}

/** Parse a user key string like "F# minor", "Bb", "3A" is not supported. */
export function parseKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^([A-Ga-g])\s*([#b♯♭]?)\s*(.*)$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
  let tonic = base;
  if (accidental === '#' || accidental === '♯') tonic += 1;
  if (accidental === 'b' || accidental === '♭') tonic -= 1;
  tonic = ((tonic % 12) + 12) % 12;
  const rest = match[3].trim().toLowerCase();
  let mode = 'MAJOR';
  if (/^(m|min|minor|小调|小調)$/.test(rest)) mode = 'MINOR';
  else if (rest && !/^(maj|major|大调|大調)$/.test(rest)) return null;
  return { tonic, mode, name: `${NOTE_NAMES[tonic]} ${mode}` };
}

/**
 * Segment a track's notes into chords. Notes are quantized onto a grid derived
 * from the tempo/signature, then consecutive cells with the same chord merge.
 */
export function chordSegments(notes, { bpm = 120, sig = DEFAULT_TIME_SIGNATURE, division = 2, tolerance = 0.05 } = {}) {
  const list = (notes || []).filter((note) => Number.isFinite(Number(note.start)) && Number.isFinite(Number(note.pitch)));
  if (!list.length) return [];
  const tempo = clampTempo(bpm);
  const beatSec = 60 / tempo;
  const cellSec = Math.max(0.05, beatSec / Math.max(1, division));
  const sorted = list.slice().sort((a, b) => a.start - b.start);
  const end = sorted.reduce((max, note) => Math.max(max, Number(note.end) || note.start), 0);
  const cells = Math.min(8192, Math.ceil(end / cellSec) + 1);
  const segments = [];
  let current = null;
  let cursor = 0;
  const active = [];
  for (let cell = 0; cell < cells; cell += 1) {
    const start = cell * cellSec;
    const stop = start + cellSec;
    while (cursor < sorted.length && sorted[cursor].start < stop) {
      active.push(sorted[cursor]);
      cursor += 1;
    }
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const note = active[i];
      const noteEnd = Math.max(Number(note.end) || note.start, note.start + tolerance);
      if (noteEnd <= start) active.splice(i, 1);
    }
    const sounding = active.map((note) => note.pitch);
    const bass = active.length ? active.reduce((min, note) => Math.min(min, note.pitch), Infinity) : null;
    const chord = sounding.length ? detectChord(sounding, bass) : null;
    const name = chord?.name || '';
    if (current && current.name === name) {
      current.end = stop;
      if (chord) {
        for (const pc of chord.pitches) if (!current.pitches.includes(pc)) current.pitches.push(pc);
      }
      continue;
    }
    if (current) segments.push(current);
    current = chord
      ? { start, end: stop, name, root: chord.root, quality: chord.quality, label: chord.label, pitches: chord.pitches.slice() }
      : { start, end: stop, name: '', root: null, quality: '', label: '', pitches: [] };
  }
  if (current) segments.push(current);

  // Short silences between staccato chords would otherwise flip the display to
  // N.C. every other step; carry the previous chord through them.
  const merged = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!segment.name) {
      if (previous?.name && segment.end - segment.start <= cellSec * 2.5) previous.end = segment.end;
      else merged.push(segment);
      continue;
    }
    if (previous?.name === segment.name) {
      previous.end = segment.end;
      continue;
    }
    merged.push(segment);
  }
  return merged.filter((segment) => segment.name || segment.end - segment.start >= cellSec);
}

export function chordAt(segments, time) {
  const t = Math.max(0, Number(time) || 0);
  let index = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].start <= t) index = i;
    else break;
  }
  if (index < 0) return { current: null, next: null, index: -1, progress: 0 };
  const current = segments[index];
  const next = segments.slice(index + 1).find((segment) => segment.name) || null;
  const span = Math.max(0.001, current.end - current.start);
  return { current, next, index, progress: Math.min(1, Math.max(0, (t - current.start) / span)) };
}

/** Pick the most polyphonic melodic track as the default harmony source. */
/** Stable reference for a merged track: survives re-imports and layer deletion. */
export function midiTrackKey(track) {
  if (!track) return '';
  return `${track.layerId || 'base'}:${Number(track.localTrack ?? track.index) || 0}`;
}

/** Resolve a stable key (or legacy numeric index) back to a merged track index. */
export function resolveMidiTrackIndex(midi, value) {
  const raw = String(value ?? '');
  const tracks = midi?.tracks || [];
  if (raw.includes(':')) {
    const split = raw.lastIndexOf(':');
    const layerId = raw.slice(0, split);
    const local = Number(raw.slice(split + 1));
    const found = tracks.find((track) => String(track.layerId || 'base') === layerId
      && Number(track.localTrack ?? track.index) === local);
    return found ? found.index : -1;
  }
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < tracks.length ? index : -1;
}

export function harmonyTrackIndex(midi) {
  const notes = (midi?.notes || []).filter((note) => Number(note.channel) !== 9);
  if (!notes.length) return -1;
  const stats = new Map();
  for (const note of notes) {
    const index = Number(note.track) || 0;
    let stat = stats.get(index);
    if (!stat) {
      stat = { index, count: 0, poly: 0, lastEnd: 0 };
      stats.set(index, stat);
    }
    stat.count += 1;
    if (note.start < stat.lastEnd - 0.02) stat.poly += 1;
    stat.lastEnd = Math.max(stat.lastEnd, Number(note.end) || note.start);
  }
  let best = null;
  for (const stat of stats.values()) {
    const score = stat.poly * 3 + stat.count;
    if (!best || score > best.score) best = { ...stat, score };
  }
  return best ? best.index : -1;
}

// ── Drums ───────────────────────────────────────────────────────────────────

export const GM_DRUMS = [
  { name: 'KICK', pitches: [35, 36], color: '#FF4F8B' },
  { name: 'SNARE', pitches: [38, 40], color: '#FFB454' },
  { name: 'CLAP', pitches: [39], color: '#FF8A6B' },
  { name: 'HATS', pitches: [42, 44], color: '#37D8FF' },
  { name: 'OPEN HAT', pitches: [46], color: '#7CE7FF' },
  { name: 'LOW TOM', pitches: [41, 43], color: '#A67CFF' },
  { name: 'MID TOM', pitches: [45, 47], color: '#B99CFF' },
  { name: 'HIGH TOM', pitches: [48, 50], color: '#D0BCFF' },
  { name: 'CRASH', pitches: [49, 57], color: '#B9FF8A' },
  { name: 'RIDE', pitches: [51, 59], color: '#8AFFC1' },
  { name: 'PERC', pitches: [56, 60, 61, 62, 63, 64, 65, 66, 67, 68], color: '#FFD166' },
];

export const DRUM_TRACK_LIMIT = 7;
export const STEPS_PER_BEAT = 4;
export const PATTERN_MAX_STEPS = 64;

/** Sequencer resolution: 1/16 notes, so a bar holds `beats * 4` steps. */
export function stepCountFor(sig) {
  const beats = Math.max(1, Number(sig?.beats) || 4);
  return Math.min(PATTERN_MAX_STEPS, Math.round(beats * STEPS_PER_BEAT));
}

export function drumNotes(midi) {
  return (midi?.notes || []).filter((note) => Number(note.channel) === 9);
}

/** Suggest up to seven drum rows from the percussion channel of a MIDI. */
export function suggestDrumTracks(midi, limit = DRUM_TRACK_LIMIT) {
  const notes = drumNotes(midi);
  if (!notes.length) return [];
  const counts = new Map();
  for (const note of notes) counts.set(note.pitch, (counts.get(note.pitch) || 0) + 1);
  const rows = [];
  for (const drum of GM_DRUMS) {
    const pitches = drum.pitches.filter((pitch) => counts.has(pitch));
    if (!pitches.length) continue;
    const hits = pitches.reduce((sum, pitch) => sum + (counts.get(pitch) || 0), 0);
    rows.push({ name: drum.name, color: drum.color, pitches, hits });
  }
  rows.sort((a, b) => b.hits - a.hits);
  return rows.slice(0, limit).map(({ name, color, pitches }) => ({ name, color, pitches }));
}

/**
 * Read the bar under `time` off the MIDI percussion channel. Used by the drum
 * board to seed a pattern from the song; each step keeps the loudest velocity.
 */
export function drumStepRows(board, midi, { time = 0, bpm = 120, sig = DEFAULT_TIME_SIGNATURE } = {}) {
  const tempo = clampTempo(bpm);
  const beats = Math.max(1, Number(sig?.beats) || 4);
  const unitSec = (60 / tempo) * (4 / Math.max(1, Number(sig?.denominator) || 4));
  const barSec = unitSec * beats;
  const steps = stepCountFor(sig);
  const stepSec = barSec / steps;
  const barStart = Math.floor(Math.max(0, time) / barSec) * barSec;
  const notes = (midi?.notes || []).filter((note) => note.start >= barStart && note.start < barStart + barSec);
  const rows = [];
  for (const track of board || []) {
    const pitches = new Set((track.pitches || []).map((pitch) => Number(pitch)));
    const channel = track.channel === undefined || track.channel === null ? null : Number(track.channel);
    const values = new Array(steps).fill(0);
    for (const note of notes) {
      if (channel !== null && Number(note.channel) !== channel) continue;
      if (channel === null && !pitches.has(Number(note.pitch))) continue;
      const step = Math.min(steps - 1, Math.floor((note.start - barStart) / stepSec));
      const velocity = clamp01((Number(note.velocity) || 64) / 127);
      values[step] = Math.max(values[step], velocity);
    }
    rows.push({ track, values });
  }
  const position = beatPosition(time, sig, tempo);
  return { rows, steps, stepSec, barStart, barSec, playhead: position.barPhase, beatInBar: position.beatInBar, beats };
}

/** Rows straight from the user-edited pattern, padded/truncated to `steps`. */
export function patternRows(board, steps) {
  const rows = [];
  for (const track of board || []) {
    const pattern = Array.isArray(track.pattern) ? track.pattern : [];
    const values = new Array(steps).fill(0);
    for (let step = 0; step < steps; step += 1) {
      values[step] = clamp01(Number(pattern[step]) || 0);
    }
    rows.push({ track, values });
  }
  return rows;
}

export function emptyPattern(steps) {
  return new Array(Math.max(1, steps)).fill(0);
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}