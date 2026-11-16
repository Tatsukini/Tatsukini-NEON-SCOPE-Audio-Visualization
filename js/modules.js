// Copyright (C) 2026 Tatsukini
import {
  STAGE_W, STAGE_H, MODULE_DEFS, clamp, lerp, rgba, mixHex, lighten, darken, hexToRgb,
  luminance, roundRect, spacedText, formatShortTime, isHexColor, hexAlpha, SCHEME_COLORS,
} from './core.js';
import {
  resolveTimeSignature, formatTimeSignature, barSeconds, clampTempo,
  chordSegments, chordAt, resolveMidiTrackIndex, inferKey, parseKey, noteLabel,
  patternRows, stepCountFor, STEPS_PER_BEAT, DRUM_TRACK_LIMIT, NOTE_NAMES,
} from './music.js';

const MONO = '"Cascadia Code", "Consolas", "SFMono-Regular", monospace';
const SANS = '"Bahnschrift", "Segoe UI Variable", "Microsoft YaHei UI", sans-serif';
const TAU = Math.PI * 2;
const HEAD_H = 26;

// Stage typography is authored at 1920×1080 and then scaled down for the
// preview. Small UI type gets a proportional boost so module labels stay
// readable at common desktop sizes without inflating the hero numerals.
function boosted(size) {
  if (size <= 12) return size * 1.45;
  if (size <= 14) return size * 1.16;
  return size;
}

const META_LABELS = {
  levels: 'L/R', loudness: 'LUFS', dial: 'VU', scope: 'TIME',
  lissajous: 'X-Y', spectrum: 'FFT', phase: 'CORR', rhythm: 'BPM',
  dynamics: 'DYN', spectrogram: 'STFT', stereometer: 'POLAR',
  waveform: 'FULL', pianoRoll: 'MIDI', midiOC: 'NOTE Δ', peakSlope: 'PEAK', stereoField: 'WIDE',
  flPlaylist: 'ARRANGE', harmony: 'CHORD', drumStep: 'STEP',
  basicInfo: 'INFO',
};

function mono(ctx, size, weight = '400') {
  ctx.font = `${weight} ${boosted(size)}px ${MONO}`;
}
function sans(ctx, size, weight = '400') {
  ctx.font = `${weight} ${boosted(size)}px ${SANS}`;
}
function getState(env, mod) {
  let s = env.states.get(mod.id);
  if (!s) {
    s = {};
    env.states.set(mod.id, s);
  }
  return s;
}
function stateArray(st, key, length) {
  if (!st[key] || st[key].length !== length) st[key] = new Float32Array(length);
  return st[key];
}
function ensureLayer(st, key, w, h) {
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  let c = st[key];
  if (!c) {
    c = document.createElement('canvas');
    st[key] = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext('2d'), resized: true };
  }
  return { canvas: c, ctx: c.getContext('2d'), resized: false };
}
function clipRect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}
function dbToNorm(db, min = -60, max = 0) {
  return clamp((db - min) / (max - min), 0, 1);
}
function ampToDb(v) {
  return v > 1e-7 ? 20 * Math.log10(v) : -60;
}
function fmtDb(v, digits = 1) {
  if (!Number.isFinite(v) || v <= -59.5) return '−∞';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}
function channelMode(mod) {
  const setting = modOpt(mod, 'channel', 'auto');
  if (setting === 'L' || setting === 'R' || setting === 'BOTH') return setting;
  const t = (mod.title || '').toUpperCase();
  if (/·\s*L\s*$/.test(t) || /\bL ONLY\b/.test(t)) return 'L';
  if (/·\s*R\s*$/.test(t) || /\bR ONLY\b/.test(t)) return 'R';
  return 'BOTH';
}

function moduleTitleText(mod, fallback) {
  const raw = (mod.title || fallback || '').toUpperCase();
  if (mod.type !== 'scope') return raw;
  const setting = modOpt(mod, 'channel', 'auto');
  if (setting !== 'L' && setting !== 'R' && setting !== 'BOTH') return raw;
  const base = raw.replace(/\s*·\s*(L|R|BOTH)\s*$/i, '');
  return `${base} · ${setting}`;
}

function modOpt(mod, key, fallback) {
  const value = mod.options?.[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function modNum(mod, key, fallback, min = -Infinity, max = Infinity) {
  const value = Number(modOpt(mod, key, fallback));
  return clamp(Number.isFinite(value) ? value : fallback, min, max);
}

/** Draw the common panel frame. Returns the inner body rect. */
function drawCard(ctx, mod, accent, env) {
  const def = MODULE_DEFS[mod.type];
  const x = Math.round(mod.x), y = Math.round(mod.y);
  const w = Math.round(mod.w), h = Math.round(mod.h);
  const glow = clamp(env.settings.glow / 100, 0, 1);
  const palette = env.palette || { bg: '#050308', window: '#171020', text: '#f7eef3', chart: accent };
  const rgb = hexToRgb(palette.chart || accent);
  const titleText = palette.text || '#f7eef3';
  const micro = rgba(palette.chart || accent, 0.55);

  ctx.save();
  ctx.globalAlpha = clamp(mod.opacity ?? 1, 0.05, 1);

  // Panel body.
  if (glow > 0.02) {
    ctx.shadowColor = rgba(accent, 0.18 * glow);
    ctx.shadowBlur = 12 + 18 * glow;
  }
  roundRect(ctx, x, y, w, h, 3.5);
  ctx.fillStyle = rgba(palette.bg || '#050308', 0.9);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, x, y, w, h, 3.5);
  ctx.clip();

  const bg = ctx.createLinearGradient(x, y + HEAD_H, x + w, y + h);
  bg.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.045)`);
  bg.addColorStop(0.45, rgba(palette.bg || '#050308', 0.22));
  bg.addColorStop(1, rgba(palette.window || '#171020', 0.32));
  ctx.fillStyle = bg;
  ctx.fillRect(x, y + HEAD_H, w, h - HEAD_H);

  // Very faint internal grid texture.
  ctx.strokeStyle = rgba(palette.text || '#f7eef3', 0.018);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = x + 24; gx < x + w; gx += 24) {
    ctx.moveTo(Math.round(gx) + 0.5, y + HEAD_H);
    ctx.lineTo(Math.round(gx) + 0.5, y + h);
  }
  for (let gy = y + HEAD_H + 18; gy < y + h; gy += 18) {
    ctx.moveTo(x, Math.round(gy) + 0.5);
    ctx.lineTo(x + w, Math.round(gy) + 0.5);
  }
  ctx.stroke();

  if (env.settings.scanlines) {
    ctx.fillStyle = rgba(palette.text || '#f7eef3', 0.014);
    for (let sy = y + HEAD_H + 2; sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1);
  }

  // Header strip uses the dedicated window color.
  const hg = ctx.createLinearGradient(x, y, x + w, y);
  hg.addColorStop(0, lighten(palette.window || '#171020', 0.08));
  hg.addColorStop(0.45, palette.window || '#171020');
  hg.addColorStop(1, darken(palette.window || '#171020', 0.12));
  ctx.fillStyle = hg;
  ctx.fillRect(x, y, w, HEAD_H);
  ctx.fillStyle = rgba(palette.chart || accent, 0.75);
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = rgba(palette.chart || accent, 0.3);
  ctx.fillRect(x, y + HEAD_H - 1, w, 1);

  // Header icon.
  ctx.fillStyle = palette.chart || accent;
  ctx.globalAlpha = (mod.opacity ?? 1) * 0.9;
  mono(ctx, 8, '700');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.glyph || '◈', x + 8, y + HEAD_H / 2 + 0.5);
  ctx.globalAlpha = mod.opacity ?? 1;

  // Title with clipping.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 23, y, Math.max(10, w - 88), HEAD_H);
  ctx.clip();
  sans(ctx, 10.5, '700');
  ctx.fillStyle = titleText;
  ctx.textAlign = 'left';
  const title = moduleTitleText(mod, def.code);
  ctx.fillText(title, x + 23, y + HEAD_H / 2 + 0.7);
  ctx.restore();

  // Right meta and tiny status marks.
  ctx.textAlign = 'right';
  mono(ctx, 6.5, '600');
  ctx.fillStyle = rgba(palette.text || titleText, 0.5);
  ctx.fillText(META_LABELS[mod.type] || '', x + w - 8, y + HEAD_H / 2 + 0.5);
  ctx.fillStyle = rgba(palette.chart || accent, 0.3);
  for (let i = 0; i < 3; i++) ctx.fillRect(x + w - 48 + i * 4, y + 9, 1.5, 1.5);

  ctx.restore();

  // Border and corner notches.
  ctx.strokeStyle = rgba(accent, 0.34);
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3.5);
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.fillRect(x, y, 8, 1);
  ctx.fillRect(x, y, 1, 8);
  ctx.fillStyle = rgba(accent, 0.35);
  ctx.fillRect(x + w - 8, y + h - 1, 8, 1);
  ctx.fillRect(x + w - 1, y + h - 8, 1, 8);

  ctx.restore();

  return {
    x: x + 1, y: y + HEAD_H + 1, w: w - 2, h: h - HEAD_H - 2, head: HEAD_H, accent, rgb,
  };
}

// ── Meter modules ───────────────────────────────────────────────────────────

function drawLevels(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 11;
  const ix = body.x + p, iy = body.y + p + 1;
  const iw = body.w - p * 2, ih = body.h - p * 2 - 2;
  const footH = 16;
  const meterH = ih - footH - 4;
  if (meterH <= 4) return;
  const ledCount = Math.round(modNum(mod, 'segments', 30, 12, 60));
  const showPeak = modOpt(mod, 'peakHold', true);

  const dbL = ampToDb(frame.rmsL), dbR = ampToDb(frame.rmsR);
  const targetL = dbToNorm(dbL, -54, 0), targetR = dbToNorm(dbR, -54, 0);
  st.l = st.l == null ? 0 : lerp(st.l, targetL, 0.35);
  st.r = st.r == null ? 0 : lerp(st.r, targetR, 0.35);
  st.holdL = Math.max((st.holdL || 0) - 0.0028, st.l);
  st.holdR = Math.max((st.holdR || 0) - 0.0028, st.r);

  // Scale.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  mono(ctx, 6, '400');
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  const ticks = [[0, '0'], [-12, '-12'], [-24, '-24'], [-36, '-36'], [-48, '-48']];
  for (const [db, label] of ticks) {
    const yy = iy + meterH * (1 - dbToNorm(db, -54, 0));
    ctx.fillText(label, ix, yy);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillRect(ix + 16, Math.round(yy) + 0.5, 4, 1);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
  }

  const barW = Math.min(22, iw * 0.23);
  const gap = Math.min(18, iw * 0.12);
  const leftX = ix + iw * 0.35 - barW - gap / 2;
  const rightX = ix + iw * 0.35 + gap / 2;
  const defs = [
    { x: leftX, v: st.l, hold: st.holdL, label: 'L' },
    { x: rightX, v: st.r, hold: st.holdR, label: 'R' },
  ];

  for (const m of defs) {
    const x = Math.round(m.x);
    const y = iy;
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    ctx.fillRect(x, y, barW, meterH);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, meterH - 1);

    // LED segments.
    const segs = ledCount;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const active = t <= m.v;
      const sy = y + meterH - (i + 1) * (meterH / segs) + 1;
      const sh = meterH / segs - 1.6;
      if (active) {
        const hot = t > 0.9;
        const col = hot ? '#ff6f86' : (t > 0.78 ? mixHex(accent, '#ffd479', (t - 0.78) / 0.12) : lighten(accent, 0.08));
        ctx.fillStyle = col;
        ctx.globalAlpha = (mod.opacity ?? 1) * (0.82 + t * 0.18);
        ctx.shadowColor = col;
        ctx.shadowBlur = 4;
        ctx.fillRect(x + 3, sy, barW - 6, Math.max(1, sh));
        ctx.shadowBlur = 0;
        ctx.globalAlpha = mod.opacity ?? 1;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.045)';
        ctx.fillRect(x + 3, sy, barW - 6, Math.max(1, sh));
      }
    }

    // Peak marker.
    if (showPeak) {
      const holdY = y + meterH * (1 - m.hold);
      ctx.fillStyle = m.hold > 0.93 ? '#ff6f86' : '#fff0f5';
      ctx.globalAlpha = (mod.opacity ?? 1) * 0.9;
      ctx.fillRect(x + 1, Math.max(y, Math.round(holdY)), barW - 2, 1.5);
      ctx.globalAlpha = mod.opacity ?? 1;
    }

    mono(ctx, 6.5, '500');
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, x + barW / 2, iy + meterH + footH / 2 + 1);
    mono(ctx, 7, '400');
    ctx.fillStyle = rgba(accent, 0.85);
    ctx.fillText(fmtDb(m.label === 'L' ? dbL : dbR, 0), x + barW / 2, iy + meterH + footH / 2 + 9);
  }

  // Clip flags.
  if (frame.peakL > 0.995) {
    ctx.fillStyle = '#ff4f64';
    ctx.fillRect(leftX + 1, iy - 2, barW - 2, 2);
  }
  if (frame.peakR > 0.995) {
    ctx.fillStyle = '#ff4f64';
    ctx.fillRect(rightX + 1, iy - 2, barW - 2, 2);
  }
}

function drawLoudness(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 12;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;
  if (w < 90 || h < 46) return;
  const compact = h < 168;
  const mainW = w * 0.56;
  const targetLufs = Number(modOpt(mod, 'target', -14));
  const historyLength = Math.round(modNum(mod, 'history', 180, 40, 180));

  // Reserve a footer strip and keep the history band above it, so readouts
  // can never sit on top of the graph on short cards.
  const footH = 13;
  const histH = compact ? clamp(Math.round(h * 0.19), 16, 22) : clamp(Math.round(h * 0.17), 22, 30);
  const histY = y + h - footH - histH;

  // History.
  if (!st.history) st.history = [];
  if (frame.playing) {
    st.history.push(frame.lufsS);
    if (st.history.length > historyLength) st.history.shift();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const yy = Math.round(histY + (histH / 2) * i) + 0.5;
    ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
  }
  ctx.stroke();

  if (st.history.length > 2) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, histY, w, histH);
    ctx.clip();
    ctx.beginPath();
    for (let i = 0; i < st.history.length; i++) {
      const val = clamp((st.history[i] + 42) / 42, 0, 1);
      const px = x + (i / Math.max(1, historyLength - 1)) * w;
      const py = histY + histH - val * histH;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = rgba(accent, 0.68);
    ctx.lineWidth = 1;
    ctx.shadowColor = rgba(accent, 0.45);
    ctx.shadowBlur = 5;
    ctx.stroke();
    ctx.lineTo(x + w, histY + histH);
    ctx.lineTo(x, histY + histH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, histY, 0, histY + histH);
    g.addColorStop(0, rgba(accent, 0.10));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  // Labels.
  sans(ctx, 7, '600');
  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  spacedText(ctx, 'LOUDNESS · SHORT TERM', x, y + 9, 0.7);

  // Main numeric.
  const lufs = frame.lufsS;
  const mainText = lufs <= -59.5 ? '−∞' : lufs.toFixed(1);
  sans(ctx, 36, '300');
  ctx.fillStyle = '#f7e8ee';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(mainText, x, y + 33);
  const nw = ctx.measureText(mainText).width;
  mono(ctx, 8, '500');
  ctx.fillStyle = rgba(accent, 0.78);
  ctx.fillText('LUFS', x + nw + 5, y + 29);

  // Mini target ruler.
  const meterY = y + (compact ? 55 : 66);
  const meterW = mainW - 8;
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.fillRect(x, meterY, meterW, 3);
  const lvl = clamp((lufs + 36) / 36, 0, 1);
  ctx.fillStyle = accent;
  ctx.fillRect(x, meterY, meterW * lvl, 3);
  const targetX = x + clamp((targetLufs + 36) / 36, 0, 1) * meterW;
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillRect(targetX, meterY - 2, 1, 7);
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (let i = 1; i < 6; i++) ctx.fillRect(x + (meterW / 6) * i, meterY, 1, 3);
  mono(ctx, 6, '400');
  ctx.fillStyle = 'rgba(255,255,255,.24)';
  ctx.textAlign = 'left';
  ctx.fillText('-36', x, meterY + 10);
  ctx.textAlign = 'right';
  ctx.fillText('0', x + meterW, meterY + 10);

  // Right column: true peak and integrated. Every unit shares the value's
  // measured width, so negative readouts can't grow into the unit text.
  const rx = x + mainW + 10;
  const rw = w - mainW - 10;
  const dividerX = x + mainW + 1;
  ctx.strokeStyle = 'rgba(255,255,255,.075)';
  ctx.beginPath();
  ctx.moveTo(dividerX, y);
  ctx.lineTo(dividerX, y + h - footH - 2);
  ctx.stroke();
  if (rw < 46) return;

  const tpLabelY = y + 9;
  const tpValueY = y + (compact ? 24 : 32);
  const tpBarY = tpValueY + 6;
  const intLabelY = y + (compact ? 41 : 56);
  const intValueY = y + (compact ? 56 : 77);
  const lrY = y + (compact ? 69 : 93);

  sans(ctx, 6.5, '600');
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  ctx.textAlign = 'left';
  spacedText(ctx, 'TRUE PEAK', rx + 8, tpLabelY, 0.7);
  mono(ctx, 17, '400');
  ctx.fillStyle = '#f3dfe8';
  const tp = frame.truePeakDb;
  const tpText = tp <= -59.5 ? '−∞' : tp.toFixed(1);
  ctx.fillText(tpText, rx + 8, tpValueY);
  const tpW = ctx.measureText(tpText).width;
  mono(ctx, 6.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.fillText('dBTP', rx + 10 + tpW, tpValueY);

  const tpN = dbToNorm(tp, -24, 0);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.fillRect(rx + 8, tpBarY, rw - 16, 2);
  ctx.fillStyle = tp > -1 ? '#ff6f86' : rgba(accent, 0.8);
  ctx.fillRect(rx + 8, tpBarY, (rw - 16) * tpN, 2);

  sans(ctx, 6.5, '600');
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  spacedText(ctx, 'INTEGRATED', rx + 8, intLabelY, 0.7);
  mono(ctx, 14, '400');
  ctx.fillStyle = rgba(accent, 0.9);
  const intText = frame.lufsI <= -59.5 ? '−∞' : frame.lufsI.toFixed(1);
  ctx.fillText(intText, rx + 8, intValueY);
  const intW = ctx.measureText(intText).width;
  mono(ctx, 6.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.fillText('LUFS-I', rx + 10 + intW, intValueY);

  // L / R readouts live in the same reserved top block, never on the graph.
  mono(ctx, 6.5, '500');
  ctx.fillStyle = 'rgba(255,255,255,.24)';
  const lText = `L ${fmtDb(ampToDb(frame.rmsL), 0)}`;
  const rText = `R ${fmtDb(ampToDb(frame.rmsR), 0)}`;
  ctx.textAlign = 'left';
  if (rw >= 104) {
    ctx.fillText(lText, rx + 8, lrY);
    ctx.fillText(rText, rx + 8 + Math.min(rw * 0.5, 52), lrY);
  } else if (lrY + 10 < histY) {
    ctx.fillText(lText, rx + 8, lrY);
    ctx.fillText(rText, rx + 8, lrY + 10);
  }

  // Footer strip below the history.
  sans(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.textAlign = 'left';
  const leftFoot = 'K-WEIGHTED · 400 ms';
  ctx.fillText(leftFoot, x, y + h - 2);
  const leftW = ctx.measureText(leftFoot).width;
  if (w - leftW > 96) {
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(accent, 0.55);
    ctx.fillText('AES17 / ITU-R BS.1770', x + w, y + h - 2);
  }
}

function drawDial(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;
  if (w < 60 || h < 46) return;
  // Keep the arc clear of the bottom readout strip so scale labels and the
  // dB value never share the same baseline.
  const footH = 14;
  const dialH = Math.max(24, h - footH);
  const cx = x + w / 2, cy = y + dialH * 0.58;
  const radius = Math.min(w * 0.42, dialH * 0.52);
  const start = Math.PI * 0.79, end = Math.PI * 2.21;
  const val = clamp(dbToNorm(ampToDb(frame.rms), -40, 3), 0, 1);
  const ballistics = modOpt(mod, 'ballistics', 'medium');
  const speed = ballistics === 'slow' ? 0.055 : ballistics === 'fast' ? 0.32 : 0.14;
  st.needle = st.needle == null ? val : lerp(st.needle, val, speed);
  st.peak = Math.max((st.peak || 0) - 0.0016, st.needle);

  // Arc.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.78);
  ctx.lineWidth = 2.4;
  ctx.shadowColor = rgba(accent, 0.55);
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + (end - start) * st.needle);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Scale ticks.
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = start + (end - start) * t;
    const major = i % 4 === 0;
    const r0 = radius - (major ? 8 : 4);
    ctx.strokeStyle = major ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.24)';
    ctx.lineWidth = major ? 1.3 : 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (radius + 3), cy + Math.sin(a) * (radius + 3));
    ctx.stroke();
  }

  // dB labels.
  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [[-20, 0.05], [-10, 0.27], [-5, 0.49], ['0', 0.70], ['+3', 0.94]];
  for (const [label, t] of labels) {
    const a = start + (end - start) * t;
    ctx.fillText(String(label), cx + Math.cos(a) * (radius + 13), cy + Math.sin(a) * (radius + 13));
  }

  // Peak tick.
  if (modOpt(mod, 'peakHold', true)) {
    const pa = start + (end - start) * st.peak;
    ctx.strokeStyle = rgba(accent, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * (radius - 10), cy + Math.sin(pa) * (radius - 10));
    ctx.lineTo(cx + Math.cos(pa) * (radius + 4), cy + Math.sin(pa) * (radius + 4));
    ctx.stroke();
  }

  // Needle.
  const a = start + (end - start) * st.needle;
  ctx.strokeStyle = '#ffe9ef';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = rgba(accent, 0.65);
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a + Math.PI) * (radius * 0.16), cy + Math.sin(a + Math.PI) * (radius * 0.16));
  ctx.lineTo(cx + Math.cos(a) * (radius - 4), cy + Math.sin(a) * (radius - 4));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Center cap.
  ctx.fillStyle = '#1b1017';
  ctx.strokeStyle = rgba(accent, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, TAU);
  ctx.fill();

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.textAlign = 'left';
  ctx.fillText('VU', x, y + h - 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.fillText(`${fmtDb(ampToDb(frame.rms), 0)} dB`, x + w, y + h - 2);
}

// ── Time-domain modules ─────────────────────────────────────────────────────

function findTrigger(data, searchEnd) {
  const end = Math.min(searchEnd, data.length - 2);
  for (let i = 1; i < end; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) return i;
  }
  return 0;
}

function drawScope(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 8;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  if (w < 20 || h < 20) return;

  const showGrid = modOpt(mod, 'grid', true);
  const traceWidth = modNum(mod, 'lineWidth', 1.25, 0.5, 4);
  const persistence = modNum(mod, 'persistence', 45, 0, 100);

  // Grid.
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const gx = Math.round(x + (w / 8) * i) + 0.5;
      ctx.moveTo(gx, y); ctx.lineTo(gx, y + h);
    }
    for (let i = 1; i < 4; i++) {
      const gy = Math.round(y + (h / 4) * i) + 0.5;
      ctx.moveTo(x, gy); ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
  }

  const mode = channelMode(mod);
  const dataL = frame.tdL, dataR = frame.tdR;
  const mid = st.mid || (st.mid = new Float32Array(dataL.length));
  for (let i = 0; i < dataL.length; i++) mid[i] = (dataL[i] + dataR[i]) * 0.5;
  const trigger = findTrigger(mid, Math.min(1024, dataL.length - 400));
  const windowSize = Math.min(dataL.length - trigger - 1, Math.round(frame.sampleRate * 0.018));
  const points = Math.max(64, Math.min(620, Math.floor(w * 1.5)));
  const sens = clamp(env.settings.sensitivity / 100, 0.4, 2);
  const amp = h * 0.44;

  // Auto-gain makes quiet material visible without flattening loud transients.
  let localPeak = 0.02;
  for (let i = trigger; i < trigger + windowSize; i += 2) {
    const a = Math.max(Math.abs(dataL[i]), mode === 'R' ? 0 : Math.abs(dataR[i]));
    if (a > localPeak) localPeak = a;
  }
  const targetGain = clamp(0.72 / localPeak, 1, 7);
  st.agc = st.agc == null ? targetGain : lerp(st.agc, targetGain, 0.07);
  const gain = st.agc * sens;

  function trace(data, color, alpha, widthPx) {
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const idx = trigger + Math.floor((i / (points - 1)) * windowSize);
      const px = x + (i / (points - 1)) * w;
      const py = y + h / 2 - clamp(data[idx] * gain, -1.35, 1.35) * amp;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = (mod.opacity ?? 1) * alpha;
    ctx.lineWidth = widthPx;
    ctx.shadowColor = color;
    ctx.shadowBlur = 7 + env.settings.glow * 0.12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = mod.opacity ?? 1;
  }

  // Retained ghost traces.
  if (!st.ghosts) st.ghosts = [];
  st.ghosts.unshift({
    l: copySamples(dataL, trigger, windowSize, points),
    r: copySamples(dataR, trigger, windowSize, points),
  });
  const ghostCount = Math.max(0, Math.round(1 + (persistence / 100) * 9));
  while (st.ghosts.length > ghostCount + 1) st.ghosts.pop();

  for (let g = st.ghosts.length - 1; g >= 1; g--) {
    const gh = st.ghosts[g];
    const ga = (0.03 + persistence / 100 * 0.16) * (1 - g / (ghostCount + 2));
    drawGhost(gh.l, mode !== 'R' ? accent : null, ga);
    if (mode === 'BOTH') drawGhost(gh.r, SCHEME_COLORS[1], ga);
  }
  function drawGhost(samples, color, alpha) {
    if (!color) return;
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const px = x + (i / (samples.length - 1)) * w;
      const py = y + h / 2 - clamp(samples[i] * gain, -1.35, 1.35) * amp;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = (mod.opacity ?? 1) * alpha;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.globalAlpha = mod.opacity ?? 1;
  }

  if (mode !== 'R') trace(dataL, accent, 0.92, traceWidth);
  if (mode === 'BOTH') trace(dataR, SCHEME_COLORS[1], 0.62, Math.max(0.6, traceWidth * 0.82));
  if (mode === 'R') trace(dataR, SCHEME_COLORS[1], 0.92, traceWidth);

  // Trigger marker and labels.
  ctx.fillStyle = rgba(accent, 0.5);
  ctx.fillRect(x - 2, y + h / 2 - 3, 3, 6);
  mono(ctx, 6, '400');
  ctx.fillStyle = 'rgba(255,255,255,.27)';
  ctx.textAlign = 'left';
  ctx.fillText(`${(windowSize / frame.sampleRate * 1000).toFixed(1)} ms`, x + 2, y + h - 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.65);
  ctx.fillText(`${mode} / TRIG`, x + w - 2, y + h - 2);
  if (mode === 'BOTH') {
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(accent, 0.7);
    ctx.fillText('L', x + 2, y + 8);
    ctx.fillStyle = rgba(SCHEME_COLORS[1], 0.7);
    ctx.fillText('R', x + 12, y + 8);
  }
}

function copySamples(data, trigger, windowSize, points) {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    out[i] = data[trigger + Math.floor((i / (points - 1)) * windowSize)] || 0;
  }
  return out;
}

function drawLissajous(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 8;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const cx = x + w / 2, cy = y + h / 2;
  const radius = Math.min(w, h) * 0.42;
  const wide = /WIDE|宽屏|宽幅/.test(String(mod.title || '').toUpperCase());
  const rx = wide ? w * 0.46 : radius;
  const ry = wide ? h * 0.42 : radius;
  const trail = modNum(mod, 'trail', 70, 0, 100);
  const dotSize = modNum(mod, 'dotSize', 1.2, 0.5, 3);

  // Grid and target rings.
  if (modOpt(mod, 'rings', true)) {
    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.5, ry * 0.5, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
    ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry);
    ctx.stroke();
  }

  let peak = 0.02;
  const tdLength = frame.tdL?.length || 0;
  for (let i = 0; i < tdLength; i += 4) {
    const a = Math.max(Math.abs(frame.tdL[i]), Math.abs(frame.tdR[i]));
    if (a > peak) peak = a;
  }
  const targetGain = clamp(0.78 / peak, 1, 6);
  st.agc = st.agc == null ? targetGain : lerp(st.agc, targetGain, 0.08);
  const gain = st.agc;

  const layer = ensureLayer(st, 'layer', Math.round(w * 1.5), Math.round(h * 1.5));
  const lc = layer.ctx;
  if (layer.resized) lc.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  lc.globalCompositeOperation = 'destination-out';
  lc.fillStyle = `rgba(0,0,0,${frame.playing ? (0.24 - trail / 100 * 0.21) : 0.03})`;
  lc.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  lc.globalCompositeOperation = 'lighter';
  const scale = 1.5;
  const r = hexToRgb(accent);
  const step = Math.max(1, Math.floor(tdLength / 1400));
  lc.beginPath();
  for (let i = 0; i < tdLength; i += step) {
    const l = clamp(frame.tdL[i] * gain, -1.2, 1.2);
    const rr = clamp(frame.tdR[i] * gain, -1.2, 1.2);
    const px = layer.canvas.width / 2 + l * rx * scale * 1.2;
    const py = layer.canvas.height / 2 - rr * ry * scale * 1.2;
    if (i === 0) lc.moveTo(px, py); else lc.lineTo(px, py);
  }
  lc.strokeStyle = `rgba(${r.r},${r.g},${r.b},${0.15 + frame.energy * 0.13})`;
  lc.lineWidth = Math.max(0.8, dotSize * scale);
  lc.stroke();
  lc.fillStyle = `rgba(255,235,246,${0.24 + frame.energy * 0.22})`;
  for (let i = 0; i < tdLength; i += step * 2) {
    const l = clamp(frame.tdL[i] * gain, -1.2, 1.2);
    const rr = clamp(frame.tdR[i] * gain, -1.2, 1.2);
    const mag = Math.abs(l) + Math.abs(rr);
    if (mag < 0.02) continue;
    const px = layer.canvas.width / 2 + l * rx * scale * 1.2;
    const py = layer.canvas.height / 2 - rr * ry * scale * 1.2;
    lc.fillRect(px, py, dotSize * scale, dotSize * scale);
  }
  lc.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalAlpha = (mod.opacity ?? 1) * 0.94;
  ctx.drawImage(layer.canvas, x, y, w, h);
  ctx.restore();

  ctx.fillStyle = rgba(accent, 0.42);
  ctx.beginPath();
  ctx.arc(cx, cy, 1.2, 0, TAU);
  ctx.fill();
  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.textAlign = 'left';
  ctx.fillText('L', x + 2, y + h - 2);
  ctx.textAlign = 'right';
  ctx.fillText('R', x + w - 2, y + h - 2);
  ctx.fillStyle = rgba(accent, 0.6);
  ctx.textAlign = 'center';
  ctx.fillText(wide ? 'M/S · WIDE' : 'M/S', cx, y + h - 2);
}

// ── Frequency modules ───────────────────────────────────────────────────────

function barValues(frame, count, fMin = 24, fMax = 20000) {
  const out = new Float32Array(count);
  const nyquist = frame.sampleRate / 2;
  const binHz = frame.sampleRate / Math.max(2, frame.binCount * 2);
  for (let i = 0; i < count; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / count);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / count);
    const b0 = clamp(Math.floor(f0 / binHz), 1, frame.binCount - 1);
    const b1 = clamp(Math.ceil(f1 / binHz), b0 + 1, frame.binCount - 1);
    let sum = 0, n = 0, peak = 0;
    for (let b = b0; b <= b1; b++) {
      const v = frame.freq[b] || 0;
      sum += v; n++;
      if (v > peak) peak = v;
    }
    const avg = n ? sum / n : 0;
    out[i] = clamp(avg * 0.65 + peak * 0.35, 0, 1);
  }
  return out;
}

function drawSpectrum(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 12;
  const barsOpt = modOpt(mod, 'bars', 'auto');
  const bars = barsOpt === 'auto'
    ? Math.max(28, Math.min(72, Math.floor(w / 5.6)))
    : clamp(Number(barsOpt) || 48, 24, 96);
  const values = barValues(frame, bars);
  if (!st.values || st.values.length !== bars) {
    st.values = new Float32Array(bars);
    st.peaks = new Float32Array(bars);
  }
  const floorY = y + h;
  const showGrid = modOpt(mod, 'grid', true);
  const showPeaks = modOpt(mod, 'peakHold', true);

  // Grid.
  if (showGrid) {
    const gridHz = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    mono(ctx, 5.5, '400');
    ctx.textBaseline = 'top';
    const labelFor = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
    const k10 = labelFor(10000);
    const k20 = labelFor(20000);
    const w10 = ctx.measureText(k10).width;
    const w20 = ctx.measureText(k20).width;
    const x10 = x + (Math.log(10000 / 24) / Math.log(20000 / 24)) * w;
    const show10k = x + w - w20 - 10 > x10 + w10 / 2;
    ctx.textAlign = 'center';
    for (const hz of gridHz) {
      const t = Math.log(hz / 24) / Math.log(20000 / 24);
      const gx = Math.round(x + t * w) + 0.5;
      ctx.strokeStyle = hz === 1000 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, floorY);
      ctx.stroke();
      const labelled = hz === 20 || hz === 100 || hz === 1000 || (hz === 10000 && show10k);
      if (labelled) {
        ctx.fillStyle = 'rgba(255,255,255,.27)';
        // The 20 Hz tick sits on the left edge: left-align it so it can't be
        // clipped into a stray "0" next to the explicit endpoint label.
        const anchor = hz === 20 ? 'left' : 'center';
        ctx.textAlign = anchor;
        ctx.fillText(labelFor(hz), hz === 20 ? x : gx, floorY + 3);
        ctx.textAlign = 'center';
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(x, floorY + 0.5);
    ctx.lineTo(x + w, floorY + 0.5);
    ctx.stroke();
  }

  const gap = 1.6;
  const bw = Math.max(1.3, (w - gap * (bars - 1)) / bars);
  const sens = clamp(env.settings.sensitivity / 100, 0.5, 2);
  for (let i = 0; i < bars; i++) {
    const v = clamp(values[i] * (1.15 * sens), 0, 1);
    st.values[i] = Math.max(v, st.values[i] * 0.84);
    const bh = Math.pow(st.values[i], 1.18) * (h - 2);
    const bx = x + i * (bw + gap);
    if (st.values[i] > 0.4) {
      const g = ctx.createLinearGradient(0, floorY - bh, 0, floorY);
      g.addColorStop(0, lighten(accent, 0.55));
      g.addColorStop(0.35, accent);
      g.addColorStop(1, rgba(accent, 0.35));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = rgba(accent, 0.48);
    }
    ctx.fillRect(bx, floorY - bh, bw, bh);

    // Peak hold.
    if (showPeaks) {
      if (st.values[i] > st.peaks[i]) st.peaks[i] = st.values[i];
      else st.peaks[i] = Math.max(0, st.peaks[i] - 0.0018);
      if (st.peaks[i] > 0.02) {
        ctx.fillStyle = 'rgba(255,238,245,.6)';
        ctx.fillRect(bx, floorY - st.peaks[i] * (h - 2) - 1, bw, 1);
      }
    }
  }

  // Peak frequency marker.
  const peakT = Math.log(clamp(frame.peakHz, 24, 20000) / 24) / Math.log(20000 / 24);
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.fillRect(x + peakT * w, y, 1, 5);
  mono(ctx, 5.5, '500');
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${Math.round(frame.peakHz)} Hz`, x + w, y);
  if (showGrid) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.fillText('20k', x + w, floorY + 3);
  }
  ctx.textAlign = 'left';
}

function drawSpectrogram(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 8;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 11;
  if (w < 20 || h < 20) return;
  const TW = 560, TH = 300;
  const palette = modOpt(mod, 'palette', 'neon');
  const energyGain = modNum(mod, 'gain', 100, 40, 220) / 100;
  const layer = ensureLayer(st, 'tex', TW, TH);
  const tc = layer.ctx;
  if (layer.resized) {
    tc.fillStyle = '#08040e';
    tc.fillRect(0, 0, TW, TH);
    st.lastT = frame.time;
  }

  const now = frame.time;
  const delta = Math.max(0, now - (st.lastT ?? now));
  st.lastT = now;
  let columns = 0;
  if (frame.playing) {
    st.acc = (st.acc || 0) + delta * 60;
    columns = Math.min(4, Math.floor(st.acc));
    st.acc -= columns;
  } else if (!st.hasDrawn) {
    columns = 1;
  }
  if (columns > 0) {
    tc.globalCompositeOperation = 'source-over';
    tc.drawImage(layer.canvas, -columns, 0);
    const rgb = hexToRgb(accent);
    const img = tc.createImageData(columns, TH);
    const ptr = img.data;
    const binHz = frame.sampleRate / Math.max(2, frame.binCount * 2);
    for (let cx = 0; cx < columns; cx++) {
      for (let yy = 0; yy < TH; yy++) {
        const t = 1 - yy / (TH - 1);
        const hz = 24 * Math.pow(20000 / 24, t);
        const bin = clamp(Math.round(hz / binHz), 1, frame.binCount - 1);
        let v = frame.freq[bin] || 0;
        v = Math.pow(v, 1.3);
        const idx = (yy * columns + cx) * 4;
        const bright = clamp(v * 1.25 * energyGain, 0, 1);
        if (palette === 'heat') {
          ptr[idx] = Math.round(18 + bright * 235);
          ptr[idx + 1] = Math.round(6 + Math.pow(bright, 1.6) * 170);
          ptr[idx + 2] = Math.round(12 + Math.pow(bright, 3) * 55);
        } else if (palette === 'ice') {
          ptr[idx] = Math.round(8 + Math.pow(bright, 2.2) * 130);
          ptr[idx + 1] = Math.round(16 + bright * 205);
          ptr[idx + 2] = Math.round(26 + bright * 225);
        } else {
          ptr[idx] = Math.round(10 + rgb.r * bright * 0.92 + bright * bright * 120);
          ptr[idx + 1] = Math.round(4 + rgb.g * bright * 0.65 + bright * bright * 30);
          ptr[idx + 2] = Math.round(18 + rgb.b * bright * 0.8 + bright * bright * 65);
        }
        ptr[idx + 3] = 255;
      }
    }
    tc.putImageData(img, TW - columns, 0);
    tc.fillStyle = 'rgba(255,255,255,.22)';
    tc.fillRect(TW - 1, 0, 1, TH);
    st.hasDrawn = true;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = (mod.opacity ?? 1) * 0.96;
  ctx.drawImage(layer.canvas, x, y, w, h);
  ctx.restore();

  // Axis labels.
  if (modOpt(mod, 'labels', true)) {
    mono(ctx, 6, '400');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const labels = [[20000, '20k'], [5000, '5k'], [1000, '1k'], [200, '200'], [30, '30 Hz']];
    for (const [hz, label] of labels) {
      const t = Math.log(hz / 24) / Math.log(20000 / 24);
      const yy = y + h - t * h;
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillText(label, x + 3, yy);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(accent, 0.55);
    ctx.fillText('TIME →', x + w - 2, y + h - 3);
  }
}

function drawPeakSlope(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const historyLength = Math.round(modNum(mod, 'historyLength', 340, 100, 340));
  const fillCurve = modOpt(mod, 'fill', true);
  const beatTicks = modOpt(mod, 'beatTicks', true);
  if (!st.history) st.history = [];
  if (frame.playing || st.history.length === 0) {
    st.history.push(clamp(frame.spectrumPeak * 0.72 + frame.high * 0.28, 0, 1));
    if (st.history.length > historyLength) st.history.shift();
  }

  // Grid.
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const gy = Math.round(y + (h / 4) * i) + 0.5;
    ctx.moveTo(x, gy); ctx.lineTo(x + w, gy);
  }
  for (let i = 0; i <= 12; i++) {
    const gx = Math.round(x + (w / 12) * i) + 0.5;
    ctx.moveTo(gx, y); ctx.lineTo(gx, y + h);
  }
  ctx.stroke();

  // Faint current spectral contour.
  const contour = barValues(frame, 72);
  ctx.beginPath();
  for (let i = 0; i < contour.length; i++) {
    const px = x + (i / (contour.length - 1)) * w;
    const py = y + h - contour[i] * h * 0.85;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // History line.
  if (st.history.length > 1) {
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, rgba(accent, 0.18));
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    for (let i = 0; i < st.history.length; i++) {
      const px = x + (i / Math.max(1, historyLength - 1)) * w;
      const val = Math.pow(st.history[i], 0.7);
      const py = y + h - val * (h - 8) - 4;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    const pathTop = new Path2D();
    // Use a second path to fill under the traced line.
    const pts = [];
    for (let i = 0; i < st.history.length; i++) {
      const px = x + (i / Math.max(1, historyLength - 1)) * w;
      const val = Math.pow(st.history[i], 0.7);
      pts.push([px, y + h - val * (h - 8) - 4]);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = rgba(accent, 0.65);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (fillCurve) {
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fillStyle = lg;
      ctx.fill();
    }

    // Beat ticks under the curve.
    if (beatTicks) {
      for (let i = 1; i < pts.length; i += 7) {
        if (frame.beatPulse > 0.1) {
          ctx.strokeStyle = rgba(accent, 0.12);
          ctx.beginPath();
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[i][0], y + h);
          ctx.stroke();
        }
      }
    }
  }

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.textAlign = 'left';
  ctx.fillText('BRIGHTNESS / PEAK ENVELOPE', x, y + h + 7);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.65);
  ctx.fillText(`${Math.round(frame.centroid)} Hz CENTROID`, x + w, y + h + 7);
}

// ── Stereo modules ──────────────────────────────────────────────────────────

function drawPhase(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 9;
  const corr = frame.correlation;
  const ballistics = modOpt(mod, 'ballistics', 'medium');
  const speed = ballistics === 'slow' ? 0.08 : ballistics === 'fast' ? 0.42 : 0.25;
  st.smooth = st.smooth == null ? corr : lerp(st.smooth, corr, speed);
  const cx = x + w / 2;
  const cy = y + h * 0.65;
  const radius = Math.min(w * 0.37, h * 0.48);
  const start = Math.PI * 1.12, end = Math.PI * 1.88;

  // Arc.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
  const split = (start + end) / 2;
  ctx.strokeStyle = 'rgba(255,90,110,.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, split);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(100,232,255,.32)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, split, end);
  ctx.stroke();

  for (let i = 0; i <= 10; i++) {
    const a = start + (end - start) * (i / 10);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (radius - 5), cy + Math.sin(a) * (radius - 5));
    ctx.lineTo(cx + Math.cos(a) * (radius + 3), cy + Math.sin(a) * (radius + 3));
    ctx.stroke();
  }

  // Needle.
  const t = (st.smooth + 1) / 2;
  const a = start + (end - start) * t;
  ctx.strokeStyle = '#ffe8ef';
  ctx.lineWidth = 1.3;
  ctx.shadowColor = rgba(accent, 0.55);
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (radius - 2), cy + Math.sin(a) * (radius - 2));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.4, 0, TAU);
  ctx.fill();

  // Numeric.
  mono(ctx, 21, '300');
  ctx.fillStyle = corr < -0.15 ? '#ff7b8f' : '#f6e4eb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`, cx, y + 19);
  mono(ctx, 5.8, '500');
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillText('CORRELATION', cx, y + 32);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.fillText('-1', x, cy + radius + 3);
  ctx.textAlign = 'right';
  ctx.fillText('+1', x + w, cy + radius + 3);

  // Phase width bar.
  if (modOpt(mod, 'showWidth', true)) {
    const width = Math.sqrt(Math.max(0, 1 - corr * corr));
    const barY = y + h - 12;
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(x, barY, w, 2);
    ctx.fillStyle = rgba(accent, 0.8);
    ctx.fillRect(x, barY, w * clamp(width, 0, 1), 2);
    mono(ctx, 5.5, '500');
    ctx.fillStyle = 'rgba(255,255,255,.27)';
    ctx.textAlign = 'left';
    ctx.fillText('WIDTH', x, barY + 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(accent, 0.7);
    ctx.fillText(`${Math.round(width * 100)}%`, x + w, barY + 7);
  }
}

function drawStereometer(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const cx = x + w / 2;
  const cy = y + h / 2 + 2;
  const radius = Math.min(w, h) * 0.43;
  const trail = modNum(mod, 'trail', 80, 0, 100);
  const dotSize = modNum(mod, 'dotSize', 1.2, 0.5, 3);

  // Rings and axes.
  if (modOpt(mod, 'rings', true)) {
    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 0.7;
    for (const rr of [radius, radius * 0.66, radius * 0.33]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.stroke();
  }

  const layer = ensureLayer(st, 'layer', Math.round(w * 1.5), Math.round(h * 1.5));
  const lc = layer.ctx;
  if (layer.resized) lc.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  lc.globalCompositeOperation = 'destination-out';
  lc.fillStyle = `rgba(0,0,0,${frame.playing ? (0.2 - trail / 100 * 0.17) : 0.02})`;
  lc.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  lc.globalCompositeOperation = 'lighter';
  const scale = 1.5;
  const rgb = hexToRgb(accent);
  const tdLength = frame.tdL?.length || 0;
  const step = Math.max(1, Math.floor(tdLength / 550));
  for (let i = 0; i < tdLength; i += step) {
    const l = frame.tdL[i], r = frame.tdR[i];
    const mid = (l + r) * 0.7071;
    const side = (r - l) * 0.7071;
    const px = layer.canvas.width / 2 + side * radius * scale * 1.45;
    const py = layer.canvas.height / 2 - mid * radius * scale * 1.45;
    const mag = Math.abs(mid) + Math.abs(side);
    if (mag < 0.008) continue;
    lc.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp(mag * 0.9, 0.04, 0.22)})`;
    lc.fillRect(px, py, dotSize * scale, dotSize * scale);
  }
  lc.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalAlpha = (mod.opacity ?? 1) * 0.95;
  ctx.drawImage(layer.canvas, x, y, w, h);
  ctx.restore();

  // Center mono axis.
  ctx.strokeStyle = rgba(accent, 0.22);
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.27)';
  ctx.textAlign = 'center';
  ctx.fillText('M', cx, y + 7);
  ctx.fillText('S', cx, y + h - 2);
  ctx.textAlign = 'left';
  ctx.fillText('L', x + 1, cy);
  ctx.textAlign = 'right';
  ctx.fillText('R', x + w - 1, cy);

  ctx.fillStyle = rgba(accent, 0.7);
  ctx.textAlign = 'left';
  ctx.fillText('STEREO', x + 1, y + 7);
}

function drawStereoField(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const centerY = y + h * 0.62;
  const baseY = y + h - 2;

  // Grid.
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 0.7;
  for (let i = 0; i <= 8; i++) {
    const gx = Math.round(x + (w / 8) * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, y); ctx.lineTo(gx, baseY);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.beginPath();
  ctx.moveTo(x, centerY + 0.5); ctx.lineTo(x + w, centerY + 0.5);
  ctx.stroke();

  // Scatter: x = stereo position, y = amplitude envelope.
  const bins = 64;
  const density = modNum(mod, 'density', 100, 20, 100) / 100;
  const hist = stateArray(st, 'hist', bins);
  hist.fill(0);
  const tdLength = frame.tdL?.length || 0;
  const step = Math.max(1, Math.floor(tdLength / (300 + density * 600)));
  ctx.fillStyle = rgba(accent, 0.22);
  for (let i = 0; i < tdLength; i += step) {
    const l = frame.tdL[i], r = frame.tdR[i];
    const mag = (Math.abs(l) + Math.abs(r)) * 0.5;
    if (mag < 0.004) continue;
    const pan = clamp((r - l) / (Math.abs(l) + Math.abs(r) + 1e-5), -1, 1);
    const px = x + (pan + 1) / 2 * w;
    const py = baseY - Math.pow(mag, 0.7) * (h * 0.78);
    const bi = clamp(Math.floor((pan + 1) / 2 * bins), 0, bins - 1);
    hist[bi] += mag;
    ctx.fillRect(px, py, 1, 1);
  }

  // Density histogram at bottom.
  if (modOpt(mod, 'histogram', true)) {
    let maxH = 0.0001;
    for (let i = 0; i < bins; i++) if (hist[i] > maxH) maxH = hist[i];
    const bw = w / bins;
    for (let i = 0; i < bins; i++) {
      const v = Math.pow(hist[i] / maxH, 0.8);
      const bh = v * h * 0.22;
      const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
      g.addColorStop(0, rgba(accent, 0.55));
      g.addColorStop(1, rgba(accent, 0.06));
      ctx.fillStyle = g;
      ctx.fillRect(x + i * bw, baseY - bh, Math.max(1, bw - 0.8), bh);
    }
  }

  // Stereo energy line.
  if (modOpt(mod, 'balanceLine', true)) {
    const balX = x + (frame.balance + 1) / 2 * w;
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(balX, y, 1, h);
    ctx.beginPath();
    ctx.arc(balX, y + 5, 2, 0, TAU);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.26)';
  ctx.textAlign = 'left';
  ctx.fillText('L', x, baseY - h * 0.15);
  ctx.textAlign = 'center';
  ctx.fillText('C', x + w / 2, baseY - h * 0.15);
  ctx.textAlign = 'right';
  ctx.fillText('R', x + w, baseY - h * 0.15);
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(accent, 0.55);
  ctx.fillText('STEREO IMAGE', x, y + 5);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillText(`${frame.balance >= 0 ? 'R' : 'L'} ${Math.round(Math.abs(frame.balance) * 100)}%`, x + w, y + 5);
}

// ── Overview / rhythm modules ───────────────────────────────────────────────

function drawRhythm(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 11;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 9;
  const leftW = w * 0.48;
  const bpm = frame.bpm || 0;
  const pulse = clamp(frame.beatPulse, 0, 1);
  const phase = frame.beatPhase;

  mono(ctx, 7, '500');
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  spacedText(ctx, 'TEMPO ESTIMATE', x, y + 8, 0.75);

  sans(ctx, 36, '300');
  ctx.fillStyle = '#f6e4eb';
  ctx.textAlign = 'left';
  const bpmText = bpm ? bpm.toFixed(1) : '—';
  ctx.fillText(bpmText, x, y + 43);
  const bpmWidth = ctx.measureText(bpmText).width;
  mono(ctx, 8, '500');
  ctx.fillStyle = rgba(accent, 0.72);
  ctx.fillText('BPM', x + bpmWidth + 7, y + 38);

  // Beat dots.
  const dotY = y + 62;
  if (modOpt(mod, 'beatDots', true)) {
    const sig = env.timeSignature || { numerator: 4, denominator: 4 };
    const beats = clamp(Math.round(Number(sig.numerator)) || 4, 1, 16);
    const activeBeat = Number.isFinite(frame.beatInBar) ? frame.beatInBar : Math.floor(phase * beats);
    const spacing = Math.min(13, Math.max(6, (leftW - 64) / beats));
    for (let i = 0; i < beats; i++) {
      const active = activeBeat === i && frame.playing;
      ctx.beginPath();
      ctx.arc(x + 4 + i * spacing, dotY, active ? 3.3 : 2.2, 0, TAU);
      ctx.fillStyle = active ? accent : 'rgba(255,255,255,.15)';
      if (active) {
        ctx.shadowColor = accent;
        ctx.shadowBlur = 9;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    mono(ctx, 5.8, '400');
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fillText(`BAR / ${sig.numerator}-${sig.denominator}`, x + 10 + beats * spacing, dotY + 2);
  }

  // Band bars.
  const bands = [
    ['LOW', frame.low],
    ['MID', frame.mid],
    ['HIGH', frame.high],
  ];
  const bandsY = y + 82;
  if (modOpt(mod, 'showBands', true)) bands.forEach(([label, value], i) => {
    const yy = bandsY + i * 15;
    mono(ctx, 5.5, '500');
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, yy + 4);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(x + 32, yy, leftW - 42, 3);
    const v = clamp(value * 1.45 * (env.settings.sensitivity / 100), 0, 1);
    ctx.fillStyle = i === 0 ? accent : (i === 1 ? mixHex(accent, '#67e8ff', 0.45) : '#9d82ff');
    ctx.fillRect(x + 32, yy, (leftW - 42) * v, 3);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(v * 100)}`, x + leftW, yy + 4);
  });

  // Pulse orb.
  const cx = x + w * 0.76;
  const cy = y + h * 0.43;
  const radius = Math.min(w * 0.16, h * 0.31);
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.32, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();

  // Expanding beat rings.
  const ringCount = Math.round(modNum(mod, 'pulseRings', 3, 0, 6));
  for (let i = 0; i < ringCount; i++) {
    const t = (pulse + i * 0.33) % 1;
    const rr = radius * (0.5 + t * 0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.strokeStyle = rgba(accent, (1 - t) * 0.30 * pulse);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.4);
  core.addColorStop(0, `rgba(255,225,238,${0.3 + pulse * 0.5})`);
  core.addColorStop(0.25, rgba(accent, 0.32 + pulse * 0.3));
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.45, 0, TAU);
  ctx.fill();

  // Orbiting ticks.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU - Math.PI / 2;
    const active = Math.floor(phase * 12) === i;
    const r0 = radius * 1.05;
    const r1 = radius * (active ? 1.22 : 1.13);
    ctx.strokeStyle = active ? accent : 'rgba(255,255,255,.13)';
    ctx.lineWidth = active ? 1.5 : 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.24)';
  ctx.textAlign = 'center';
  ctx.fillText(frame.playing ? 'LIVE' : 'STANDBY', cx, y + h - 1);
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(accent, 0.6);
  ctx.fillText(`PULSE ${Math.round(pulse * 100)}`, x, y + h - 1);
}

function drawDynamics(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 9;
  const peakDb = ampToDb(frame.peak), rmsDb = ampToDb(frame.rms);
  const crest = clamp(peakDb - rmsDb, 0, 24);
  const range = clamp(Math.abs(frame.lufsS - frame.lufsI), 0, 20);
  const rows = [
    ['PEAK', dbToNorm(peakDb, -60, 0), `${fmtDb(peakDb, 1)}`],
    ['RMS', dbToNorm(rmsDb, -60, 0), `${fmtDb(rmsDb, 1)}`],
    ['CREST', crest / 24, `${crest.toFixed(1)}`],
    ['RANGE', range / 20, `${range.toFixed(1)}`],
  ];
  const historyLength = Math.round(modNum(mod, 'historyLength', 110, 40, 110));
  const showValues = modOpt(mod, 'showValues', true);
  const showGrid = modOpt(mod, 'grid', true);
  if (!st.history) st.history = [];
  if (frame.playing) {
    st.history.push(dbToNorm(rmsDb, -60, 0));
    if (st.history.length > historyLength) st.history.shift();
  }

  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.textAlign = 'left';
  rows.forEach(([label, value, text], i) => {
    const yy = y + 8 + i * 27;
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillText(label, x, yy);
    if (showValues) {
      ctx.textAlign = 'right';
      ctx.fillStyle = rgba(accent, 0.8);
      ctx.fillText(text, x + w, yy);
      ctx.textAlign = 'left';
    }
    const by = yy + 7;
    ctx.fillStyle = 'rgba(255,255,255,.055)';
    ctx.fillRect(x, by, w, 4);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, rgba(accent, 0.35));
    g.addColorStop(1, i < 2 ? accent : mixHex(accent, '#67e8ff', 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(x, by, w * clamp(value, 0, 1), 4);
    if (showGrid) {
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      for (let t = 1; t < 5; t++) ctx.fillRect(x + (w / 5) * t, by, 0.7, 4);
    }
  });

  // Bottom RMS history.
  const histY = y + h - 30;
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.beginPath();
  ctx.moveTo(x, histY + 18.5); ctx.lineTo(x + w, histY + 18.5);
  ctx.stroke();
  if (st.history.length > 2) {
    ctx.beginPath();
    for (let i = 0; i < st.history.length; i++) {
      const px = x + (i / Math.max(1, historyLength - 1)) * w;
      const py = histY + 18 - st.history[i] * 15;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = rgba(accent, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  mono(ctx, 5.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.21)';
  ctx.textAlign = 'left';
  ctx.fillText('RMS HISTORY', x, histY + 27);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.5);
  ctx.fillText('400 ms', x + w, histY + 27);
}

function drawWaveform(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p + 2;
  const w = body.w - p * 2, h = body.h - p * 2 - 16;
  const engine = env.engine;

  if (!engine?.overviewMin || !engine?.overviewMax) {
    mono(ctx, 8, '400');
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.textAlign = 'center';
    ctx.fillText('NO AUDIO BUFFER', x + w / 2, y + h / 2);
    return;
  }
  const min = engine.overviewMin, max = engine.overviewMax;
  const n = min.length;
  const mid = y + h / 2;
  const progress = frame.duration ? clamp(frame.time / frame.duration, 0, 1) : 0;
  const playedX = x + w * progress;

  // Waveform.
  const cols = Math.max(80, Math.min(620, Math.floor(w * 1.1)));
  const style = modOpt(mod, 'style', 'bars');
  const gain = modNum(mod, 'gain', 100, 50, 160) / 100;
  const showTimeline = modOpt(mod, 'timeline', true);
  const ampH = h * 0.47 * gain;
  if (style === 'bars') {
    for (let i = 0; i < cols; i++) {
      const bi = Math.floor((i / cols) * n);
      const lo = Math.min(0, min[bi] || 0);
      const hi = Math.max(0, max[bi] || 0);
      const px = x + (i / cols) * w;
      const top = mid - hi * ampH;
      const bot = mid - lo * ampH;
      ctx.fillStyle = px <= playedX ? rgba(accent, 0.78) : 'rgba(255,255,255,.11)';
      ctx.fillRect(px, top, Math.max(0.8, w / cols - 0.35), Math.max(1, bot - top));
    }
  } else {
    const topPath = new Path2D();
    const botPath = new Path2D();
    for (let i = 0; i < cols; i++) {
      const bi = Math.floor((i / cols) * n);
      const lo = Math.min(0, min[bi] || 0);
      const hi = Math.max(0, max[bi] || 0);
      const px = x + (i / cols) * w;
      const ty = mid - hi * ampH;
      const by = mid - lo * ampH;
      if (i === 0) { topPath.moveTo(px, ty); botPath.moveTo(px, by); }
      else { topPath.lineTo(px, ty); botPath.lineTo(px, by); }
    }
    if (style === 'filled') {
      ctx.beginPath();
      ctx.moveTo(x, mid);
      for (let i = 0; i < cols; i++) {
        const bi = Math.floor((i / cols) * n);
        ctx.lineTo(x + (i / cols) * w, mid - Math.max(0, max[bi] || 0) * ampH);
      }
      for (let i = cols - 1; i >= 0; i--) {
        const bi = Math.floor((i / cols) * n);
        ctx.lineTo(x + (i / cols) * w, mid - Math.min(0, min[bi] || 0) * ampH);
      }
      ctx.closePath();
      const fill = ctx.createLinearGradient(x, y, x + w, y + h);
      fill.addColorStop(0, rgba(accent, 0.28));
      fill.addColorStop(1, rgba(accent, 0.05));
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.stroke(topPath);
    ctx.stroke(botPath);
    ctx.strokeStyle = rgba(accent, 0.8);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, mid);
    for (let i = 0; i < cols; i++) {
      const bi = Math.floor((i / cols) * n);
      const hi = Math.max(0, max[bi] || 0);
      const lo = Math.min(0, min[bi] || 0);
      ctx.lineTo(x + (i / cols) * w, mid - (hi + lo) * 0.5 * ampH);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Glow under the played section.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba(accent, 0.10));
  g.addColorStop(0.5, rgba(accent, 0.025));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w * progress, h);
  ctx.restore();

  // Timeline.
  if (showTimeline) {
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath();
    ctx.moveTo(x, y + h + 4.5); ctx.lineTo(x + w, y + h + 4.5);
    ctx.stroke();
    mono(ctx, 5.5, '400');
    ctx.fillStyle = 'rgba(255,255,255,.26)';
    ctx.textAlign = 'left';
    ctx.fillText('00:00', x, y + h + 12);
    ctx.textAlign = 'center';
    ctx.fillText(formatShortTime(frame.duration / 2), x + w / 2, y + h + 12);
    ctx.textAlign = 'right';
    ctx.fillText(formatShortTime(frame.duration), x + w, y + h + 12);
  }

  // Playhead.
  ctx.fillStyle = '#fff5f8';
  ctx.fillRect(playedX, y - 2, 1.5, h + 4);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(playedX - 3.5, y - 2);
  ctx.lineTo(playedX + 5, y - 2);
  ctx.lineTo(playedX + 0.8, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.fillStyle = rgba(accent, 0.8);
  ctx.fillRect(playedX - 1, y, 3, h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(5,3,8,.8)';
  ctx.fillRect(x + w - 66, y - 1, 64, 12);
  mono(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.textAlign = 'right';
  ctx.fillText(formatShortTime(frame.time), x + w - 3, y + 8);
}

function midiChordAt(midi, time) {
  const active = midi.notes.filter((note) => note.start <= time && note.end >= time);
  if (!active.length) return '';
  const root = active.reduce((low, note) => (note.pitch < low.pitch ? note : low), active[0]).pitch;
  const rootPc = root % 12;
  const intervals = new Set(active.map((note) => (note.pitch - root + 120) % 12));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let suffix = '';
  if (intervals.has(3)) suffix += 'm';
  else if (intervals.has(4)) suffix += '';
  if (intervals.has(11)) suffix += 'maj7';
  else if (intervals.has(10)) suffix += '7';
  return `${names[rootPc]}${suffix}`;
}

function drawPianoRoll(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 8;
  const x = body.x + p + 22, y = body.y + p + 1;
  const w = body.w - p * 2 - 22, h = body.h - p * 2 - 12;
  const midi = (mod.options?.midiMaster && env.midiMerged)
    ? env.midiMerged
    : ((env.midiLayers || []).find((layer) => layer.id === mod.options?.midiId) || env.midi);

  if (!midi || !midi.notes?.length) {
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= 8; i++) {
      const yy = y + (h / 8) * i;
      ctx.beginPath(); ctx.moveTo(x - 18, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    }
    mono(ctx, 7, '500');
    ctx.fillStyle = rgba(accent, 0.55);
    ctx.textAlign = 'center';
    ctx.fillText('导入 MIDI 后，这里将显示音符时间轴', x + w / 2, y + h / 2);
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    mono(ctx, 5.8, '400');
    ctx.fillText('MIDI / PIANO ROLL', x + w / 2, y + h / 2 + 13);
    return;
  }

  if (st.minPitch == null || st.midiRef !== midi) {
    let lo = 127, hi = 0;
    for (const note of midi.notes) {
      if (note.pitch < lo) lo = note.pitch;
      if (note.pitch > hi) hi = note.pitch;
    }
    st.minPitch = Math.max(0, lo - 2);
    st.maxPitch = Math.min(127, hi + 2);
    st.midiRef = midi;
  }
  const minPitch = st.minPitch, maxPitch = st.maxPitch;
  const pitchSpan = Math.max(12, maxPitch - minPitch + 1);
  const rowH = h / pitchSpan;
  const scrollSpeed = clamp(modNum(mod, 'speed', 100, 25, 200) / 100, 0.25, 2);
  const midiZoom = clamp(modNum(mod, 'midiZoom', 100, 50, 200) / 100, 0.5, 2);
  const autoSpeed = modOpt(mod, 'autoSpeed', true);
  const syncAudioLength = modOpt(mod, 'syncAudioLength', true);
  const barsVisible = modNum(mod, 'barsVisible', 16, 1, 32);
  const signature = env.timeSignature || midi.timeSignature || { numerator: 4, denominator: 4 };
  const beatsPerBar = Math.max(1, Number(signature.numerator) || 4) * (4 / Math.max(1, Number(signature.denominator) || 4));
  const midiBpm = Math.max(40, Number(midi.bpm) || 120);
  const audioDuration = Number(env.engine?.duration) || 0;
  const durationBpm = (Number(midi.totalBeats) > 0 && audioDuration > 0)
    ? (Number(midi.totalBeats) / audioDuration) * 60
    : 0;
  const displayBpm = autoSpeed && syncAudioLength && durationBpm >= 40 && durationBpm <= 300 ? durationBpm : midiBpm;
  const manualWindow = modNum(mod, 'window', 10, 4, 20);
  const windowSec = (autoSpeed
    ? ((barsVisible * beatsPerBar * 60) / displayBpm)
    : manualWindow) / midiZoom;
  const midiOffset = modNum(mod, 'midiOffset', 0, -2000, 2000) / 1000;
  const midiTime = (frame.time - midiOffset) * scrollSpeed;
  const startT = Math.max(0, midiTime - 1.2);
  const endT = startT + windowSec;
  const palette = [accent, SCHEME_COLORS[1], SCHEME_COLORS[3], SCHEME_COLORS[2], '#b9ff8a', '#ff8a6b'];
  const showGrid = modOpt(mod, 'grid', true);
  const showLabels = modOpt(mod, 'labels', true);
  const noteStyle = modOpt(mod, 'noteStyle', 'rect');
  const allTrackColor = modOpt(mod, 'allTrackColor', false);
  const globalTrackColor = isHexColor(modOpt(mod, 'globalTrackColor', '#ffc46b')) ? modOpt(mod, 'globalTrackColor', '#ffc46b') : '#ffc46b';
  const noteThickness = modNum(mod, 'noteThickness', 100, 50, 200) / 100;
  const centerShift = (modNum(mod, 'centerY', 50, 0, 100) / 100 - 0.5) * h * 0.24;
  const vibratoAmount = modNum(mod, 'vibrato', 0, 0, 100) / 100;
  const defaultDepth = modNum(mod, 'trackDepth', 275, 0, 500);
  const trackColors = Array.isArray(mod.options?.trackColors) ? mod.options.trackColors : [];
  const trackDepths = Array.isArray(mod.options?.trackDepths) ? mod.options.trackDepths : [];
  const trackMutes = Array.isArray(mod.options?.trackMutes) ? mod.options.trackMutes : [];
  const trackSolos = Array.isArray(mod.options?.trackSolos) ? mod.options.trackSolos : [];
  const soloActive = trackSolos.some(Boolean);
  const trackCount = Math.max(1, Number(midi.trackCount) || 1);
  const rawOrder = Array.isArray(mod.options?.trackOrder) ? mod.options.trackOrder : [];
  const trackOrder = [];
  const seenTracks = new Set();
  for (const value of rawOrder) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < trackCount && !seenTracks.has(index)) {
      seenTracks.add(index);
      trackOrder.push(index);
    }
  }
  for (let index = 0; index < trackCount; index++) {
    if (!seenTracks.has(index)) trackOrder.push(index);
  }
  const orderPosition = new Map(trackOrder.map((track, index) => [track, index]));
  const horizonX = x + w * 0.08;
  const midPitch = (minPitch + maxPitch) / 2;

  // Pitch rows and keyboard.
  for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
    const yy = y + h - (pitch - minPitch + 1) * rowH;
    const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
    if (isBlack) {
      ctx.fillStyle = 'rgba(255,255,255,.018)';
      ctx.fillRect(x, yy, w, rowH);
    }
    if (pitch % 12 === 0) {
      if (showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.beginPath();
        ctx.moveTo(x, yy + 0.5); ctx.lineTo(x + w, yy + 0.5); ctx.stroke();
      }
      if (showLabels) {
        mono(ctx, 5, '400');
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.textAlign = 'right';
        ctx.fillText(`C${Math.floor(pitch / 12) - 1}`, x - 4, yy + rowH - 1);
      }
    }
    // Keyboard strips on the left.
    ctx.fillStyle = isBlack ? '#0e0a13' : 'rgba(255,255,255,.09)';
    ctx.fillRect(x - 18, yy, 18, Math.max(0.5, rowH - 0.3));
  }

  // Time grid. Pick the coarsest tick that still fits the measured label
  // width so the timestamps never collide in narrow or zoomed-out modules.
  const footerLeft = `${midi.trackCount} TRACKS · ${midi.noteCount} NOTES`;
  const footerBpm = `${displayBpm.toFixed(1)}${autoSpeed && syncAudioLength ? ' AUDIO-SYNC' : ''}`;
  const footerRight = `BPM ${footerBpm} · ${signature.numerator}/${signature.denominator}`;
  if (showGrid) {
    mono(ctx, 5.8, '400');
    const footerLeftRight = x + ctx.measureText(footerLeft).width + 10;
    const footerRightLeft = x + w - ctx.measureText(footerRight).width - 10;
    mono(ctx, 5, '400');
    let labelW = 0;
    for (const sample of ['00:00', '00:00:00']) labelW = Math.max(labelW, ctx.measureText(sample).width);
    const minGap = labelW + 12;
    const tickSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let tickStep = tickSteps[tickSteps.length - 1];
    for (const step of tickSteps) {
      if ((step / windowSec) * w >= minGap) { tickStep = step; break; }
    }
    const firstGrid = Math.ceil(startT / tickStep) * tickStep;
    let lastRight = -Infinity;
    for (let t = firstGrid; t <= endT; t += tickStep) {
      const px = x + ((t - startT) / windowSec) * w;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath();
      ctx.moveTo(px + 0.5, y); ctx.lineTo(px + 0.5, y + h);
      ctx.stroke();
      const label = formatShortTime(t);
      const labelWidth = ctx.measureText(label).width;
      const labelX = px + 2;
      if (labelX < footerLeftRight || labelX + labelWidth > footerRightLeft) continue;
      if (labelX < lastRight + 6) continue;
      lastRight = labelX + labelWidth;
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.textAlign = 'left';
      ctx.fillText(label, labelX, y + h + 8);
    }
  }

  // Notes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const visible = [];
  let count = 0;
  for (const note of midi.notes) {
    if (note.end < startT || note.start > endT) continue;
    const trackIndex = Number(note.track) || 0;
    if (trackMutes[trackIndex]) continue;
    if (soloActive && !trackSolos[trackIndex]) continue;
    if (count++ > 5000) break;
    const orderIndex = orderPosition.get(trackIndex) ?? trackIndex;
    const depthValue = clamp(Number(trackDepths[trackIndex] ?? defaultDepth) || 0, 0, 500);
    const z = clamp(depthValue / 500, 0, 1);
    const scale = 0.58 + z * 0.82;
    const laneCenter = y + h * (0.18 + z * 0.60) + centerShift;
    const pitchOffset = ((midPitch - note.pitch) / pitchSpan) * h * (0.36 + z * 0.20);
    const vibratoY = vibratoAmount ? Math.sin(frame.time * 7 + note.pitch * 0.7) * vibratoAmount * 5 : 0;
    const nx = x + ((note.start - startT) / windowSec) * w;
    const nw = Math.max(1.5, ((note.end - note.start) / windowSec) * w);
    const px = horizonX + (nx - horizonX) * scale;
    const py = laneCenter + pitchOffset + vibratoY;
    const pw = nw * scale;
    const color = allTrackColor ? globalTrackColor : (isHexColor(trackColors[trackIndex]) ? trackColors[trackIndex] : palette[trackIndex % palette.length]);
    const active = midiTime >= note.start && midiTime <= note.end;
    const nh = Math.max(1.1, rowH * (0.62 + z * 0.38) - 0.7) * scale * noteThickness;
    visible.push({ note, trackIndex, orderIndex, z, scale, px, py, pw, nh, color, active });
  }
  visible.sort((a, b) => a.z - b.z || a.orderIndex - b.orderIndex || a.note.start - b.note.start);
  for (const item of visible) {
    const { note, z, scale, px, py, pw, nh, color, active } = item;
    const depthAlpha = 0.30 + z * 0.70;
    ctx.globalAlpha = (mod.opacity ?? 1) * depthAlpha * (active ? 1 : (0.30 + (note.velocity / 127) * 0.52));
    ctx.fillStyle = color;
    if (active) {
      ctx.shadowColor = color;
      ctx.shadowBlur = (3 + z * 8) * scale;
    }
    const noteY = py + 0.35 + (0.5 - z) * rowH * 0.08;
    if (noteStyle === 'rounded') {
      roundRect(ctx, px, noteY, pw, nh, Math.min(nh / 2, 4 * scale));
      ctx.fill();
    } else {
      ctx.fillRect(px, noteY, pw, nh);
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = mod.opacity ?? 1;
  ctx.restore();

  // MIDI overlay text: title and current chord.
  const showTitle = modOpt(mod, 'showTitle', true);
  const showChords = modOpt(mod, 'showChords', true);
  const titlePosition = modOpt(mod, 'titlePosition', 'topLeft');
  const titleColor = isHexColor(modOpt(mod, 'titleColor', '#C7F8FF')) ? modOpt(mod, 'titleColor', '#C7F8FF') : '#C7F8FF';
  const chordColor = isHexColor(modOpt(mod, 'chordColor', '#9DDBFF')) ? modOpt(mod, 'chordColor', '#9DDBFF') : '#9DDBFF';
  const titleText = String(modOpt(mod, 'title', '') || midi.title || 'MIDI').slice(0, 80);
  const titleSize = modNum(mod, 'titleSize', 40, 12, 64);
  const titleFontName = modOpt(mod, 'titleFont', 'Bahnschrift');
  const titleAnimation = modOpt(mod, 'titleAnimation', 'slide');
  const intro = titleAnimation === 'none' ? 1 : clamp(frame.time / 1.2, 0, 1);
  const titleAlpha = titleAnimation === 'fade' ? intro : 1;
  const titleOffset = titleAnimation === 'slide' ? (1 - intro) * -18 : 0;
  const titleFont = `600 ${titleSize}px "${titleFontName}", "Microsoft YaHei UI", sans-serif`;
  if (showTitle) {
    ctx.save();
    ctx.globalAlpha = (mod.opacity ?? 1) * titleAlpha;
    ctx.font = titleFont;
    ctx.fillStyle = titleColor;
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 7;
    if (titlePosition === 'topCenter') {
      ctx.textAlign = 'center';
      ctx.fillText(titleText, x + w / 2 + titleOffset, y + titleSize + 10);
    } else if (titlePosition === 'topRight') {
      ctx.textAlign = 'right';
      ctx.fillText(titleText, x + w - 8 + titleOffset, y + titleSize + 10);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(titleText, x + 8 + titleOffset, y + titleSize + 10);
    }
    ctx.restore();
  }
  if (showChords) {
    const chord = midiChordAt(midi, midiTime);
    if (chord) {
      ctx.save();
      ctx.globalAlpha = mod.opacity ?? 1;
      ctx.textAlign = titlePosition === 'topRight' ? 'left' : 'right';
      ctx.font = `600 ${Math.max(14, titleSize * 0.52)}px "Cascadia Code", monospace`;
      ctx.fillStyle = chordColor;
      ctx.fillText(chord, titlePosition === 'topRight' ? x + 8 : x + w - 8, y + titleSize + 10);
      ctx.restore();
    }
  }

  // Playhead.
  const playX = x + (1.2 / windowSec) * w;
  ctx.fillStyle = '#fff2f8';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 7;
  ctx.fillRect(playX, y, 1, h);
  ctx.shadowBlur = 0;

  // Footer.
  mono(ctx, 5.8, '400');
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.textAlign = 'left';
  ctx.fillText(footerLeft, x, y + h + 9);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.62);
  ctx.fillText(footerRight, x + w, y + h + 9);
}

// ── Export dispatcher ───────────────────────────────────────────────────────

function drawBasicInfo(ctx, mod, body, frame, st, env) {
  const info = env.info || {};
  const engine = env.engine || {};
  const accent = body.accent || '#ff4f8b';
  const primaryColor = isHexColor(modOpt(mod, 'primaryColor', '#101a3b')) ? modOpt(mod, 'primaryColor', '#101a3b') : '#101a3b';
  const secondaryColor = isHexColor(modOpt(mod, 'secondaryColor', '#6d6782')) ? modOpt(mod, 'secondaryColor', '#6d6782') : '#6d6782';
  const cardBg = isHexColor(modOpt(mod, 'cardBg', '#eeebf4')) ? modOpt(mod, 'cardBg', '#eeebf4') : '#eeebf4';
  const x = body.x;
  const y = body.y;
  const w = body.w;
  const h = body.h;
  const k = Math.max(0.45, Math.sqrt((w / 900) * (h / 300)));
  const p = Math.max(10, Math.min(w, h) * 0.06);
  const ink = primaryColor;
  const soft = secondaryColor;
  const pink = accent;
  const coverSize = Math.max(62, Math.min(h - p * 2, w * 0.28));
  const coverX = x + p;
  const coverY = y + p;
  const tx = coverX + coverSize + p * 1.15;
  const tw = x + w - p - tx;
  const coverSrc = info.cover || '';
  if (!coverSrc) {
    st.coverSrc = '';
    st.coverImage = null;
  } else if (st.coverSrc !== coverSrc) {
    st.coverSrc = coverSrc;
    const img = new Image();
    img.onload = () => {
      if (st.coverSrc !== coverSrc) return;
      st.coverImage = img;
      env.invalidate?.();
    };
    img.src = coverSrc;
  }

  ctx.save();
  clipRect(ctx, x, y, w, h);
  ctx.fillStyle = cardBg;
  ctx.fillRect(x, y, w, h);

  // Thin editorial grid.
  ctx.strokeStyle = 'rgba(25, 28, 60, .055)';
  ctx.lineWidth = 0.7;
  for (let gx = x + 12; gx < x + w; gx += Math.max(34, w / 22)) {
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
  }
  for (let gy = y + 12; gy < y + h; gy += Math.max(34, h / 6)) {
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
  }

  // Cover plate with cut-corner crop marks.
  ctx.fillStyle = '#e6e2ee';
  ctx.fillRect(coverX, coverY, coverSize, coverSize);
  if (st.coverImage) {
    const img = st.coverImage;
    const scale = Math.max(coverSize / img.width, coverSize / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, coverX + (coverSize - dw) / 2, coverY + (coverSize - dh) / 2, dw, dh);
  } else {
    ctx.strokeStyle = 'rgba(25,28,60,.18)';
    ctx.setLineDash([4, 5]);
    ctx.strokeRect(coverX + 8, coverY + 8, coverSize - 16, coverSize - 16);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(25,28,60,.34)';
    ctx.font = `600 ${Math.max(8, coverSize * 0.09)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('COVER ART', coverX + coverSize / 2, coverY + coverSize / 2);
  }
  ctx.strokeStyle = 'rgba(25,28,60,.36)';
  ctx.lineWidth = 1;
  ctx.strokeRect(coverX + 0.5, coverY + 0.5, coverSize - 1, coverSize - 1);
  ctx.strokeStyle = pink;
  ctx.lineWidth = 2;
  const corner = Math.min(18, coverSize * 0.14);
  for (const [cx, cy, sx, sy] of [
    [coverX, coverY, 1, 1], [coverX + coverSize, coverY, -1, 1],
    [coverX, coverY + coverSize, 1, -1], [coverX + coverSize, coverY + coverSize, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * corner, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * corner);
    ctx.stroke();
  }

  const title = info.title || engine.track?.name || 'Untitled signal';
  const composer = info.composer || info.artist || engine.track?.artist || 'Unknown source';
  const album = info.album || 'Album';
  const genre = info.genre || engine.track?.genre || 'Genre';
  const bpm = info.bpm || engine.track?.bpm || '—';
  const trackNo = info.trackNo || '—';
  const sampleRate = engine.sampleRate ? `${(engine.sampleRate / 1000).toFixed(1)} kHz` : '—';
  const duration = engine.duration ? formatShortTime(engine.duration) : '—';

  ctx.textAlign = 'left';
  const tiny = 9 * k;
  const label = 12 * k;
  ctx.fillStyle = pink;
  ctx.font = `600 ${tiny}px ${MONO}`;
  ctx.fillText(`FROM: ${composer}`, tx, y + p + tiny);
  ctx.fillStyle = soft;
  ctx.textAlign = 'right';
  ctx.fillText('AUDIO VISUALIZATION INTERFACE', x + w - p, y + p + tiny);
  ctx.textAlign = 'left';

  const titleSize = 50 * k;
  ctx.fillStyle = ink;
  ctx.font = `700 ${titleSize}px ${SANS}`;
  ctx.fillText(String(title), tx, y + p + titleSize + tiny * 2, tw);
  ctx.fillStyle = pink;
  ctx.fillRect(tx, y + p + titleSize + tiny * 4, Math.min(tw * 0.54, 190), 2);

  const rowY = y + p + titleSize + tiny * 7;
  const colW = tw / 3;
  const labels = ['ARTIST', 'ALBUM', 'TRACK'];
  const values = [composer, album, trackNo];
  for (let i = 0; i < 3; i += 1) {
    const cx = tx + i * colW;
    ctx.fillStyle = soft;
    ctx.font = `500 ${tiny}px ${MONO}`;
    ctx.fillText(labels[i], cx, rowY);
    ctx.fillStyle = ink;
    ctx.font = `600 ${14 * k}px ${SANS}`;
    ctx.fillText(String(values[i]), cx, rowY + label + 12 * k, colW - 8);
  }

  const metaY = y + h - p - 46 * k;
  ctx.fillStyle = soft;
  ctx.font = `500 ${tiny}px ${MONO}`;
  const meta = `GENRE ${genre}    BPM ${bpm}    SAMPLE ${sampleRate}    DURATION ${duration}`;
  ctx.fillText(meta, tx, metaY, tw);

  // Waveform preview.
  const waveY = y + h - p - 14 * k;
  const waveW = Math.max(30, tw);
  const minArr = engine.overviewMin;
  const maxArr = engine.overviewMax;
  ctx.strokeStyle = 'rgba(25,28,60,.30)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  const cols = Math.max(30, Math.min(220, Math.floor(waveW / 3)));
  for (let i = 0; i < cols; i += 1) {
    let lo = 0;
    let hi = 0;
    if (minArr?.length && maxArr?.length) {
      const idx = Math.floor(i / cols * minArr.length);
      lo = minArr[idx] || 0;
      hi = maxArr[idx] || 0;
    } else {
      lo = Math.sin(i * 0.37) * 0.4;
      hi = Math.cos(i * 0.23) * 0.4;
    }
    const wx = tx + i * (waveW / cols);
    ctx.moveTo(wx, waveY - hi * 8 * k);
    ctx.lineTo(wx, waveY - lo * 8 * k);
  }
  ctx.stroke();
  ctx.fillStyle = pink;
  ctx.font = `500 ${tiny}px ${MONO}`;
  ctx.fillText('WAVEFORM PREVIEW', tx, waveY - 13 * k);
  ctx.restore();
}

function midiOCIntervals(notes, track, detect) {
  const merged = [];
  for (const note of notes) {
    if ((Number(note.track) || 0) !== track) continue;
    const start = Math.max(0, Number(note.start) || 0);
    const end = Math.max(start, Number(note.end) || start);
    const last = merged[merged.length - 1];
    if (last && start - last.end < detect) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

function midiOCEvents(intervals, detect) {
  const events = [];
  for (const interval of intervals) {
    events.push({ t: interval.start, kind: 'up' });
    events.push({ t: interval.end + detect, kind: 'down' });
  }
  return events.sort((a, b) => (a.t - b.t) || (a.kind === 'down' ? -1 : 1));
}

function midiOCStateAt(track, time) {
  let last = null;
  for (const event of track.events) {
    if (event.t <= time) last = event;
    else break;
  }
  return last;
}

function midiOCFitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

function midiOCLabel(track) {
  let raw = String(track?.name || '').trim();
  if (/^track\s*\d+$/i.test(raw)) return '';
  raw = raw.replace(/\s*·\s*track\s*\d+\s*$/i, '').trim();
  return raw.toUpperCase();
}

function midiOCVisualState(track, time, cfg) {
  const last = midiOCStateAt(track, time);
  if (!last) return null;
  const age = Math.max(0, time - last.t);
  if (last.kind === 'up') {
    if (cfg.showUp && age <= cfg.fadeIn) {
      return { sign: '+', color: cfg.upColor, alpha: cfg.fadeIn > 0 ? clamp(age / cfg.fadeIn, 0, 1) : 1 };
    }
    if (cfg.showHold) return { sign: '', color: cfg.holdColor, alpha: 1 };
    return null;
  }
  if (cfg.showDown && age <= cfg.fadeOut) {
    return { sign: '−', color: cfg.downColor, alpha: cfg.fadeOut > 0 ? clamp(1 - age / cfg.fadeOut, 0, 1) : 1 };
  }
  return null;
}

function drawMidiOC(ctx, mod, body, frame, st, env) {
  const palette = env.palette || {};
  const textColor = palette.text || '#f7eef3';
  const midi = env.midiMerged
    || ((env.midiLayers || []).find((layer) => layer.id === mod.options?.midiId) || env.midi);
  const originX = Number(mod.x) + (Number(mod.w) || 640) / 2 + modNum(mod, 'x', 0, -STAGE_W, STAGE_W);
  const originY = Number(mod.y) + (Number(mod.h) || 260) / 2 + modNum(mod, 'y', 0, -STAGE_H, STAGE_H);
  const detect = modNum(mod, 'detect', 1, 0.1, 10);
  const fadeIn = modNum(mod, 'fadeIn', 0.3, 0, 2);
  const fadeOut = modNum(mod, 'fadeOut', 0.5, 0, 2);
  const showUp = modOpt(mod, 'showIncrease', true);
  const showDown = modOpt(mod, 'showDecrease', true);
  const showHold = modOpt(mod, 'showHold', true);
  const upColor = isHexColor(modOpt(mod, 'increaseColor', SCHEME_COLORS[0])) ? modOpt(mod, 'increaseColor', SCHEME_COLORS[0]) : SCHEME_COLORS[0];
  const downColor = isHexColor(modOpt(mod, 'decreaseColor', SCHEME_COLORS[1])) ? modOpt(mod, 'decreaseColor', SCHEME_COLORS[1]) : SCHEME_COLORS[1];
  const holdColor = isHexColor(modOpt(mod, 'holdColor', SCHEME_COLORS[2])) ? modOpt(mod, 'holdColor', SCHEME_COLORS[2]) : SCHEME_COLORS[2];
  const time = Number(frame.time) || 0;
  const moduleW = Math.max(80, Number(mod.w) || 640);
  const moduleH = Math.max(40, Number(mod.h) || 260);
  const framed = modOpt(mod, 'frame', false) === true;
  const insetTop = framed ? HEAD_H + 2 : 0;
  const bandTop = Number(mod.y) + insetTop;
  const bandH = Math.max(24, moduleH - insetTop - (framed ? 3 : 0));
  const bandCenterY = bandTop + bandH / 2 + modNum(mod, 'y', 0, -STAGE_H, STAGE_H);
  const messageY = framed ? bandCenterY : originY;

  if (!midi || !midi.notes?.length) {
    ctx.save();
    mono(ctx, 9, '500');
    ctx.fillStyle = rgba(textColor, 0.42);
    ctx.textAlign = 'center';
    ctx.fillText('等待 MIDI · MIDI O/C', originX, messageY + 2);
    ctx.restore();
    return;
  }

  if (st.midiRef !== midi || st.detect !== detect) {
    st.midiRef = midi;
    st.detect = detect;
    st.tracks = [];
    const notesByTrack = new Map();
    for (const note of midi.notes) {
      const index = Number(note.track) || 0;
      let list = notesByTrack.get(index);
      if (!list) {
        list = [];
        notesByTrack.set(index, list);
      }
      list.push(note);
    }
    const count = Math.max(0, Number(midi.trackCount) || midi.tracks?.length || 0);
    for (let index = 0; index < count; index += 1) {
      const meta = (midi.tracks || []).find((item) => item.index === index) || midi.tracks?.[index] || {};
      const notes = notesByTrack.get(index) || [];
      const intervals = midiOCIntervals(notes, index, detect);
      st.tracks.push({
        index,
        name: meta.name || meta.trackName || midi.trackNames?.[index] || `Track ${index + 1}`,
        intervals,
        events: midiOCEvents(intervals, detect),
      });
    }
  }

  const activeTracks = st.tracks.filter((track) => track.intervals.length);
  if (!activeTracks.length) {
    ctx.save();
    mono(ctx, 9, '500');
    ctx.fillStyle = rgba(textColor, 0.42);
    ctx.textAlign = 'center';
    ctx.fillText('无音符 · MIDI O/C', originX, messageY + 2);
    ctx.restore();
    return;
  }

  const cfg = { showUp, showDown, showHold, upColor, downColor, holdColor, fadeIn, fadeOut };
  const columns = moduleW >= 760 ? 2 : 1;
  const gutter = columns > 1 ? 24 : 0;
  const minRowH = framed ? 10 : 16;
  const slotsPerColumn = Math.max(1, Math.floor(bandH / minRowH));
  const capacity = slotsPerColumn * columns;
  const total = activeTracks.length;
  let visible = Math.min(capacity, total);
  let moreCount = 0;
  if (total > visible && visible > 1) {
    visible -= 1;
    moreCount = total - visible;
  }
  const entries = activeTracks.slice(0, visible).map((track) => ({ track }));
  if (moreCount > 0) entries.push({ note: `+ ${moreCount} More Track` });

  const rowsPerColumn = Math.ceil(entries.length / columns);
  const rowH = Math.min(44, bandH / rowsPerColumn);
  const fontSize = Math.max(10, Math.round(rowH * 0.64));
  const contentLeft = Math.round(originX - moduleW / 2) + 6;
  const contentRight = Math.round(originX + moduleW / 2) - 6;
  const columnW = Math.max(24, (contentRight - contentLeft - gutter * (columns - 1)) / columns);
  const perColumn = Math.ceil(entries.length / columns);
  const top = Math.max(Math.round(bandTop), Math.round(bandCenterY - (rowsPerColumn * rowH) / 2));

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  mono(ctx, fontSize, '700');
  for (let column = 0; column < columns; column += 1) {
    const columnLeft = contentLeft + column * (columnW + gutter);
    for (let row = 0; row < perColumn; row += 1) {
      const entry = entries[column * perColumn + row];
      if (!entry) break;
      const rowCenter = top + row * rowH + rowH / 2;
      if (entry.note) {
        ctx.fillStyle = rgba(textColor, 0.6);
        ctx.shadowBlur = 0;
        ctx.fillText(entry.note, columnLeft, rowCenter);
        continue;
      }
      const state = midiOCVisualState(entry.track, time, cfg);
      const label = midiOCLabel(entry.track);
      const signText = state?.sign ? `${state.sign} ` : '';
      const signW = signText ? ctx.measureText(signText).width : 0;
      const color = state ? state.color : textColor;
      const alpha = state ? state.alpha : 0.2;
      ctx.fillStyle = rgba(color, alpha);
      ctx.shadowColor = rgba(color, alpha * 0.65);
      ctx.shadowBlur = state ? Math.round(rowH * 0.28) : 0;
      if (signText) ctx.fillText(signText, columnLeft, rowCenter);
      if (label) ctx.fillText(midiOCFitText(ctx, label, Math.max(8, columnW - signW)), columnLeft + signW, rowCenter);
    }
  }
  ctx.restore();
}

function drawBandRings(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const gain = clamp(modNum(mod, 'bandGain', 100, 50, 200) / 100, 0.5, 2);
  const values = [frame.low, frame.mid, frame.high].map((v) => clamp((v || 0) * gain, 0, 1));
  const labels = ['LOW', 'MID', 'HIGH'];
  const colors = [accent, SCHEME_COLORS[1], SCHEME_COLORS[2]];
  const style = modOpt(mod, 'bandStyle', 'rings');
  const showLabels = modOpt(mod, 'bandLabels', true);
  if (style === 'bars') {
    const bw = w / 3;
    for (let i = 0; i < 3; i++) {
      const bh = Math.max(2, values[i] * h * 0.82);
      const bx = x + i * bw + bw * 0.18;
      const by = y + h - bh;
      ctx.fillStyle = 'rgba(255,255,255,.045)';
      ctx.fillRect(bx, y + h * 0.12, bw * 0.64, h * 0.88);
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = (mod.opacity ?? 1) * (0.35 + values[i] * 0.65);
      ctx.fillRect(bx, by, bw * 0.64, bh);
      ctx.globalAlpha = mod.opacity ?? 1;
      if (showLabels) {
        mono(ctx, 6, '500'); ctx.fillStyle = colors[i]; ctx.textAlign = 'center';
        ctx.fillText(labels[i], bx + bw * 0.32, y + h + 7);
      }
    }
    return;
  }
  const cx = x + w / 2, cy = y + h / 2;
  const radius = Math.max(18, Math.min(w, h) * 0.34);
  for (let i = 0; i < 3; i++) {
    const rr = radius * (1 - i * 0.22);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 3 + values[i] * 8;
    ctx.lineCap = 'round';
    ctx.globalAlpha = (mod.opacity ?? 1) * (0.30 + values[i] * 0.70);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, values[i]));
    ctx.stroke();
    ctx.globalAlpha = mod.opacity ?? 1;
  }
  if (showLabels) {
    mono(ctx, 6, '500'); ctx.textAlign = 'left';
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = colors[i];
      ctx.fillText(`${labels[i]} ${Math.round(values[i] * 100)}`, x + 2, y + 9 + i * 10);
    }
  }
  ctx.fillStyle = rgba(accent, 0.55);
  mono(ctx, 5.5, '400'); ctx.textAlign = 'center';
  ctx.fillText('BAND ENERGY', cx, cy + 3);
}

function drawPeakSpectrum(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 12;
  const barsOpt = modOpt(mod, 'bars', 'auto');
  const bars = barsOpt === 'auto' ? Math.max(28, Math.min(72, Math.floor(w / 5.6))) : clamp(Number(barsOpt) || 48, 24, 96);
  const tilt = modNum(mod, 'tilt', 35, 0, 100) / 100;
  const lowColor = isHexColor(modOpt(mod, 'lowColor', SCHEME_COLORS[0])) ? modOpt(mod, 'lowColor', SCHEME_COLORS[0]) : SCHEME_COLORS[0];
  const midColor = isHexColor(modOpt(mod, 'midColor', SCHEME_COLORS[1])) ? modOpt(mod, 'midColor', SCHEME_COLORS[1]) : SCHEME_COLORS[1];
  const highColor = isHexColor(modOpt(mod, 'highColor', SCHEME_COLORS[2])) ? modOpt(mod, 'highColor', SCHEME_COLORS[2]) : SCHEME_COLORS[2];
  const values = barValues(frame, bars);
  if (!st.values || st.values.length !== bars) st.values = new Float32Array(bars);
  if (!st.peaks || st.peaks.length !== bars) st.peaks = new Float32Array(bars);
  const floor = y + h;
  for (let i = 0; i < bars; i++) {
    const v = clamp(values[i] * (1 - tilt * (i / Math.max(1, bars - 1)) * 0.35), 0, 1);
    st.values[i] = st.values[i] * 0.62 + v * 0.38;
    st.peaks[i] = Math.max(st.peaks[i] * 0.985, st.values[i]);
    const bw = w / bars;
    const bx = x + i * bw;
    const bh = Math.max(1, st.values[i] * h * 0.86);
    const barColor = i > bars * 0.66 ? highColor : (i > bars * 0.33 ? midColor : lowColor);
    ctx.fillStyle = barColor;
    ctx.globalAlpha = (mod.opacity ?? 1) * (0.35 + st.values[i] * 0.65);
    ctx.fillRect(bx + bw * 0.18, floor - bh, Math.max(1, bw * 0.64), bh);
    ctx.globalAlpha = mod.opacity ?? 1;
    if (modOpt(mod, 'peakHold', true) && st.peaks[i] > 0.02) {
      ctx.fillStyle = rgba(barColor, 0.85);
      ctx.fillRect(bx + bw * 0.12, floor - st.peaks[i] * h * 0.86 - 1, Math.max(1, bw * 0.76), 1.5);
    }
  }
  mono(ctx, 5.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.textAlign = 'left';
  ctx.fillText(`${bars} BANDS · PEAK HOLD`, x, y + h + 8);
  ctx.textAlign = 'right'; ctx.fillStyle = rgba(accent, 0.6);
  ctx.fillText(`${Math.round(frame.centroid || 0)} Hz`, x + w, y + h + 8);
}

function drawBeatPulse(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 9;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const cx = x + w / 2, cy = y + h / 2;
  const base = Math.min(w, h) * 0.26;
  const sensitivity = clamp(modNum(mod, 'pulseSensitivity', 100, 50, 200) / 100, 0.5, 2);
  const maxRings = Math.round(modNum(mod, 'pulseRings', 6, 3, 10));
  const now = frame.time || 0;
  if (!st.rings) st.rings = [];
  if (!st.lastTime) st.lastTime = now;
  const dt = Math.max(0, Math.min(0.1, now - st.lastTime));
  st.lastTime = now;
  const pulse = clamp((frame.beatPulse || 0) * sensitivity, 0, 1);
  if (pulse > 0.62 && now - (st.lastBeat || -10) > 0.18) {
    st.lastBeat = now;
    st.rings.push({ r: base * 0.35, a: 0.55 });
  }
  st.rings = st.rings.filter((ring) => {
    ring.r += dt * base * 1.4;
    ring.a -= dt * 0.7;
    return ring.a > 0.02 && ring.r < Math.max(w, h) * 0.75;
  });
  if (st.rings.length > maxRings) st.rings.splice(0, st.rings.length - maxRings);
  for (const ring of st.rings) {
    ctx.strokeStyle = rgba(accent, ring.a);
    ctx.lineWidth = 1.2 + pulse * 2;
    ctx.beginPath(); ctx.arc(cx, cy, ring.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = rgba(accent, 0.12 + pulse * 0.30);
  ctx.beginPath(); ctx.arc(cx, cy, base * (0.7 + pulse * 0.6), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, base * 0.72, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.28); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, base * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frame.beatPhase || 0, 0, 1)); ctx.stroke();
  if (modOpt(mod, 'showBpm', true)) {
    ctx.fillStyle = rgba(accent, 0.75); ctx.textAlign = 'center';
    mono(ctx, 7, '500');
    ctx.fillText(`${Math.round(frame.bpm || 0)} BPM`, cx, cy + 3);
    mono(ctx, 5, '400'); ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillText(`BEAT ${Math.round(clamp(frame.beatPhase || 0, 0, 1) * 100)}%`, cx, cy + 13);
  }
}

function drawCircularScope(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p + 1;
  const w = body.w - p * 2, h = body.h - p * 2 - 10;
  const cx = x + w / 2, cy = y + h / 2;
  const radius = Math.min(w, h) * 0.36;
  const samples = clamp(Number(modOpt(mod, 'scopeSamples', 256)) || 256, 64, 1024);
  const width = modNum(mod, 'scopeWidth', 1.5, 1, 4);
  const glow = modOpt(mod, 'scopeGlow', true);
  const left = frame.tdL || new Float32Array(1024);
  const right = frame.tdR || left;
  const step = Math.max(1, Math.floor(left.length / samples));
  ctx.save();
  ctx.lineWidth = width;
  if (glow) { ctx.shadowBlur = 8; ctx.shadowColor = accent; }
  for (let ch = 0; ch < 2; ch++) {
    const data = ch === 0 ? left : right;
    ctx.strokeStyle = ch === 0 ? accent : '#68e8ff';
    ctx.globalAlpha = (mod.opacity ?? 1) * (ch === 0 ? 0.9 : 0.55);
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const value = clamp(data[Math.min(data.length - 1, i * step)] || 0, -1, 1);
      const angle = -Math.PI / 2 + (i / samples) * Math.PI * 2;
      const rr = radius + value * radius * 0.42 * (ch === 0 ? 1 : -1);
      const px = cx + Math.cos(angle) * rr;
      const py = cy + Math.sin(angle) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  mono(ctx, 5.5, '400'); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.textAlign = 'center';
  ctx.fillText('CIRCULAR SCOPE', cx, y + h + 8);
}

function drawChladni(ctx, mod, body, frame, st, env) {
  const accent = body.accent || '#ff7dba';
  const p = 8;
  const x = body.x + p;
  const y = body.y + p + 1;
  const w = body.w - p * 2;
  const h = body.h - p * 2 - 12;
  const side = Math.max(24, Math.min(w, h));
  const ox = x + (w - side) / 2;
  const oy = y + (h - side) / 2;
  const cx = ox + side / 2;
  const cy = oy + side / 2;
  const mode = String(modOpt(mod, 'chladniMode', '3,4')).split(',');
  const m = clamp(Number(mode[0]) || 3, 1, 9);
  const n = clamp(Number(mode[1]) || 4, 1, 9);
  const sandCount = clamp(Math.round(modNum(mod, 'sandCount', 4500, 1000, 12000)), 500, 12000);
  const amplitude = clamp(modNum(mod, 'vibration', 45, 0, 100) / 100, 0, 1);
  const sampling = clamp(Math.round(modNum(mod, 'sampling', 16, 8, 32)), 6, 32);
  const grainResponse = clamp(modNum(mod, 'grainResponse', 70, 10, 100) / 100, 0.1, 1);
  const showField = modOpt(mod, 'showField', true);
  const beat = clamp(frame.beatPulse || 0, 0, 1);
  const low = clamp(frame.low || 0, 0, 1);
  const mid = clamp(frame.mid || 0, 0, 1);
  const high = clamp(frame.high || 0, 0, 1);
  const playing = !!frame.playing;
  const audioDrive = clamp(low * 1.25 + mid * 0.55 + high * 0.25 + beat * 0.55, 0, 1);
  if (playing) {
    // Modes follow the low/high spectrum, not just a fixed m x n pair.
    st.modeM = clamp(m * (0.78 + low * 1.25 + beat * 0.35), 1, 12);
    st.modeN = clamp(n * (1.22 - high * 0.85 + mid * 0.30), 1, 12);
  }
  const mEff = st.modeM || m;
  const nEff = st.modeN || n;
  const rgb = hexToRgb(accent);
  const palette = env.palette || {};
  const bgRgb = hexToRgb(palette.bg || '#08040c');
  const isLight = (bgRgb.r * 299 + bgRgb.g * 587 + bgRgb.b * 114) / 1000 > 145;
  const labelColor = isLight ? 'rgba(45,25,55,.42)' : 'rgba(255,255,255,.26)';
  const sandColor = isLight ? 'rgba(52,28,60,.70)' : 'rgba(255,242,248,.72)';
  const cos = Math.cos;
  const sin = Math.sin;

  // The plate mode is slowly phase-modulated so the nodal figure visibly
  // breathes; sand jitter adds the fine grain motion on top.
  if (playing) {
    st.phase = (st.phase || 0) + 0.012 + amplitude * 0.045 + audioDrive * 0.16 + beat * 0.05;
    st.wobble = Math.sin((st.phase || 0) * 1.7) * (0.015 + amplitude * 0.16 + audioDrive * 0.14);
    st.pulse = 1 + beat * 0.05;
  }
  const wobble = st.wobble || 0;
  const pulse = st.pulse || 1;

  // Low-resolution nodal field. The real Chladni figure is the zero set of
  // this approximate eigenfunction; we render |f| as a soft plate glow.
  if (showField) {
    const grid = clamp(Math.round(12 + sampling * 1.8), 20, 72);
    if (!st.fieldCanvas || st.fieldSize !== grid) {
      st.fieldCanvas = document.createElement('canvas');
      st.fieldCanvas.width = grid;
      st.fieldCanvas.height = grid;
      st.fieldCtx = st.fieldCanvas.getContext('2d');
      st.fieldSize = grid;
      st.fieldImage = st.fieldCtx.createImageData(grid, grid);
    }
    const image = st.fieldImage;
    const data = image.data;
    for (let gy = 0; gy < grid; gy++) {
      const yy = (gy + 0.5) / grid * 2 - 1;
      for (let gx = 0; gx < grid; gx++) {
        const xx = (gx + 0.5) / grid * 2 - 1;
        const f = cos(mEff * Math.PI * xx + wobble) * cos(nEff * Math.PI * yy - wobble)
          - cos(nEff * Math.PI * xx - wobble) * cos(mEff * Math.PI * yy + wobble);
        const line = Math.pow(clamp(1 - Math.abs(f) * 1.35, 0, 1), 2.4);
        const idx = (gy * grid + gx) * 4;
        data[idx] = rgb.r;
        data[idx + 1] = rgb.g;
        data[idx + 2] = rgb.b;
        data[idx + 3] = Math.round(4 + line * 105 + amplitude * 22);
      }
    }
    st.fieldCtx.putImageData(image, 0, 0);
    ctx.save();
    ctx.globalAlpha = (mod.opacity ?? 1) * (isLight ? 0.58 : 0.78);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(st.fieldCanvas, ox, oy, side, side);
    ctx.restore();
  }

  if (!st.particles || st.particleCount !== sandCount) {
    st.particleCount = sandCount;
    st.particles = new Float32Array(sandCount * 2);
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < sandCount; i++) {
      st.particles[i * 2] = rand() * 2 - 1;
      st.particles[i * 2 + 1] = rand() * 2 - 1;
    }
    st.randState = seed;
  }

  // Approximate sand advection: a damped Newton step toward f = 0, plus a
  // small vibration jitter. This is cheaper than integrating a real plate.
  const particles = st.particles;
  const jitter = 0.003 + amplitude * 0.026 + audioDrive * 0.018 + beat * 0.025;
  const kick = 0.003 + amplitude * 0.006 + audioDrive * 0.025 + beat * 0.006;
  const step = 0.12 + grainResponse * 0.20;
  let seed = st.randState || 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (playing) {
    for (let i = 0; i < sandCount; i++) {
      let px = particles[i * 2];
      let py = particles[i * 2 + 1];
      const ax = mEff * Math.PI * px + wobble;
      const ay = nEff * Math.PI * py - wobble;
      const bx = nEff * Math.PI * px - wobble;
      const by = mEff * Math.PI * py + wobble;
      const f = cos(ax) * cos(ay) - cos(bx) * cos(by);
      const fx = -mEff * Math.PI * sin(ax) * cos(ay) + nEff * Math.PI * sin(bx) * cos(by);
      const fy = -nEff * Math.PI * cos(ax) * sin(ay) + mEff * Math.PI * cos(bx) * sin(by);
      const denom = fx * fx + fy * fy + 1e-5;
      px -= f * fx / denom * step;
      py -= f * fy / denom * step;
      if (rand() < kick) {
        px = rand() * 2 - 1;
        py = rand() * 2 - 1;
      } else if (jitter > 0.0001) {
        px += (rand() * 2 - 1) * jitter;
        py += (rand() * 2 - 1) * jitter;
      }
      px = clamp(px, -1, 1);
      py = clamp(py, -1, 1);
      particles[i * 2] = px;
      particles[i * 2 + 1] = py;
    }
    st.randState = seed;
  }

  // Plate and sand: one square frame, no extra circular border or plate fill.
  ctx.save();
  ctx.strokeStyle = rgba(accent, 0.24 + amplitude * 0.18 + beat * 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, side - 1, side - 1);

  const half = side / 2;
  const scale = half * pulse * (1 + Math.sin(st.phase * 2.3) * (0.006 + amplitude * 0.012));
  ctx.fillStyle = sandColor;
  ctx.globalAlpha = (mod.opacity ?? 1) * (0.42 + amplitude * 0.38);
  ctx.beginPath();
  const dot = Math.max(0.55, side / 620);
  for (let i = 0; i < sandCount; i++) {
    const px = cx + particles[i * 2] * scale;
    const py = cy + particles[i * 2 + 1] * scale;
    ctx.rect(px, py, dot, dot);
  }
  ctx.fill();
  ctx.restore();

  mono(ctx, 5.5, '400');
  ctx.fillStyle = labelColor;
  ctx.textAlign = 'left';
  ctx.fillText(`CHLADNI ${m}×${n} · ${sandCount} GRAINS`, x + 1, y + h + 8);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.55);
  ctx.fillText(`AMP ${Math.round(amplitude * 100)}% · GRID ${sampling}`, x + w - 1, y + h + 8);
}

// ── Arrangement / harmony / drum modules ────────────────────────────────────

/** Tempo used by bar-grid modules: manual BPM > audio-length calibration > MIDI. */
function projectTempo(env, midi, frame) {
  const manual = Number(env.info?.bpm);
  if (Number.isFinite(manual) && manual > 0) return clampTempo(manual);
  const audioDuration = Number(env.engine?.duration) || 0;
  const totalBeats = Number(midi?.totalBeats) || 0;
  if (totalBeats > 0 && audioDuration > 0) {
    const derived = (totalBeats / audioDuration) * 60;
    if (derived >= 20 && derived <= 400) return derived;
  }
  return clampTempo(midi?.bpm || frame?.bpm || 120);
}

function busTrackPalette(env) {
  const master = (env.modules || []).find((m) => m.type === 'pianoRoll' && m.options?.midiMaster)
    || (env.modules || []).find((m) => m.type === 'pianoRoll');
  const fallback = [env.settings?.accent || '#ff4f8b', SCHEME_COLORS[1], SCHEME_COLORS[3], SCHEME_COLORS[2], '#b9ff8a', '#ff8a6b'];
  const colors = Array.isArray(master?.options?.trackColors) ? master.options.trackColors : [];
  const all = master?.options?.allTrackColor === true;
  const global = isHexColor(master?.options?.globalTrackColor) ? master.options.globalTrackColor : '#ffc46b';
  const mutes = Array.isArray(master?.options?.trackMutes) ? master.options.trackMutes : [];
  const solos = Array.isArray(master?.options?.trackSolos) ? master.options.trackSolos : [];
  const soloActive = solos.some(Boolean);
  return {
    color: (index) => all ? global : (isHexColor(colors[index]) ? colors[index] : fallback[index % fallback.length]),
    audible: (index) => !mutes[index] && (!soloActive || !!solos[index]),
  };
}

function moduleInk(env) {
  const palette = env.palette || {};
  const bg = palette.bg || '#050308';
  const win = palette.window || '#171020';
  const light = luminance(bg) * 0.65 + luminance(win) * 0.35 > 0.52;
  return { light, ink: light ? '#1b1526' : (palette.text || '#f7eef3') };
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function drawFlPlaylist(ctx, mod, body, frame, st, env) {
  const palette = env.palette || {};
  const { ink: textColor } = moduleInk(env);
  const accent = body.accent;
  const midi = env.midiMerged || env.midi;
  const p = 8;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;

  if (!midi || !midi.notes?.length) {
    mono(ctx, 7, '500');
    ctx.fillStyle = rgba(accent, 0.55);
    ctx.textAlign = 'center';
    ctx.fillText('导入 MIDI 后，这里将铺出整首编排的色块', x + w / 2, y + h / 2);
    ctx.fillStyle = rgba(textColor, 0.25);
    mono(ctx, 5.8, '400');
    ctx.fillText('FL PLAYLIST / ARRANGEMENT', x + w / 2, y + h / 2 + 13);
    return;
  }

  const sig = env.timeSignature || resolveTimeSignature(env.info, midi);
  const bpm = projectTempo(env, midi, frame);
  const barSec = barSeconds(sig, bpm);
  const midiDuration = Number(midi.duration) || 0;
  const duration = midiDuration > 0 ? midiDuration : Math.max(Number(env.engine?.duration) || 0, barSec);
  const bars = clamp(Math.ceil(duration / barSec), 1, 1024);
  const time = Number(frame.time) || 0;

  const bus = busTrackPalette(env);
  const trackCount = Math.max(1, Number(midi.trackCount) || 1);
  const tracks = [];
  for (let index = 0; index < trackCount; index += 1) {
    if (!bus.audible(index)) continue;
    const meta = (midi.tracks || []).find((item) => item.index === index) || {};
    tracks.push({
      index,
      name: meta.trackName || meta.name || midi.trackNames?.[index] || `Track ${index + 1}`,
      color: bus.color(index),
    });
  }

  const cacheKey = `${bars}|${barSec.toFixed(4)}|${trackCount}`;
  if (st.midiRef !== midi || st.cacheKey !== cacheKey) {
    st.midiRef = midi;
    st.cacheKey = cacheKey;
    st.cells = tracks.map(() => new Float32Array(bars));
    const byIndex = new Map(tracks.map((track, i) => [track.index, i]));
    for (const note of midi.notes) {
      const row = byIndex.get(Number(note.track) || 0);
      if (row === undefined) continue;
      const startBar = clamp(Math.floor(note.start / barSec), 0, bars - 1);
      const endBar = clamp(Math.floor((Number(note.end) || note.start) / barSec), 0, bars - 1);
      for (let bar = startBar; bar <= endBar; bar += 1) st.cells[row][bar] += 1;
    }
    st.maxCell = 1;
    for (const cells of st.cells) for (const value of cells) if (value > st.maxCell) st.maxCell = value;
  }

  const showRuler = modOpt(mod, 'ruler', true);
  const showPlayhead = modOpt(mod, 'playhead', true);
  const intensity = modOpt(mod, 'intensity', true);
  const rulerH = showRuler ? 14 : 0;
  const footerH = 12;
  const labelW = clamp(w * 0.2, 64, 168);
  const gridX = x + labelW + 6;
  const gridW = Math.max(20, w - labelW - 6);
  const rowsY = y + rulerH + 2;
  const rowsH = Math.max(12, h - rulerH - footerH - 4);

  // Vertical capacity follows the MIDI O/C rule: shrink rows, reserve the last
  // slot for a "+ N More Track" notice instead of clipping the arrangement.
  const minRowH = 9;
  const capacity = Math.max(1, Math.floor(rowsH / minRowH));
  const total = tracks.length;
  let visible = Math.min(capacity, total);
  let moreCount = 0;
  if (total > visible && visible > 1) {
    visible -= 1;
    moreCount = total - visible;
  }
  const rowCount = visible + (moreCount > 0 ? 1 : 0);
  const rowH = Math.min(modNum(mod, 'rowHeight', 28, 12, 44), rowsH / Math.max(1, rowCount));
  const cellW = gridW / bars;
  const gap = cellW > 3 ? Math.min(1.5, cellW * 0.18) : 0;
  const blockH = Math.max(2, rowH - Math.min(4, rowH * 0.22));

  ctx.save();
  ctx.textBaseline = 'middle';

  // Bar ruler.
  if (showRuler) {
    mono(ctx, 5.5, '400');
    ctx.fillStyle = rgba(textColor, 0.35);
    ctx.textAlign = 'left';
    const minGap = 30;
    const steps = [1, 2, 4, 8, 16, 32, 64, 128];
    let step = steps[steps.length - 1];
    for (const candidate of steps) {
      if (candidate * cellW >= minGap) { step = candidate; break; }
    }
    for (let bar = 0; bar < bars; bar += step) {
      const px = gridX + bar * cellW;
      ctx.fillText(String(bar + 1), px + 1, y + rulerH / 2);
      ctx.strokeStyle = rgba(textColor, 0.08);
      ctx.beginPath();
      ctx.moveTo(px + 0.5, rowsY);
      ctx.lineTo(px + 0.5, rowsY + rowCount * rowH);
      ctx.stroke();
    }
  }

  const currentBar = clamp(Math.floor(time / barSec), 0, bars - 1);
  if (showPlayhead) {
    ctx.fillStyle = rgba(accent, 0.08);
    ctx.fillRect(gridX + currentBar * cellW, rowsY, Math.max(cellW, 1.5), rowCount * rowH);
  }

  for (let row = 0; row < visible; row += 1) {
    const track = tracks[row];
    const ry = rowsY + row * rowH;
    const cy = ry + rowH / 2;
    ctx.fillStyle = rgba(textColor, row % 2 ? 0.025 : 0.05);
    ctx.fillRect(x, ry, w, rowH - 1);
    mono(ctx, Math.max(5, Math.min(7, rowH * 0.42)), '600');
    ctx.fillStyle = rgba(track.color, 0.92);
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, track.name, labelW - 4), x + 2, cy);
    const cells = st.cells[row];
    for (let bar = 0; bar < bars; bar += 1) {
      const value = cells[bar];
      if (!value) continue;
      const alpha = intensity ? 0.3 + 0.7 * Math.min(1, value / st.maxCell) : 0.85;
      ctx.fillStyle = rgba(track.color, alpha);
      ctx.fillRect(gridX + bar * cellW + gap / 2, cy - blockH / 2, Math.max(0.8, cellW - gap), blockH);
    }
  }
  if (moreCount > 0) {
    const cy = rowsY + visible * rowH + rowH / 2;
    mono(ctx, Math.max(5, Math.min(7, rowH * 0.42)), '600');
    ctx.fillStyle = rgba(textColor, 0.55);
    ctx.textAlign = 'left';
    ctx.fillText(`+ ${moreCount} More Track`, x + 2, cy);
  }

  if (showPlayhead) {
    const px = gridX + clamp(time / duration, 0, 1) * gridW;
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.lineWidth = 1.2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, rowsY - 2);
    ctx.lineTo(px, rowsY + rowCount * rowH);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  mono(ctx, 5.5, '400');
  ctx.fillStyle = rgba(textColor, 0.35);
  ctx.textAlign = 'left';
  ctx.fillText(`${total} TRACKS · ${bars} BARS`, x, y + h - 4);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.6);
  ctx.fillText(`${formatTimeSignature(sig)} · ${bpm.toFixed(1)} BPM · BAR ${currentBar + 1}`, x + w, y + h - 4);
  ctx.restore();
}

function drawHarmony(ctx, mod, body, frame, st, env) {
  const palette = env.palette || {};
  const { light, ink } = moduleInk(env);
  const accent = body.accent;
  const midi = env.midiMerged || env.midi;
  const p = 12;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;
  const highlight = modOpt(mod, 'followChart', true)
    ? (palette.chart || accent)
    : (isHexColor(modOpt(mod, 'highlight', '')) ? modOpt(mod, 'highlight', '') : (palette.chart || accent));
  const onHighlight = luminance(highlight) > 0.62 ? '#1b1526' : '#ffffff';

  if (!midi || !midi.notes?.length) {
    mono(ctx, 7, '500');
    ctx.fillStyle = rgba(ink, 0.5);
    ctx.textAlign = 'center';
    ctx.fillText('导入 MIDI 后，这里将推算当前和弦', x + w / 2, y + h / 2);
    ctx.fillStyle = rgba(ink, 0.3);
    mono(ctx, 5.8, '400');
    ctx.fillText('HARMONY / CHORDS', x + w / 2, y + h / 2 + 13);
    return;
  }

  const sig = env.timeSignature || resolveTimeSignature(env.info, midi);
  const bpm = projectTempo(env, midi, frame);
  const trackOpt = String(modOpt(mod, 'track', 'auto'));
  const resolved = trackOpt === 'auto' ? -1 : resolveMidiTrackIndex(midi, trackOpt);
  // A stale reference (track deleted, or a layer removed) falls back to auto
  // instead of silently pointing at whatever track took its place.
  const autoTrack = resolved < 0;
  const trackIndex = autoTrack ? -1 : resolved;
  const division = clamp(Math.round(modNum(mod, 'division', 2, 1, 4)), 1, 4);
  const time = Number(frame.time) || 0;

  const cacheKey = `${autoTrack ? 'auto' : trackIndex}|${bpm.toFixed(3)}|${division}|${sig.numerator}/${sig.denominator}`;
  if (st.midiRef !== midi || st.cacheKey !== cacheKey) {
    st.midiRef = midi;
    st.cacheKey = cacheKey;
    st.trackIndex = trackIndex;
    // Auto means "the whole arrangement" (minus drums); picking a single track
    // remains available when the user wants that track's own harmony.
    st.notes = autoTrack
      ? midi.notes.filter((note) => Number(note.channel) !== 9)
      : midi.notes.filter((note) => (Number(note.track) || 0) === trackIndex);
    st.segments = chordSegments(st.notes, { bpm, sig, division });
    st.key = inferKey(st.notes);
  }

  const manualKey = parseKey(modOpt(mod, 'key', '')) || parseKey(env.info?.key);
  const keyInfo = manualKey || st.key;
  const keyName = keyInfo ? keyInfo.name : 'KEY —';

  const { current, next, progress } = chordAt(st.segments, time);
  const currentIndex = current ? st.segments.indexOf(current) : -1;
  const rootName = current && current.root != null ? NOTE_NAMES[current.root] : '';
  const quality = current?.label || '';

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Header: source on the left, key on the right.
  const trackMeta = (midi.tracks || []).find((item) => item.index === trackIndex);
  const trackName = autoTrack
    ? 'ALL TRACKS'
    : (trackMeta?.name || trackMeta?.trackName || `Track ${trackIndex + 1}`);
  mono(ctx, 5.6, '500');
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ink, 0.4);
  spacedText(ctx, 'SOURCE', x, y + 7, 0.9);
  mono(ctx, 5.6, '400');
  ctx.fillStyle = rgba(ink, 0.62);
  ctx.fillText(fitText(ctx, trackName.toUpperCase(), w * 0.44), x + 38, y + 7);

  ctx.textAlign = 'right';
  mono(ctx, 5.6, '500');
  ctx.fillStyle = rgba(ink, 0.4);
  ctx.fillText('KEY', x + w - 70, y + 7);
  sans(ctx, 10, '700');
  ctx.fillStyle = rgba(highlight, 0.95);
  ctx.fillText(keyName.toUpperCase(), x + w, y + 7);

  // Next chord capsule.
  const capsuleW = clamp(w * 0.28, 78, 118);
  const capsuleH = 34;
  const capsuleX = x + w - capsuleW;
  const capsuleY = y + 18;
  if (next?.name && h > 110) {
    roundRect(ctx, capsuleX, capsuleY, capsuleW, capsuleH, 6);
    ctx.fillStyle = rgba(ink, light ? 0.035 : 0.05);
    ctx.fill();
    ctx.strokeStyle = rgba(ink, 0.16);
    ctx.lineWidth = 1;
    ctx.stroke();
    mono(ctx, 5.4, '500');
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(ink, 0.42);
    ctx.fillText('NEXT', capsuleX + 9, capsuleY + 13);
    sans(ctx, 13, '600');
    ctx.fillStyle = rgba(ink, 0.85);
    ctx.fillText(fitText(ctx, next.name, capsuleW - 18), capsuleX + 9, capsuleY + 27);
  }

  // Big chord name: solid root, lighter quality suffix.
  const chordSize = clamp(h * 0.19, 22, 54);
  const nameBaseline = y + 26 + chordSize;
  sans(ctx, chordSize, '700');
  ctx.textAlign = 'left';
  ctx.fillStyle = current?.name ? ink : rgba(ink, 0.35);
  const rootText = current?.name ? (rootName || current.name) : 'N.C.';
  ctx.fillText(rootText, x, nameBaseline);
  const rootW = ctx.measureText(rootText).width;
  if (current?.name && quality) {
    sans(ctx, chordSize * 0.72, '300');
    ctx.fillStyle = rgba(highlight, 0.9);
    ctx.fillText(quality, x + rootW + 2, nameBaseline);
  }

  // Quality chip (like the reference "Isus2" pill).
  let cursorY = nameBaseline + 12;
  if (current?.name && quality && h > 150) {
    sans(ctx, 8.5, '600');
    const chipW = ctx.measureText(current.name).width + 18;
    roundRect(ctx, x, cursorY - 11, chipW, 17, 8.5);
    ctx.fillStyle = rgba(highlight, 0.16);
    ctx.fill();
    ctx.strokeStyle = rgba(highlight, 0.45);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = rgba(onHighlight === '#1b1526' ? darken(highlight, 0.2) : highlight, 0.95);
    ctx.fillText(current.name, x + 9, cursorY + 1);
    cursorY += 16;
  }

  // Segment progress.
  const progW = Math.min(w * 0.45, 240);
  ctx.fillStyle = rgba(ink, 0.12);
  ctx.fillRect(x, cursorY, progW, 3);
  ctx.fillStyle = rgba(highlight, 0.9);
  ctx.fillRect(x, cursorY, progW * clamp(progress, 0, 1), 3);
  cursorY += 12;

  // Keyboard (two octaves, C3–B4).
  const showKeyboard = modOpt(mod, 'showKeyboard', true);
  const showProgression = modOpt(mod, 'showProgression', true);
  const footerH = 12;
  const progChipsH = showProgression && h > 190 ? 26 : 0;
  if (showKeyboard && h > 150) {
    const keyH = clamp(y + h - cursorY - progChipsH - footerH, 34, 96);
    if (keyH >= 34) {
      drawHarmonyKeys(ctx, x, cursorY, w, keyH, highlight, light, ink, current);
      cursorY += keyH + 10;
    }
  }

  // Progression chips: current chord highlighted, then upcoming ones.
  if (progChipsH && h - (cursorY - y) >= progChipsH + footerH - 4) {
    const items = [];
    if (current?.name) items.push({ name: current.name, active: true });
    for (let i = currentIndex + 1; i < st.segments.length && items.length < 6; i += 1) {
      const segment = st.segments[i];
      if (!segment.name) continue;
      if (items.length && items[items.length - 1].name === segment.name) continue;
      items.push({ name: segment.name, active: false });
    }
    sans(ctx, 8.5, '600');
    let chipX = x;
    const chipH = 18;
    for (const item of items) {
      const chipW = ctx.measureText(item.name).width + 18;
      if (chipX + chipW > x + w) break;
      roundRect(ctx, chipX, cursorY - chipH, chipW, chipH, chipH / 2);
      if (item.active) {
        ctx.fillStyle = rgba(highlight, 0.9);
        ctx.fill();
        ctx.fillStyle = onHighlight;
      } else {
        ctx.fillStyle = rgba(ink, light ? 0.04 : 0.07);
        ctx.fill();
        ctx.strokeStyle = rgba(ink, 0.12);
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.fillStyle = rgba(ink, 0.65);
      }
      ctx.textAlign = 'center';
      ctx.fillText(item.name, chipX + chipW / 2, cursorY - 5);
      ctx.textAlign = 'left';
      chipX += chipW + 6;
    }
  }

  // Footer.
  mono(ctx, 5.5, '400');
  ctx.textAlign = 'left';
  ctx.fillStyle = rgba(ink, 0.38);
  ctx.fillText(`${formatTimeSignature(sig)} · ${bpm.toFixed(1)} BPM`, x, y + h);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(ink, 0.32);
  ctx.fillText('HARMONY', x + w, y + h);
  ctx.restore();
}

/** Two-octave keyboard strip used by the harmony module. */
function drawHarmonyKeys(ctx, x, y, width, height, highlight, light, ink, current) {
  const startPitch = 48;
  const keys = 24;
  const whiteOffsets = new Set([0, 2, 4, 5, 7, 9, 11]);
  const whites = [];
  for (let i = 0; i < keys; i += 1) {
    if (whiteOffsets.has(i % 12)) whites.push(startPitch + i);
  }
  const whiteW = width / whites.length;
  const activePcs = new Set(current?.pitches || []);
  const rootPc = current?.root;
  const whiteIndex = new Map(whites.map((pitch, i) => [pitch, i]));
  const onHighlight = luminance(highlight) > 0.62 ? '#1b1526' : '#ffffff';

  ctx.lineWidth = 1;
  ctx.strokeStyle = light ? 'rgba(24,18,38,.28)' : 'rgba(0,0,0,.55)';
  for (const pitch of whites) {
    const pc = pitch % 12;
    const kx = x + whiteIndex.get(pitch) * whiteW;
    const active = activePcs.has(pc);
    roundRect(ctx, kx + 0.5, y, Math.max(2, whiteW - 1.2), height, 2);
    ctx.fillStyle = active ? highlight : (light ? '#ffffff' : 'rgba(255,255,255,.13)');
    ctx.fill();
    ctx.stroke();
    if (active) {
      ctx.shadowColor = rgba(highlight, 0.8);
      ctx.shadowBlur = 7;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (pc === 0) {
      mono(ctx, 4.8, '500');
      ctx.fillStyle = active ? onHighlight : rgba(ink, 0.45);
      ctx.textAlign = 'center';
      ctx.fillText(noteLabel(pitch), kx + whiteW / 2, y + height - 4);
    } else if (active && whiteW > 16) {
      mono(ctx, 4.8, '600');
      ctx.fillStyle = onHighlight;
      ctx.textAlign = 'center';
      ctx.fillText(noteLabel(pitch), kx + whiteW / 2, y + height - 4);
    }
  }

  const blackOffsets = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
  const blackW = whiteW * 0.58;
  const blackH = height * 0.62;
  for (let i = 0; i < keys; i += 1) {
    const off = i % 12;
    if (!(off in blackOffsets)) continue;
    const pitch = startPitch + i;
    const wi = whiteIndex.get(pitch - 1);
    if (wi === undefined) continue;
    const kx = x + (wi + 1) * whiteW - blackW / 2;
    const active = activePcs.has(pitch % 12);
    roundRect(ctx, kx, y, blackW, blackH, 1.5);
    ctx.fillStyle = active ? highlight : (light ? '#1b1526' : '#07050a');
    ctx.fill();
    if (active) {
      ctx.shadowColor = rgba(highlight, 0.85);
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = light ? 'rgba(24,18,38,.35)' : 'rgba(255,255,255,.1)';
      ctx.stroke();
    }
    if (active && pcLabelFits(blackW)) {
      mono(ctx, 4.4, '600');
      ctx.fillStyle = onHighlight;
      ctx.textAlign = 'center';
      ctx.fillText(noteLabel(pitch), kx + blackW / 2, y + blackH - 4);
    }
  }
}

function pcLabelFits(width) {
  return width > 13;
}

function drawDrumStep(ctx, mod, body, frame, st, env) {
  const palette = env.palette || {};
  const { ink: textColor } = moduleInk(env);
  const accent = body.accent;
  const midi = env.midiMerged || env.midi;
  const board = (env.drumBoard?.tracks || []).slice(0, DRUM_TRACK_LIMIT);
  const p = 10;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;

  if (!board.length) {
    mono(ctx, 7, '500');
    ctx.fillStyle = rgba(accent, 0.55);
    ctx.textAlign = 'center';
    ctx.fillText('在「鼓组步进」板块里编排步进（上限 7 条鼓轨）', x + w / 2, y + h / 2);
    ctx.fillStyle = rgba(textColor, 0.25);
    mono(ctx, 5.8, '400');
    ctx.fillText('DRUM STEP / SEQUENCER', x + w / 2, y + h / 2 + 13);
    return;
  }

  const sig = env.timeSignature || resolveTimeSignature(env.info, midi);
  const showVelocity = modOpt(mod, 'showVelocity', false);
  const showPlayhead = modOpt(mod, 'playhead', true);
  const steps = stepCountFor(sig);
  const beats = Math.max(1, Number(sig.beats) || 4);
  const rows = patternRows(board, steps);
  const playhead = clamp(Number(frame.barPhase) || 0, 0, 1);
  const beatInBar = clamp(Math.floor(playhead * beats), 0, beats - 1);
  st.steps = steps;
  st.rows = rows.length;

  const rulerH = 14;
  const footerH = 12;
  const labelW = clamp(w * 0.2, 56, 120);
  const gridX = x + labelW + 6;
  const gridW = Math.max(20, w - labelW - 6);
  const bandH = Math.max(14, h - footerH - 2);
  const rowH = Math.min(48, (bandH - rulerH - 2) / rows.length);
  const totalH = rulerH + rows.length * rowH;
  const bandTop = y + Math.max(0, (bandH - totalH) / 2);
  const rowsY = bandTop + rulerH + 2;
  const cellW = gridW / steps;
  const gap = Math.min(2, cellW * 0.16);
  const dotSize = Math.max(3, Math.min(rowH - 5, cellW - gap) * 0.72);

  ctx.save();
  ctx.textBaseline = 'middle';

  // Beat ruler.
  mono(ctx, 5.5, '500');
  ctx.textAlign = 'center';
  for (let beat = 0; beat < beats; beat += 1) {
    const bx = gridX + beat * STEPS_PER_BEAT * cellW;
    ctx.fillStyle = beat === beatInBar ? rgba(accent, 0.95) : rgba(textColor, 0.35);
    ctx.fillText(String(beat + 1), bx + (STEPS_PER_BEAT * cellW) / 2, bandTop + rulerH / 2);
    ctx.strokeStyle = rgba(textColor, beat === 0 ? 0.16 : 0.08);
    ctx.beginPath();
    ctx.moveTo(bx + 0.5, rowsY);
    ctx.lineTo(bx + 0.5, rowsY + rows.length * rowH);
    ctx.stroke();
  }

  for (let row = 0; row < rows.length; row += 1) {
    const { track, values } = rows[row];
    const ry = rowsY + row * rowH;
    const cy = ry + rowH / 2;
    const color = isHexColor(track.color) ? track.color : accent;
    ctx.fillStyle = rgba(textColor, row % 2 ? 0.025 : 0.05);
    ctx.fillRect(x, ry, w, rowH - 1);
    mono(ctx, Math.max(5, Math.min(7, rowH * 0.4)), '600');
    ctx.fillStyle = rgba(color, 0.92);
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, String(track.name || `DRUM ${row + 1}`).toUpperCase(), labelW - 4), x + 2, cy);
    for (let step = 0; step < steps; step += 1) {
      const cx = gridX + step * cellW + cellW / 2;
      const velocity = values[step];
      const onBeat = step % STEPS_PER_BEAT === 0;
      if (velocity > 0) {
        const alpha = showVelocity ? 0.4 + 0.6 * velocity : 0.9;
        const size = dotSize * (showVelocity ? 0.7 + 0.3 * velocity : 1);
        ctx.fillStyle = rgba(color, alpha);
        ctx.shadowColor = rgba(color, 0.7);
        ctx.shadowBlur = 6 * velocity;
        roundRect(ctx, cx - size / 2, cy - size / 2, size, size, Math.min(3, size * 0.3));
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = rgba(textColor, onBeat ? 0.14 : 0.06);
        const size = dotSize * 0.34;
        roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 1);
        ctx.fill();
      }
    }
  }

  if (showPlayhead) {
    const px = gridX + clamp(playhead, 0, 1) * gridW;
    ctx.strokeStyle = rgba(accent, 0.9);
    ctx.lineWidth = 1.2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, rowsY - 2);
    ctx.lineTo(px, rowsY + rows.length * rowH);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const barIndex = Math.max(0, Number(frame.barIndex) || 0);
  mono(ctx, 5.5, '400');
  ctx.fillStyle = rgba(textColor, 0.35);
  ctx.textAlign = 'left';
  ctx.fillText(`${rows.length} / ${DRUM_TRACK_LIMIT} DRUM TRACKS`, x, y + h - 4);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.6);
  ctx.fillText(`BAR ${barIndex + 1} · ${formatTimeSignature(sig)} · ${steps} STEPS`, x + w, y + h - 4);
  ctx.restore();
}

const DRAWERS = {
  levels: drawLevels,
  loudness: drawLoudness,
  dial: drawDial,
  scope: drawScope,
  lissajous: drawLissajous,
  spectrum: drawSpectrum,
  phase: drawPhase,
  rhythm: drawRhythm,
  dynamics: drawDynamics,
  spectrogram: drawSpectrogram,
  stereometer: drawStereometer,
  waveform: drawWaveform,
  pianoRoll: drawPianoRoll,
  midiOC: drawMidiOC,
  flPlaylist: drawFlPlaylist,
  harmony: drawHarmony,
  drumStep: drawDrumStep,
  peakSlope: drawPeakSlope,
  stereoField: drawStereoField,
  bandRings: drawBandRings,
  peakSpectrum: drawPeakSpectrum,
  beatPulse: drawBeatPulse,
  circularScope: drawCircularScope,
  chladni: drawChladni,
  basicInfo: drawBasicInfo,
};

export function registerPluginDrawer(id, drawer) {
  if (typeof id === 'string' && id && typeof drawer === 'function') DRAWERS[id] = drawer;
}

export function unregisterPluginDrawer(id) {
  if (typeof id === 'string') delete DRAWERS[id];
}

export function drawVisualModule(ctx, mod, accent, env) {
  if (!MODULE_DEFS[mod.type] || mod.hidden) return;
  const palette = env.palette || {
    bg: '#050308', window: '#171020', text: '#f7eef3', chart: accent,
  };
  const frameless = mod.type === 'midiOC' && modOpt(mod, 'frame', false) !== true;
  const body = frameless
    ? {
      x: Math.round(mod.x), y: Math.round(mod.y), w: Math.round(mod.w), h: Math.round(mod.h),
      head: 0, accent: palette.chart || accent, rgb: hexToRgb(palette.chart || accent),
    }
    : (env.cardBody || drawCard(ctx, mod, palette.chart || accent, env));
  const st = getState(env, mod);
  const drawer = DRAWERS[mod.type];
  if (!drawer) return;
  ctx.save();
  if (!frameless) clipRect(ctx, body.x, body.y, body.w, body.h);
  const originalFillText = ctx.fillText;
  const pluginModule = Boolean(MODULE_DEFS[mod.type]?.plugin);
  if (!pluginModule && !['basicInfo', 'midiOC', 'flPlaylist', 'harmony', 'drumStep'].includes(mod.type) && palette.text) {
    ctx.fillText = function (text, x, y, maxWidth) {
      ctx.fillStyle = palette.text;
      return originalFillText.call(ctx, text, x, y, maxWidth);
    };
  }
  try {
    drawer(ctx, mod, body, env.frame, st, env);
  } catch (err) {
    console.error(`[NEON//SCOPE] Module "${mod.type}" draw error:`, err);
    mono(ctx, 8, '400');
    ctx.fillStyle = '#ff6c82';
    ctx.textAlign = 'center';
    ctx.fillText('RENDER ERROR', body.x + body.w / 2, body.y + body.h / 2);
  }
  ctx.fillText = originalFillText;
  ctx.restore();
}

export function resetModuleState(states, id) {
  states.delete(id);
}

export function clearAllModuleStates(states) {
  states.clear();
}
