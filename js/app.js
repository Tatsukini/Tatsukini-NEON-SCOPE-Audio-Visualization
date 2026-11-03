import {
  STAGE_W, STAGE_H, MODULE_DEFS, MODULE_ORDER, DEFAULT_SETTINGS,
  EXPORT_QUALITIES, LAYOUT_PRESETS, makeStudioLayout, makeScopeLayout, makeMinimalLayout,
  createModule, uid, hexToRgb, rgbToHex, mixHex, luminance, normalizeHexInput, clamp, formatTime, formatTC,
  formatShortTime, humanBytes, safeRead, safeStore, safeParse, debounce,
} from './core.js';
import { AudioEngine } from './audio.js';
import { createDemoTrack } from './demo.js';
import { parseMidi, renderMidiToBuffer, describeMidi } from './midi.js';
import { Visualizer } from './visualizer.js';
import { VideoExporter, downloadBlob, checkFfmpeg, sanitizeFilename } from './exporter.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const STORAGE_KEY = 'neon-scope.project.v1';
const SETTINGS_SYNC_KEY = 'neon-scope.settings-sync.v1';
const BG_PREVIEW_KEY = 'neon-scope.bg-preview.v1';
const BG_IMAGE_KEY = 'neon-scope.bg-image.v1';
const DEMO_META = { name: 'Neon Skyline · DEMO', kind: 'demo', bpm: 112, artist: 'NEON//SCOPE' };

const SHORTCUT_ACTIONS = [
  { id: 'play_pause', label: '播放 / 暂停', code: 'PLAYBACK', group: '播放', default: 'Space' },
  { id: 'stop', label: '停止并回到开头', code: 'STOP', group: '播放', default: 'Home' },
  { id: 'loop', label: '循环播放', code: 'LOOP', group: '播放', default: 'KeyL' },
  { id: 'open_export', label: '打开视频导出', code: 'EXPORT', group: '播放', default: 'Ctrl+Shift+KeyE' },
  { id: 'save_archive', label: '保存工程存档', code: 'SAVE', group: '文件', default: 'Ctrl+KeyS' },
  { id: 'snap', label: '吸附对齐', code: 'SNAP', group: '编辑', default: 'KeyG' },
  { id: 'edit_mode', label: '编辑 / 预览模式', code: 'EDIT', group: '编辑', default: 'KeyE' },
  { id: 'delete_module', label: '删除所选模块', code: 'DELETE', group: '编辑', default: 'Delete' },
  { id: 'duplicate_module', label: '复制所选模块', code: 'DUPLICATE', group: '编辑', default: 'Ctrl+KeyD' },
  { id: 'center_h', label: '模块水平居中', code: 'CENTER H', group: '编辑', default: 'Shift+KeyH' },
  { id: 'center_v', label: '模块垂直居中', code: 'CENTER V', group: '编辑', default: 'Shift+KeyV' },
  { id: 'nudge_left', label: '微调：向左', code: 'NUDGE', group: '编辑', default: 'ArrowLeft' },
  { id: 'nudge_right', label: '微调：向右', code: 'NUDGE', group: '编辑', default: 'ArrowRight' },
  { id: 'nudge_up', label: '微调：向上', code: 'NUDGE', group: '编辑', default: 'ArrowUp' },
  { id: 'nudge_down', label: '微调：向下', code: 'NUDGE', group: '编辑', default: 'ArrowDown' },
  { id: 'focus', label: '专注预览模式', code: 'FOCUS', group: '窗口', default: 'KeyF' },
  { id: 'open_settings', label: '打开设置', code: 'SETTINGS', group: '窗口', default: 'Ctrl+Comma' },
  { id: 'open_shortcuts', label: '快捷键映射表', code: 'KEY MAP', group: '窗口', default: 'F1' },
  { id: 'open_help', label: '工作台指南', code: 'HELP', group: '窗口', default: 'F2' },
];
const DEFAULT_KEYBINDS = Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action.default]));

const MODULE_OPTIONS = {
  levels: [
    { key: 'segments', label: 'LED 段数', type: 'select', default: '30', options: [['18', '18 段 · 粗颗粒'], ['30', '30 段 · 标准'], ['45', '45 段 · 精细']] },
    { key: 'peakHold', label: '峰值保持标记', type: 'toggle', default: true },
  ],
  loudness: [
    { key: 'target', label: '目标响度', type: 'select', default: '-14', options: [['-9', '-9 LUFS · 流媒体'], ['-14', '-14 LUFS · 标准'], ['-16', '-16 LUFS · 播客'], ['-23', '-23 LUFS · 广播']] },
    { key: 'history', label: '历史长度', type: 'range', min: 40, max: 180, step: 10, default: 180, unit: ' 帧' },
  ],
  dial: [
    { key: 'ballistics', label: '指针阻尼', type: 'select', default: 'medium', options: [['slow', '慢速 · 模拟'], ['medium', '中速 · 标准'], ['fast', '快速 · 峰值']] },
    { key: 'peakHold', label: '峰值记忆刻线', type: 'toggle', default: true },
  ],
  scope: [
    { key: 'lineWidth', label: '轨迹线宽', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.25, unit: ' px' },
    { key: 'persistence', label: '荧光余晖', type: 'range', min: 0, max: 100, step: 5, default: 45, unit: '%' },
    { key: 'grid', label: '显示时间网格', type: 'toggle', default: true },
  ],
  lissajous: [
    { key: 'trail', label: '拖尾长度', type: 'range', min: 0, max: 100, step: 5, default: 70, unit: '%' },
    { key: 'dotSize', label: '散点尺寸', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.2, unit: ' px' },
    { key: 'rings', label: '极坐标环', type: 'toggle', default: true },
  ],
  spectrum: [
    { key: 'bars', label: '频段数量', type: 'select', default: 'auto', options: [['auto', '自动 · 随宽度'], ['32', '32 Bands'], ['48', '48 Bands'], ['64', '64 Bands'], ['96', '96 Bands']] },
    { key: 'peakHold', label: '峰值保持线', type: 'toggle', default: true },
    { key: 'grid', label: '频率网格与刻度', type: 'toggle', default: true },
  ],
  phase: [
    { key: 'ballistics', label: '指针响应', type: 'select', default: 'medium', options: [['slow', '慢速'], ['medium', '标准'], ['fast', '快速']] },
    { key: 'showWidth', label: '显示相位宽度条', type: 'toggle', default: true },
  ],
  rhythm: [
    { key: 'showBands', label: '低 / 中 / 高能量', type: 'toggle', default: true },
    { key: 'pulseRings', label: '脉冲环数量', type: 'range', min: 0, max: 6, step: 1, default: 3 },
    { key: 'beatDots', label: '四拍指示点', type: 'toggle', default: true },
  ],
  dynamics: [
    { key: 'historyLength', label: 'RMS 历史长度', type: 'range', min: 40, max: 110, step: 10, default: 110, unit: ' 帧' },
    { key: 'showValues', label: '显示数值', type: 'toggle', default: true },
    { key: 'grid', label: '动态刻度线', type: 'toggle', default: true },
  ],
  spectrogram: [
    { key: 'palette', label: '色图', type: 'select', default: 'neon', options: [['neon', 'NEON · 主色'], ['heat', 'HEAT · 热力'], ['ice', 'ICE · 冷色']] },
    { key: 'gain', label: '能量增益', type: 'range', min: 50, max: 200, step: 10, default: 100, unit: '%' },
    { key: 'labels', label: '频率刻度', type: 'toggle', default: true },
  ],
  stereometer: [
    { key: 'trail', label: '余晖长度', type: 'range', min: 0, max: 100, step: 5, default: 80, unit: '%' },
    { key: 'dotSize', label: '散点尺寸', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.2, unit: ' px' },
    { key: 'rings', label: '同心环', type: 'toggle', default: true },
  ],
  waveform: [
    { key: 'style', label: '波形样式', type: 'select', default: 'bars', options: [['bars', 'BAR · 柱状'], ['line', 'LINE · 轮廓'], ['filled', 'FILL · 填充']] },
    { key: 'gain', label: '波幅', type: 'range', min: 50, max: 160, step: 10, default: 100, unit: '%' },
    { key: 'timeline', label: '显示时间刻度', type: 'toggle', default: true },
  ],
  pianoRoll: [
    { key: 'window', label: '时间窗口', type: 'select', default: '10', options: [['4', '4 秒'], ['6', '6 秒'], ['10', '10 秒'], ['16', '16 秒'], ['20', '20 秒']] },
    { key: 'grid', label: '节拍网格', type: 'toggle', default: true },
    { key: 'labels', label: '音名标签', type: 'toggle', default: true },
  ],
  peakSlope: [
    { key: 'historyLength', label: '历史长度', type: 'range', min: 100, max: 340, step: 20, default: 340, unit: ' 帧' },
    { key: 'fill', label: '曲线下方填充', type: 'toggle', default: true },
    { key: 'beatTicks', label: '节拍垂直线', type: 'toggle', default: true },
  ],
  stereoField: [
    { key: 'density', label: '散点密度', type: 'range', min: 30, max: 100, step: 10, default: 100, unit: '%' },
    { key: 'histogram', label: '声像分布柱', type: 'toggle', default: true },
    { key: 'balanceLine', label: '声像平衡线', type: 'toggle', default: true },
  ],
};
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
const FORBIDDEN_BINDINGS = new Set(['Tab', 'Escape']);

function ensureUiRoot() {
  if (document.getElementById('ui-root')) return document.getElementById('ui-root');
  const root = document.createElement('div');
  root.id = 'ui-root';
  const nodes = Array.from(document.body.children).filter((el) => el.tagName !== 'SCRIPT');
  for (const node of nodes) root.appendChild(node);
  document.body.appendChild(root);
  return root;
}

function clampByte(v) { return clamp(Math.round(Number(v) || 0), 0, 255); }

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-7) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function bindingParts(binding) {
  return String(binding || '').split('+').filter(Boolean);
}

function bindingLabel(binding) {
  return bindingParts(binding).map((part) => {
    if (part === 'Ctrl') return 'Ctrl';
    if (part === 'Shift') return 'Shift';
    if (part === 'Alt') return 'Alt';
    if (part === 'Meta') return 'Meta';
    if (part === 'Space') return 'Space';
    if (part === 'Delete') return 'Delete';
    if (part === 'Backspace') return 'Backspace';
    if (part === 'Enter') return 'Enter';
    if (part === 'Home') return 'Home';
    if (part === 'End') return 'End';
    if (part === 'PageUp') return 'PgUp';
    if (part === 'PageDown') return 'PgDn';
    if (part === 'Insert') return 'Ins';
    if (part === 'ArrowLeft') return '←';
    if (part === 'ArrowRight') return '→';
    if (part === 'ArrowUp') return '↑';
    if (part === 'ArrowDown') return '↓';
    if (part === 'Comma') return ',';
    if (part === 'Period') return '.';
    if (part === 'Slash') return '/';
    if (part === 'Semicolon') return ';';
    if (part === 'Quote') return "'";
    if (part === 'BracketLeft') return '[';
    if (part === 'BracketRight') return ']';
    if (part === 'Backslash') return '\\';
    if (part === 'Minus') return '-';
    if (part === 'Equal') return '=';
    if (part === 'Backquote') return '`';
    if (part.startsWith('Key')) return part.slice(3);
    if (part.startsWith('Digit')) return part.slice(5);
    if (part.startsWith('Numpad')) return `Num ${part.slice(6)}`;
    return part;
  }).join(' + ');
}

function eventToBinding(e, ignoreShift = false) {
  if (!e || MODIFIER_CODES.has(e.code)) return '';
  if (FORBIDDEN_BINDINGS.has(e.code)) return '';
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !ignoreShift) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code);
  return parts.join('+');
}

function saveShortcutMatch(keybinds, binding) {
  return SHORTCUT_ACTIONS.find((action) => keybinds[action.id] === binding) || null;
}

class NeonScopeApp {
  constructor() {
    this.state = {
      modules: makeStudioLayout(),
      selectedId: null,
      settings: { ...DEFAULT_SETTINGS },
      midi: null,
      preset: 'studio',
      info: { title: '', artist: '', album: '', genre: '', bpm: '', cover: '', show: false },
      animationCues: [],
      ffmpegAvailable: false,
      exporting: false,
    };
    this.exportSettings = {
      quality: 1080, fps: 60, bitrate: 24, format: 'mp4', range: 'full',
    };
    this.demoBuffer = null;
    this.demoPromise = null;
    this.demoToken = 0;
    this.loadToken = 0;
    this.bgImageUrl = null;
    this.bgImage = null;
    this._draggingFiles = 0;
    this._lastUi = 0;
    this._lastBgPreview = 0;
    this._lastSeekDraw = 0;
    this._frame = null;
    this._activeModal = null;
    this._modalStack = [];
    this._settingsTab = 'appearance';
    this._keyCapture = null;
    this._moduleMenuId = null;
    this._colorTarget = null;
    this._picker = { h: 340, s: 0.75, v: 1, a: 1, hex: '#ff4f8b' };
    this.keybinds = { ...DEFAULT_KEYBINDS };
    this._captureKeyHandler = (e) => this._handleCaptureKey(e);
    this.panelState = {
      left: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
      stage: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
      right: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
    };
    this._panelZ = 66;
    this.subpanelState = {};
    this._started = false;
    this._isNative = !!window.chrome?.webview;
    this._standaloneSettings = new URLSearchParams(location.search).has('settings');
    this.audio = new AudioEngine();
    this._loadPersisted();
    this._cacheDom();
    this._setUiScale(this.state.settings.uiScale, { silent: true, noPersist: true });
    this._applySettingsToState();
    this.audio.setVolume(this.state.settings.volume / 100);
    this.audio.setSmoothing(this.state.settings.smoothing);
    this.audio.onState = (s) => this._onAudioState(s);
    this._initVisualizer();
    this._bindUI();
    this._initPanels();
    this._initSubpanels();
    this._applyAccent(this.state.settings.accent, this.state.settings.accentAlpha, { silent: true, noPersist: true });
    this._applyUiTheme(this.state.settings.uiTheme, { silent: true, noPersist: true });
    this._applyUiMode(this.state.settings.uiMode, { silent: true, noPersist: true });
    this._syncSettingsUI();
    this._restoreBackgroundImage();
    this._renderLibrary();
    this._syncCanvasMeta();
    this._syncSelectionUI();
    this._refreshTrackUI();
    this._setupKeyboard();
    window.addEventListener('beforeunload', () => {
      if (this._skipUnloadSave) return;
      try { this._saveNow(); } catch { /* noop */ }
    });
    this._bindNativeBridge();
    this._notifyNativePaths();
    this._bindExternalSettingsSync();
    if (this._standaloneSettings) {
      this._enterSettingsStandalone();
    } else {
      this._initAlphaNotice();
      this._setupDragDrop();
      this._checkHealth();
      this.visualizer.start();
      this._updateStartOverlay('loading');
      this._loadDemo(false);
      window.setTimeout(() => this._drawSeekWave(0), 150);
    }
  }

  _initAlphaNotice() {
    if (!this.dom.alphaNotice) return;
    this.dom.alphaNotice.classList.remove('hidden');
    document.body.classList.add('alpha-locked');
    const dismiss = () => {
      this.dom.alphaNotice.classList.add('hidden');
      document.body.classList.remove('alpha-locked');
      this.dom.alphaNoticeBtn?.blur();
    };
    this.dom.alphaNoticeBtn?.addEventListener('click', dismiss, { once: true });
  }

  _enterSettingsStandalone() {
    this.dom.alphaNotice?.classList.add('hidden');
    document.body.classList.remove('alpha-locked');
    document.body.classList.add('settings-standalone');
    document.title = 'NEON//SCOPE — 设置';
    this.dom.settingsModal.classList.remove('hidden');
    this.dom.settingsModal.style.zIndex = '1';
    this._activeModal = 'settings';
    this._modalStack = ['settings'];
    this._switchSettingsTab(this._settingsTab);
    this._syncSettingsUI();
    setTimeout(() => {
      this._loadBackgroundThumbnailForSettings();
      this.dom.colorModal.classList.add('hidden');
      this.dom.shortcutsModal.classList.add('hidden');
      this._activeModal = 'settings';
      this._modalStack = ['settings'];
      this._refreshBgPreview(true);
    }, 80);
    this._settingsPreviewTimer = setInterval(() => {
      if (!this.dom.settingsModal.classList.contains('hidden') && this._settingsTab === 'background') {
        this._refreshBgPreview(true);
      }
    }, 120);
  }

  _bindNativeBridge() {
    if (!this._isNative) return;
    window.chrome.webview.addEventListener('message', (event) => {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (data?.action === 'apply-settings' || data?.action === 'settings-updated') this._applyExternalSettings(data);
      else if (data?.action === 'background-image' && data.dataUrl) this._applyIncomingBackgroundImage(data.dataUrl, data.name);
      else if (data?.action === 'folder-chosen' && data.path) {
        const key = this._pathName(data.kind);
        this.state.settings[key] = data.path;
        if (this.dom.savePathInput) this.dom.savePathInput.value = this.state.settings.savePath || '';
        if (this.dom.exportPathInput) this.dom.exportPathInput.value = this.state.settings.exportPath || '';
        this._persist();
        this._toast(`${data.kind === 'save' ? '存档' : '导出'}路径已设置`, 'success');
      } else if (data?.action === 'archive-saved') {
        this._toast(`存档已保存 · ${data.path || ''}`, 'success', 4200);
      } else if (data?.action === 'archive-error') {
        this._toast(`存档保存失败：${data.message || '未知错误'}`, 'error', 5000);
      } else if (data?.action === 'archive-import' && data.archive) {
        this._applyArchive(data.archive);
      }
    });
  }

  _applyIncomingBackgroundImage(dataUrl, name = 'background') {
    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this.visualizer.setBackgroundImage(img, { name });
      this.state.settings.bgMode = 'image';
      this.visualizer.applyBackgroundSettings();
      this._syncBgModeUI();
      this._refreshBgPreview(true);
      this._storeBackgroundImage(img);
      this._storeBackgroundThumbnail(img);
      this._persist();
    };
    img.src = dataUrl;
  }

  _storeBackgroundImage(img) {
    try {
      const max = 1920;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(1, max / Math.max(iw, ih));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(iw * scale));
      canvas.height = Math.max(2, Math.round(ih * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      safeStore(BG_IMAGE_KEY, canvas.toDataURL('image/jpeg', 0.86));
    } catch { /* optional */ }
  }

  _restoreBackgroundImage() {
    if (this.bgImage) return;
    const raw = safeRead(BG_IMAGE_KEY);
    if (!raw) {
      if (this.state.settings.bgMode === 'image') {
        this.state.settings.bgMode = 'plasma';
        this._syncBgModeUI();
      }
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (this.bgImage) return;
      this.bgImage = img;
      this.visualizer.setBackgroundImage(img, { name: 'restored-background', restored: true });
      if (this.state.settings.bgMode === 'image') this.visualizer.applyBackgroundSettings();
      this._syncBgModeUI();
      this._refreshBgPreview(true);
    };
    img.onerror = () => {
      if (this.state.settings.bgMode === 'image') {
        this.state.settings.bgMode = 'plasma';
        this._syncBgModeUI();
      }
    };
    img.src = raw;
  }

  _storeBackgroundThumbnail(img) {
    try {
      const max = 720;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(1, max / Math.max(iw, ih));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(iw * scale));
      canvas.height = Math.max(2, Math.round(ih * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      safeStore(BG_PREVIEW_KEY, canvas.toDataURL('image/jpeg', 0.78));
    } catch { /* optional */ }
  }

  _loadBackgroundThumbnailForSettings() {
    if (this.bgImage) return;
    const raw = safeRead(BG_PREVIEW_KEY);
    if (!raw) return;
    const img = new Image();
    img.onload = () => {
      if (this.bgImage) return;
      this.bgImage = img;
      this.visualizer.setBackgroundImage(img, { name: 'background-preview', thumbnail: true });
      if (this.state.settings.bgMode === 'image') this.visualizer.applyBackgroundSettings();
      this._refreshBgPreview(true);
    };
    img.src = raw;
  }

  _bindExternalSettingsSync() {
    if (this._standaloneSettings) return;
    window.addEventListener('storage', (event) => {
      if ((event.key !== STORAGE_KEY && event.key !== SETTINGS_SYNC_KEY) || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue);
        if (data?.settings) this._applyExternalSettings(data);
      } catch {
        // Ignore partial writes from older builds.
      }
    });
  }

  _applyExternalSettings(data) {
    if (!data || typeof data !== 'object') return;
    if (data.settings && typeof data.settings === 'object') {
      const s = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!(key in data.settings)) continue;
        const value = data.settings[key];
        if (typeof DEFAULT_SETTINGS[key] === 'boolean') s[key] = !!value;
        else if (typeof DEFAULT_SETTINGS[key] === 'number') s[key] = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_SETTINGS[key];
        else s[key] = value;
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(s.accent)) s.accent = DEFAULT_SETTINGS.accent;
      if (!/^#[0-9a-fA-F]{6}$/.test(s.bgColor || '')) s.bgColor = DEFAULT_SETTINGS.bgColor;
      if (!['plasma', 'image', 'color'].includes(s.bgMode)) s.bgMode = 'plasma';
      if (!['gpu', 'cpu'].includes(s.rendererMode)) s.rendererMode = 'gpu';
      s.accentAlpha = clamp(Number(s.accentAlpha), 0, 1);
      s.bgColorAlpha = clamp(Number(s.bgColorAlpha), 0, 1);
      if (!['static', 'kenburns', 'drift', 'breathe', 'sway', 'beat'].includes(s.bgMotion)) s.bgMotion = 'kenburns';
      if (!['auto', 'left', 'right', 'up', 'down'].includes(s.bgMotionDirection)) s.bgMotionDirection = 'auto';
      if (s.uiTheme === 'studio') s.uiTheme = 'vidi';
      if (s.uiTheme === 'aura') s.uiTheme = 'catbot';
      if (!['neon', 'vidi', 'catbot'].includes(s.uiTheme)) s.uiTheme = 'neon';
      if (!['auto', 'dark', 'light'].includes(s.uiMode)) s.uiMode = 'auto';
      s.bgMotionAmount = clamp(s.bgMotionAmount, 0, 100);
      s.bgMotionSpeed = clamp(s.bgMotionSpeed, 0, 200);
      s.exportFadeIn = clamp(s.exportFadeIn, 0, 3);
      s.exportFadeOut = clamp(s.exportFadeOut, 0, 3);
      s.exportPulse = clamp(s.exportPulse, 0, 100);
      s.uiScale = clamp(Number(s.uiScale) || 100, 70, 150);
      s.volume = clamp(s.volume, 0, 100);
      s.glow = clamp(s.glow, 0, 100);
      s.bgDim = clamp(s.bgDim, 0, 90);
      s.bgBlur = clamp(s.bgBlur, 0, 30);
      s.bgEnergy = clamp(s.bgEnergy, 0, 150);
      s.sensitivity = clamp(s.sensitivity, 40, 200);
      s.smoothing = clamp(s.smoothing, 0, 96);
      this.state.settings = s;
      this._applySettingsToState();
      this.audio.setVolume(s.volume / 100);
      this.audio.setSmoothing(s.smoothing);
      this.audio.setSensitivity(s.sensitivity);
      this.audio.setLoop(s.loop);
      this._setUiScale(s.uiScale, { silent: true, noPersist: true });
      this._applyAccent(s.accent, s.accentAlpha, { silent: true, noPersist: true });
      this._applyUiTheme(s.uiTheme, { silent: true, noPersist: true });
      this._applyUiMode(s.uiMode, { silent: true, noPersist: true });
      this.visualizer.applyBackgroundSettings();
      this._syncSettingsUI();
      this._syncWatermark();
      this._syncCanvasMeta();
      this._renderLibrary();
      this._syncExportUI();
      this._persist();
    }
    if (data.keybinds && typeof data.keybinds === 'object') {
      const kb = { ...DEFAULT_KEYBINDS };
      for (const action of SHORTCUT_ACTIONS) {
        const binding = data.keybinds[action.id];
        if (typeof binding === 'string' && binding && !FORBIDDEN_BINDINGS.has(bindingParts(binding).at(-1))) {
          kb[action.id] = binding;
        }
      }
      this.keybinds = kb;
      this._refreshKeybindLabels?.();
      this._renderShortcutList?.();
    }
  }

  _cacheDom() {
    this.dom = {
      playBtn: $('#playBtn'), stopBtn: $('#stopBtn'), seek: $('#seek'), seekWave: $('#seekWave'),
      curTime: $('#curTime'), durTime: $('#durTime'), loopBtn: $('#loopBtn'), volume: $('#volume'),
      snapBtn: $('#snapBtn'), editBtn: $('#editBtn'), exportBtn: $('#exportBtn'), helpBtn: $('#helpBtn'),
      stage: $('#stage'), stageCanvas: $('#stageCanvas'), stageOverlay: $('#stageOverlay'),
      guideV: $('#guideV'), guideH: $('#guideH'), stageViewport: $('#stageViewport'),
      stageDims: $('#stageDims'), stageMode: $('#stageMode'), snapMeta: $('#snapMeta'),
      moduleMeta: $('#moduleMeta'), chipText: $('#chipText'), stageWatermark: $('#stageWatermark'),
      watermarkTime: $('#watermarkTime'), startOverlay: $('#startOverlay'), startPlayBtn: $('#startPlayBtn'),
      exportVeil: $('#exportVeil'), exportVeilTime: $('#exportVeilTime'),
      moduleLibrary: $('#moduleLibrary'), moduleCount: $('#moduleCount'),
      trackName: $('#trackName'), trackMeta: $('#trackMeta'), trackBadge: $('#trackBadge'),
      trackCard: $('#trackCard'), audioFile: $('#audioFile'), midiFile: $('#midiFile'), bgFile: $('#bgFile'),
      importAudioBtn: $('#importAudioBtn'), importMidiBtn: $('#importMidiBtn'), demoBtn: $('#demoBtn'),
      dropzone: $('#dropzone'), dragVeil: $('#dragVeil'),
      engineDot: $('#engineDot'), engineStatus: $('#engineStatus'), fpsRead: $('#fpsRead'),
      footerAccentDot: $('#footerAccentDot'), footerAccentHex: $('#footerAccentHex'),
      footerEngine: $('#footerEngine'), footerTrack: $('#footerTrack'), footerRate: $('#footerRate'),
      footerFfmpeg: $('#footerFfmpeg'),
      panelModules: $('#panelModules'),
      panelMenuBtn: $('#panelMenuBtn'), panelMenu: $('#panelMenu'), panelMenuList: $('#panelMenuList'),
      subpanelMenuList: $('#subpanelMenuList'), subpanelLayer: $('#subpanelLayer'),
      panelMenuSettingsBtn: $('#panelMenuSettingsBtn'),
      resetPanelsBtn: $('#resetPanelsBtn'), stageDockPlaceholder: $('#stageDockPlaceholder'),
      restoreStageBtn: $('#restoreStageBtn'),
      shortcutsBtn: $('#shortcutsBtn'), settingsFab: $('#settingsFab'),
      settingsModal: $('#settingsModal'), settingsWindow: $('#settingsWindow'),
      openShortcutsBtn: $('#openShortcutsBtn'), openShortcutsBtn2: $('#openShortcutsBtn2'),
      shortcutsModal: $('#shortcutsModal'), shortcutSearch: $('#shortcutSearch'),
      shortcutCount: $('#shortcutCount'), shortcutList: $('#shortcutList'), resetShortcutsBtn: $('#resetShortcutsBtn'),
      colorModal: $('#colorModal'), colorFieldWrap: $('#colorFieldWrap'), colorField: $('#colorField'),
      colorFieldCursor: $('#colorFieldCursor'), colorPreview: $('#colorPreview'), colorHexLabel: $('#colorHexLabel'),
      colorRgbaLabel: $('#colorRgbaLabel'), hueSlider: $('#hueSlider'), hueOut: $('#hueOut'),
      alphaSlider: $('#alphaSlider'), alphaOut: $('#alphaOut'), colorR: $('#colorR'), colorG: $('#colorG'),
      colorB: $('#colorB'), colorA: $('#colorA'), colorApplyBtn: $('#colorApplyBtn'),
      moduleMenu: $('#moduleMenu'),
      accentPickBtn: $('#accentPickBtn'), accentSwatch: $('#accentSwatch'), accentValue: $('#accentValue'),
      glow: $('#glow'), glowOut: $('#glowOut'),
      moduleTint: $('#moduleTint'), bgMode: $('#bgMode'), bgPreviewCanvas: $('#bgPreviewCanvas'),
      bgPreviewLabel: $('#bgPreviewLabel'), bgUploadBtn: $('#bgUploadBtn'), bgImageControls: $('#bgImageControls'),
      bgColorControls: $('#bgColorControls'), bgColorPickBtn: $('#bgColorPickBtn'), bgColorSwatch: $('#bgColorSwatch'),
      bgColorValue: $('#bgColorValue'),
      bgDim: $('#bgDim'), dimOut: $('#dimOut'), bgBlur: $('#bgBlur'), blurOut: $('#blurOut'),
      bgContain: $('#bgContain'), removeBgBtn: $('#removeBgBtn'), bgEnergy: $('#bgEnergy'), bgEnergyOut: $('#bgEnergyOut'),
      rendererMode: $('#rendererMode'), sensitivity: $('#sensitivity'), sensitivityOut: $('#sensitivityOut'),
      smoothing: $('#smoothing'), smoothingOut: $('#smoothingOut'), watermarkToggle: $('#watermarkToggle'),
      scanlineToggle: $('#scanlineToggle'), resetLayoutBtn: $('#resetLayoutBtn'),
      uiScale: $('#uiScale'), uiScaleOut: $('#uiScaleOut'),
      bgMotion: $('#bgMotion'), bgMotionAmount: $('#bgMotionAmount'), bgMotionAmountOut: $('#bgMotionAmountOut'),
      bgMotionSpeed: $('#bgMotionSpeed'), bgMotionSpeedOut: $('#bgMotionSpeedOut'), bgMotionDirection: $('#bgMotionDirection'),
      exportFadeIn: $('#exportFadeIn'), exportFadeInOut: $('#exportFadeInOut'),
      exportFadeOut: $('#exportFadeOut'), exportFadeOutOut: $('#exportFadeOutOut'),
      exportPulse: $('#exportPulse'), exportPulseOut: $('#exportPulseOut'),
      inspectorEmpty: $('#inspectorEmpty'), inspectorModule: $('#inspectorModule'), selectionBadge: $('#selectionBadge'),
      selectedSwatch: $('#selectedSwatch'), selectedName: $('#selectedName'), selectedType: $('#selectedType'),
      deleteModuleBtn: $('#deleteModuleBtn'), propX: $('#propX'), propY: $('#propY'), propW: $('#propW'), propH: $('#propH'),
      centerHBtn: $('#centerHBtn'), centerVBtn: $('#centerVBtn'), matchBtn: $('#matchBtn'),
      moduleOptions: $('#moduleOptions'), moduleOptionsType: $('#moduleOptionsType'),
      moduleOptionsHelp: $('#moduleOptionsHelp'), resetModuleOptionsBtn: $('#resetModuleOptionsBtn'),
      infoTitle: $('#infoTitle'), infoArtist: $('#infoArtist'), infoAlbum: $('#infoAlbum'),
      infoGenre: $('#infoGenre'), infoBpm: $('#infoBpm'), infoCoverBtn: $('#infoCoverBtn'),
      infoCoverFile: $('#infoCoverFile'), infoCoverPreview: $('#infoCoverPreview'), infoOverlay: $('#infoOverlay'),
      animType: $('#animType'), animTime: $('#animTime'), animDuration: $('#animDuration'),
      animValue: $('#animValue'), animAddBtn: $('#animAddBtn'), animCueList: $('#animCueList'), animClearBtn: $('#animClearBtn'),
      animScript: $('#animScript'), animScriptApply: $('#animScriptApply'), animScriptExport: $('#animScriptExport'),
      animScriptImport: $('#animScriptImport'), animScriptFile: $('#animScriptFile'),
      archiveSaveBtn: $('#archiveSaveBtn'), archiveExportBtn: $('#archiveExportBtn'), archiveImportBtn: $('#archiveImportBtn'),
      archiveFile: $('#archiveFile'), fileAnimExportBtn: $('#fileAnimExportBtn'), fileAnimImportBtn: $('#fileAnimImportBtn'),
      savePathInput: $('#savePathInput'), exportPathInput: $('#exportPathInput'),
      savePathBrowse: $('#savePathBrowse'), exportPathBrowse: $('#exportPathBrowse'),
      timelinePanel: $('#timelinePanel'), timelineToggle: $('#timelineToggle'), timelineLabels: $('#timelineLabels'),
      timelineRuler: $('#timelineRuler'), timelineLanes: $('#timelineLanes'), timelinePlayhead: $('#timelinePlayhead'),
      timelineContent: $('#timelineContent'), timelineScroll: $('#timelineScroll'), timelineZoomLabel: $('#timelineZoomLabel'),
      timelineTime: $('#timelineTime'), timelineAddCue: $('#timelineAddCue'),
      timelineZoomOut: $('#timelineZoomOut'), timelineZoomIn: $('#timelineZoomIn'),
      useGlobalColor: $('#useGlobalColor'), moduleColorPickBtn: $('#moduleColorPickBtn'), moduleColorSwatch: $('#moduleColorSwatch'),
      moduleColorValue: $('#moduleColorValue'),
      opacity: $('#opacity'), opacityOut: $('#opacityOut'), moduleVisible: $('#moduleVisible'),
      layerUpBtn: $('#layerUpBtn'), layerDownBtn: $('#layerDownBtn'), duplicateBtn: $('#duplicateBtn'),
      moduleAbout: $('#moduleAbout'), previewQuality: $('#previewQuality'), exportPresetLabel: $('#exportPresetLabel'),
      openExportBtn: $('#openExportBtn'), autoSave: $('#autoSave'),
      exportModal: $('#exportModal'), exportSetup: $('#exportSetup'), exportProgress: $('#exportProgress'),
      startExportBtn: $('#startExportBtn'), cancelExportBtn: $('#cancelExportBtn'), qualityGrid: $('#qualityGrid'),
      fpsSeg: $('#fpsSeg'), formatSeg: $('#formatSeg'), bitrateSelect: $('#bitrateSelect'), rangeSelect: $('#rangeSelect'),
      exportSummaryQuality: $('#exportSummaryQuality'), exportSummaryDuration: $('#exportSummaryDuration'),
      exportSummarySize: $('#exportSummarySize'), exportSummaryEncoder: $('#exportSummaryEncoder'),
      exportWarning: $('#exportWarning'), progressFill: $('#progressFill'), progressTime: $('#progressTime'),
      progressPercent: $('#progressPercent'), progressTitle: $('#progressTitle'), progressHint: $('#progressHint'),
      alphaNotice: $('#alphaNotice'), alphaNoticeBtn: $('#alphaNoticeBtn'),
      helpModal: $('#helpModal'), toastStack: $('#toastStack'), fitBtn: $('#fitBtn'), theaterBtn: $('#theaterBtn'),
      stageTitle: $('.stage-title'), stageFooter: $('.stage-footer'),
    };
  }

  _loadPersisted() {
    const raw = safeRead(STORAGE_KEY);
    if (!raw) return;
    const data = safeParse(raw, null);
    if (!data) return;
    if (data.settings && typeof data.settings === 'object') {
      const s = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!(key in data.settings)) continue;
        const value = data.settings[key];
        if (typeof DEFAULT_SETTINGS[key] === 'boolean') s[key] = !!value;
        else if (typeof DEFAULT_SETTINGS[key] === 'number') s[key] = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_SETTINGS[key];
        else s[key] = value;
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(s.accent)) s.accent = DEFAULT_SETTINGS.accent;
      if (!/^#[0-9a-fA-F]{6}$/.test(s.bgColor || '')) s.bgColor = DEFAULT_SETTINGS.bgColor;
      if (!['plasma', 'image', 'color'].includes(s.bgMode)) s.bgMode = 'plasma';
      if (!['gpu', 'cpu'].includes(s.rendererMode)) s.rendererMode = 'gpu';
      s.volume = clamp(s.volume, 0, 100);
      s.glow = clamp(s.glow, 0, 100);
      s.accentAlpha = clamp(Number(s.accentAlpha) || 0, 0, 1);
      s.bgColorAlpha = clamp(Number(s.bgColorAlpha) || 0, 0, 1);
      if (!['static', 'kenburns', 'drift', 'breathe', 'sway', 'beat'].includes(s.bgMotion)) s.bgMotion = 'kenburns';
      if (!['auto', 'left', 'right', 'up', 'down'].includes(s.bgMotionDirection)) s.bgMotionDirection = 'auto';
      if (s.uiTheme === 'studio') s.uiTheme = 'vidi';
      if (s.uiTheme === 'aura') s.uiTheme = 'catbot';
      if (!['neon', 'vidi', 'catbot'].includes(s.uiTheme)) s.uiTheme = 'neon';
      if (!['auto', 'dark', 'light'].includes(s.uiMode)) s.uiMode = 'auto';
      s.bgMotionAmount = clamp(s.bgMotionAmount, 0, 100);
      s.bgMotionSpeed = clamp(s.bgMotionSpeed, 0, 200);
      s.exportFadeIn = clamp(s.exportFadeIn, 0, 3);
      s.exportFadeOut = clamp(s.exportFadeOut, 0, 3);
      s.exportPulse = clamp(s.exportPulse, 0, 100);
      s.bgDim = clamp(s.bgDim, 0, 90);
      s.bgBlur = clamp(s.bgBlur, 0, 30);
      s.bgEnergy = clamp(s.bgEnergy, 0, 150);
      s.sensitivity = clamp(s.sensitivity, 40, 200);
      s.smoothing = clamp(s.smoothing, 0, 96);
      s.uiScale = clamp(Number(s.uiScale) || 100, 70, 150);
      this.state.settings = s;
    }
    if (data.keybinds && typeof data.keybinds === 'object') {
      const kb = { ...DEFAULT_KEYBINDS };
      for (const action of SHORTCUT_ACTIONS) {
        const binding = data.keybinds[action.id];
        if (typeof binding === 'string' && binding && !FORBIDDEN_BINDINGS.has(bindingParts(binding).at(-1))) {
          kb[action.id] = binding;
        }
      }
      this.keybinds = kb;
    }
    if (Array.isArray(data.modules) && data.modules.length) {
      const normalized = this._sanitizeModules(data.modules);
      if (normalized.length) this.state.modules = normalized;
    }
    if (typeof data.preset === 'string') this.state.preset = data.preset;
    if (data.exportSettings && typeof data.exportSettings === 'object') {
      Object.assign(this.exportSettings, data.exportSettings);
    }
    if (data.info && typeof data.info === 'object') {
      const info = data.info;
      this.state.info = {
        title: typeof info.title === 'string' ? info.title.slice(0, 80) : '',
        artist: typeof info.artist === 'string' ? info.artist.slice(0, 80) : '',
        album: typeof info.album === 'string' ? info.album.slice(0, 80) : '',
        genre: typeof info.genre === 'string' ? info.genre.slice(0, 40) : '',
        bpm: info.bpm === '' ? '' : String(info.bpm ?? '').slice(0, 12),
        cover: typeof info.cover === 'string' ? info.cover : '',
        show: !!info.show,
      };
    }
    if (Array.isArray(data.animationCues)) {
      this.state.animationCues = data.animationCues
        .filter((cue) => cue && typeof cue === 'object')
        .slice(0, 80)
        .map((cue) => ({
          id: typeof cue.id === 'string' ? cue.id : uid('cue'),
          time: clamp(Number(cue.time) || 0, 0, 36000),
          duration: clamp(Number(cue.duration) || 1, 0.1, 60),
          type: ['flash', 'text', 'subtitle', 'tint', 'fade', 'effect', 'mash', 'color', 'bpm'].includes(cue.type) ? cue.type : 'flash',
          value: typeof cue.value === 'string' ? cue.value.slice(0, 200) : '',
          params: cue.params && typeof cue.params === 'object' ? cue.params : {},
        }));
    }
    if (data.subpanelState && typeof data.subpanelState === 'object') {
      for (const [id, raw] of Object.entries(data.subpanelState)) {
        if (!raw || typeof raw !== 'object') continue;
        const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
        this.subpanelState[id] = {
          hidden: !!raw.hidden,
          floating: !!raw.floating,
          x: num(raw.x),
          y: num(raw.y),
          w: num(raw.w),
          h: num(raw.h),
        };
      }
    }
    if (data.panelState && typeof data.panelState === 'object') {
      for (const id of ['left', 'stage', 'right']) {
        const raw = data.panelState[id];
        if (!raw || typeof raw !== 'object') continue;
        const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
        this.panelState[id] = {
          hidden: !!raw.hidden,
          floating: !!raw.floating,
          x: num(raw.x),
          y: num(raw.y),
          w: num(raw.w),
          h: num(raw.h),
        };
      }
      // A detached panel cannot also be hidden; keep the state deterministic.
      for (const id of ['left', 'stage', 'right']) {
        if (this.panelState[id].floating) this.panelState[id].hidden = false;
      }
    }
  }

  _sanitizeModules(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      if (!raw || !MODULE_DEFS[raw.type]) continue;
      const def = MODULE_DEFS[raw.type];
      let id = typeof raw.id === 'string' && raw.id ? raw.id : uid(raw.type);
      if (seen.has(id)) id = uid(raw.type);
      seen.add(id);
      let w = clamp(Number(raw.w) || def.w, 150, STAGE_W);
      let h = clamp(Number(raw.h) || def.h, 100, STAGE_H);
      let x = clamp(Number(raw.x) || 0, 0, STAGE_W - w);
      let y = clamp(Number(raw.y) || 0, 0, STAGE_H - h);
      const color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color.toUpperCase() : null;
      const options = {};
      for (const option of (MODULE_OPTIONS[raw.type] || [])) {
        const v = raw.options?.[option.key];
        if (v === undefined || v === null) continue;
        if (option.type === 'toggle') options[option.key] = !!v;
        else if (option.type === 'range') {
          const num = Number(v);
          if (Number.isFinite(num)) options[option.key] = clamp(num, option.min, option.max);
        } else if (option.options.some(([value]) => String(value) === String(v))) {
          options[option.key] = String(v);
        }
      }
      out.push({
        id, type: raw.type, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
        color, colorAlpha: clamp(Number(raw.colorAlpha) || 1, 0, 1),
        opacity: clamp(Number(raw.opacity) || 1, 0.05, 1),
        hidden: !!raw.hidden,
        title: typeof raw.title === 'string' ? raw.title.slice(0, 44) : null,
        options,
      });
    }
    return out;
  }

  _applySettingsToState() {
    const s = this.state.settings;
    this.state.modules.forEach((m) => { m.color = m.color || null; });
    document.body.classList.toggle('editing', s.editing);
    this.audio.setLoop(s.loop);
  }

  _initVisualizer() {
    this.visualizer = new Visualizer({
      canvas: this.dom.stageCanvas,
      stage: this.dom.stage,
      overlay: this.dom.stageOverlay,
      guideV: this.dom.guideV,
      guideH: this.dom.guideH,
      engine: this.audio,
      state: this.state,
      callbacks: {
        onSelect: (id) => this._syncSelectionUI(id),
        onGeometry: (mod) => this._syncGeometryFields(mod),
        onLayoutCommit: () => { this.state.preset = 'custom'; this._persist(); },
        onStageResize: () => { this.dom.stageDims.textContent = '1920 × 1080 / 16:9'; },
        onPreviewResize: ({ width, height }) => {
          this.dom.previewQuality.textContent = `${width} × ${height}`;
        },
        onFps: (fps) => { this.dom.fpsRead.textContent = `${Math.round(fps)} FPS`; },
        onTick: (frame, fps, dt) => this._onTick(frame, fps, dt),
        onEnded: () => this._onTrackEnded(),
        onModuleMenu: (id, x, y) => this._openModuleMenu(id, x, y),
      },
    });
    this.visualizer.applyBackgroundSettings();
    this.visualizer.syncOverlay();
  }

  _bindUI() {
    const d = this.dom;
    d.playBtn.addEventListener('click', () => this._togglePlay());
    d.startPlayBtn.addEventListener('click', () => this._togglePlay());
    d.stopBtn.addEventListener('click', () => {
      if (this.state.exporting) return;
      this.audio.stop();
      this.dom.seek.value = 0;
      this._updateTransport(this.audio.currentTime);
    });
    d.seek.addEventListener('pointerdown', () => { this._seeking = true; });
    d.seek.addEventListener('pointerup', () => { this._seeking = false; });
    d.seek.addEventListener('input', () => {
      if (this.state.exporting || !this.audio.hasAudio) return;
      const t = (Number(d.seek.value) / 1000) * this.audio.duration;
      this.audio.seek(t);
      this._updateTransport(t);
    });
    d.volume.addEventListener('input', () => {
      const value = clamp(Number(d.volume.value), 0, 100);
      this.state.settings.volume = value;
      this.audio.setVolume(value / 100);
      this._persist();
    });
    d.loopBtn.addEventListener('click', () => this._toggleLoop());
    d.snapBtn.addEventListener('click', () => this._setSnap(!this.state.settings.snap));
    d.editBtn.addEventListener('click', () => this._setEditing(!this.state.settings.editing));
    d.exportBtn.addEventListener('click', () => this._openExport());
    d.helpBtn.addEventListener('click', () => this._openModal('help'));
    d.shortcutsBtn.addEventListener('click', () => this._openShortcuts());
    d.settingsFab.addEventListener('click', () => this._openSettings());
    d.openExportBtn.addEventListener('click', () => this._openExport());
    d.fitBtn.addEventListener('click', () => { this.visualizer._resize(); this._toast('画布已适配窗口'); });
    d.theaterBtn.addEventListener('click', () => this._toggleFocus());
    d.theaterBtn.textContent = 'FOCUS';

    d.importAudioBtn.addEventListener('click', () => d.audioFile.click());
    d.importMidiBtn.addEventListener('click', () => d.midiFile.click());
    d.dropzone.addEventListener('click', () => d.audioFile.click());
    d.demoBtn.addEventListener('click', () => this._loadDemo(true));
    d.audioFile.addEventListener('change', () => {
      const file = d.audioFile.files?.[0];
      d.audioFile.value = '';
      if (file) this._loadAudioFile(file);
    });
    d.midiFile.addEventListener('change', () => {
      const file = d.midiFile.files?.[0];
      d.midiFile.value = '';
      if (file) this._loadMidiFile(file);
    });
    d.bgFile.addEventListener('change', () => {
      const file = d.bgFile.files?.[0];
      d.bgFile.value = '';
      if (file) this._loadBackgroundFile(file);
    });

    d.moduleLibrary.addEventListener('click', (e) => this._handleLibraryClick(e));
    d.moduleLibrary.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('button')) return;
      const item = e.target.closest('.lib-item');
      if (!item) return;
      e.preventDefault();
      this._handleLibraryRow(item.dataset.type);
    });
    d.resetLayoutBtn.addEventListener('click', () => this._applyPreset('studio', true));

    // Settings tabs, accent picker and layout presets.
    d.settingsModal.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-settings-tab]');
      if (tab) this._switchSettingsTab(tab.dataset.settingsTab);
      const preset = e.target.closest('.preset-btn');
      if (preset) this._applyPreset(preset.dataset.preset);
      const scale = e.target.closest('[data-ui-scale]');
      if (scale) this._setUiScale(Number(scale.dataset.uiScale));
      const theme = e.target.closest('[data-theme-color]');
      if (theme) this._applyAccent(theme.dataset.themeColor, this.state.settings.accentAlpha);
      const uiTheme = e.target.closest('.theme-card[data-ui-theme]');
      if (uiTheme) this._applyUiTheme(uiTheme.dataset.uiTheme);
      const uiMode = e.target.closest('[data-ui-mode-btn]');
      if (uiMode) this._applyUiMode(uiMode.dataset.uiModeBtn);
    });
    d.accentPickBtn.addEventListener('click', () => this._openColorPicker('accent'));
    d.bgColorPickBtn.addEventListener('click', () => this._openColorPicker('background'));
    d.openShortcutsBtn.addEventListener('click', () => this._openShortcuts());
    d.openShortcutsBtn2.addEventListener('click', () => this._openShortcuts());
    d.glow.addEventListener('input', () => {
      this.state.settings.glow = Number(d.glow.value);
      d.glowOut.textContent = `${d.glow.value}%`;
      this._persist();
    });
    d.moduleTint.addEventListener('change', () => {
      this.state.settings.moduleTint = d.moduleTint.checked;
      this._persist();
    });

    // Background.
    d.bgMode.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === 'image' && !this.bgImage) {
        d.bgFile.click();
        return;
      }
      this._setBgMode(mode);
    });
    d.bgUploadBtn.addEventListener('click', () => d.bgFile.click());
    d.removeBgBtn.addEventListener('click', () => this._removeBackground());
    d.bgDim.addEventListener('input', () => {
      this.state.settings.bgDim = Number(d.bgDim.value);
      d.dimOut.textContent = `${d.bgDim.value}%`;
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgBlur.addEventListener('input', () => {
      this.state.settings.bgBlur = Number(d.bgBlur.value);
      d.blurOut.textContent = `${d.bgBlur.value}px`;
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgContain.addEventListener('change', () => {
      this.state.settings.bgContain = d.bgContain.checked;
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgEnergy.addEventListener('input', () => {
      this.state.settings.bgEnergy = Number(d.bgEnergy.value);
      d.bgEnergyOut.textContent = `${d.bgEnergy.value}%`;
      this._persist();
    });
    d.bgMotion.addEventListener('change', () => {
      this.state.settings.bgMotion = d.bgMotion.value;
      this.visualizer.applyBackgroundSettings();
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgMotionDirection.addEventListener('change', () => {
      this.state.settings.bgMotionDirection = d.bgMotionDirection.value;
      this.visualizer.applyBackgroundSettings();
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgMotionAmount.addEventListener('input', () => {
      this.state.settings.bgMotionAmount = Number(d.bgMotionAmount.value);
      d.bgMotionAmountOut.textContent = `${d.bgMotionAmount.value}%`;
      this.visualizer.applyBackgroundSettings();
      this._refreshBgPreview(true);
      this._persist();
    });
    d.bgMotionSpeed.addEventListener('input', () => {
      this.state.settings.bgMotionSpeed = Number(d.bgMotionSpeed.value);
      d.bgMotionSpeedOut.textContent = `${d.bgMotionSpeed.value}%`;
      this.visualizer.applyBackgroundSettings();
      this._refreshBgPreview(true);
      this._persist();
    });
    d.exportFadeIn.addEventListener('input', () => {
      this.state.settings.exportFadeIn = Number(d.exportFadeIn.value);
      d.exportFadeInOut.textContent = `${Number(d.exportFadeIn.value).toFixed(1)}s`;
      this._persist();
    });
    d.exportFadeOut.addEventListener('input', () => {
      this.state.settings.exportFadeOut = Number(d.exportFadeOut.value);
      d.exportFadeOutOut.textContent = `${Number(d.exportFadeOut.value).toFixed(1)}s`;
      this._persist();
    });
    d.exportPulse.addEventListener('input', () => {
      this.state.settings.exportPulse = Number(d.exportPulse.value);
      d.exportPulseOut.textContent = `${d.exportPulse.value}%`;
      this._persist();
    });
    d.rendererMode.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-renderer]');
      if (!btn) return;
      this.state.settings.rendererMode = btn.dataset.renderer;
      this._syncSettingsUI();
      this._refreshBgPreview(true);
      this._persist();
    });
    d.sensitivity.addEventListener('input', () => {
      this.state.settings.sensitivity = Number(d.sensitivity.value);
      d.sensitivityOut.textContent = `${d.sensitivity.value}%`;
      this.audio.setSensitivity(this.state.settings.sensitivity);
      this._persist();
    });
    d.smoothing.addEventListener('input', () => {
      this.state.settings.smoothing = Number(d.smoothing.value);
      d.smoothingOut.textContent = `${d.smoothing.value}%`;
      this.audio.setSmoothing(this.state.settings.smoothing);
      this._persist();
    });
    d.watermarkToggle.addEventListener('change', () => {
      this.state.settings.watermark = d.watermarkToggle.checked;
      this._syncWatermark();
      this._persist();
    });
    d.scanlineToggle.addEventListener('change', () => {
      this.state.settings.scanlines = d.scanlineToggle.checked;
      this._persist();
    });
    d.autoSave.addEventListener('change', () => {
      this.state.settings.autoSave = d.autoSave.checked;
      if (d.autoSave.checked) this._persist();
    });
    d.uiScale.addEventListener('input', () => {
      this._setUiScale(Number(d.uiScale.value), { silent: true });
    });

    // Inspector.
    d.deleteModuleBtn.addEventListener('click', () => this._deleteSelected());
    d.duplicateBtn.addEventListener('click', () => this._duplicateSelected());
    d.layerUpBtn.addEventListener('click', () => this._layerSelected(1));
    d.layerDownBtn.addEventListener('click', () => this._layerSelected(-1));
    d.centerHBtn.addEventListener('click', () => this._centerSelected('h'));
    d.centerVBtn.addEventListener('click', () => this._centerSelected('v'));
    d.matchBtn.addEventListener('click', () => this._alignSelectedLeft());
    d.useGlobalColor.addEventListener('change', () => {
      const mod = this._selected();
      if (!mod) return;
      if (d.useGlobalColor.checked) {
        mod.color = null;
        mod.colorAlpha = 1;
        this._syncSelectionUI();
        this._persist();
      } else {
        mod.color = this.state.settings.accent;
        mod.colorAlpha = this.state.settings.accentAlpha ?? 1;
        this._syncSelectionUI();
        this._openColorPicker('module');
      }
    });
    d.moduleColorPickBtn.addEventListener('click', () => this._openColorPicker('module'));
    d.moduleOptions.addEventListener('input', (e) => {
      const control = e.target.closest('[data-opt-key]');
      if (!control) return;
      const mod = this._selected();
      if (!mod) return;
      const key = control.dataset.optKey;
      const schema = (MODULE_OPTIONS[mod.type] || []).find((option) => option.key === key);
      if (!schema) return;
      let value;
      if (schema.type === 'toggle') value = !!control.checked;
      else if (schema.type === 'range') value = Number(control.value);
      else value = control.value;
      mod.options = { ...(mod.options || {}), [key]: value };
      if (schema.type === 'range') {
        const output = d.moduleOptions.querySelector(`[data-opt-output="${key}"]`);
        if (output) output.textContent = `${Math.round(value)}${schema.unit || ''}`;
      }
      this._persist();
    });
    d.resetModuleOptionsBtn.addEventListener('click', () => {
      const mod = this._selected();
      if (!mod) return;
      mod.options = {};
      this._syncModuleOptions(mod);
      this._persist();
      this._toast('模块专属参数已恢复默认');
    });
    d.opacity.addEventListener('input', () => {
      const mod = this._selected();
      if (!mod) return;
      mod.opacity = clamp(Number(d.opacity.value) / 100, 0.05, 1);
      d.opacityOut.textContent = `${d.opacity.value}%`;
      this._persist();
    });
    d.moduleVisible.addEventListener('change', () => {
      const mod = this._selected();
      if (!mod) return;
      mod.hidden = !d.moduleVisible.checked;
      this.visualizer.syncOverlay();
      this._renderLibrary();
      this._persist();
    });
    for (const [input, key, min, max] of [
      [d.propX, 'x', 0, STAGE_W], [d.propY, 'y', 0, STAGE_H],
      [d.propW, 'w', 150, STAGE_W], [d.propH, 'h', 100, STAGE_H],
    ]) {
      input.addEventListener('change', () => {
        const mod = this._selected();
        if (!mod) return;
        let value = Number(input.value);
        if (!Number.isFinite(value)) { this._syncGeometryFields(mod); return; }
        if (key === 'w' || key === 'h') {
          value = clamp(value, min, key === 'w' ? STAGE_W - mod.x : STAGE_H - mod.y);
          mod[key] = Math.round(value);
        } else {
          value = clamp(value, 0, key === 'x' ? STAGE_W - mod.w : STAGE_H - mod.h);
          mod[key] = Math.round(value);
        }
        this.visualizer.syncOverlay();
        this._syncGeometryFields(mod);
        this._persist();
      });
    }

    // Export dialog.
    d.qualityGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-quality]');
      if (!btn) return;
      this.exportSettings.quality = Number(btn.dataset.quality);
      this._syncExportUI();
    });
    d.fpsSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-fps]');
      if (!btn) return;
      this.exportSettings.fps = Number(btn.dataset.fps);
      this._syncExportUI();
    });
    d.formatSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-format]');
      if (!btn) return;
      this.exportSettings.format = btn.dataset.format;
      this._syncExportUI();
    });
    d.bitrateSelect.addEventListener('change', () => {
      this.exportSettings.bitrate = Number(d.bitrateSelect.value);
      this._syncExportUI();
    });
    d.rangeSelect.addEventListener('change', () => {
      this.exportSettings.range = d.rangeSelect.value;
      this._syncExportUI();
    });
    d.startExportBtn.addEventListener('click', () => this._startExport());
    d.cancelExportBtn.addEventListener('click', () => {
      if (this._exporter) {
        this._exporter.cancel();
        d.progressHint.textContent = '正在取消导出…';
        d.cancelExportBtn.disabled = true;
      }
    });
    $$('[data-close]').forEach((el) => {
      el.addEventListener('click', () => {
        const name = el.dataset.close;
        if (name === 'export' && this.state.exporting) return;
        this._closeModal(name);
      });
    });
    d.helpModal.addEventListener('click', (e) => {
      if (e.target === d.helpModal) this._closeModal('help');
    });
    d.exportModal.addEventListener('click', (e) => {
      if (e.target === d.exportModal && !this.state.exporting) this._closeModal('export');
    });

    window.addEventListener('resize', debounce(() => {
      this._applyResponsiveUI();
      this._drawSeekWave(this.audio.getTime());
      this._refreshBgPreview(true);
      this.visualizer?._resize();
    }, 120));
    document.getElementById('stageViewport').addEventListener('dblclick', (e) => {
      if (this.state.exporting) return;
      const box = e.target.closest('.module-box');
      if (box) return;
      this.visualizer.select(null);
    });

    this._bindColorPickerUI();
    this._bindShortcutUI();
    this._bindModuleMenuUI();
    this._bindWindowDrag();
    this._bindSettingsKeybindLabels();
    this._bindPanels();
    this._bindInfoAnimationUI();
    this._bindArchiveUI();
    this._bindTimeline();
  }

  _bindArchiveUI() {
    if (!this.dom.archiveSaveBtn) return;
    this.dom.archiveSaveBtn.addEventListener('click', () => this._saveArchive());
    this.dom.archiveExportBtn.addEventListener('click', () => this._saveArchive({ as: true }));
    this.dom.archiveImportBtn.addEventListener('click', () => this.dom.archiveFile.click());
    this.dom.archiveFile.addEventListener('change', () => {
      const file = this.dom.archiveFile.files?.[0];
      this.dom.archiveFile.value = '';
      if (file) this._importArchive(file);
    });
    this.dom.savePathInput.addEventListener('change', () => {
      this.state.settings.savePath = this.dom.savePathInput.value.trim();
      this._notifyNativePaths();
      this._persist();
    });
    this.dom.exportPathInput.addEventListener('change', () => {
      this.state.settings.exportPath = this.dom.exportPathInput.value.trim();
      this._notifyNativePaths();
      this._persist();
    });
    this.dom.savePathBrowse.addEventListener('click', () => this._chooseFolder('save'));
    this.dom.exportPathBrowse.addEventListener('click', () => this._chooseFolder('export'));
    this.dom.animScriptApply.addEventListener('click', () => this._applyAnimationScript());
    this.dom.animScriptImport.addEventListener('click', () => this.dom.animScriptFile.click());
    this.dom.animScriptFile.addEventListener('change', async () => {
      const file = this.dom.animScriptFile.files?.[0];
      this.dom.animScriptFile.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        this.dom.animScript.value = text;
        this._applyAnimationScript();
      } catch (err) {
        this._toast(`动画脚本读取失败：${err.message}`, 'error');
      }
    });
    this.dom.animScriptExport.addEventListener('click', () => this._exportAnimationScript());
    this.dom.fileAnimExportBtn.addEventListener('click', () => this._exportAnimationScript());
    this.dom.fileAnimImportBtn.addEventListener('click', () => this.dom.animScriptFile.click());
    this.dom.animScript.value = serializeAnimationCues(this.state.animationCues || []);
  }

  _bindTimeline() {
    if (!this.dom.timelinePanel) return;
    this._timelineZoom = 1;
    this._tlPps = 1;
    this._tlDuration = 1;
    this.dom.timelineToggle.addEventListener('click', () => {
      this._applyTimelineOpen(!(this.state.settings.timelineOpen !== false));
    });
    this.dom.timelineZoomOut.addEventListener('click', () => {
      this._timelineZoom = clamp(this._timelineZoom - 0.25, 0.5, 4);
      this._renderTimeline();
    });
    this.dom.timelineZoomIn.addEventListener('click', () => {
      this._timelineZoom = clamp(this._timelineZoom + 0.25, 0.5, 4);
      this._renderTimeline();
    });
    this.dom.timelineAddCue.addEventListener('click', () => this._addTimelineCue());
    this.dom.timelineScroll.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tl-bar') || e.target.closest('.timeline-ruler') === null && e.target.closest('.tl-row-label')) return;
      this._seekFromTimeline(e.clientX);
    });
    this.dom.timelineContent.addEventListener('pointerdown', (e) => {
      const del = e.target.closest('.tl-del');
      const bar = e.target.closest('.tl-bar');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        this.state.animationCues = this.state.animationCues.filter((cue) => cue.id !== del.dataset.cueId);
        this._renderAnimationCues();
        this._persist();
        return;
      }
      if (!bar) return;
      const cue = this.state.animationCues.find((item) => item.id === bar.dataset.cueId);
      if (!cue) return;
      e.preventDefault();
      e.stopPropagation();
      const resizing = !!e.target.closest('.tl-resize');
      const startX = e.clientX;
      const startTime = cue.time;
      const startDuration = cue.duration;
      const move = (ev) => {
        const delta = (ev.clientX - startX) / Math.max(1, this._tlPps);
        if (resizing) cue.duration = clamp(startDuration + delta, 0.1, 60);
        else cue.time = clamp(startTime + delta, 0, Math.max(0.1, this._tlDuration));
        this.state.animationCues.sort((a, b) => a.time - b.time);
        this._renderTimeline();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this._renderAnimationCues();
        this._persist();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    this._applyTimelineOpen(this.state.settings.timelineOpen !== false, { silent: true });
    this._renderTimeline();
  }

  _applyTimelineOpen(open, { silent = false } = {}) {
    this.state.settings.timelineOpen = !!open;
    this.dom.timelinePanel?.classList.toggle('collapsed', !open);
    this.dom.timelineToggle?.classList.toggle('active', !!open);
    if (!silent) this._persist();
  }

  _timelineLabel(cue) {
    const p = cue.params || {};
    if (cue.type === 'text' || cue.type === 'subtitle') return p.text || cue.value || cue.type;
    if (cue.type === 'mash') return p.title || cue.value || 'mash';
    if (cue.type === 'color') return p.accent || 'color';
    if (cue.type === 'effect') return p.effect || 'effect';
    if (cue.type === 'bpm') return `${p.bpm ?? cue.value ?? ''} BPM`;
    return cue.value || cue.type;
  }

  _addTimelineCue() {
    const time = this.audio.getTime() || 0;
    const cue = {
      id: uid('cue'), time, duration: 2, type: 'text', value: 'TEXT',
      params: { text: 'TEXT', x: 0.5, y: 0.5, size: 26, align: 'center' },
    };
    this.state.animationCues.push(cue);
    this.state.animationCues.sort((a, b) => a.time - b.time);
    this._renderAnimationCues();
    this._persist();
    this._toast('已在播放头添加文字动作');
  }

  _seekFromTimeline(clientX) {
    const rect = this.dom.timelineContent.getBoundingClientRect();
    const t = clamp((clientX - rect.left) / Math.max(1, this._tlPps), 0, this._tlDuration);
    this.audio.seek(t);
    this._updateTransport(t);
    this._syncTimelinePlayhead(t);
  }

  _renderTimeline() {
    if (!this.dom.timelinePanel || !this.dom.timelineContent) return;
    if (!this.dom.timelineScroll.clientWidth) return;
    const duration = Math.max(1, this.audio.duration || 36, ...this.state.animationCues.map((c) => c.time + c.duration));
    this._tlDuration = duration;
    const viewport = Math.max(120, this.dom.timelineScroll.clientWidth);
    const width = Math.round(viewport * (this._timelineZoom || 1));
    this.dom.timelineContent.style.width = `${width}px`;
    this._tlPps = width / duration;
    this.dom.timelineZoomLabel.textContent = `${Math.round((this._timelineZoom || 1) * 100)}%`;
    const cues = this.state.animationCues.slice().sort((a, b) => a.time - b.time);
    const labels = [];
    const lanes = [];
    const labelsMap = { text: 'TEXT', subtitle: 'SUB', mash: 'MASH', color: 'COLOR', effect: 'FX', bpm: 'BPM', flash: 'FLASH', tint: 'TINT', fade: 'FADE' };
    for (const cue of cues) {
      labels.push(`<div class="tl-row-label"><span class="tl-type">${labelsMap[cue.type] || cue.type.toUpperCase()}</span><span class="tl-value">${this._timelineLabel(cue)}</span></div>`);
      const left = cue.time * this._tlPps;
      const bw = Math.max(10, cue.duration * this._tlPps);
      lanes.push(`<div class="tl-row">
        <div class="tl-bar ${cue.type}" data-cue-id="${cue.id}" style="left:${left}px;width:${bw}px" title="${formatCueTime(cue.time)} · ${cue.type}">
          <span>${this._timelineLabel(cue)}</span>
          <span class="tl-del" data-cue-id="${cue.id}" title="删除动作">×</span>
          <span class="tl-resize" title="拖动改变时长"></span>
        </div>
      </div>`);
    }
    if (!cues.length) {
      labels.push('<div class="tl-row-label"><span class="tl-type">EMPTY</span></div>');
      lanes.push('<div class="tl-row"><div class="timeline-empty">还没有动画动作 · 点击「+ 动作」或导入动画脚本</div></div>');
    }
    this.dom.timelineLabels.innerHTML = `<div style="height:22px"></div>${labels.join('')}`;
    this.dom.timelineLanes.innerHTML = lanes.join('');
    const ruler = [];
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * this._tlPps >= 54) || 600;
    for (let t = 0; t <= duration + 0.001; t += step) {
      const x = t * this._tlPps;
      ruler.push(`<div class="tl-tick" style="left:${x}px"><span>${formatCueTime(t).slice(0, 6)}</span></div>`);
    }
    this.dom.timelineRuler.innerHTML = ruler.join('');
    this._syncTimelinePlayhead(this.audio.getTime() || 0);
  }

  _syncTimelinePlayhead(t) {
    if (!this.dom.timelinePlayhead) return;
    const time = clamp(Number(t) || 0, 0, this._tlDuration || 1);
    this.dom.timelinePlayhead.style.left = `${time * (this._tlPps || 1)}px`;
    if (this.dom.timelineTime) this.dom.timelineTime.textContent = formatCueTime(time);
  }

  _notifyNativePaths() {
    if (!this._isNative || this._standaloneSettings) return;
    try {
      window.chrome.webview.postMessage({
        action: 'paths-updated',
        savePath: this.state.settings.savePath || '',
        exportPath: this.state.settings.exportPath || '',
      });
    } catch { /* noop */ }
  }

  _chooseFolder(kind) {
    if (this._isNative) {
      try {
        window.chrome.webview.postMessage({ action: 'choose-folder', kind });
        return;
      } catch { /* fall through */ }
    }
    this._toast('网页版请直接输入路径；EXE 中可用原生文件夹选择器', 'info', 3200);
  }

  _pathName(kind) {
    return kind === 'save' ? 'savePath' : 'exportPath';
  }

  _applyAnimationScript() {
    const text = this.dom.animScript.value;
    const cues = parseAnimationScript(text);
    if (!cues.length) {
      this._toast('没有解析到动画动作，请检查时间码与格式', 'error', 4200);
      return;
    }
    this.state.animationCues = cues;
    this._renderAnimationCues();
    this._persist();
    this._toast(`已应用动画脚本 · ${cues.length} 个动作`, 'success');
  }

  _exportAnimationScript() {
    const text = serializeAnimationCues(this.state.animationCues || []);
    if (!text.trim()) {
      this._toast('还没有动画动作可以导出', 'error');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${sanitizeFilename(this.audio.track?.name || 'neon-scope')}-animation.txt`);
    this._toast(`已导出动画脚本 · ${this.state.animationCues.length} 个动作`, 'success');
  }

  _buildArchive() {
    return {
      format: 'neon-scope-project',
      version: 1,
      app: '1.3',
      savedAt: new Date().toISOString(),
      title: this.audio.track?.name || 'Untitled signal',
      backgroundImage: safeRead(BG_IMAGE_KEY) || '',
      project: {
        version: 1,
        settings: this.state.settings,
        modules: this.state.modules,
        preset: this.state.preset,
        keybinds: this.keybinds,
        panelState: this.panelState,
        subpanelState: this.subpanelState,
        info: this.state.info,
        animationCues: this.state.animationCues,
        exportSettings: this.exportSettings,
      },
    };
  }

  async _saveArchive({ as = false } = {}) {
    const archive = this._buildArchive();
    const content = JSON.stringify(archive, null, 2);
    const filename = `${sanitizeFilename(this.audio.track?.name || 'neon-scope')}-${new Date().toISOString().slice(0, 10)}.neon`;
    if (this._isNative) {
      try {
        window.chrome.webview.postMessage({ action: 'save-archive', filename, content, saveAs: !!as });
        this._toast('正在保存工程存档…', 'info', 1800);
        return;
      } catch { /* fall through */ }
    }
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'NEON//SCOPE 工程存档', accept: { 'application/json': ['.neon'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        this._toast(`存档已保存 · ${handle.name}`, 'success', 3600);
        return;
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('Archive save failed:', err);
      if (err?.name === 'AbortError') return;
    }
    downloadBlob(new Blob([content], { type: 'application/json' }), filename);
    this._toast('存档已下载', 'success');
  }

  async _importArchive(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const archive = data?.format === 'neon-scope-project' ? data : { project: data };
      if (!archive.project || typeof archive.project !== 'object') throw new Error('不是有效的 NEON//SCOPE 存档');
      if (!window.confirm('导入存档会覆盖当前工程，继续吗？')) return;
      if (this._standaloneSettings && this._isNative) {
        window.chrome.webview.postMessage({ action: 'archive-import', archive });
        this._toast('已发送到主窗口，正在恢复存档…', 'success', 3000);
        return;
      }
      this._applyArchive(archive);
    } catch (err) {
      this._toast(`存档导入失败：${err.message}`, 'error', 5200);
    }
  }

  _applyArchive(archive) {
    const project = archive.project || archive;
    this._skipUnloadSave = true;
    safeStore(STORAGE_KEY, JSON.stringify(project));
    try {
      if (archive.backgroundImage) safeStore(BG_IMAGE_KEY, archive.backgroundImage);
      else localStorage.removeItem(BG_IMAGE_KEY);
    } catch { /* optional */ }
    this._toast('存档已恢复，正在重新载入…', 'success', 1200);
    setTimeout(() => location.reload(), 420);
  }

  _bindInfoAnimationUI() {
    const fields = [
      ['title', this.dom.infoTitle], ['artist', this.dom.infoArtist],
      ['album', this.dom.infoAlbum], ['genre', this.dom.infoGenre], ['bpm', this.dom.infoBpm],
    ];
    for (const [key, el] of fields) {
      el.addEventListener('input', () => {
        this.state.info[key] = el.value;
        this._persist();
      });
    }
    this.dom.infoOverlay.addEventListener('change', () => {
      this.state.info.show = this.dom.infoOverlay.checked;
      this._persist();
    });
    this.dom.infoCoverBtn.addEventListener('click', () => this.dom.infoCoverFile.click());
    this.dom.infoCoverFile.addEventListener('change', () => {
      const file = this.dom.infoCoverFile.files?.[0];
      this.dom.infoCoverFile.value = '';
      if (file) this._loadInfoCover(file);
    });
    this.dom.animAddBtn.addEventListener('click', () => this._addAnimationCue());
    this.dom.animClearBtn.addEventListener('click', () => {
      this.state.animationCues = [];
      this._renderAnimationCues();
      this._persist();
    });
    this.dom.animCueList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cue-delete]');
      if (!btn) return;
      this.state.animationCues = this.state.animationCues.filter((cue) => cue.id !== btn.dataset.cueDelete);
      this._renderAnimationCues();
      this._persist();
    });
    this._syncInfoPanel();
    this._renderAnimationCues();
  }

  _loadInfoCover(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 640;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(img.width * scale));
        canvas.height = Math.max(2, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        this.state.info.cover = canvas.toDataURL('image/jpeg', 0.86);
        this._syncInfoPanel();
        this._persist();
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  _syncInfoPanel() {
    const info = this.state.info;
    this.dom.infoTitle.value = info.title || '';
    this.dom.infoArtist.value = info.artist || '';
    this.dom.infoAlbum.value = info.album || '';
    this.dom.infoGenre.value = info.genre || '';
    this.dom.infoBpm.value = info.bpm || '';
    this.dom.infoOverlay.checked = !!info.show;
    if (info.cover) {
      this.dom.infoCoverPreview.innerHTML = `<img alt="cover" src="${info.cover}">`;
    } else {
      this.dom.infoCoverPreview.innerHTML = '<span>COVER</span>';
    }
  }

  _addAnimationCue() {
    const time = clamp(Number(this.dom.animTime.value) || this.audio.getTime() || 0, 0, 36000);
    const duration = clamp(Number(this.dom.animDuration.value) || 1, 0.1, 60);
    const type = this.dom.animType.value;
    let value = this.dom.animValue.value.trim();
    if ((type === 'text' || type === 'subtitle') && !value) value = type === 'subtitle' ? 'NEON//SCOPE' : 'TITLE';
    if (type === 'tint' && !/^#[0-9a-fA-F]{6}$/.test(value)) value = this.state.settings.accent;
    const params = {};
    if (type === 'text' || type === 'subtitle') {
      params.text = value;
      params.x = 0.5;
      params.y = type === 'subtitle' ? 0.88 : 0.5;
      params.size = 26;
      params.align = 'center';
    }
    this.state.animationCues.push({ id: uid('cue'), time, duration, type, value, params });
    this.state.animationCues.sort((a, b) => a.time - b.time);
    this._renderAnimationCues();
    this._persist();
  }

  _renderAnimationCues() {
    if (!this.dom.animCueList) return;
    const labels = { flash: '闪白', text: '文字', subtitle: '字幕', tint: '染色', fade: '淡出', effect: '效果', mash: '标题卡', color: '调色', bpm: 'BPM' };
    const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const cues = this.state.animationCues || [];
    if (!cues.length) {
      this.dom.animCueList.innerHTML = '<div class="anim-empty">还没有动作。输入时间码后点击「添加动作」。</div>';
      return;
    }
    this.dom.animCueList.innerHTML = cues.map((cue) => {
      const p = cue.params || {};
      const detail = cue.type === 'mash' ? (p.title || cue.value)
        : cue.type === 'color' ? `${p.accent || ''}`
        : cue.type === 'effect' ? `${p.effect || 'blur'} ${p.amount ?? ''}`
        : cue.type === 'bpm' ? `${p.bpm ?? cue.value} BPM`
        : (p.text || cue.value || '');
      return `
      <div class="anim-cue">
        <span class="time">${Number(cue.time).toFixed(1)}s</span>
        <span class="kind">${labels[cue.type] || esc(cue.type)}</span>
        <span class="value">${esc(detail || `${Number(cue.duration).toFixed(1)}s`)} · ${Number(cue.duration).toFixed(1)}s</span>
        <button data-cue-delete="${esc(cue.id)}" title="删除">×</button>
      </div>`;
    }).join('');
    if (this.dom.animScript && document.activeElement !== this.dom.animScript) {
      this.dom.animScript.value = serializeAnimationCues(cues);
    }
    this._renderTimeline();
  }

  _panelElements() {
    return {
      left: $('.left-sidebar'),
      stage: $('.stage-column'),
      right: $('.right-sidebar'),
    };
  }

  _initPanels() {
    this._panels = this._panelElements();
    this._panelLabels = {
      left: { title: '模块与素材', sub: 'WORKSPACE' },
      stage: { title: '舞台监视器', sub: 'PROGRAM' },
      right: { title: '属性检查器', sub: 'INSPECTOR' },
    };
    this._panelResize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.panelId;
        if (!id || !this.panelState[id]?.floating) continue;
        this.panelState[id].w = Math.round(entry.target.offsetWidth);
        this.panelState[id].h = Math.round(entry.target.offsetHeight);
      }
      this._savePanelState();
    });
    for (const [id, el] of Object.entries(this._panels)) {
      if (!el) continue;
      el.dataset.panelId = id;
      if (!el.querySelector('.panel-resizer')) {
        const grip = document.createElement('div');
        grip.className = 'panel-resizer';
        grip.dataset.resizePanel = id;
        grip.title = '拖动调整面板大小';
        el.appendChild(grip);
      }
      this._panelResize.observe(el);
    }
    this._bindResizeHandles();
    this._applyPanelState();
  }

  _panelViewport() {
    const scale = (this.state.settings.uiScale || 100) / 100;
    return { w: window.innerWidth / scale, h: window.innerHeight / scale, scale };
  }

  _panelDefaults(id) {
    const vp = this._panelViewport();
    const height = Math.max(360, Math.min(690, vp.h - 104));
    if (id === 'left') return { x: 18, y: 82, w: Math.min(312, vp.w - 40), h: height };
    if (id === 'right') return { x: Math.max(18, vp.w - Math.min(320, vp.w - 40) - 18), y: 82, w: Math.min(320, vp.w - 40), h: height };
    return {
      x: Math.round(Math.max(16, Math.min(110, vp.w * 0.08))),
      y: 76,
      w: Math.min(980, Math.max(460, vp.w - 140)),
      h: Math.min(720, Math.max(360, vp.h - 116)),
    };
  }

  _applyPanelState() {
    if (!this._panels) return;
    const vp = this._panelViewport();
    const workspace = $('.workspace');
    for (const [id, el] of Object.entries(this._panels)) {
      if (!el) continue;
      const ps = this.panelState[id];
      el.classList.toggle('panel-hidden', ps.hidden);
      const floating = !!(ps.floating && !ps.hidden);
      el.classList.toggle('panel-floating', floating);
      if (floating) {
        const defaults = this._panelDefaults(id);
        if (!Number.isFinite(ps.w)) ps.w = defaults.w;
        if (!Number.isFinite(ps.h)) ps.h = defaults.h;
        if (!Number.isFinite(ps.x)) ps.x = defaults.x;
        if (!Number.isFinite(ps.y)) ps.y = defaults.y;
        const w = clamp(ps.w, id === 'stage' ? 460 : 250, vp.w - 16);
        const h = clamp(ps.h, id === 'stage' ? 300 : 220, vp.h - 16);
        ps.w = Math.round(w); ps.h = Math.round(h);
        ps.x = Math.round(clamp(ps.x, 4, vp.w - w - 4));
        ps.y = Math.round(clamp(ps.y, 4, vp.h - h - 4));
        el.style.left = `${ps.x}px`;
        el.style.top = `${ps.y}px`;
        el.style.width = `${ps.w}px`;
        el.style.height = `${ps.h}px`;
        el.style.zIndex = String(ps.z || 65);
      } else {
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.zIndex = '';
      }
      for (const btn of $$(`[data-panel-float="${id}"]`)) {
        btn.title = floating ? '停靠面板' : '浮动面板';
        const use = btn.querySelector('use');
        if (use) use.setAttribute('href', floating ? '#i-dock' : '#i-window');
      }
    }
    if (workspace) {
      workspace.classList.toggle('panel-left-hidden', this.panelState.left.hidden || this.panelState.left.floating);
      workspace.classList.toggle('panel-right-hidden', this.panelState.right.hidden || this.panelState.right.floating);
    }
    const stageDetached = this.panelState.stage.hidden || this.panelState.stage.floating;
    this.dom.stageDockPlaceholder?.classList.toggle('hidden', !stageDetached);
    if (stageDetached) {
      const strong = this.dom.stageDockPlaceholder?.querySelector('strong');
      const p = this.dom.stageDockPlaceholder?.querySelector('p');
      if (strong) strong.textContent = this.panelState.stage.hidden ? '舞台已关闭' : '舞台正在浮动';
      if (p) p.textContent = this.panelState.stage.hidden ? '舞台已从主工作区关闭，可从面板菜单恢复。' : '舞台正在独立浮动窗口中显示，可拖拽标题栏移动。';
    }
    this._renderPanelMenu();
    this._savePanelState();
    setTimeout(() => this.visualizer?._resize(), 60);
  }

  _bindPanels() {
    document.addEventListener('click', (e) => {
      const floatBtn = e.target.closest('[data-panel-float]');
      if (floatBtn) {
        this._togglePanelFloat(floatBtn.dataset.panelFloat);
        return;
      }
      const closeBtn = e.target.closest('[data-panel-close]');
      if (closeBtn) {
        this._closePanel(closeBtn.dataset.panelClose);
        return;
      }
      const row = e.target.closest('[data-panel-toggle]');
      if (row) {
        this._togglePanelFromMenu(row.dataset.panelToggle);
      }
    });
    this.dom.panelMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePanelMenu();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.dom.panelMenu.classList.contains('hidden') && !e.target.closest('#panelMenu') && !e.target.closest('#panelMenuBtn')) {
        this._closePanelMenu();
      }
    }, true);
    this.dom.resetPanelsBtn.addEventListener('click', () => {
      this._resetPanels();
    });
    this.dom.panelMenuSettingsBtn.addEventListener('click', () => {
      this._closePanelMenu();
      this._openSettings();
    });
    this.dom.restoreStageBtn?.addEventListener('click', () => {
      this.panelState.stage.hidden = false;
      this.panelState.stage.floating = false;
      this._applyPanelState();
    });
    this._bindPanelDrag();
  }

  _bindPanelDrag() {
    for (const handle of $$('[data-panel-drag]')) {
      const id = handle.dataset.panelDrag;
      handle.addEventListener('pointerdown', (e) => {
        if (!this.panelState[id]?.floating || e.button !== 0) return;
        if (e.target.closest('button, input, select')) return;
        const el = this._panels[id];
        if (!el) return;
        const ps = this.panelState[id];
        ps.z = ++this._panelZ;
        el.style.zIndex = String(ps.z);
        const start = { x: e.clientX, y: e.clientY, left: ps.x, top: ps.y };
        const move = (ev) => {
          const vp = this._panelViewport();
          const dx = (ev.clientX - start.x) / vp.scale;
          const dy = (ev.clientY - start.y) / vp.scale;
          ps.x = Math.round(clamp(start.left + dx, 4, vp.w - el.offsetWidth - 4));
          ps.y = Math.round(clamp(start.top + dy, 4, vp.h - el.offsetHeight - 4));
          el.style.left = `${ps.x}px`;
          el.style.top = `${ps.y}px`;
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          this._savePanelState();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        e.preventDefault();
      });
    }
  }

  _togglePanelFloat(id) {
    const ps = this.panelState[id];
    if (!ps) return;
    if (ps.hidden) ps.hidden = false;
    ps.floating = !ps.floating;
    if (ps.floating) {
      const d = this._panelDefaults(id);
      if (!Number.isFinite(ps.x)) ps.x = d.x;
      if (!Number.isFinite(ps.y)) ps.y = d.y;
      if (!Number.isFinite(ps.w)) ps.w = d.w;
      if (!Number.isFinite(ps.h)) ps.h = d.h;
      ps.z = ++this._panelZ;
    }
    this._applyPanelState();
    this._toast(ps.floating ? `${this._panelLabels[id].title} 已浮动` : `${this._panelLabels[id].title} 已停靠`);
  }

  _closePanel(id) {
    const ps = this.panelState[id];
    if (!ps) return;
    ps.hidden = true;
    ps.floating = false;
    this._applyPanelState();
    this._toast(`${this._panelLabels[id].title} 已关闭 · 从顶部面板按钮恢复`);
  }

  _togglePanelFromMenu(id) {
    const ps = this.panelState[id];
    if (!ps) return;
    if (ps.hidden) {
      ps.hidden = false;
      ps.floating = false;
      this._applyPanelState();
    } else if (ps.floating) {
      ps.floating = false;
      this._applyPanelState();
    } else {
      this._closePanel(id);
    }
    this._closePanelMenu();
  }

  _togglePanelMenu() {
    if (this.dom.panelMenu.classList.contains('hidden')) this._openPanelMenu();
    else this._closePanelMenu();
  }

  _openPanelMenu() {
    this._renderPanelMenu();
    const btn = this.dom.panelMenuBtn;
    const r = btn.getBoundingClientRect();
    const vp = this._panelViewport();
    const menu = this.dom.panelMenu;
    menu.classList.remove('hidden');
    requestAnimationFrame(() => {
      const width = menu.offsetWidth || 244;
      menu.style.left = `${clamp(r.right / vp.scale - width, 8, vp.w - width - 8)}px`;
      menu.style.top = `${(r.bottom + 6) / vp.scale}px`;
    });
  }

  _closePanelMenu() {
    this.dom.panelMenu.classList.add('hidden');
  }

  _renderPanelMenu() {
    if (!this.dom.panelMenuList) return;
    const rows = ['left', 'stage', 'right'].map((id) => {
      const ps = this.panelState[id];
      const status = ps.hidden ? '已关闭' : ps.floating ? '浮动' : '停靠';
      const off = ps.hidden || ps.floating;
      return `<button class="panel-menu-row ${off ? 'is-off' : ''}" data-panel-toggle="${id}">
        <svg class="icon"><use href="#i-window"/></svg><span>${this._panelLabels[id].title}</span><em>${status}</em>
      </button>`;
    }).join('');
    this.dom.panelMenuList.innerHTML = rows;
    this._renderSubpanelMenu();
  }

  _resetPanels() {
    this.panelState = {
      left: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
      stage: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
      right: { hidden: false, floating: false, x: null, y: null, w: null, h: null },
    };
    this._applyPanelState();
    this._resetSubpanels();
    this._closePanelMenu();
    this._toast('面板布局已恢复默认');
  }

  _savePanelState() {
    if (this.state.settings.autoSave) this._saveDebounced();
  }

  _initSubpanels() {
    const specs = [];
    const reserve = new Set(['source', 'library', 'info', 'animation', 'geometry', 'style', 'options', 'layer', 'about', 'output', 'tips']);
    const add = (id, el, title) => {
      if (!el || !reserve.has(id)) return;
      specs.push({ id, el, title: title || el.querySelector('.section-head > span')?.textContent || id });
    };
    const leftSections = $$('#panelModules > .panel-section');
    add('source', leftSections[0], '信号源');
    add('library', leftSections[1], '模块库');
    add('info', leftSections[2], '信息编辑');
    add('animation', leftSections[3], '动画设计');
    const propSections = $$('#inspectorModule > .inspector-section');
    add('geometry', propSections[0], '位置与尺寸');
    add('style', propSections[1], '模块外观');
    add('options', propSections[2], '模块专属');
    add('layer', propSections[3], '图层');
    add('about', propSections[4], '模块信息');
    add('output', $('.canvas-inspector'), '画布与输出');
    add('tips', $$('.right-sidebar .inspector-section').at(-1), '快速提示');

    this._subpanelSpecs = specs;
    this._subpanels = {};
    for (const [index, spec] of specs.entries()) {
      const st = this.subpanelState[spec.id] || {
        hidden: spec.id === 'info' || spec.id === 'animation',
        floating: false, x: null, y: null, w: null, h: null,
      };
      if (st.hidden && st.floating) st.floating = false;
      this.subpanelState[spec.id] = st;
      const head = spec.el.querySelector('.section-head');
      if (head && !head.querySelector('.subpanel-tools')) {
        const tools = document.createElement('div');
        tools.className = 'panel-tools subpanel-tools';
        tools.innerHTML = `<button data-subpanel-float="${spec.id}" title="浮动此板块"><svg class="icon"><use href="#i-window"/></svg></button><button data-subpanel-close="${spec.id}" title="关闭此板块"><svg class="icon"><use href="#i-close"/></svg></button>`;
        head.appendChild(tools);
        head.dataset.subpanelDrag = spec.id;
      }
      if (!spec.el.querySelector('.subpanel-resizer')) {
        const grip = document.createElement('div');
        grip.className = 'subpanel-resizer';
        grip.dataset.resizeSubpanel = spec.id;
        grip.title = '拖动调整板块大小';
        spec.el.appendChild(grip);
      }
      this._subpanels[spec.id] = {
        spec, el: spec.el, head, index,
        parent: spec.el.parentNode,
        placeholder: null,
        z: 80,
      };
      if (head) this._bindSubpanelDrag(spec.id, head);
      this._subpanelResize = this._subpanelResize || new ResizeObserver((entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.subpanelId;
          if (!id || !this.subpanelState[id]?.floating) continue;
          this.subpanelState[id].w = Math.round(entry.target.offsetWidth);
          this.subpanelState[id].h = Math.round(entry.target.offsetHeight);
        }
        this._savePanelState();
      });
      this._subpanelResize.observe(spec.el);
    }
    this._bindSubpanelEvents();
    this._applySubpanelState();
  }

  _subpanelDefaults(index, el = null) {
    const vp = this._panelViewport();
    const w = Math.min(330, Math.max(270, vp.w * 0.24));
    const measured = el ? el.scrollHeight + 18 : 280;
    const h = clamp(measured, 180, Math.min(570, vp.h - 26));
    const col = index % 3;
    const row = Math.floor(index / 3);
    const stepX = Math.min(360, Math.max(275, vp.w * 0.245));
    const stepY = Math.min(285, Math.max(205, vp.h * 0.29));
    return {
      x: Math.round(clamp(44 + col * stepX, 8, vp.w - w - 8)),
      y: Math.round(clamp(80 + row * stepY, 8, vp.h - h - 8)),
      w: Math.round(w),
      h: Math.round(h),
    };
  }

  _applySubpanelState() {
    if (!this._subpanelSpecs) return;
    const layer = this.dom.subpanelLayer;
    if (!layer) return;
    const vp = this._panelViewport();
    for (const spec of this._subpanelSpecs) {
      const rec = this._subpanels[spec.id];
      const st = this.subpanelState[spec.id];
      if (!rec || !st) continue;
      const floating = !!(st.floating && !st.hidden);
      rec.el.dataset.subpanelId = spec.id;
      if (st.hidden && st.floating) st.floating = false;
      rec.el.classList.toggle('subpanel-hidden', !!st.hidden);
      if (floating) {
        if (rec.el.parentNode !== layer) {
          if (!rec.placeholder) {
            const marker = document.createElement('span');
            marker.className = 'subpanel-placeholder';
            marker.hidden = true;
            rec.parent.insertBefore(marker, rec.el);
            rec.placeholder = marker;
          }
          layer.appendChild(rec.el);
        }
        rec.el.classList.add('subpanel-floating');
        const defaults = this._subpanelDefaults(rec.index, rec.el);
        if (!Number.isFinite(st.w)) st.w = defaults.w;
        if (!Number.isFinite(st.h)) st.h = defaults.h;
        if (!Number.isFinite(st.x)) st.x = defaults.x;
        if (!Number.isFinite(st.y)) st.y = defaults.y;
        const w = clamp(st.w, 240, vp.w - 16);
        const h = clamp(st.h, 160, vp.h - 16);
        st.w = Math.round(w); st.h = Math.round(h);
        st.x = Math.round(clamp(st.x, 4, vp.w - w - 4));
        st.y = Math.round(clamp(st.y, 4, vp.h - h - 4));
        rec.el.style.left = `${st.x}px`;
        rec.el.style.top = `${st.y}px`;
        rec.el.style.width = `${st.w}px`;
        rec.el.style.height = `${st.h}px`;
        rec.el.style.zIndex = String(rec.z || 80);
      } else {
        rec.el.classList.remove('subpanel-floating');
        if (rec.placeholder) {
          if (rec.placeholder.parentNode) rec.placeholder.parentNode.insertBefore(rec.el, rec.placeholder);
          rec.placeholder.remove();
          rec.placeholder = null;
        } else if (rec.el.parentNode === layer) {
          rec.parent.appendChild(rec.el);
        }
        rec.el.style.left = '';
        rec.el.style.top = '';
        rec.el.style.width = '';
        rec.el.style.height = '';
        rec.el.style.zIndex = '';
      }
      for (const btn of $$(`[data-subpanel-float="${spec.id}"]`)) {
        btn.title = floating ? '停靠此板块' : '浮动此板块';
        const use = btn.querySelector('use');
        if (use) use.setAttribute('href', floating ? '#i-dock' : '#i-window');
      }
    }
    this._renderSubpanelMenu();
    this._savePanelState();
  }

  _bindResizeHandles() {
    document.addEventListener('pointerdown', (e) => {
      const primary = e.target.closest('[data-resize-panel]');
      const card = e.target.closest('[data-resize-subpanel]');
      if (!primary && !card) return;
      const id = primary ? primary.dataset.resizePanel : card.dataset.resizeSubpanel;
      const el = primary ? this._panels[id] : this._subpanels[id]?.el;
      const st = primary ? this.panelState[id] : this.subpanelState[id];
      if (!el || !st) return;
      if (!el.classList.contains('panel-floating') && !el.classList.contains('subpanel-floating')) return;
      e.preventDefault();
      e.stopPropagation();
      const start = {
        x: e.clientX, y: e.clientY,
        w: el.offsetWidth, h: el.offsetHeight,
      };
      const minW = primary ? (id === 'stage' ? 460 : 250) : 240;
      const minH = primary ? (id === 'stage' ? 300 : 220) : 170;
      try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      const move = (ev) => {
        const vp = this._panelViewport();
        const maxW = vp.w - (st.x ?? 0) - 4;
        const maxH = vp.h - (st.y ?? 0) - 4;
        const w = Math.round(clamp(start.w + (ev.clientX - start.x) / vp.scale, minW, maxW));
        const h = Math.round(clamp(start.h + (ev.clientY - start.y) / vp.scale, minH, maxH));
        st.w = w;
        st.h = h;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        try { el.releasePointerCapture?.(ev.pointerId); } catch { /* noop */ }
        if (primary) this._applyPanelState(); else this._applySubpanelState();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  _bindSubpanelEvents() {
    document.addEventListener('click', (e) => {
      const floatBtn = e.target.closest('[data-subpanel-float]');
      if (floatBtn) {
        this._toggleSubpanelFloat(floatBtn.dataset.subpanelFloat);
        return;
      }
      const closeBtn = e.target.closest('[data-subpanel-close]');
      if (closeBtn) {
        this._closeSubpanel(closeBtn.dataset.subpanelClose);
        return;
      }
      const row = e.target.closest('[data-subpanel-toggle]');
      if (row) {
        this._toggleSubpanelFromMenu(row.dataset.subpanelToggle);
      }
    });
  }

  _bindSubpanelDrag(id, head) {
    head.addEventListener('pointerdown', (e) => {
      const st = this.subpanelState[id];
      if (!st?.floating || e.button !== 0) return;
      if (e.target.closest('button, input, select')) return;
      const rec = this._subpanels[id];
      const el = rec?.el;
      if (!el) return;
      rec.z = ++this._panelZ;
      el.style.zIndex = String(rec.z);
      const start = { x: e.clientX, y: e.clientY, left: st.x, top: st.y };
      const move = (ev) => {
        const vp = this._panelViewport();
        st.x = Math.round(clamp(start.left + (ev.clientX - start.x) / vp.scale, 4, vp.w - el.offsetWidth - 4));
        st.y = Math.round(clamp(start.top + (ev.clientY - start.y) / vp.scale, 4, vp.h - el.offsetHeight - 4));
        el.style.left = `${st.x}px`;
        el.style.top = `${st.y}px`;
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this._savePanelState();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      e.preventDefault();
    });
  }

  _toggleSubpanelFloat(id) {
    const st = this.subpanelState[id];
    if (!st) return;
    if (st.hidden) st.hidden = false;
    st.floating = !st.floating;
    if (st.floating) {
      const rec = this._subpanels[id];
      const defaults = this._subpanelDefaults(rec?.index || 0, rec?.el);
      if (!Number.isFinite(st.x)) st.x = defaults.x;
      if (!Number.isFinite(st.y)) st.y = defaults.y;
      if (!Number.isFinite(st.w)) st.w = defaults.w;
      if (!Number.isFinite(st.h)) st.h = defaults.h;
      this._subpanels[id].z = ++this._panelZ;
    }
    this._applySubpanelState();
  }

  _ensureSubpanelParent(id) {
    const side = ['source', 'library'].includes(id) ? 'left' : 'right';
    const ps = this.panelState[side];
    if (ps?.hidden) {
      ps.hidden = false;
      ps.floating = false;
      this._applyPanelState();
    }
  }

  _closeSubpanel(id) {
    const st = this.subpanelState[id];
    if (!st) return;
    st.floating = false;
    st.hidden = true;
    this._applySubpanelState();
    this._toast(`${this._subpanels[id]?.spec.title || '板块'} 已关闭 · 从顶部面板按钮恢复`);
  }

  _toggleSubpanelFromMenu(id) {
    const st = this.subpanelState[id];
    if (!st) return;
    if (st.hidden) {
      this._ensureSubpanelParent(id);
      st.hidden = false;
      st.floating = false;
      this._applySubpanelState();
      setTimeout(() => this._subpanels[id]?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);
    } else if (st.floating) {
      st.floating = false;
      this._applySubpanelState();
    } else {
      this._closeSubpanel(id);
    }
    this._closePanelMenu();
  }

  _resetSubpanels() {
    for (const spec of this._subpanelSpecs || []) {
      this.subpanelState[spec.id] = { hidden: false, floating: false, x: null, y: null, w: null, h: null };
    }
    this._applySubpanelState();
  }

  _renderSubpanelMenu() {
    if (!this.dom.subpanelMenuList) return;
    const rows = (this._subpanelSpecs || []).map((spec) => {
      const st = this.subpanelState[spec.id] || {};
      const status = st.hidden ? '已关闭' : st.floating ? '浮动' : '停靠';
      const off = st.hidden || st.floating;
      return `<button class="panel-menu-row ${off ? 'is-off' : ''}" data-subpanel-toggle="${spec.id}">
        <svg class="icon"><use href="#i-window"/></svg><span>${spec.title}</span><em>${status}</em>
      </button>`;
    }).join('');
    this.dom.subpanelMenuList.innerHTML = rows || '<div class="shortcut-empty">没有独立板块</div>';
  }

  _switchSettingsTab(name) {
    this._settingsTab = name || 'appearance';
    $$('#settingsModal [data-settings-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.settingsTab === this._settingsTab);
    });
    $$('#settingsModal [data-settings-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.settingsPanel !== this._settingsTab);
    });
    if (this._settingsTab === 'background') this._refreshBgPreview(true);
  }

  _bindSettingsKeybindLabels() {
    const update = () => {
      const snapKbd = this.dom.snapBtn.querySelector('kbd');
      const editKbd = this.dom.editBtn.querySelector('kbd');
      if (snapKbd) snapKbd.textContent = bindingLabel(this.keybinds.snap);
      if (editKbd) editKbd.textContent = bindingLabel(this.keybinds.edit_mode);
      $$('#moduleMenu [data-menu-key]').forEach((el) => {
        const action = SHORTCUT_ACTIONS.find((a) => a.id === el.dataset.menuKey);
        if (action) el.textContent = bindingLabel(this.keybinds[action.id]).toUpperCase();
      });
    };
    this._refreshKeybindLabels = update;
    update();
  }

  _bindWindowDrag() {
    for (const head of $$('[data-window-drag]')) {
      const card = head.closest('.window-card');
      if (!card) continue;
      let drag = null;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || e.button !== 0) return;
        const current = card.style.translate ? card.style.translate.match(/-?[\d.]+/g)?.map(Number) || [0, 0] : [0, 0];
        drag = { x: e.clientX, y: e.clientY, baseX: current[0] || 0, baseY: current[1] || 0 };
        head.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });
      head.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const scale = (this.state.settings.uiScale || 100) / 100;
        const dx = (e.clientX - drag.x) / scale;
        const dy = (e.clientY - drag.y) / scale;
        card.style.translate = `${drag.baseX + dx}px ${drag.baseY + dy}px`;
      });
      const end = (e) => {
        if (!drag) return;
        drag = null;
        try { head.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    }
  }

  _setupKeyboard() {
    window.addEventListener('keydown', (e) => this._handleGlobalKeydown(e));
  }

  _isTypingTarget(target) {
    const tag = (target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
  }

  _handleGlobalKeydown(e) {
    if (this.dom.alphaNotice && !this.dom.alphaNotice.classList.contains('hidden')) return;
    if (e.key === 'Escape' && !this.dom.panelMenu.classList.contains('hidden')) {
      this._closePanelMenu();
      e.preventDefault();
      return;
    }
    if (this._moduleMenuId && e.key === 'Escape') {
      this._closeModuleMenu();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && !this._keyCapture) {
      if (this._activeModal === 'export' && this.state.exporting) return;
      if (this._activeModal) {
        this._closeModal(this._activeModal);
        e.preventDefault();
        return;
      }
      if (document.body.classList.contains('focus-mode')) {
        this._toggleFocus();
        return;
      }
      this.visualizer.select(null);
      return;
    }
    if (this._keyCapture || this.state.exporting) return;
    if (this._isTypingTarget(e.target)) return;
    if (this._activeModal) return;
    let binding = eventToBinding(e);
    if (!binding) return;
    let action = SHORTCUT_ACTIONS.find((a) => this.keybinds[a.id] === binding);
    let fastNudge = false;
    if (!action && e.shiftKey) {
      const base = eventToBinding(e, true);
      const baseAction = SHORTCUT_ACTIONS.find((a) => this.keybinds[a.id] === base);
      if (baseAction && baseAction.id.startsWith('nudge_')) {
        action = baseAction;
        fastNudge = true;
      }
    }
    if (!action) return;
    if (e.repeat && !action.id.startsWith('nudge_')) return;
    e.preventDefault();
    e.stopPropagation();
    this._runShortcut(action.id, { ...e, fastNudge });
  }

  _runShortcut(id, e = {}) {
    const editing = this.state.settings.editing;
    const selected = this._selected();
    switch (id) {
      case 'play_pause': this._togglePlay(); break;
      case 'stop':
        if (this.state.exporting) return;
        this.audio.stop();
        this.dom.seek.value = 0;
        this._updateTransport(this.audio.currentTime);
        break;
      case 'loop': this._toggleLoop(); break;
      case 'open_export': this._openExport(); break;
      case 'save_archive': this._saveArchive(); break;
      case 'snap': this._setSnap(!this.state.settings.snap); break;
      case 'edit_mode': this._setEditing(!this.state.settings.editing); break;
      case 'delete_module':
        if (editing && selected) this._deleteSelected();
        break;
      case 'duplicate_module':
        if (editing && selected) this._duplicateSelected();
        break;
      case 'center_h':
        if (editing && selected) this._centerSelected('h');
        break;
      case 'center_v':
        if (editing && selected) this._centerSelected('v');
        break;
      case 'nudge_left':
      case 'nudge_right':
      case 'nudge_up':
      case 'nudge_down': {
        if (!editing || !selected) return;
        const step = e.shiftKey || e.fastNudge ? 10 : 1;
        const dx = id === 'nudge_left' ? -step : id === 'nudge_right' ? step : 0;
        const dy = id === 'nudge_up' ? -step : id === 'nudge_down' ? step : 0;
        this.visualizer.nudgeSelected(dx, dy);
        this._persist();
        break;
      }
      case 'focus': this._toggleFocus(); break;
      case 'open_settings': this._openSettings(); break;
      case 'open_shortcuts': this._openShortcuts(); break;
      case 'open_help': this._openModal('help'); break;
      default: break;
    }
  }

  _bindShortcutUI() {
    const d = this.dom;
    d.shortcutSearch.addEventListener('input', () => this._renderShortcutList());
    d.shortcutList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shortcut-action]');
      if (!btn) return;
      this._beginKeyCapture(btn.dataset.shortcutAction);
    });
    d.resetShortcutsBtn.addEventListener('click', () => this._resetKeybinds());
    d.shortcutsModal.addEventListener('mousedown', (e) => {
      if (!this._keyCapture) return;
      if (!e.target.closest('.shortcut-key-btn')) {
        this._cancelKeyCapture();
      }
    });
  }

  _openShortcuts() {
    this._openModal('shortcuts');
    this._renderShortcutList();
    setTimeout(() => this.dom.shortcutSearch.focus(), 80);
  }

  _renderShortcutList() {
    if (!this.dom.shortcutList) return;
    const query = (this.dom.shortcutSearch.value || '').trim().toLowerCase();
    const rows = SHORTCUT_ACTIONS.filter((action) => {
      if (!query) return true;
      return `${action.label} ${action.code} ${action.group} ${bindingLabel(this.keybinds[action.id])}`.toLowerCase().includes(query);
    });
    if (this.dom.shortcutCount) this.dom.shortcutCount.textContent = `${rows.length} / ${SHORTCUT_ACTIONS.length}`;
    if (!rows.length) {
      this.dom.shortcutList.innerHTML = '<div class="shortcut-empty">没有匹配的功能</div>';
      return;
    }
    this.dom.shortcutList.innerHTML = rows.map((action) => {
      const listening = this._keyCapture === action.id;
      return `
        <div class="shortcut-row">
          <div class="shortcut-row-main"><strong>${action.label}</strong><span>${action.group.toUpperCase()} / ${action.code}</span></div>
          <button class="shortcut-key-btn ${listening ? 'listening' : ''}" data-shortcut-action="${action.id}">
            ${listening ? '按下新键位…' : bindingLabel(this.keybinds[action.id])}
          </button>
        </div>`;
    }).join('');
  }

  _beginKeyCapture(actionId) {
    if (this._keyCapture) document.removeEventListener('keydown', this._captureKeyHandler, true);
    this._keyCapture = actionId;
    this._renderShortcutList();
    document.addEventListener('keydown', this._captureKeyHandler, true);
    setTimeout(() => this.dom.shortcutList.querySelector(`[data-shortcut-action="${actionId}"]`)?.focus(), 20);
  }

  _cancelKeyCapture() {
    if (!this._keyCapture) return;
    this._keyCapture = null;
    document.removeEventListener('keydown', this._captureKeyHandler, true);
    this._renderShortcutList();
  }

  _handleCaptureKey(e) {
    const actionId = this._keyCapture;
    if (!actionId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape' || e.code === 'Tab') {
      this._toast('Tab 和 Esc 不能绑定为快捷键', 'error');
      this._cancelKeyCapture();
      return;
    }
    if (MODIFIER_CODES.has(e.code)) return;
    const binding = eventToBinding(e);
    if (!binding) return;
    const conflict = SHORTCUT_ACTIONS.find((action) => action.id !== actionId && this.keybinds[action.id] === binding);
    if (conflict) {
      this._toast(`该键位已用于「${conflict.label}」`, 'error');
      return;
    }
    this.keybinds[actionId] = binding;
    this._keyCapture = null;
    document.removeEventListener('keydown', this._captureKeyHandler, true);
    this._renderShortcutList();
    this._refreshKeybindLabels?.();
    this._persist();
    const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
    this._toast(`「${action?.label || actionId}」已映射为 ${bindingLabel(binding)}`, 'success');
  }

  _resetKeybinds() {
    this.keybinds = { ...DEFAULT_KEYBINDS };
    this._cancelKeyCapture();
    this._renderShortcutList();
    this._refreshKeybindLabels?.();
    this._persist();
    this._toast('快捷键已恢复默认');
  }

  _setupDragDrop() {
    const isFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      this._draggingFiles++;
      document.body.classList.add('dragging');
      this.dom.dragVeil.classList.remove('hidden');
    });
    window.addEventListener('dragover', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!isFiles(e)) return;
      this._draggingFiles = Math.max(0, this._draggingFiles - 1);
      if (this._draggingFiles === 0) {
        document.body.classList.remove('dragging');
        this.dom.dragVeil.classList.add('hidden');
      }
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      this._draggingFiles = 0;
      document.body.classList.remove('dragging');
      this.dom.dragVeil.classList.add('hidden');
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const image = files.find((f) => f.type.startsWith('image/'));
      const midi = files.find((f) => /\.(mid|midi)$/i.test(f.name));
      const audio = files.find((f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f.name));
      if (image) this._loadBackgroundFile(image);
      if (midi) this._loadMidiFile(midi);
      else if (audio) this._loadAudioFile(audio);
    });
  }

  _setEngineStatus(text, kind = '') {
    this.dom.engineStatus.textContent = text;
    this.dom.engineDot.className = `status-dot ${kind}`;
  }

  _onAudioState(state) {
    const playing = state === 'playing';
    const use = this.dom.playBtn.querySelector('use');
    if (use) use.setAttribute('href', playing ? '#i-pause' : '#i-play');
    this.dom.playBtn.classList.toggle('playing', playing);
    this.dom.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    if (playing) {
      this.dom.startOverlay.classList.add('dismissed');
      this._setEngineStatus('实时分析中', 'ready');
    } else if (state === 'paused' || state === 'stopped') {
      this._setEngineStatus(this.audio.hasAudio ? '引擎就绪' : '等待信号', this.audio.hasAudio ? 'ready' : '');
    } else if (state === 'loaded') {
      this._refreshTrackUI();
      this._setEngineStatus('音频就绪', 'ready');
    }
  }

  _onTrackEnded() {
    this.dom.playBtn.classList.remove('playing');
    const use = this.dom.playBtn.querySelector('use');
    if (use) use.setAttribute('href', '#i-play');
    this._updateTransport(this.audio.duration);
    this._setEngineStatus('播放结束', 'ready');
  }

  async _togglePlay() {
    if (this.state.exporting) return;
    if (!this.audio.hasAudio) {
      this._toast('请先导入音频或载入内置 DEMO', 'error');
      return;
    }
    if (this.audio.playing) {
      this.audio.pause();
      return;
    }
    const offset = this.audio.getTime() >= this.audio.duration - 0.05 ? 0 : this.audio.getTime();
    const ok = await this.audio.play(offset);
    if (!ok) this._toast('音频引擎尚未就绪，请再点一次', 'error');
    this.dom.startOverlay.classList.add('dismissed');
  }

  _toggleLoop() {
    const loop = !this.state.settings.loop;
    this.state.settings.loop = loop;
    this.audio.setLoop(loop);
    this.dom.loopBtn.classList.toggle('active', loop);
    this.dom.loopBtn.style.color = loop ? 'var(--accent)' : '';
    this._persist();
  }

  _setSnap(v) {
    this.state.settings.snap = !!v;
    this.dom.snapBtn.classList.toggle('active', this.state.settings.snap);
    this.dom.snapMeta.textContent = this.state.settings.snap ? 'SNAP ON' : 'SNAP OFF';
    this._syncCanvasMeta();
    this._persist();
  }

  _setEditing(v) {
    this.state.settings.editing = !!v;
    document.body.classList.toggle('editing', this.state.settings.editing);
    this.dom.editBtn.classList.toggle('active', this.state.settings.editing);
    this.dom.stageOverlay.classList.toggle('editing-off', !this.state.settings.editing);
    this.visualizer.overlay.style.pointerEvents = this.state.settings.editing ? '' : 'none';
    this._syncCanvasMeta();
    this._persist();
  }

  _syncCanvasMeta() {
    const visible = this.state.modules.filter((m) => !m.hidden).length;
    this.dom.moduleMeta.textContent = `${visible} MODULES`;
    this.dom.moduleCount.textContent = `${this.state.modules.length}`;
    this.dom.stageMode.textContent = this.state.settings.editing ? 'EDIT MODE' : 'PREVIEW';
    this.dom.snapMeta.textContent = this.state.settings.snap ? 'SNAP ON' : 'SNAP OFF';
    this.dom.chipText.textContent = this.state.settings.editing
      ? (this.state.settings.snap ? 'EDIT / SNAP' : 'EDIT / FREE')
      : 'PREVIEW / LOCKED';
    this._syncWatermark();
  }

  _syncWatermark() {
    this.dom.stageWatermark.classList.toggle('hidden', !this.state.settings.watermark);
  }

  _onTick(frame, fps, dt) {
    this._frame = frame;
    const now = performance.now();
    if (now - this._lastUi > 90) {
      this._lastUi = now;
      this._updateTransport(frame.time);
      this.dom.watermarkTime.textContent = formatTC(frame.time, this.exportSettings.fps);
      if (!this._seeking && this.audio.hasAudio && now - this._lastSeekDraw > 120) {
        this._lastSeekDraw = now;
        this._drawSeekWave(frame.time);
      }
    }
    if (now - this._lastBgPreview > 280 && this._settingsTab === 'background' && !this.dom.settingsModal.classList.contains('hidden')) {
      this._lastBgPreview = now;
      this._refreshBgPreview(false);
    }
    if (this.state.exporting) {
      this.dom.exportVeilTime.textContent = formatShortTime(frame.time);
    }
  }

  _updateTransport(t) {
    const dur = this.audio.duration || 0;
    this.dom.curTime.textContent = formatTime(t, true);
    this.dom.durTime.textContent = formatTime(dur, true);
    if (!this._seeking && dur > 0) {
      this.dom.seek.value = String(clamp(t / dur, 0, 1) * 1000);
    }
    if (this.state.exporting) this.dom.exportVeilTime.textContent = formatShortTime(t);
    this._syncTimelinePlayhead(t);
  }

  _drawSeekWave(t) {
    const canvas = this.dom.seekWave;
    const wrap = this.dom.seek?.parentElement;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(20, Math.round(wrap.clientWidth));
    const ch = Math.max(18, Math.round(wrap.clientHeight || 22));
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const dur = this.audio.duration || 0;
    const progress = dur > 0 ? clamp(t / dur, 0, 1) : 0;
    if (!this.audio.overviewMin || !this.audio.overviewMax || !dur) {
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(0, ch / 2, cw, 1);
      return;
    }
    const min = this.audio.overviewMin;
    const max = this.audio.overviewMax;
    const n = min.length;
    const mid = ch / 2;
    const bars = Math.max(30, Math.floor(cw));
    const acRgb = hexToRgb(this.state.settings.accent);
    for (let i = 0; i < bars; i++) {
      const bi = Math.floor((i / bars) * n);
      const lo = Math.min(0, min[bi]);
      const hi = Math.max(0, max[bi]);
      const x = (i / bars) * cw;
      const top = mid - hi * (ch * 0.47);
      const bottom = mid - lo * (ch * 0.47);
      const played = i / bars <= progress;
      ctx.fillStyle = played ? `rgba(${acRgb.r},${acRgb.g},${acRgb.b},.82)` : 'rgba(255,255,255,.16)';
      ctx.fillRect(x, top, Math.max(0.7, cw / bars - 0.3), Math.max(1, bottom - top));
    }
    // Playhead.
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillRect(progress * cw, 2, 1, ch - 4);
  }

  _refreshTrackUI() {
    const track = this.audio.track;
    const d = this.dom;
    if (!track) {
      d.trackName.textContent = '尚未加载音频';
      d.trackMeta.textContent = '导入 WAV / MP3 / FLAC / OGG 或 MIDI';
      d.trackBadge.textContent = 'IDLE';
      d.footerTrack.textContent = 'NO SIGNAL';
      d.footerRate.textContent = '—';
      d.durTime.textContent = '00:00.000';
      d.seek.value = '0';
      this._drawSeekWave(0);
      this._renderTimeline();
      return;
    }
    const kind = track.kind || 'AUDIO';
    d.trackName.textContent = track.name || 'Untitled';
    const sample = this.audio.sampleRate || track.sampleRate || 0;
    const channels = this.audio.channels || track.channels || 2;
    const bpm = track.bpm ? ` · ${Math.round(track.bpm)} BPM` : '';
    d.trackMeta.textContent = `${formatShortTime(this.audio.duration)} · ${(sample / 1000).toFixed(1)} kHz · ${channels === 1 ? 'MONO' : 'STEREO'}${bpm}`;
    d.trackBadge.textContent = kind.toUpperCase();
    d.footerTrack.textContent = track.name || 'UNTITLED';
    d.footerRate.textContent = sample ? `${(sample / 1000).toFixed(1)} kHz / ${channels}ch` : '—';
    d.durTime.textContent = formatTime(this.audio.duration, true);
    d.seek.value = '0';
    d.currentTime = 0;
    this._drawSeekWave(0);
    this._updateTransport(0);
    this._renderTimeline();
  }

  _updateStartOverlay(mode) {
    const kicker = this.dom.startOverlay.querySelector('.start-kicker');
    const title = this.dom.startOverlay.querySelector('.start-title');
    const desc = this.dom.startOverlay.querySelector('.start-desc');
    if (mode === 'loading') {
      kicker.textContent = 'RENDERING DEMO SIGNAL // PLEASE WAIT';
      title.textContent = '正在生成演示音轨';
      desc.textContent = '内置合成器正在离线渲染一段 36 秒 Synthwave DEMO。你也可以直接导入自己的音频或 MIDI。';
      this.dom.startPlayBtn.disabled = true;
      this.dom.startPlayBtn.style.opacity = '.45';
    } else if (mode === 'ready') {
      kicker.textContent = `DEMO READY // ${formatShortTime(this.audio.duration)}`;
      title.textContent = '启动演示音轨';
      desc.textContent = '或从左侧导入你的音频 / MIDI。所有视觉将跟随声音实时生成。';
      this.dom.startPlayBtn.disabled = false;
      this.dom.startPlayBtn.style.opacity = '';
    } else if (mode === 'custom') {
      kicker.textContent = 'SIGNAL LOCKED // READY';
      title.textContent = '播放你的音轨';
      desc.textContent = `${this.audio.track?.name || '音频'} 已加载。按空格播放，或拖动模块开始自定义视觉。`;
      this.dom.startPlayBtn.disabled = false;
      this.dom.startPlayBtn.style.opacity = '';
    } else if (mode === 'empty') {
      kicker.textContent = 'NO SIGNAL // IMPORT REQUIRED';
      title.textContent = '导入音频或 MIDI';
      desc.textContent = '支持 WAV / MP3 / FLAC / OGG 与标准 MIDI 文件。';
      this.dom.startPlayBtn.disabled = true;
      this.dom.startPlayBtn.style.opacity = '.45';
    }
  }

  async _loadDemo(autoplay = false) {
    const token = ++this.loadToken;
    try {
      this._setEngineStatus('渲染 DEMO 音轨…', 'busy');
      this._setBusyTrack('生成内置 DEMO…');
      if (!this.demoBuffer) {
        if (!this.demoPromise) {
          this.demoPromise = createDemoTrack(this.audio.ctx.sampleRate).catch((err) => {
            this.demoPromise = null;
            throw err;
          });
        }
        this.demoBuffer = await this.demoPromise;
      }
      if (token !== this.loadToken) return;
      this.audio.setBuffer(this.demoBuffer, { ...DEMO_META });
      this.state.midi = null;
      this.state.preset = this.state.preset || 'studio';
      this._refreshTrackUI();
      this._updateStartOverlay('ready');
      this._setEngineStatus('演示音频就绪', 'ready');
      if (autoplay) {
        await this._togglePlay();
      }
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      this._setEngineStatus('DEMO 生成失败', 'error');
      this._updateStartOverlay('empty');
      this._toast(`演示音轨生成失败：${err.message}`, 'error', 5200);
    }
  }

  _setBusyTrack(text) {
    this.dom.trackName.textContent = text;
    this.dom.trackMeta.textContent = 'OFFLINE SYNTHESIS';
    this.dom.trackBadge.textContent = 'SYNTH';
  }

  async _loadAudioFile(file) {
    if (!file) return;
    const token = ++this.loadToken;
    this._setEngineStatus('解码音频…', 'busy');
    this._setBusyTrack(file.name);
    try {
      const buffer = await this.audio.decodeFile(file);
      if (token !== this.loadToken) return;
      const name = file.name.replace(/\.[^.]+$/, '');
      this.audio.setBuffer(buffer, { name, kind: 'audio', file: file.name });
      this.state.midi = null;
      this._refreshTrackUI();
      this._updateStartOverlay('custom');
      this._setEngineStatus('音频就绪', 'ready');
      this.visualizer.states.clear();
      await this.audio.play(0);
      this.dom.startOverlay.classList.add('dismissed');
      this._toast(`已载入 ${file.name}`, 'success');
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      this._setEngineStatus('解码失败', 'error');
      this._updateStartOverlay('empty');
      this._toast(`无法解码音频：${err.message}`, 'error', 5000);
    }
  }

  async _loadMidiFile(file) {
    if (!file) return;
    const token = ++this.loadToken;
    this._setEngineStatus('解析 MIDI…', 'busy');
    this._setBusyTrack(file.name);
    this._toast('正在解析 MIDI 并离线合成音频…', '', 2200);
    try {
      const buf = await file.arrayBuffer();
      if (token !== this.loadToken) return;
      const midi = parseMidi(buf);
      this._setEngineStatus(`合成 MIDI · ${midi.noteCount} 音符…`, 'busy');
      const rendered = await renderMidiToBuffer(midi, 44100);
      if (token !== this.loadToken) return;
      this.state.midi = midi;
      const name = file.name.replace(/\.[^.]+$/, '');
      this.audio.setBuffer(rendered, {
        name, kind: 'midi', bpm: midi.bpm, midiNotes: midi.noteCount,
        tracks: midi.trackCount, midiDescription: describeMidi(midi),
      });
      this._ensurePianoRoll();
      this._refreshTrackUI();
      this._updateStartOverlay('custom');
      this._setEngineStatus('MIDI 合成完成', 'ready');
      this.visualizer.states.clear();
      await this.audio.play(0);
      this.dom.startOverlay.classList.add('dismissed');
      this._toast(`MIDI 已合成 · ${midi.noteCount} 音符 / ${midi.trackCount} 轨`, 'success', 4200);
    } catch (err) {
      console.error(err);
      if (token !== this.loadToken) return;
      this._setEngineStatus('MIDI 处理失败', 'error');
      this._updateStartOverlay('empty');
      this._toast(err.message || 'MIDI 解析失败', 'error', 5200);
    }
  }

  _ensurePianoRoll() {
    if (this.state.modules.some((m) => m.type === 'pianoRoll')) return;
    const placement = this._findPlacement(MODULE_DEFS.pianoRoll.w, MODULE_DEFS.pianoRoll.h);
    const mod = createModule('pianoRoll', placement);
    this.state.modules.push(mod);
    this.visualizer.syncOverlay();
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
  }

  _handleLibraryClick(e) {
    const add = e.target.closest('.lib-add');
    const eye = e.target.closest('.lib-eye');
    const item = e.target.closest('.lib-item');
    if (!item) return;
    const type = item.dataset.type;
    if (add) {
      e.stopPropagation();
      this._addModule(type);
      return;
    }
    if (eye) {
      e.stopPropagation();
      this._toggleTypeVisibility(type);
      return;
    }
    this._handleLibraryRow(type);
  }

  _handleLibraryRow(type) {
    const matches = this.state.modules.filter((m) => m.type === type);
    if (!matches.length) { this._addModule(type); return; }
    const visible = matches.find((m) => !m.hidden);
    if (!visible) {
      matches.forEach((m) => { m.hidden = false; });
      this.visualizer.syncOverlay();
      this._renderLibrary();
      this._syncCanvasMeta();
    }
    const target = visible || matches[0];
    this.visualizer.select(target.id);
    this.state.settings.editing = true;
    this._setEditing(true);
  }

  _toggleTypeVisibility(type) {
    const matches = this.state.modules.filter((m) => m.type === type);
    if (!matches.length) { this._addModule(type); return; }
    const anyVisible = matches.some((m) => !m.hidden);
    matches.forEach((m) => { m.hidden = anyVisible; });
    if (this.state.selectedId && matches.some((m) => m.id === this.state.selectedId) && anyVisible) {
      this.visualizer.select(null);
    }
    this.visualizer.syncOverlay();
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
    this._toast(`${MODULE_DEFS[type].name} 已${anyVisible ? '隐藏' : '显示'}`);
  }

  _renderLibrary() {
    const parts = [];
    for (const type of MODULE_ORDER) {
      const def = MODULE_DEFS[type];
      const matches = this.state.modules.filter((m) => m.type === type);
      const visible = matches.some((m) => !m.hidden);
      const count = matches.length;
      parts.push(`
        <div class="lib-item ${count ? 'active' : ''} ${count && !visible ? 'hidden-type' : ''}" data-type="${type}" role="button" tabindex="0" aria-label="添加 ${def.name}">
          <span class="lib-glyph">${def.glyph}</span>
          <span class="lib-text"><strong>${def.name}</strong><small>${def.category}</small></span>
          <span class="lib-count">${count ? `×${count}` : ''}</span>
          ${count ? `<button class="lib-eye" title="${visible ? '隐藏该类模块' : '显示该类模块'}" aria-label="显隐"><svg class="icon"><use href="#${visible ? 'i-eye' : 'i-eye-off'}"/></svg></button>` : '<span class="lib-eye-spacer" aria-hidden="true"></span>'}
          <button class="lib-add" title="添加模块" aria-label="添加"><svg class="icon"><use href="#i-plus"/></svg></button>
        </div>`);
    }
    this.dom.moduleLibrary.innerHTML = parts.join('');
    this.dom.moduleCount.textContent = `${this.state.modules.length}`;
    this.dom.moduleMeta.textContent = `${this.state.modules.filter((m) => !m.hidden).length} MODULES`;
  }

  _findPlacement(w, h) {
    const margin = 24;
    const step = 32;
    const collides = (x, y) => this.state.modules.some((m) => !m.hidden &&
      !(x + w + 12 <= m.x || x >= m.x + m.w + 12 || y + h + 12 <= m.y || y >= m.y + m.h + 12));
    for (let y = margin; y <= STAGE_H - h - margin; y += step) {
      for (let x = margin; x <= STAGE_W - w - margin; x += step) {
        if (!collides(x, y)) return { x, y, w, h };
      }
    }
    const n = this.state.modules.length;
    return {
      x: clamp(80 + (n % 6) * 40, margin, STAGE_W - w - margin),
      y: clamp(80 + (n % 4) * 40, margin, STAGE_H - h - margin),
      w, h,
    };
  }

  _addModule(type, preset = null) {
    const def = MODULE_DEFS[type];
    if (!def) return null;
    const placement = preset || this._findPlacement(def.w, def.h);
    const mod = createModule(type, {
      ...placement,
      title: def.code,
    });
    if (this.state.modules.some((m) => m.type === type && m.title === def.code)) {
      mod.title = `${def.code} ${this.state.modules.filter((m) => m.type === type).length + 1}`;
    }
    this.state.modules.push(mod);
    this.state.selectedId = mod.id;
    this.visualizer.states.delete(mod.id);
    this.visualizer.syncOverlay();
    this._syncSelectionUI(mod.id);
    if (!this.state.settings.editing) this._setEditing(true);
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
    return mod;
  }

  _selected() {
    return this.state.modules.find((m) => m.id === this.state.selectedId) || null;
  }

  _syncSelectionUI(id = this.state.selectedId) {
    this.state.selectedId = id;
    const mod = this._selected();
    const d = this.dom;
    if (!mod) {
      d.inspectorEmpty.classList.remove('hidden');
      d.inspectorModule.classList.add('hidden');
      d.selectionBadge.textContent = 'NO SELECTION';
      d.selectionBadge.classList.remove('active');
      this.visualizer.updateSelectionClasses();
      return;
    }
    d.inspectorEmpty.classList.add('hidden');
    d.inspectorModule.classList.remove('hidden');
    d.selectionBadge.textContent = `${mod.type.toUpperCase()} SELECTED`;
    d.selectionBadge.classList.add('active');
    const def = MODULE_DEFS[mod.type];
    d.selectedName.textContent = (mod.title || def.code).toUpperCase();
    d.selectedType.textContent = `${mod.type} · ${mod.w} × ${mod.h}`;
    const swatchColor = mod.color || this.state.settings.accent;
    const swatchAlpha = mod.color ? (mod.colorAlpha ?? 1) : (this.state.settings.accentAlpha ?? 1);
    const swatchRgb = hexToRgb(swatchColor);
    d.selectedSwatch.style.background = `linear-gradient(rgba(${swatchRgb.r},${swatchRgb.g},${swatchRgb.b},${swatchAlpha}), rgba(${swatchRgb.r},${swatchRgb.g},${swatchRgb.b},${swatchAlpha})), repeating-conic-gradient(#24202a 0% 25%, #141118 0% 50%) 50% / 10px 10px`;
    d.selectedSwatch.style.borderColor = swatchColor;
    d.propX.value = mod.x;
    d.propY.value = mod.y;
    d.propW.value = mod.w;
    d.propH.value = mod.h;
    d.opacity.value = Math.round(mod.opacity * 100);
    d.opacityOut.textContent = `${Math.round(mod.opacity * 100)}%`;
    d.moduleVisible.checked = !mod.hidden;
    d.useGlobalColor.checked = !mod.color;
    this._syncModuleColorFields(mod);
    this._syncModuleOptions(mod);
    d.moduleAbout.textContent = def.about;
    this.visualizer.updateSelectionClasses();
  }

  _syncGeometryFields(mod) {
    if (!mod || mod.id !== this.state.selectedId) return;
    const d = this.dom;
    d.propX.value = mod.x; d.propY.value = mod.y;
    d.propW.value = mod.w; d.propH.value = mod.h;
    d.selectedType.textContent = `${mod.type} · ${mod.w} × ${mod.h}`;
  }

  _syncModuleColorFields(mod) {
    const d = this.dom;
    const color = mod.color || this.state.settings.accent;
    const alpha = mod.color ? (mod.colorAlpha ?? 1) : (this.state.settings.accentAlpha ?? 1);
    const rgb = hexToRgb(color);
    d.moduleColorSwatch?.style.setProperty('--swatch', `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
    if (d.moduleColorValue) d.moduleColorValue.textContent = `${color.toUpperCase()} · ${Math.round(alpha * 100)}%`;
    if (this._pickerTargetIs('module')) this._loadPickerFromColor(color, alpha);
  }

  _moduleOptionValue(mod, option) {
    const raw = mod.options?.[option.key];
    if (raw === undefined || raw === null || raw === '') return option.default;
    return raw;
  }

  _syncModuleOptions(mod) {
    const d = this.dom;
    if (!d.moduleOptions) return;
    const schema = MODULE_OPTIONS[mod.type] || [];
    const def = MODULE_DEFS[mod.type];
    d.moduleOptionsType.textContent = (def?.code || mod.type).toUpperCase();
    d.moduleOptionsHelp.textContent = schema.length
      ? '这类模块的独立参数；与布局一起自动保存。'
      : '这个模块暂时没有额外参数。';
    d.moduleOptions.innerHTML = schema.map((option) => {
      const value = this._moduleOptionValue(mod, option);
      if (option.type === 'toggle') {
        return `<label class="check-row compact"><input type="checkbox" data-opt-key="${option.key}" ${value ? 'checked' : ''}/><span>${option.label}</span></label>`;
      }
      if (option.type === 'select') {
        const opts = option.options.map(([val, label]) => `<option value="${val}" ${String(value) === String(val) ? 'selected' : ''}>${label}</option>`).join('');
        return `<label class="module-option-field"><span>${option.label}</span><select data-opt-key="${option.key}">${opts}</select></label>`;
      }
      const output = `${Math.round(Number(value))}${option.unit || ''}`;
      return `<div class="field-row module-option-range"><label class="field-label">${option.label} <output data-opt-output="${option.key}">${output}</output></label><input type="range" data-opt-key="${option.key}" min="${option.min}" max="${option.max}" step="${option.step}" value="${value}" /></div>`;
    }).join('');
  }

  _deleteSelected() {
    const mod = this._selected();
    if (!mod) return;
    const index = this.state.modules.indexOf(mod);
    this.state.modules = this.state.modules.filter((m) => m.id !== mod.id);
    this.visualizer.states.delete(mod.id);
    this.state.selectedId = null;
    this.visualizer.syncOverlay();
    this._syncSelectionUI(null);
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
    this._toast(`已移除 ${MODULE_DEFS[mod.type].name}`);
    void index;
  }

  _duplicateSelected() {
    const mod = this._selected();
    if (!mod) return;
    const copy = {
      ...mod,
      id: uid(mod.type),
      x: clamp(mod.x + 28, 0, STAGE_W - mod.w),
      y: clamp(mod.y + 28, 0, STAGE_H - mod.h),
      title: `${mod.title || MODULE_DEFS[mod.type].code} · COPY`,
    };
    this.state.modules.push(copy);
    this.state.selectedId = copy.id;
    this.visualizer.syncOverlay();
    this._syncSelectionUI(copy.id);
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
  }

  _layerSelected(direction) {
    const mod = this._selected();
    if (!mod) return;
    const from = this.state.modules.indexOf(mod);
    if (from < 0) return;
    const list = this.state.modules;
    list.splice(from, 1);
    const to = clamp(from + direction, 0, list.length);
    list.splice(to, 0, mod);
    this.visualizer.syncOverlay();
    this._persist();
  }

  _centerSelected(axis) {
    const mod = this._selected();
    if (!mod) return;
    if (axis === 'h') mod.x = Math.round((STAGE_W - mod.w) / 2);
    else mod.y = Math.round((STAGE_H - mod.h) / 2);
    this.visualizer.syncOverlay();
    this._syncGeometryFields(mod);
    this._persist();
  }

  _alignSelectedLeft() {
    const mod = this._selected();
    if (!mod) return;
    mod.x = 24;
    this.visualizer.syncOverlay();
    this._syncGeometryFields(mod);
    this._persist();
  }

  _applyPreset(name, silent = false) {
    const preset = LAYOUT_PRESETS[name];
    if (!preset) return;
    this.state.modules = preset.make();
    this.state.preset = name;
    this.state.selectedId = null;
    this.visualizer.states.clear();
    this.visualizer.select(null);
    this.visualizer.syncOverlay();
    this.visualizer._resize();
    this._renderLibrary();
    this._syncCanvasMeta();
    this._syncSelectionUI(null);
    $$('#settingsModal .preset-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === name);
    });
    this._persist();
    if (!silent) this._toast(`布局已切换 · ${preset.label}`);
  }

  _applyUiMode(mode, { silent = false, noPersist = false } = {}) {
    const value = ['auto', 'dark', 'light'].includes(mode) ? mode : 'auto';
    this.state.settings.uiMode = value;
    document.body.dataset.uiMode = value;
    $$('#settingsModal [data-ui-mode-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.uiModeBtn === value);
    });
    if (!noPersist) this._persist();
    if (!silent) {
      const label = value === 'dark' ? '深色模式' : value === 'light' ? '浅色模式' : '跟随主题';
      this._toast(`界面模式已切换 · ${label}`, 'info', 1300);
    }
  }

  _applyUiTheme(theme, { silent = false, noPersist = false } = {}) {
    if (theme === 'studio') theme = 'vidi';
    if (theme === 'aura') theme = 'catbot';
    const value = ['neon', 'vidi', 'catbot'].includes(theme) ? theme : 'neon';
    this.state.settings.uiTheme = value;
    document.body.dataset.uiTheme = value;
    $$('#settingsModal .theme-card[data-ui-theme]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.uiTheme === value);
    });
    if (!noPersist) this._persist();
    if (!silent) this._toast(`界面风格已切换 · ${value.toUpperCase()}`);
  }

  _applyUserPalette() {
    const s = this.state.settings;
    const bg = /^#[0-9a-fA-F]{6}$/.test(s.bgColor || '') ? s.bgColor : '#1a0b22';
    const accent = /^#[0-9a-fA-F]{6}$/.test(s.accent || '') ? s.accent : '#ff4f8b';
    const root = document.documentElement;
    const set = (name, value) => root.style.setProperty(name, value);
    set('--paper-bg', mixHex(bg, '#ffffff', 0.91));
    set('--paper-bg-2', mixHex(bg, '#ffffff', 0.86));
    set('--paper-head', mixHex(bg, '#ffffff', 0.83));
    set('--paper-panel', mixHex(bg, '#ffffff', 0.95));
    set('--paper-card', mixHex(bg, '#ffffff', 0.975));
    set('--paper-line', mixHex(bg, '#ffffff', 0.66));
    set('--paper-line-strong', mixHex(bg, '#ffffff', 0.5));
    set('--paper-accent-soft', mixHex(accent, '#ffffff', 0.8));
    set('--paper-accent-line', mixHex(accent, '#ffffff', 0.45));
    set('--paper-accent-contrast', luminance(mixHex(accent, '#ffffff', 0.45)) > 0.55 ? '#1d1630' : '#fff8fd');
    set('--ui-dark-bg', mixHex(bg, '#05030a', 0.74));
    set('--ui-dark-bg-2', mixHex(bg, '#08050d', 0.68));
    set('--ui-dark-head', mixHex(bg, '#0c0812', 0.64));
    set('--ui-dark-panel', mixHex(bg, '#0d0913', 0.62));
    set('--ui-dark-line', mixHex(bg, '#8d7a94', 0.24));
  }

  _applyAccent(hex, alpha = this.state.settings.accentAlpha ?? 1, { silent = false, noPersist = false } = {}) {
    const value = normalizeHexInput(hex);
    const a = clamp(Number(alpha), 0, 1);
    this.state.settings.accent = value;
    this.state.settings.accentAlpha = Number.isFinite(a) ? a : 1;
    const rgb = hexToRgb(value);
    const rgbaValue = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.state.settings.accentAlpha})`;
    const root = document.documentElement;
    root.style.setProperty('--accent', rgbaValue);
    root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--accent-solid', value);
    root.style.setProperty('--accent-contrast', luminance(value) > 0.4 ? '#160a12' : '#fff7fa');
    this._applyUserPalette();
    if (this.dom.footerAccentHex) {
      this.dom.footerAccentHex.textContent = `${value.toUpperCase()} · ${Math.round(this.state.settings.accentAlpha * 100)}%`;
    }
    if (this.dom.footerAccentDot) {
      this.dom.footerAccentDot.style.background = rgbaValue;
    }
    if (this.dom.accentSwatch) {
      this.dom.accentSwatch.style.setProperty('--swatch', rgbaValue);
    }
    if (this.dom.accentValue) {
      this.dom.accentValue.textContent = `${value.toUpperCase()} · ${Math.round(this.state.settings.accentAlpha * 100)}%`;
    }
    this.visualizer.applyBackgroundSettings();
    this._refreshBgPreview(true);
    if (this._selected()) this._syncSelectionUI();
    if (!noPersist) this._persist();
    if (!silent) {
      this._toast(`主题色已更新 · ${value.toUpperCase()} · ${Math.round(this.state.settings.accentAlpha * 100)}%`);
    }
  }

  _syncAccentInputs() {
    const value = this.state.settings.accent;
    const alpha = this.state.settings.accentAlpha ?? 1;
    const rgb = hexToRgb(value);
    const rgbaValue = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    if (this.dom.accentSwatch) this.dom.accentSwatch.style.setProperty('--swatch', rgbaValue);
    if (this.dom.accentValue) this.dom.accentValue.textContent = `${value.toUpperCase()} · ${Math.round(alpha * 100)}%`;
    if (this.dom.footerAccentHex) this.dom.footerAccentHex.textContent = `${value.toUpperCase()} · ${Math.round(alpha * 100)}%`;
    if (this.dom.footerAccentDot) this.dom.footerAccentDot.style.background = rgbaValue;
  }

  _setUiScale(value, { silent = false, noPersist = false } = {}) {
    const scale = clamp(Math.round(Number(value) || 100), 70, 150);
    this.state.settings.uiScale = scale;
    const root = document.getElementById('ui-root');
    if (root) {
      root.style.width = `${10000 / scale}%`;
      root.style.height = `${10000 / scale}%`;
      root.style.transform = `scale(${scale / 100})`;
    }
    if (this.dom.uiScale) this.dom.uiScale.value = String(scale);
    if (this.dom.uiScaleOut) this.dom.uiScaleOut.textContent = `${scale}%`;
    this._applyResponsiveUI();
    setTimeout(() => this.visualizer?._resize(), 30);
    if (!noPersist) this._persist();
    if (!silent) this._toast(`界面缩放 · ${scale}%`);
  }

  _applyResponsiveUI() {
    const root = document.getElementById('ui-root');
    if (!root) return;
    const scale = (this.state.settings.uiScale || 100) / 100;
    const effectiveWidth = window.innerWidth / scale;
    const effectiveHeight = window.innerHeight / scale;
    root.classList.toggle('ui-compact', effectiveWidth < 1280);
    root.classList.toggle('ui-tight', effectiveWidth < 1120);
    root.classList.toggle('ui-ultra', effectiveWidth < 960);
    root.classList.toggle('ui-short', effectiveHeight < 720);
    root.dataset.effectiveWidth = String(Math.round(effectiveWidth));
  }

  _pickerTargetIs(target) {
    return this._colorTarget === target;
  }

  _openColorPicker(target) {
    const mod = this._selected();
    if (target === 'module' && !mod) return;
    let color = this.state.settings.accent;
    let alpha = this.state.settings.accentAlpha ?? 1;
    if (target === 'module') {
      color = mod.color || this.state.settings.accent;
      alpha = mod.color ? (mod.colorAlpha ?? 1) : (this.state.settings.accentAlpha ?? 1);
    } else if (target === 'background') {
      color = this.state.settings.bgColor;
      alpha = this.state.settings.bgColorAlpha ?? 1;
    }
    this._colorTarget = target;
    this._loadPickerFromColor(color, alpha);
    this._openModal('color');
    this._renderColorField();
    this._syncColorPickerUI();
  }

  _loadPickerFromColor(hex, alpha = 1) {
    const value = normalizeHexInput(hex);
    const rgb = hexToRgb(value);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    this._picker = {
      h: hsv.h,
      s: hsv.s,
      v: hsv.v,
      a: clamp(Number(alpha), 0, 1),
      hex: value,
    };
  }

  _pickerRgb() {
    return hsvToRgb(this._picker.h, this._picker.s, this._picker.v);
  }

  _syncColorPickerUI() {
    const d = this.dom;
    if (!d.colorField) return;
    const rgb = this._pickerRgb();
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    this._picker.hex = hex;
    const a = this._picker.a;
    const rgbaValue = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    d.hueSlider.value = String(Math.round(this._picker.h));
    d.hueOut.textContent = `${Math.round(this._picker.h)}°`;
    d.alphaSlider.value = String(Math.round(a * 100));
    d.alphaOut.textContent = `${Math.round(a * 100)}%`;
    d.alphaSlider.style.background = `linear-gradient(90deg, rgba(${rgb.r},${rgb.g},${rgb.b},0), ${hex})`;
    d.colorR.value = rgb.r;
    d.colorG.value = rgb.g;
    d.colorB.value = rgb.b;
    d.colorA.value = Math.round(a * 100);
    d.colorHexLabel.textContent = hex;
    d.colorRgbaLabel.textContent = rgbaValue;
    d.colorPreview.style.setProperty('--swatch', rgbaValue);
    d.colorFieldCursor.style.left = `${this._picker.s * 100}%`;
    d.colorFieldCursor.style.top = `${(1 - this._picker.v) * 100}%`;
  }

  _renderColorField() {
    const canvas = this.dom.colorField;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const pure = hsvToRgb(this._picker.h, 1, 1);
    ctx.fillStyle = `rgb(${pure.r},${pure.g},${pure.b})`;
    ctx.fillRect(0, 0, w, h);
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, 'rgba(255,255,255,1)');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, h);
    const black = ctx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, h);
  }

  _bindColorPickerUI() {
    const d = this.dom;
    const setFromField = (e) => {
      const rect = d.colorFieldWrap.getBoundingClientRect();
      this._picker.s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      this._picker.v = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
      this._syncColorPickerUI();
    };
    let dragging = false;
    d.colorFieldWrap.addEventListener('pointerdown', (e) => {
      dragging = true;
      d.colorFieldWrap.setPointerCapture?.(e.pointerId);
      setFromField(e);
      e.preventDefault();
    });
    d.colorFieldWrap.addEventListener('pointermove', (e) => {
      if (dragging) setFromField(e);
    });
    const stop = (e) => {
      dragging = false;
      try { d.colorFieldWrap.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    d.colorFieldWrap.addEventListener('pointerup', stop);
    d.colorFieldWrap.addEventListener('pointercancel', stop);
    d.hueSlider.addEventListener('input', () => {
      this._picker.h = Number(d.hueSlider.value);
      this._renderColorField();
      this._syncColorPickerUI();
    });
    d.alphaSlider.addEventListener('input', () => {
      this._picker.a = clamp(Number(d.alphaSlider.value) / 100, 0, 1);
      this._syncColorPickerUI();
    });
    const readRgb = () => {
      this._picker.h = this._picker.h;
      const rgb = {
        r: clampByte(d.colorR.value),
        g: clampByte(d.colorG.value),
        b: clampByte(d.colorB.value),
      };
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      this._picker.s = hsv.s;
      this._picker.v = hsv.v;
      this._picker.h = hsv.h;
      this._renderColorField();
      this._syncColorPickerUI();
    };
    for (const input of [d.colorR, d.colorG, d.colorB]) input.addEventListener('change', readRgb);
    d.colorA.addEventListener('change', () => {
      this._picker.a = clamp(Number(d.colorA.value) / 100, 0, 1);
      this._syncColorPickerUI();
    });
    d.colorApplyBtn.addEventListener('click', () => {
      const rgb = this._pickerRgb();
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      const alpha = clamp(this._picker.a, 0, 1);
      if (this._colorTarget === 'accent') {
        this._applyAccent(hex, alpha);
      } else if (this._colorTarget === 'module') {
        const mod = this._selected();
        if (mod) {
          mod.color = hex;
          mod.colorAlpha = alpha;
          this._syncSelectionUI();
          this._persist();
        }
      } else if (this._colorTarget === 'background') {
        this.state.settings.bgColor = hex;
        this.state.settings.bgColorAlpha = alpha;
        this.state.settings.bgMode = 'color';
        this._applyUserPalette();
        this._syncBgModeUI();
        this._syncBgColorUI();
        this.visualizer.applyBackgroundSettings();
        this._refreshBgPreview(true);
        this._persist();
      }
      this._closeModal('color');
    });
  }

  _bindModuleMenuUI() {
    const menu = this.dom.moduleMenu;
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-menu-action]');
      if (!btn) return;
      this._runModuleMenuAction(btn.dataset.menuAction);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this._moduleMenuId) return;
      if (!e.target.closest('#moduleMenu')) this._closeModuleMenu();
    }, true);
    window.addEventListener('blur', () => this._closeModuleMenu());
    window.addEventListener('scroll', () => this._closeModuleMenu(), true);
  }

  _openModuleMenu(id, x, y) {
    if (!this.state.modules.some((m) => m.id === id)) return;
    this._moduleMenuId = id;
    const menu = this.dom.moduleMenu;
    menu.classList.remove('hidden');
    const scale = (this.state.settings.uiScale || 100) / 100;
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = clamp(x / scale, 8, window.innerWidth / scale - menuWidth - 8);
    const top = clamp(y / scale, 8, window.innerHeight / scale - menuHeight - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this._refreshKeybindLabels?.();
  }

  _closeModuleMenu() {
    this._moduleMenuId = null;
    this.dom.moduleMenu?.classList.add('hidden');
  }

  _runModuleMenuAction(action) {
    const mod = this.state.modules.find((m) => m.id === this._moduleMenuId);
    this._closeModuleMenu();
    if (!mod) return;
    this.state.selectedId = mod.id;
    this.visualizer.select(mod.id);
    switch (action) {
      case 'duplicate': this._duplicateSelected(); break;
      case 'hide':
        mod.hidden = true;
        this.state.selectedId = null;
        this.visualizer.syncOverlay();
        this._syncSelectionUI(null);
        this._renderLibrary();
        this._syncCanvasMeta();
        this._persist();
        break;
      case 'solo':
        this.state.modules.forEach((m) => { m.hidden = m.id !== mod.id; });
        this.visualizer.syncOverlay();
        this._renderLibrary();
        this._syncCanvasMeta();
        this._persist();
        break;
      case 'show_all':
        this.state.modules.forEach((m) => { m.hidden = false; });
        this.visualizer.syncOverlay();
        this._renderLibrary();
        this._syncCanvasMeta();
        this._persist();
        break;
      case 'center_h': this._centerSelected('h'); break;
      case 'center_v': this._centerSelected('v'); break;
      case 'reset_size': {
        const def = MODULE_DEFS[mod.type];
        mod.w = Math.min(STAGE_W, def.w);
        mod.h = Math.min(STAGE_H, def.h);
        mod.x = clamp(mod.x, 0, STAGE_W - mod.w);
        mod.y = clamp(mod.y, 0, STAGE_H - mod.h);
        this.visualizer.syncOverlay();
        this._syncGeometryFields(mod);
        this._persist();
        break;
      }
      case 'layer_up': this._layerSelected(1); break;
      case 'layer_down': this._layerSelected(-1); break;
      case 'delete': this._deleteSelected(); break;
      default: break;
    }
  }

  _syncSettingsUI() {
    const s = this.state.settings;
    const d = this.dom;
    this.dom.stageOverlay.classList.toggle('editing-off', !s.editing);
    d.snapBtn.classList.toggle('active', s.snap);
    d.editBtn.classList.toggle('active', s.editing);
    d.loopBtn.classList.toggle('active', s.loop);
    d.loopBtn.style.color = s.loop ? 'var(--accent)' : '';
    d.volume.value = s.volume;
    d.glow.value = s.glow;
    d.glowOut.textContent = `${s.glow}%`;
    d.moduleTint.checked = s.moduleTint;
    d.bgDim.value = s.bgDim;
    d.dimOut.textContent = `${s.bgDim}%`;
    d.bgBlur.value = s.bgBlur;
    d.blurOut.textContent = `${s.bgBlur}px`;
    d.bgContain.checked = s.bgContain;
    d.bgEnergy.value = s.bgEnergy;
    d.bgEnergyOut.textContent = `${s.bgEnergy}%`;
    d.sensitivity.value = s.sensitivity;
    d.sensitivityOut.textContent = `${s.sensitivity}%`;
    d.smoothing.value = s.smoothing;
    d.smoothingOut.textContent = `${s.smoothing}%`;
    d.watermarkToggle.checked = s.watermark;
    d.scanlineToggle.checked = s.scanlines;
    d.autoSave.checked = s.autoSave;
    d.uiScale.value = s.uiScale;
    d.uiScaleOut.textContent = `${s.uiScale}%`;
    d.bgMotion.value = s.bgMotion;
    d.bgMotionDirection.value = s.bgMotionDirection;
    d.bgMotionAmount.value = s.bgMotionAmount;
    d.bgMotionAmountOut.textContent = `${s.bgMotionAmount}%`;
    d.bgMotionSpeed.value = s.bgMotionSpeed;
    d.bgMotionSpeedOut.textContent = `${s.bgMotionSpeed}%`;
    d.exportFadeIn.value = s.exportFadeIn;
    d.exportFadeInOut.textContent = `${Number(s.exportFadeIn).toFixed(1)}s`;
    d.exportFadeOut.value = s.exportFadeOut;
    d.exportFadeOutOut.textContent = `${Number(s.exportFadeOut).toFixed(1)}s`;
    d.exportPulse.value = s.exportPulse;
    d.exportPulseOut.textContent = `${s.exportPulse}%`;
    this._applyUiTheme(s.uiTheme, { silent: true, noPersist: true });
    this._applyUiMode(s.uiMode, { silent: true, noPersist: true });
    this._syncBgModeUI();
    this._syncRendererUI();
    this._syncWatermark();
    this._syncCanvasMeta();
    this.audio.setSensitivity(s.sensitivity);
    this.audio.setSmoothing(s.smoothing);
    this.audio.setLoop(s.loop);
    d.footerEngine.textContent = s.rendererMode === 'gpu' ? 'WEBGL + CANVAS2D' : 'CANVAS2D / CPU';
    this._syncAccentInputs();
    this._syncBgColorUI();
    this._refreshKeybindLabels?.();
    $$('#settingsModal .preset-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === this.state.preset);
    });
    this.dom.exportPresetLabel.textContent = this._exportPresetLabel();
    if (this.dom.savePathInput) this.dom.savePathInput.value = s.savePath || '';
    if (this.dom.exportPathInput) this.dom.exportPathInput.value = s.exportPath || '';
    this._applyTimelineOpen(s.timelineOpen !== false, { silent: true });
  }

  _syncBgColorUI() {
    const s = this.state.settings;
    this._applyUserPalette();
    const rgb = hexToRgb(s.bgColor || s.accent);
    const alpha = s.bgColorAlpha ?? 1;
    if (this.dom.bgColorSwatch) {
      this.dom.bgColorSwatch.style.setProperty('--swatch', `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
    }
    if (this.dom.bgColorValue) {
      this.dom.bgColorValue.textContent = `${(s.bgColor || s.accent).toUpperCase()} · ${Math.round(alpha * 100)}%`;
    }
  }

  _syncBgModeUI() {
    const s = this.state.settings;
    for (const btn of this.dom.bgMode.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.mode === s.bgMode);
    }
    this.dom.bgImageControls.classList.toggle('hidden', s.bgMode !== 'image');
    this.dom.bgColorControls.classList.toggle('hidden', s.bgMode !== 'color');
    this.dom.bgPreviewLabel.textContent = s.bgMode === 'image'
      ? 'IMAGE BACKGROUND'
      : s.bgMode === 'color'
        ? 'SOLID COLOR'
        : (s.rendererMode === 'gpu' ? 'GPU SHADER · PLASMA' : 'CPU PLASMA FALLBACK');
  }

  _syncRendererUI() {
    const s = this.state.settings;
    for (const btn of this.dom.rendererMode.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.renderer === s.rendererMode);
    }
  }

  _setBgMode(mode) {
    this.state.settings.bgMode = mode;
    this.visualizer?.applyBackgroundSettings();
    this._syncBgModeUI();
    this._refreshBgPreview(true);
    this._persist();
  }

  async _loadBackgroundFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      this._toast('请选择图片文件', 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (this.bgImageUrl) URL.revokeObjectURL(this.bgImageUrl);
      this.bgImageUrl = url;
      this.bgImage = img;
      this.visualizer.setBackgroundImage(img, { name: file.name });
      this.state.settings.bgMode = 'image';
      this.visualizer.applyBackgroundSettings();
      this._syncBgModeUI();
      this._refreshBgPreview(true);
      this._persist();
      this._storeBackgroundImage(img);
      this._storeBackgroundThumbnail(img);
      if (this._standaloneSettings && this._isNative) {
        try {
          const max = 2560;
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          const scale = Math.min(1, max / Math.max(iw, ih));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(2, Math.round(iw * scale));
          canvas.height = Math.max(2, Math.round(ih * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          window.chrome.webview.postMessage({ action: 'background-image', dataUrl, name: file.name });
        } catch (err) {
          console.warn('[NEON//SCOPE] Background bridge failed:', err);
        }
      }
      this._toast(`背景图片已载入 · ${file.name}`, 'success');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._toast('无法读取该图片', 'error');
    };
    img.src = url;
  }

  _removeBackground() {
    if (this.bgImageUrl) URL.revokeObjectURL(this.bgImageUrl);
    this.bgImageUrl = null;
    this.bgImage = null;
    this.visualizer.setBackgroundImage(null);
    this.state.settings.bgMode = 'plasma';
    this.visualizer.applyBackgroundSettings();
    this._syncBgModeUI();
    this._refreshBgPreview(true);
    this._persist();
    try {
      localStorage.removeItem(BG_PREVIEW_KEY);
      localStorage.removeItem(BG_IMAGE_KEY);
    } catch { /* noop */ }
    this._toast('已移除背景图片');
  }

  _refreshBgPreview(force = false) {
    if (!force && (this.dom.settingsModal.classList.contains('hidden') || this._settingsTab !== 'background')) return;
    const canvas = this.dom.bgPreviewCanvas;
    if (!canvas || !canvas.clientWidth) return;
    try {
      this.visualizer.applyBackgroundSettings();
      const t = this._frame?.time || performance.now() / 1000;
      this.visualizer.background.drawPreview(
        canvas,
        canvas.clientWidth,
        canvas.clientHeight,
        performance.now() / 1000,
        this._frame?.energy || 0,
        this._frame?.beatPulse || 0,
      );
      void t;
    } catch (e) { /* preview is optional */ }
  }

  _openExport() {
    if (!this.audio.hasAudio) {
      this._toast('请先载入音频再导出视频', 'error');
      return;
    }
    if (this.state.exporting) return;
    this.dom.exportSetup.classList.remove('hidden');
    this.dom.exportProgress.classList.add('hidden');
    this.dom.startExportBtn.classList.remove('hidden');
    this._syncExportUI();
    this._openModal('export');
  }

  _exportPresetLabel() {
    const q = EXPORT_QUALITIES[this.exportSettings.quality] || EXPORT_QUALITIES[1080];
    return `${q.label} · ${this.exportSettings.fps}FPS`;
  }

  _syncExportUI() {
    const es = this.exportSettings;
    const q = EXPORT_QUALITIES[es.quality] || EXPORT_QUALITIES[1080];
    const d = this.dom;
    for (const btn of d.qualityGrid.querySelectorAll('button[data-quality]')) {
      btn.classList.toggle('active', Number(btn.dataset.quality) === es.quality);
    }
    for (const btn of d.fpsSeg.querySelectorAll('button[data-fps]')) {
      btn.classList.toggle('active', Number(btn.dataset.fps) === es.fps);
    }
    for (const btn of d.formatSeg.querySelectorAll('button[data-format]')) {
      btn.classList.toggle('active', btn.dataset.format === es.format);
    }
    d.bitrateSelect.value = String(es.bitrate);
    d.rangeSelect.value = es.range;
    d.exportSummaryQuality.textContent = `${q.w} × ${q.h} · ${es.fps} FPS`;
    const duration = this._exportDuration();
    d.exportSummaryDuration.textContent = formatShortTime(duration);
    const bytes = (es.bitrate * 1_000_000 / 8 + 192_000 / 8) * duration;
    d.exportSummarySize.textContent = humanBytes(bytes);
    d.exportSummaryEncoder.textContent = es.format === 'mp4' ? 'H.264 / AAC · NATIVE' : 'VP9 / OPUS · WEBM';
    d.exportPresetLabel.textContent = this._exportPresetLabel();
    const warning = [];
    if (es.format === 'mp4' && !this.state.ffmpegAvailable) {
      warning.push('当前浏览器支持时直接录制 MP4；若编码不可用，则需要 FFmpeg 转码。');
    }
    if (es.quality === 2160) warning.push('4K 实时录制对 GPU/CPU 压力较大，建议保持页面在前台。');
    d.exportWarning.textContent = warning.join(' ');
    d.exportWarning.classList.toggle('hidden', warning.length === 0);
  }

  _exportDuration() {
    let duration = this.audio.duration || 0;
    if (this.exportSettings.range !== 'full') {
      duration = Math.min(duration, Number(this.exportSettings.range) || duration);
    }
    return Math.max(0, duration);
  }

  async _startExport() {
    if (this.state.exporting) return;
    if (!this.audio.hasAudio) { this._toast('没有可导出的音频', 'error'); return; }
    const q = EXPORT_QUALITIES[this.exportSettings.quality] || EXPORT_QUALITIES[1080];
    const duration = this._exportDuration();
    if (duration < 0.5) { this._toast('音频过短，无法导出', 'error'); return; }
    this.state.exporting = true;
    document.body.classList.add('exporting');
    this.dom.startOverlay.classList.add('dismissed');
    this.dom.exportSetup.classList.add('hidden');
    this.dom.exportProgress.classList.remove('hidden');
    this.dom.startExportBtn.classList.add('hidden');
    this.dom.exportVeil.classList.remove('hidden');
    this.dom.exportVeilTime.textContent = '00:00';
    this.dom.progressFill.style.width = '0%';
    this.dom.progressPercent.textContent = '0%';
    this.dom.progressTime.textContent = `00:00 / ${formatShortTime(duration)}`;
    this.dom.progressTitle.textContent = '正在初始化渲染管线…';
    this.dom.progressHint.textContent = '请保持此标签页处于前台，录制期间请勿切换窗口。';
    this.dom.cancelExportBtn.disabled = false;
    this.audio.stop();

    const trackName = this.audio.track?.name || 'neon-scope';
    const filename = `${sanitizeFilename(trackName)}-neon-scope`;
    this._exporter = new VideoExporter({
      visualizer: this.visualizer,
      engine: this.audio,
      onProgress: (p) => {
        const percent = clamp(p.percent || 0, 0, 1);
        this.dom.progressFill.style.width = `${(percent * 100).toFixed(1)}%`;
        this.dom.progressPercent.textContent = `${Math.round(percent * 100)}%`;
        this.dom.progressTime.textContent = `${formatShortTime(p.time || 0)} / ${formatShortTime(p.duration || duration)}`;
        this.dom.progressTitle.textContent = p.phase === 'converting' ? '正在封装 MP4…' : p.phase === 'finalizing' ? '正在完成视频编码…' : '正在录制画布与音频…';
        this.dom.progressHint.textContent = p.message || '';
        this.dom.exportVeilTime.textContent = formatShortTime(p.time || 0);
      },
    });

    let result = null;
    try {
      result = await this._exporter.start({
        width: q.w,
        height: q.h,
        fps: this.exportSettings.fps,
        bitrateMbps: this.exportSettings.bitrate,
        format: this.exportSettings.format,
        range: this.exportSettings.range,
        filename,
      });
      if (result?.cancelled) {
        this._toast('已取消导出');
      } else if (result?.blob) {
        downloadBlob(result.blob, result.filename);
        const note = result.note ? ` · ${result.note}` : '';
        this._toast(`导出完成 · ${result.filename}${note}`, 'success', 5200);
      }
    } catch (err) {
      console.error(err);
      this._toast(`导出失败：${err.message}`, 'error', 6000);
    } finally {
      this.state.exporting = false;
      document.body.classList.remove('exporting');
      this.dom.exportVeil.classList.add('hidden');
      this.visualizer.setExportMode(false);
      this.audio.stop();
      this._exporter = null;
      this.dom.cancelExportBtn.disabled = false;
      this.dom.exportSetup.classList.remove('hidden');
      this.dom.exportProgress.classList.add('hidden');
      this.dom.startExportBtn.classList.remove('hidden');
      this._closeModal('export');
      this._updateTransport(0);
      this._setEngineStatus(this.audio.hasAudio ? '引擎就绪' : '等待信号', this.audio.hasAudio ? 'ready' : '');
      this._syncExportUI();
    }
  }

  _toggleFocus() {
    document.body.classList.toggle('focus-mode');
    const focus = document.body.classList.contains('focus-mode');
    this.dom.theaterBtn.textContent = focus ? 'EXIT' : 'FOCUS';
    setTimeout(() => this.visualizer._resize(), 30);
    if (focus) this._toast('专注预览 · 按 F 或 ESC 退出');
  }

  _modalElement(name) {
    if (name === 'export') return this.dom.exportModal;
    if (name === 'help') return this.dom.helpModal;
    if (name === 'settings') return this.dom.settingsModal;
    if (name === 'shortcuts') return this.dom.shortcutsModal;
    if (name === 'color') return this.dom.colorModal;
    return null;
  }

  _openModal(name) {
    const modal = this._modalElement(name);
    if (!modal) return;
    if (!this._modalStack.includes(name)) this._modalStack.push(name);
    this._activeModal = name;
    modal.classList.remove('hidden');
    modal.style.zIndex = String(100 + this._modalStack.length * 10);
    if (name === 'export') this._syncExportUI();
    if (name === 'settings') {
      this._syncSettingsUI();
      this._switchSettingsTab(this._settingsTab);
    }
  }

  _closeModal(name) {
    if (!name) return;
    if (name === 'export' && this.state.exporting) return;
    if (name === 'shortcuts' && this._keyCapture) this._cancelKeyCapture();
    if (name === 'settings' && this._standaloneSettings) {
      if (this.state.settings.autoSave) this._saveNow();
      if (this._isNative) window.chrome.webview.postMessage({ action: 'close-settings' });
      return;
    }
    const modal = this._modalElement(name);
    if (!modal) return;
    modal.classList.add('hidden');
    this._modalStack = this._modalStack.filter((item) => item !== name);
    this._activeModal = this._modalStack[this._modalStack.length - 1] || null;
  }

  _openSettings() {
    if (this._isNative && !this._standaloneSettings) {
      window.chrome.webview.postMessage({ action: 'open-settings' });
      return;
    }
    this._openModal('settings');
    this._syncSettingsUI();
  }

  async _checkHealth() {
    if (location.protocol === 'file:') {
      this.dom.footerFfmpeg.textContent = 'NEEDS SERVER';
      return;
    }
    const info = await checkFfmpeg();
    this.state.ffmpegAvailable = info.ok;
    this.dom.footerFfmpeg.textContent = info.ok ? 'READY · MP4' : 'WEBM ONLY';
    this.dom.footerFfmpeg.style.color = info.ok ? 'var(--lime)' : 'var(--muted)';
    this._syncExportUI();
  }

  _persist() {
    if (!this.state.settings.autoSave) return;
    this._saveDebounced();
  }

  _saveDebounced() {
    if (!this._saveLater) {
      this._saveLater = debounce(() => this._saveNow(), 260);
    }
    this._saveLater();
  }

  _saveNow() {
    if (this._skipUnloadSave) return;
    if (!this.state.settings.autoSave) return;
    if (this._standaloneSettings) {
      const syncPayload = {
        version: 1,
        settings: this.state.settings,
        keybinds: this.keybinds,
      };
      safeStore(SETTINGS_SYNC_KEY, JSON.stringify(syncPayload));
      if (this._isNative) {
        window.chrome.webview.postMessage({
          action: 'settings-updated',
          settings: this.state.settings,
          keybinds: this.keybinds,
        });
      }
      return;
    }
    const payload = {
      version: 1,
      settings: this.state.settings,
      modules: this.state.modules,
      preset: this.state.preset,
      keybinds: this.keybinds,
      panelState: this.panelState,
      subpanelState: this.subpanelState,
      info: this.state.info,
      animationCues: this.state.animationCues,
      exportSettings: this.exportSettings,
    };
    safeStore(STORAGE_KEY, JSON.stringify(payload));
  }

  _toast(message, type = '', timeout = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    this.dom.toastStack.appendChild(el);
    while (this.dom.toastStack.children.length > 4) this.dom.toastStack.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }, timeout);
  }
}

function formatCueTime(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function parseCueTime(value) {
  const m = String(value || '').match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!m) return NaN;
  const frac = m[3] ? Number(`0.${m[3].padEnd(3, '0')}`) : 0;
  return Number(m[1]) * 60 + Number(m[2]) + frac;
}

function parseAnimationScript(text) {
  const cues = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const match = line.match(/^(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\s+([a-zA-Z]+)\s*(.*)$/);
    if (!match) continue;
    const time = parseCueTime(match[1]);
    if (!Number.isFinite(time)) continue;
    const type = match[2].toLowerCase();
    const rest = match[3].trim();
    const tokens = {};
    const tokenRe = /([a-zA-Z_]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
    let firstBare = '';
    let tm;
    while ((tm = tokenRe.exec(rest))) {
      const key = tm[1];
      const value = tm[2] ?? tm[3] ?? tm[4];
      if (value === undefined) { if (!firstBare) firstBare = key; continue; }
      tokens[key] = value;
    }
    const num = (key, fallback) => Number.isFinite(Number(tokens[key])) ? Number(tokens[key]) : fallback;
    const rawDuration = num('duration', num('hold', 1));
    const duration = Math.max(0, rawDuration);
    const base = { id: uid('cue'), time, duration, type, value: '', params: {} };
    if (type === 'effect') {
      base.type = 'effect';
      base.params.effect = tokens.effect || firstBare || 'blur';
      base.params.amount = num('amount', 35);
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.effect;
    } else if (type === 'text' || type === 'subtitle') {
      base.type = type === 'subtitle' ? 'subtitle' : 'text';
      base.params.text = tokens.text ?? tokens.value ?? rest.replace(/[a-zA-Z_]+=(?:"[^"]*"|'[^']*'|[^\s]+)/g, '').trim();
      base.params.x = num('x', 0.5);
      base.params.y = num('y', type === 'subtitle' ? 0.88 : 0.5);
      base.params.size = num('size', 26);
      base.params.align = tokens.align || 'center';
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.text || '';
    } else if (type === 'mash') {
      base.type = 'mash';
      base.params.title = tokens.title || 'Title';
      base.params.author = tokens.author || 'Artist';
      base.params.origin = tokens.origin || 'Origin';
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.title;
    } else if (type === 'color') {
      base.type = 'color';
      base.params.bg = tokens.bg || '#DCDCE8';
      base.params.primary = tokens.primary || '#0F1C4A';
      base.params.accent = tokens.accent || '#DE9FCA';
      base.params.ink = tokens.ink || '#0a0a0a';
      base.duration = Math.max(0, base.duration);
      base.value = base.params.accent;
    } else if (type === 'bpm') {
      base.type = 'bpm';
      base.params.bpm = num('bpm', Number(rest) || 120);
      base.duration = Math.max(0.1, num('duration', 0.35));
      base.value = String(base.params.bpm);
    } else if (['flash', 'tint', 'fade'].includes(type)) {
      base.type = type;
      base.value = tokens.color || tokens.value || '';
    } else {
      continue;
    }
    cues.push(base);
  }
  return cues.sort((a, b) => a.time - b.time);
}

function serializeAnimationCues(cues) {
  return (cues || []).slice().sort((a, b) => a.time - b.time).map((cue) => {
    const t = formatCueTime(cue.time);
    const p = cue.params || {};
    if (cue.type === 'effect') {
      return `${t} effect ${p.effect || 'blur'} duration=${Number(cue.duration).toFixed(2)} amount=${p.amount ?? 35}`;
    }
    if (cue.type === 'text' || cue.type === 'subtitle') {
      const text = p.text ?? cue.value ?? 'Text overlay';
      return `${t} ${cue.type} text="${String(text).replace(/"/g, '\\"')}" duration=${Number(cue.duration).toFixed(2)} x=${p.x ?? 0.5} y=${p.y ?? (cue.type === 'subtitle' ? 0.88 : 0.5)} size=${p.size ?? 26} align=${p.align || 'center'}`;
    }
    if (cue.type === 'mash') {
      return `${t} mash title="${String(p.title || cue.value || 'Title').replace(/"/g, '\\"')}" author="${String(p.author || 'Artist').replace(/"/g, '\\"')}" origin="${String(p.origin || 'Origin').replace(/"/g, '\\"')}" hold=${Number(cue.duration).toFixed(2)}`;
    }
    if (cue.type === 'color') {
      return `${t} color bg=${p.bg || '#DCDCE8'} primary=${p.primary || '#0F1C4A'} accent=${p.accent || '#DE9FCA'} ink=${p.ink || '#0a0a0a'} duration=${Number(cue.duration).toFixed(2)}`;
    }
    if (cue.type === 'bpm') return `${t} bpm ${p.bpm ?? cue.value ?? 120}`;
    return `${t} ${cue.type}${cue.value ? ` text="${String(cue.value).replace(/"/g, '\\"')}"` : ''} duration=${Number(cue.duration).toFixed(2)}`;
  }).join('\n');
}

function boot() {
  try {
    ensureUiRoot();
    window.neonScope = new NeonScopeApp();
  } catch (err) {
    console.error(err);
    const body = document.body;
    body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;background:#08040d;color:#f6e3ea;font-family:Segoe UI,sans-serif;padding:32px;">
      <div style="max-width:560px;border:1px solid rgba(255,79,139,.35);border-radius:12px;padding:28px;background:rgba(20,12,25,.9);">
        <div style="font:10px monospace;letter-spacing:.18em;color:#ff4f8b;margin-bottom:10px;">NEON//SCOPE · BOOT FAILURE</div>
        <h1 style="font-size:22px;margin:0 0 12px;">无法启动可视化工作台</h1>
        <p style="font-size:13px;line-height:1.8;color:#a68d9a;">${String(err.message || err)}</p>
        <p style="font-size:12px;line-height:1.8;color:#7f6875;">建议使用最新版 Chrome / Edge，并确认通过本地服务器启动（双击“启动 NEON SCOPE.bat”）。</p>
      </div>
    </div>`;
  }
}

boot();
