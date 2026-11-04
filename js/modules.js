import {
  MODULE_DEFS, clamp, lerp, rgba, mixHex, lighten, darken, hexToRgb,
  luminance, roundRect, spacedText, formatShortTime,
} from './core.js';

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
  waveform: 'FULL', pianoRoll: 'MIDI', peakSlope: 'PEAK', stereoField: 'WIDE',
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
  const t = (mod.title || '').toUpperCase();
  if (/·\s*L\s*$/.test(t) || /\bL ONLY\b/.test(t)) return 'L';
  if (/·\s*R\s*$/.test(t) || /\bR ONLY\b/.test(t)) return 'R';
  return 'BOTH';
}

function modOpt(mod, key, fallback) {
  const value = mod.options?.[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function modNum(mod, key, fallback, min = -Infinity, max = Infinity) {
  return clamp(Number(modOpt(mod, key, fallback)) || fallback, min, max);
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
  ctx.strokeStyle = 'rgba(255,255,255,.018)';
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
    ctx.fillStyle = 'rgba(255,255,255,.014)';
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
  const title = (mod.title || def.code).toUpperCase();
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
  const mainW = w * 0.56;
  const targetLufs = Number(modOpt(mod, 'target', -14));
  const historyLength = Math.round(modNum(mod, 'history', 180, 40, 180));

  // History.
  if (!st.history) st.history = [];
  if (frame.playing) {
    st.history.push(frame.lufsS);
    if (st.history.length > historyLength) st.history.shift();
  }
  const histH = 30;
  const histY = y + h - histH;
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
  ctx.fillText(mainText, x, y + 34);
  const nw = ctx.measureText(mainText).width;
  mono(ctx, 8, '500');
  ctx.fillStyle = rgba(accent, 0.78);
  ctx.fillText('LUFS', x + nw + 5, y + 30);

  // Mini target ruler.
  const meterY = y + 59;
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

  // Right column: true peak and integrated.
  const rx = x + mainW + 8;
  const rw = w - mainW - 8;
  const dividerX = x + mainW + 1;
  ctx.strokeStyle = 'rgba(255,255,255,.075)';
  ctx.beginPath();
  ctx.moveTo(dividerX, y);
  ctx.lineTo(dividerX, y + h - 5);
  ctx.stroke();

  sans(ctx, 6.5, '600');
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  ctx.textAlign = 'left';
  spacedText(ctx, 'TRUE PEAK', rx + 8, y + 9, 0.7);
  mono(ctx, 17, '400');
  ctx.fillStyle = '#f3dfe8';
  const tp = frame.truePeakDb;
  ctx.fillText(tp <= -59.5 ? '−∞' : tp.toFixed(1), rx + 8, y + 31);
  mono(ctx, 6.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.fillText('dBTP', rx + 8 + (tp <= -59.5 ? 17 : 29), y + 31);

  const barY = y + 42;
  const tpN = dbToNorm(tp, -24, 0);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.fillRect(rx + 8, barY, rw - 16, 2);
  ctx.fillStyle = tp > -1 ? '#ff6f86' : rgba(accent, 0.8);
  ctx.fillRect(rx + 8, barY, (rw - 16) * tpN, 2);

  sans(ctx, 6.5, '600');
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  spacedText(ctx, 'INTEGRATED', rx + 8, y + 56, 0.7);
  mono(ctx, 14, '400');
  ctx.fillStyle = rgba(accent, 0.9);
  const intText = frame.lufsI <= -59.5 ? '−∞' : frame.lufsI.toFixed(1);
  ctx.fillText(intText, rx + 8, y + 73);
  mono(ctx, 6.5, '400');
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.fillText('LUFS-I', rx + 8 + (frame.lufsI <= -59.5 ? 17 : 26), y + 73);

  // Peak hold indicator meters.
  mono(ctx, 6, '400');
  ctx.fillStyle = 'rgba(255,255,255,.24)';
  ctx.fillText(`L ${fmtDb(ampToDb(frame.rmsL), 0)}`, rx + 8, y + 89);
  ctx.fillText(`R ${fmtDb(ampToDb(frame.rmsR), 0)}`, rx + 8, y + 98);

  sans(ctx, 6, '500');
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillText('K-WEIGHTED · 400 ms', x, y + h - 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.55);
  ctx.fillText('AES17 / ITU-R BS.1770', x + w, y + h - 2);
}

function drawDial(ctx, mod, body, frame, st, env) {
  const accent = body.accent;
  const p = 10;
  const x = body.x + p, y = body.y + p;
  const w = body.w - p * 2, h = body.h - p * 2;
  const cx = x + w / 2, cy = y + h * 0.60;
  const radius = Math.min(w * 0.42, h * 0.52);
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
    if (mode === 'BOTH') drawGhost(gh.r, '#64e8ff', ga);
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
  if (mode === 'BOTH') trace(dataR, '#64e8ff', 0.62, Math.max(0.6, traceWidth * 0.82));
  if (mode === 'R') trace(dataR, '#64e8ff', 0.92, traceWidth);

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
    ctx.fillStyle = 'rgba(100,232,255,.7)';
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
  const trail = modNum(mod, 'trail', 70, 0, 100);
  const dotSize = modNum(mod, 'dotSize', 1.2, 0.5, 3);

  // Grid and target rings.
  if (modOpt(mod, 'rings', true)) {
    ctx.strokeStyle = 'rgba(255,255,255,.075)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.stroke();
  }

  let peak = 0.02;
  for (let i = 0; i < 8192; i += 4) {
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
  const step = Math.max(1, Math.floor(8192 / 1400));
  lc.beginPath();
  for (let i = 0; i < 8192; i += step) {
    const l = clamp(frame.tdL[i] * gain, -1.2, 1.2);
    const rr = clamp(frame.tdR[i] * gain, -1.2, 1.2);
    const px = layer.canvas.width / 2 + l * radius * scale * 1.2;
    const py = layer.canvas.height / 2 - rr * radius * scale * 1.2;
    if (i === 0) lc.moveTo(px, py); else lc.lineTo(px, py);
  }
  lc.strokeStyle = `rgba(${r.r},${r.g},${r.b},${0.15 + frame.energy * 0.13})`;
  lc.lineWidth = Math.max(0.8, dotSize * scale);
  lc.stroke();
  lc.fillStyle = `rgba(255,235,246,${0.24 + frame.energy * 0.22})`;
  for (let i = 0; i < 8192; i += step * 2) {
    const l = clamp(frame.tdL[i] * gain, -1.2, 1.2);
    const rr = clamp(frame.tdR[i] * gain, -1.2, 1.2);
    const mag = Math.abs(l) + Math.abs(rr);
    if (mag < 0.02) continue;
    const px = layer.canvas.width / 2 + l * radius * scale * 1.2;
    const py = layer.canvas.height / 2 - rr * radius * scale * 1.2;
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
  ctx.fillText('M/S', cx, y + h - 2);
}

// ── Frequency modules ───────────────────────────────────────────────────────

function barValues(frame, count, fMin = 24, fMax = 20000) {
  const out = new Float32Array(count);
  const nyquist = frame.sampleRate / 2;
  const binHz = frame.sampleRate / 8192;
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const hz of gridHz) {
      const t = Math.log(hz / 24) / Math.log(20000 / 24);
      const gx = Math.round(x + t * w) + 0.5;
      ctx.strokeStyle = hz === 1000 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, floorY);
      ctx.stroke();
      if (hz === 20 || hz === 100 || hz === 1000 || hz === 10000) {
        ctx.fillStyle = 'rgba(255,255,255,.27)';
        const label = hz >= 1000 ? `${hz / 1000}k` : String(hz);
        ctx.fillText(label, gx, floorY + 3);
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
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.24)';
  ctx.fillText('20', x, floorY + 3);
  ctx.textAlign = 'right';
  ctx.fillText('20k', x + w, floorY + 3);
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
    const binHz = frame.sampleRate / 8192;
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
  const step = Math.max(1, Math.floor(8192 / 550));
  for (let i = 0; i < 8192; i += step) {
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
  const step = Math.max(1, Math.floor(8192 / (300 + density * 600)));
  ctx.fillStyle = rgba(accent, 0.22);
  for (let i = 0; i < 8192; i += step) {
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
  ctx.fillText(bpm ? bpm.toFixed(1) : '—', x, y + 43);
  mono(ctx, 8, '500');
  ctx.fillStyle = rgba(accent, 0.72);
  ctx.fillText('BPM', x + (bpm ? ctx.measureText(`${bpm.toFixed(1)}`).width : 0) + 18, y + 36);

  // Beat dots.
  const dotY = y + 62;
  if (modOpt(mod, 'beatDots', true)) {
    for (let i = 0; i < 4; i++) {
      const active = Math.floor(phase * 4) === i && frame.playing;
      ctx.beginPath();
      ctx.arc(x + 4 + i * 13, dotY, active ? 3.3 : 2.2, 0, TAU);
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
    ctx.fillText('BAR / 4-4', x + 58, dotY + 2);
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
  const speed = clamp(modNum(mod, 'speed', 100, 50, 250) / 100, 0.5, 2.5);
  const autoSpeed = modOpt(mod, 'autoSpeed', true);
  const syncAudioLength = modOpt(mod, 'syncAudioLength', true);
  const barsVisible = modNum(mod, 'barsVisible', 8, 1, 32);
  const signature = midi.timeSignature || { numerator: 4, denominator: 4 };
  const beatsPerBar = Math.max(1, Number(signature.numerator) || 4) * (4 / Math.max(1, Number(signature.denominator) || 4));
  const midiBpm = Math.max(40, Number(midi.bpm) || 120);
  const audioDuration = Number(env.engine?.duration) || 0;
  const durationBpm = (Number(midi.totalBeats) > 0 && audioDuration > 0)
    ? (Number(midi.totalBeats) / audioDuration) * 60
    : 0;
  const displayBpm = autoSpeed && syncAudioLength && durationBpm >= 40 && durationBpm <= 300 ? durationBpm : midiBpm;
  const manualWindow = modNum(mod, 'window', 10, 4, 20);
  const windowSec = autoSpeed
    ? Math.max(1, ((barsVisible * beatsPerBar * 60) / displayBpm) / speed)
    : manualWindow / speed;
  const midiOffset = modNum(mod, 'midiOffset', 0, -2000, 2000) / 1000;
  const midiTime = frame.time - midiOffset;
  const startT = Math.max(0, midiTime - 1.2);
  const endT = startT + windowSec;
  const palette = [accent, '#68e8ff', '#a98bff', '#ffc46b', '#b9ff8a', '#ff8a6b'];
  const showGrid = modOpt(mod, 'grid', true);
  const showLabels = modOpt(mod, 'labels', true);
  const noteStyle = modOpt(mod, 'noteStyle', 'rect');
  const allTrackColor = modOpt(mod, 'allTrackColor', false);
  const globalTrackColor = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'globalTrackColor', '#ffc46b')) ? modOpt(mod, 'globalTrackColor', '#ffc46b') : '#ffc46b';
  const noteThickness = modNum(mod, 'noteThickness', 100, 50, 200) / 100;
  const centerShift = (modNum(mod, 'centerY', 50, 0, 100) / 100 - 0.5) * h * 0.24;
  const vibratoAmount = modNum(mod, 'vibrato', 0, 0, 100) / 100;
  const defaultDepth = modNum(mod, 'trackDepth', 55, 0, 100) / 100;
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

  // Time grid.
  if (showGrid) {
    const firstGrid = Math.ceil(startT / 2) * 2;
    for (let t = firstGrid; t <= endT; t += 2) {
      const px = x + ((t - startT) / windowSec) * w;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath();
      ctx.moveTo(px + 0.5, y); ctx.lineTo(px + 0.5, y + h);
      ctx.stroke();
      mono(ctx, 5, '400');
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.textAlign = 'left';
      ctx.fillText(formatShortTime(t), px + 2, y + h + 8);
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
    const orderDepth = orderPosition.size > 1 ? orderIndex / (orderPosition.size - 1) : 0.5;
    const bias = (clamp(Number(trackDepths[trackIndex] ?? defaultDepth * 100) || 0, 0, 100) / 100 - 0.5) * 0.22;
    const z = clamp(orderDepth + bias, 0, 1);
    const scale = 0.58 + z * 0.82;
    const laneCenter = y + h * (0.18 + z * 0.60) + centerShift;
    const pitchOffset = ((midPitch - note.pitch) / pitchSpan) * h * (0.36 + z * 0.20);
    const vibratoY = vibratoAmount ? Math.sin(frame.time * 7 + note.pitch * 0.7) * vibratoAmount * 5 : 0;
    const nx = x + ((note.start - startT) / windowSec) * w;
    const nw = Math.max(1.5, ((note.end - note.start) / windowSec) * w);
    const px = horizonX + (nx - horizonX) * scale;
    const py = laneCenter + pitchOffset + vibratoY;
    const pw = nw * scale;
    const color = allTrackColor ? globalTrackColor : (/^#[0-9a-fA-F]{6}$/.test(trackColors[trackIndex] || '') ? trackColors[trackIndex] : palette[trackIndex % palette.length]);
    const active = midiTime >= note.start && midiTime <= note.end;
    const nh = Math.max(1.1, rowH * (0.62 + z * 0.38) - 0.7) * scale * noteThickness;
    visible.push({ note, trackIndex, z, scale, px, py, pw, nh, color, active });
  }
  visible.sort((a, b) => a.z - b.z || a.note.start - b.note.start);
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
  const titleColor = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'titleColor', '#C7F8FF')) ? modOpt(mod, 'titleColor', '#C7F8FF') : '#C7F8FF';
  const chordColor = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'chordColor', '#9DDBFF')) ? modOpt(mod, 'chordColor', '#9DDBFF') : '#9DDBFF';
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
  ctx.fillText(`${midi.trackCount} TRACKS · ${midi.noteCount} NOTES`, x, y + h + 9);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(accent, 0.62);
  const bpmLabel = `${displayBpm.toFixed(1)}${autoSpeed && syncAudioLength ? ' AUDIO-SYNC' : ''}`;
  ctx.fillText(`BPM ${bpmLabel} · ${signature.numerator}/${signature.denominator}`, x + w, y + h + 9);
}

// ── Export dispatcher ───────────────────────────────────────────────────────

function drawBasicInfo(ctx, mod, body, frame, st, env) {
  const info = env.info || {};
  const engine = env.engine || {};
  const accent = body.accent || '#ff4f8b';
  const primaryColor = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'primaryColor', '#101a3b')) ? modOpt(mod, 'primaryColor', '#101a3b') : '#101a3b';
  const secondaryColor = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'secondaryColor', '#6d6782')) ? modOpt(mod, 'secondaryColor', '#6d6782') : '#6d6782';
  const cardBg = /^#[0-9a-fA-F]{6}$/.test(modOpt(mod, 'cardBg', '#eeebf4')) ? modOpt(mod, 'cardBg', '#eeebf4') : '#eeebf4';
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
  if (coverSrc && st.coverSrc !== coverSrc) {
    st.coverSrc = coverSrc;
    const img = new Image();
    img.onload = () => { st.coverImage = img; };
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
  ctx.fillText(`{${title}}`, tx, y + p + titleSize + tiny * 2, tw);
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
  peakSlope: drawPeakSlope,
  stereoField: drawStereoField,
  basicInfo: drawBasicInfo,
};

export function drawVisualModule(ctx, mod, accent, env) {
  if (!MODULE_DEFS[mod.type] || mod.hidden) return;
  const palette = env.palette || {
    bg: '#050308', window: '#171020', text: '#f7eef3', chart: accent,
  };
  const body = drawCard(ctx, mod, palette.chart || accent, env);
  const st = getState(env, mod);
  const drawer = DRAWERS[mod.type];
  if (!drawer) return;
  ctx.save();
  clipRect(ctx, body.x, body.y, body.w, body.h);
  const originalFillText = ctx.fillText;
  if (mod.type !== 'basicInfo' && palette.text) {
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
