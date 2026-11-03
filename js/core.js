export const STAGE_W = 1920;
export const STAGE_H = 1080;

export const MODULE_DEFS = {
  levels: {
    name: 'VU 电平表',
    code: 'VU METERS',
    glyph: '▥',
    about: '双通道 RMS 电平与峰值保持，带经典 VU 刻度和削波指示。',
    w: 160, h: 165, category: 'METERING',
  },
  loudness: {
    name: '响度监视器',
    code: 'LOUDNESS LAB',
    glyph: 'LU',
    about: '短时响度、综合响度、采样真峰值与历史曲线，适合整体混音观察。',
    w: 330, h: 165, category: 'METERING',
  },
  dial: {
    name: '模拟 VU 表',
    code: 'VU / DIAL',
    glyph: '◔',
    about: '带阻尼与峰值记忆的模拟式 VU 指针，响应整体节目电平。',
    w: 170, h: 165, category: 'METERING',
  },
  scope: {
    name: '示波器',
    code: 'OSCILLOSCOPE',
    glyph: '∿',
    about: '带零交叉触发的时域波形，可显示 L/R 双轨迹与荧光余晖。',
    w: 390, h: 210, category: 'TIME DOMAIN',
  },
  lissajous: {
    name: 'X-Y 李萨如图',
    code: 'LISSAJOUS X-Y',
    glyph: '✦',
    about: '把左右声道分别作为 X/Y 轴的相图，用于观察立体声宽度与相位关系。',
    w: 350, h: 210, category: 'STEREO',
  },
  spectrum: {
    name: '频谱分析仪',
    code: 'SPECTRUM ANALYZER',
    glyph: '▤',
    about: '对数频率坐标的实时 FFT 频谱、峰值保持和频段标注。',
    w: 430, h: 210, category: 'FREQUENCY',
  },
  phase: {
    name: '相位相关表',
    code: 'PHASE CORRELATION',
    glyph: '◑',
    about: '左右声道相关系数与相位宽度仪表，检测单声道兼容性。',
    w: 240, h: 210, category: 'STEREO',
  },
  rhythm: {
    name: '节奏引擎',
    code: 'RHYTHM ENGINE',
    glyph: '◉',
    about: '瞬态检测、节拍脉冲、BPM 估计和低中高频能量分布。',
    w: 414, h: 210, category: 'TEMPO',
  },
  dynamics: {
    name: '动态分析',
    code: 'DYNAMICS',
    glyph: '▮',
    about: 'Peak / RMS / Crest / 动态范围四组横向动态条。',
    w: 200, h: 240, category: 'METERING',
  },
  spectrogram: {
    name: '声谱图',
    code: 'SPECTROGRAM',
    glyph: '≋',
    about: '滚动的频率-时间热力图，低频在下方，颜色亮度表示能量。',
    w: 400, h: 240, category: 'FREQUENCY',
  },
  stereometer: {
    name: '立体声场',
    code: 'STEREO FIELD',
    glyph: '◒',
    about: '旋转的声场散点图，展示左右声像分布与中央能量。',
    w: 350, h: 240, category: 'STEREO',
  },
  waveform: {
    name: '全局波形',
    code: 'WAVEFORM',
    glyph: '≈',
    about: '整首音频的峰值概览、播放位置和区域标记，可点击跳转。',
    w: 440, h: 240, category: 'OVERVIEW',
  },
  pianoRoll: {
    name: 'MIDI 钢琴卷帘',
    code: 'MIDI / PIANO ROLL',
    glyph: '▦',
    about: 'MIDI 音符随播放位置滚动，按音高和力度着色；导入 MIDI 后自动启用。',
    w: 434, h: 240, category: 'MIDI',
  },
  peakSlope: {
    name: '峰值倾斜',
    code: 'PEAK SLOPE SHARP',
    glyph: '◢',
    about: '频谱峰值包络的历史轨迹，表现音乐的明亮度与能量起伏。',
    w: 600, h: 190, category: 'FREQUENCY',
  },
  stereoField: {
    name: '声场分布',
    code: 'STEREO FIELD',
    glyph: '◓',
    about: '宽屏声场散点与中央密度，适合铺在画面底部作为仪表。',
    w: 600, h: 179, category: 'STEREO',
  },
  basicInfo: {
    name: '基础信息',
    code: 'BASIC INFORMATION',
    glyph: '▣',
    about: '曲绘、歌曲名、作曲、风格、BPM、曲序、采样率与时长的一体化信息卡。',
    w: 900, h: 300, category: 'OVERVIEW',
  },
};

export const MODULE_ORDER = [
  'levels', 'loudness', 'dial', 'scope', 'lissajous', 'spectrum',
  'phase', 'rhythm', 'dynamics', 'spectrogram', 'stereometer',
  'waveform', 'pianoRoll', 'peakSlope', 'stereoField', 'basicInfo',
];

let _id = 0;
export function uid(prefix = 'm') {
  _id += 1;
  return `${prefix}_${Date.now().toString(36)}_${_id.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return (v - a) / (b - a); }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
export function deg(rad) { return rad * 180 / Math.PI; }

export function hexToRgb(hex) {
  const s = String(hex || '').replace('#', '').trim();
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  const n = parseInt(s.padEnd(6, '0').slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 255, g: 79, b: 139 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
}

export const AUTOMATION_PROPERTIES = {
  text: {
    x: { label: 'X 偏移', min: -960, max: 960, step: 1, kind: 'number' },
    y: { label: 'Y 偏移', min: -540, max: 540, step: 1, kind: 'number' },
    size: { label: '字号', min: 8, max: 200, step: 1, kind: 'number' },
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
  subtitle: {
    x: { label: 'X 偏移', min: -960, max: 960, step: 1, kind: 'number' },
    y: { label: 'Y 偏移', min: -540, max: 540, step: 1, kind: 'number' },
    size: { label: '字号', min: 8, max: 80, step: 1, kind: 'number' },
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
  effect: {
    amount: { label: '强度', min: 0, max: 100, step: 1, kind: 'number' },
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
  intro: {
    blur: { label: 'Blur', min: 0, max: 100, step: 1, kind: 'number' },
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
  color: {
    bg: { label: '背景色', min: 0, max: 1, kind: 'color' },
    primary: { label: '窗口颜色', min: 0, max: 1, kind: 'color' },
    accent: { label: '字符颜色', min: 0, max: 1, kind: 'color' },
    ink: { label: '图表颜色', min: 0, max: 1, kind: 'color' },
  },
  bpm: {
    bpm: { label: 'BPM', min: 1, max: 300, step: 0.01, kind: 'number' },
  },
  mash: {
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
  batch: {
    opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' },
  },
};

export function automationValueAt(keys, relativeTime, fallback, kind = 'number') {
  if (!Array.isArray(keys) || !keys.length) return fallback;
  const sorted = keys.slice().sort((a, b) => a.t - b.t);
  const t = Math.max(0, Number(relativeTime) || 0);
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < a.t || t > b.t) continue;
    const span = Math.max(0.0001, b.t - a.t);
    const mix = (t - a.t) / span;
    if (kind === 'color') return mixHex(a.v, b.v, mix);
    return Number(a.v) + (Number(b.v) - Number(a.v)) * mix;
  }
  return fallback;
}

export function lighten(hex, amount = 0.2) {
  return mixHex(hex, '#ffffff', amount);
}

export function darken(hex, amount = 0.2) {
  return mixHex(hex, '#000000', amount);
}

export function rgbString(rgb, a = 1) {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function formatTime(sec, withMs = true) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${withMs ? '.' + String(ms).padStart(3, '0') : ''}`;
}

export function formatShortTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTC(sec, fps = 60) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.min(fps - 1, Math.floor((sec % 1) * fps));
  return [h, m, s, f].map((v) => String(v).padStart(2, '0')).join(':');
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

export function roundRect(ctx, x, y, w, h, r = 0) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function spacedText(ctx, text, x, y, spacing = 1, align = 'left') {
  const chars = Array.from(text);
  let total = 0;
  const widths = chars.map((c) => {
    const w = ctx.measureText(c).width;
    total += w + spacing;
    return w;
  });
  total -= spacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + spacing;
  }
  return total;
}

export function fitCanvasText(ctx, text, maxWidth, startSize = 20, minSize = 8, font = '') {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${font} ${size}px "Bahnschrift", "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

export function safeParse(json, fallback) {
  try { return JSON.parse(json) ?? fallback; } catch { return fallback; }
}

export function safeStore(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function safeRead(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function debounce(fn, ms = 200) {
  let handle = 0;
  const wrapped = (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(handle); fn(...args); };
  return wrapped;
}

export function createModule(type, overrides = {}) {
  const def = MODULE_DEFS[type];
  if (!def) throw new Error(`Unknown module type: ${type}`);
  return {
    id: uid(type),
    type,
    x: 40, y: 40,
    w: def.w, h: def.h,
    color: null,
    opacity: 1,
    hidden: false,
    title: null,
    ...overrides,
  };
}

function m(type, x, y, w, h, extra = {}) {
  return createModule(type, { x, y, w, h, ...extra });
}

export function makeStudioLayout() {
  return [
    m('levels', 24, 24, 160, 165, { title: 'VU METERS' }),
    m('loudness', 196, 24, 330, 165, { title: 'LOUDNESS · LUFS-S' }),
    m('dial', 538, 24, 170, 165, { title: 'VU / DIAL' }),
    m('scope', 720, 24, 390, 165, { title: 'OSCILLOSCOPE · BOTH' }),
    m('lissajous', 1122, 24, 350, 165, { title: 'LISSAJOUS · X-Y' }),
    m('lissajous', 1484, 24, 412, 165, { title: 'LISSAJOUS · WIDE' }),

    m('scope', 24, 201, 370, 210, { title: 'OSCILLOSCOPE · L' }),
    m('scope', 406, 201, 370, 210, { title: 'OSCILLOSCOPE · R' }),
    m('spectrum', 788, 201, 430, 210),
    m('phase', 1230, 201, 240, 210),
    m('rhythm', 1482, 201, 414, 210),

    m('dynamics', 24, 423, 200, 240),
    m('spectrogram', 236, 423, 400, 240),
    m('stereometer', 648, 423, 350, 240),
    m('waveform', 1010, 423, 440, 240),
    m('pianoRoll', 1462, 423, 434, 240),

    m('peakSlope', 24, 675, 600, 190),
    m('stereoField', 24, 877, 600, 179),
  ];
}

export function makeScopeLayout() {
  return [
    m('levels', 24, 24, 164, 1032),
    m('scope', 200, 24, 820, 520, { title: 'MAIN OSCILLOSCOPE' }),
    m('lissajous', 1032, 24, 864, 520, { title: 'VECTOR SCOPE' }),
    m('spectrum', 200, 556, 1100, 500),
    m('waveform', 1312, 556, 584, 240),
    m('stereometer', 1312, 808, 584, 248),
  ];
}

export function makeMinimalLayout() {
  return [
    m('loudness', 24, 24, 380, 160),
    m('levels', 416, 24, 170, 160),
    m('waveform', 24, 900, 1872, 156),
    m('scope', 24, 420, 1872, 468, { title: 'OSCILLOSCOPE · CINEMATIC' }),
  ];
}

export const LAYOUT_PRESETS = {
  studio: { label: 'STUDIO', make: makeStudioLayout },
  scope: { label: 'SCOPE', make: makeScopeLayout },
  minimal: { label: 'MINIMAL', make: makeMinimalLayout },
};

export const DEFAULT_SETTINGS = {
  accent: '#ff4f8b',
  accentAlpha: 1,
  glow: 45,
  moduleTint: true,
  bgMode: 'plasma',
  bgColor: '#1a0b22',
  bgColorAlpha: 1,
  bgMotion: 'kenburns',
  bgMotionAmount: 35,
  bgMotionSpeed: 100,
  bgMotionDirection: 'auto',
  uiScale: 100,
  exportFadeIn: 0,
  exportFadeOut: 0,
  exportPulse: 0,
  uiTheme: 'neon',
  uiMode: 'auto',
  uiFont: 'default',
  themeBg: '#07050a',
  themeWindow: '#171020',
  themeText: '#f7eef3',
  themeChart: '#ff4f8b',
  themeChartFollow: 'custom',
  savePath: '',
  exportPath: '',
  timelineOpen: true,
  bgDim: 35,
  bgBlur: 6,
  bgContain: false,
  bgEnergy: 70,
  rendererMode: 'gpu',
  sensitivity: 100,
  smoothing: 78,
  watermark: true,
  scanlines: true,
  snap: true,
  editing: true,
  autoSave: true,
  volume: 78,
  loop: false,
  preset: 'studio',
};

export const EXPORT_QUALITIES = {
  720: { label: '720P', w: 1280, h: 720 },
  1080: { label: '1080P', w: 1920, h: 1080 },
  1440: { label: '2K', w: 2560, h: 1440 },
  2160: { label: '4K', w: 3840, h: 2160 },
};

export function deepClone(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

export function normalizeHexInput(value, fallback = '#FF4F8B') {
  let s = String(value || '').trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return fallback;
  return s.toUpperCase();
}

export function getTypeActive(modules, type) {
  return modules.some((mod) => mod.type === type && !mod.hidden);
}

export function getTypeCount(modules, type) {
  return modules.reduce((acc, mod) => acc + (mod.type === type ? 1 : 0), 0);
}

export function computeDataURLSize(dataUrl) {
  return Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
}
