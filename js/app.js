import {
  STAGE_W, STAGE_H, MODULE_DEFS, MODULE_ORDER, DEFAULT_SETTINGS,
  EXPORT_QUALITIES, LAYOUT_PRESETS, makeStudioLayout, makeScopeLayout, makeMinimalLayout,
  createModule, uid, hexToRgb, rgbToHex, mixHex, resolveThemeColors, luminance, normalizeHexInput, clamp, formatTime, formatTC,
  AUTOMATION_PROPERTIES, automationValueAt,
  formatShortTime, humanBytes, safeRead, safeStore, safeParse, debounce,
} from './core.js';
import { AudioEngine } from './audio.js';
import { createDemoTrack } from './demo.js';
import { parseMidi } from './midi.js';
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
  { id: 'toggle_timeline', label: '显示 / 收起时间轴', code: 'TIMELINE', group: '窗口', default: 'KeyT' },
  { id: 'toggle_keyframes', label: '显示关键帧管理总线', code: 'KEYFRAMES', group: '窗口', default: 'KeyK' },
  { id: 'add_action', label: '添加动画动作', code: 'ADD ACTION', group: '动画', default: 'KeyA' },
  { id: 'open_stage_window', label: '打开独立舞台窗口', code: 'STAGE', group: '窗口', default: 'F3' },
  { id: 'reset_panels', label: '恢复默认面板布局', code: 'RESET LAYOUT', group: '窗口', default: 'Ctrl+Shift+KeyR' },
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
    { key: 'speed', label: '滚动速度', type: 'range', min: 50, max: 250, step: 5, default: 100, unit: '%' },
    { key: 'noteStyle', label: '音符样式', type: 'select', default: 'rect', options: [['rect', '长方形'], ['rounded', '圆角长方形']] },
    { key: 'allTrackColor', label: '统一轨道颜色', type: 'toggle', default: false },
    { key: 'globalTrackColor', label: '统一颜色', type: 'color', default: '#ffc46b' },
    { key: 'noteThickness', label: '音符厚度', type: 'range', min: 50, max: 200, step: 5, default: 100, unit: '%' },
    { key: 'centerY', label: '垂直中心', type: 'range', min: 0, max: 100, step: 5, default: 50, unit: '%' },
    { key: 'vibrato', label: 'Vibrato', type: 'range', min: 0, max: 100, step: 5, default: 0, unit: '%' },
    { key: 'trackDepth', label: '单轨道深度', type: 'range', min: 0, max: 100, step: 5, default: 55, unit: '%' },
    { key: 'grid', label: '节拍网格', type: 'toggle', default: true },
    { key: 'labels', label: '音名标签', type: 'toggle', default: true },
    { key: 'showTitle', label: '显示标题', type: 'toggle', default: true },
    { key: 'title', label: '标题文字', type: 'text', default: '' },
    { key: 'titlePosition', label: '标题位置', type: 'select', default: 'topLeft', options: [['topLeft', '左上'], ['topCenter', '顶部居中'], ['topRight', '右上']] },
    { key: 'titleColor', label: '标题颜色', type: 'color', default: '#C7F8FF' },
    { key: 'titleSize', label: '标题字号', type: 'range', min: 12, max: 64, step: 1, default: 40, unit: 'px' },
    { key: 'titleFont', label: '标题字体', type: 'select', default: 'Bahnschrift', options: [['Bahnschrift', 'Bahnschrift'], ['Segoe UI', 'Segoe UI'], ['Microsoft YaHei UI', '微软雅黑'], ['Georgia', 'Georgia'], ['Cascadia Code', 'Cascadia Code']] },
    { key: 'titleAnimation', label: '标题动画', type: 'select', default: 'slide', options: [['none', '无'], ['slide', '滑入'], ['fade', '淡入']] },
    { key: 'showChords', label: '显示和弦', type: 'toggle', default: true },
    { key: 'chordColor', label: '和弦颜色', type: 'color', default: '#9DDBFF' },
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
  basicInfo: [
    { key: 'primaryColor', label: '主字体颜色', type: 'color', default: '#101a3b' },
    { key: 'secondaryColor', label: '次字体颜色', type: 'color', default: '#6d6782' },
    { key: 'cardBg', label: '背景颜色', type: 'color', default: '#eeebf4' },
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
      midiLayers: [],
      preset: 'studio',
      info: { title: '', artist: '', composer: '', album: '', genre: '', bpm: '', trackNo: '', cover: '', show: false },
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
    this.timelineState = { floating: false, x: null, y: null, w: null, h: null, height: 220, labelWidth: 148 };
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
    this._applyThemePalette({ silent: true, noPersist: true });
    this._applyUiTheme(this.state.settings.uiTheme, { silent: true, noPersist: true });
    this._applyUiMode(this.state.settings.uiMode, { silent: true, noPersist: true });
    this._applyUiFont(this.state.settings.uiFont, { silent: true, noPersist: true });
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
      for (const key of ['themeBg', 'themeWindow', 'themeText', 'themeChart']) {
        if (!/^#[0-9a-fA-F]{6}$/.test(s[key] || '')) s[key] = DEFAULT_SETTINGS[key];
      }
      if (!['custom', 'bg', 'primary', 'accent'].includes(s.themeChartFollow)) s.themeChartFollow = 'custom';
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
      if (!['default', 'Bahnschrift', 'Segoe UI', 'Microsoft YaHei UI', 'Georgia', 'Arial', 'Times New Roman', 'Cascadia Code', 'Consolas'].includes(s.uiFont)) s.uiFont = 'default';
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
      this._applyThemePalette({ silent: true, noPersist: true });
      this._applyUiTheme(s.uiTheme, { silent: true, noPersist: true });
      this._applyUiMode(s.uiMode, { silent: true, noPersist: true });
      this._applyUiFont(s.uiFont, { silent: true, noPersist: true });
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
      themeBg: $('#themeBg'), themeWindow: $('#themeWindow'), themeText: $('#themeText'), themeChart: $('#themeChart'),
      themeChartFollow: $('#themeChartFollow'),
      glow: $('#glow'), glowOut: $('#glowOut'),
      bgMode: $('#bgMode'), bgPreviewCanvas: $('#bgPreviewCanvas'),
      bgPreviewLabel: $('#bgPreviewLabel'), bgUploadBtn: $('#bgUploadBtn'), bgImageControls: $('#bgImageControls'),
      bgColorControls: $('#bgColorControls'), bgColorPickBtn: $('#bgColorPickBtn'), bgColorSwatch: $('#bgColorSwatch'),
      bgColorValue: $('#bgColorValue'),
      bgDim: $('#bgDim'), dimOut: $('#dimOut'), bgBlur: $('#bgBlur'), blurOut: $('#blurOut'),
      bgContain: $('#bgContain'), removeBgBtn: $('#removeBgBtn'), bgEnergy: $('#bgEnergy'), bgEnergyOut: $('#bgEnergyOut'),
      rendererMode: $('#rendererMode'), sensitivity: $('#sensitivity'), sensitivityOut: $('#sensitivityOut'),
      smoothing: $('#smoothing'), smoothingOut: $('#smoothingOut'), watermarkToggle: $('#watermarkToggle'),
      scanlineToggle: $('#scanlineToggle'), resetLayoutBtn: $('#resetLayoutBtn'),
      uiScale: $('#uiScale'), uiScaleOut: $('#uiScaleOut'), uiFont: $('#uiFont'), uiFontReset: $('#uiFontReset'),
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
      infoTitle: $('#infoTitle'), infoArtist: $('#infoArtist'), infoComposer: $('#infoComposer'),
      infoAlbum: $('#infoAlbum'), infoGenre: $('#infoGenre'), infoBpm: $('#infoBpm'), infoTrackNo: $('#infoTrackNo'),
      infoCoverBtn: $('#infoCoverBtn'),
      infoCoverFile: $('#infoCoverFile'), infoCoverPreview: $('#infoCoverPreview'), infoOverlay: $('#infoOverlay'),
      animOpenBuilder: $('#animOpenBuilder'), animCueList: $('#animCueList'), animClearBtn: $('#animClearBtn'),
      actionBuilderModal: $('#actionBuilderModal'), actionBuilderTitle: $('#actionBuilderTitle'), actionBuilderType: $('#actionBuilderType'),
      actionBuilderTime: $('#actionBuilderTime'), actionBuilderFields: $('#actionBuilderFields'),
      actionBuilderPreview: $('#actionBuilderPreview'), actionBuilderInsert: $('#actionBuilderInsert'),
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
      timelineFloatBtn: $('#timelineFloatBtn'), timelineSplitter: $('#timelineSplitter'), timelineResizer: $('#timelineResizer'),
      stageTimelineSplitter: $('#stageTimelineSplitter'), stageDetachBtn: $('#stageDetachBtn'),
      stageWindowView: $('#stageWindowView'), stageMirrorCanvas: $('#stageMirrorCanvas'),
      timelineMenu: $('#timelineMenu'), keyframeMenu: $('#keyframeMenu'), keyframePanel: $('#keyframePanel'), keyframeList: $('#keyframeList'),
      midiBusPanel: $('#midiBusPanel'), midiBusList: $('#midiBusList'), midiBusCount: $('#midiBusCount'), midiBusImportBtn: $('#midiBusImportBtn'),
      aboutDeveloperBtn: $('#aboutDeveloperBtn'), aboutLicensesBtn: $('#aboutLicensesBtn'), aboutRepositoryBtn: $('#aboutRepositoryBtn'),
      licenseModal: $('#licenseModal'), licenseList: $('#licenseList'),
      developerModal: $('#developerModal'), developerSiteBtn: $('#developerSiteBtn'),
      confirmModal: $('#confirmModal'), confirmMessage: $('#confirmMessage'),
      confirmOk: $('#confirmModal [data-confirm-ok]'),
      keyframeCount: $('#keyframeCount'), keyframeAddBtn: $('#keyframeAddBtn'),
      keyframeEditorModal: $('#keyframeEditorModal'), keyframeEditorTitle: $('#keyframeEditorTitle'),
      keyframeEditorCue: $('#keyframeEditorCue'), keyframePropSelect: $('#keyframePropSelect'),
      keyframeEditorAdd: $('#keyframeEditorAdd'), keyframeEditorDelete: $('#keyframeEditorDelete'),
      keyframeEditorRange: $('#keyframeEditorRange'), keyframeGraph: $('#keyframeGraph'),
      keyframeKeyList: $('#keyframeKeyList'), keyframeEditorHint: $('#keyframeEditorHint'),
      timelineSelectionLabel: $('#timelineSelectionLabel'), timelineSelStart: $('#timelineSelStart'),
      timelineSelEnd: $('#timelineSelEnd'), timelineSelectionEdit: $('#timelineSelectionEdit'),
      timelineSelectionDelete: $('#timelineSelectionDelete'), timelineSnap: $('#timelineSnap'),
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
      for (const key of ['themeBg', 'themeWindow', 'themeText', 'themeChart']) {
        if (!/^#[0-9a-fA-F]{6}$/.test(s[key] || '')) s[key] = DEFAULT_SETTINGS[key];
      }
      if (!['custom', 'bg', 'primary', 'accent'].includes(s.themeChartFollow)) s.themeChartFollow = 'custom';
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
      if (!['default', 'Bahnschrift', 'Segoe UI', 'Microsoft YaHei UI', 'Georgia', 'Arial', 'Times New Roman', 'Cascadia Code', 'Consolas'].includes(s.uiFont)) s.uiFont = 'default';
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
    if (Array.isArray(data.midiLayers) && data.midiLayers.length) {
      this.state.midiLayers = data.midiLayers.filter((layer) => layer && Array.isArray(layer.notes) && layer.notes.length);
    } else if (data.midi && Array.isArray(data.midi.notes) && data.midi.notes.length) {
      this.state.midiLayers = [{ ...data.midi, id: data.midi.id || uid('midi') }];
    }
    if (this.state.midiLayers.length) {
      this._rebuildMidiMerged();
      this._ensureMidiMaster();
    }
    if (data.info && typeof data.info === 'object') {
      const info = data.info;
      this.state.info = {
        title: typeof info.title === 'string' ? info.title.slice(0, 80) : '',
        artist: typeof info.artist === 'string' ? info.artist.slice(0, 80) : '',
        composer: typeof info.composer === 'string' ? info.composer.slice(0, 80) : '',
        album: typeof info.album === 'string' ? info.album.slice(0, 80) : '',
        genre: typeof info.genre === 'string' ? info.genre.slice(0, 40) : '',
        bpm: info.bpm === '' ? '' : String(info.bpm ?? '').slice(0, 12),
        trackNo: typeof info.trackNo === 'string' ? info.trackNo.slice(0, 12) : '',
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
          type: ['flash', 'text', 'subtitle', 'tint', 'fade', 'effect', 'mash', 'color', 'bpm', 'genre', 'intro', 'batch'].includes(cue.type) ? cue.type : 'flash',
          value: typeof cue.value === 'string' ? cue.value.slice(0, 200) : '',
          params: cue.params && typeof cue.params === 'object' ? cue.params : {},
          keys: cue.keys && typeof cue.keys === 'object' ? cue.keys : {},
        }));
      for (const cue of this.state.animationCues) {
        if (cue.type !== 'text' && cue.type !== 'subtitle') continue;
        const p = cue.params;
        if (!p.coordMode) {
          const x = Number(p.x);
          const y = Number(p.y);
          if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            p.x = (x - 0.5) * STAGE_W;
            p.y = (y - 0.5) * STAGE_H;
          }
          for (const [prop, span] of [['x', STAGE_W], ['y', STAGE_H]]) {
            if (!Array.isArray(cue.keys?.[prop])) continue;
            cue.keys[prop] = cue.keys[prop].map((key) => {
              const v = Number(key.v);
              return Number.isFinite(v) && v >= 0 && v <= 1
                ? { ...key, v: (v - 0.5) * span }
                : key;
            });
          }
          p.coordMode = 'absolute';
        }
        delete p.align;
        p.fadeIn = Math.max(0, Number(p.fadeIn) || 0.35);
        p.fadeOut = Math.max(0, Number(p.fadeOut) || 0.35);
      }
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
    if (data.timelineState && typeof data.timelineState === 'object') {
      const raw = data.timelineState;
      const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
      this.timelineState = {
        floating: !!raw.floating,
        x: num(raw.x),
        y: num(raw.y),
        w: num(raw.w),
        h: num(raw.h),
        height: clamp(Number(raw.height) || 220, 80, 620),
        labelWidth: clamp(Number(raw.labelWidth) || 148, 110, 420),
      };
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
        } else if (option.type === 'color') {
          if (/^#[0-9a-fA-F]{6}$/.test(String(v))) options[option.key] = String(v);
        } else if (option.type === 'text') {
          options[option.key] = String(v).slice(0, 80);
        } else if (option.options?.some(([value]) => String(value) === String(v))) {
          options[option.key] = String(v);
        }
      }
      if (raw.type === 'pianoRoll' && raw.options && typeof raw.options === 'object') {
        if (typeof raw.options.midiId === 'string') options.midiId = raw.options.midiId;
        if (Array.isArray(raw.options.trackOrder)) {
          const seen = new Set();
          options.trackOrder = raw.options.trackOrder.slice(0, 32).map(Number)
            .filter((v) => Number.isInteger(v) && v >= 0 && v < 32 && !seen.has(v) && seen.add(v))
            .filter((v) => v !== false);
        }
        if (Array.isArray(raw.options.trackColors)) {
          options.trackColors = raw.options.trackColors.slice(0, 16).map((v) => /^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : null);
        }
        if (Array.isArray(raw.options.trackDepths)) {
          options.trackDepths = raw.options.trackDepths.slice(0, 16).map((v) => clamp(Number(v) || 0, 0, 100));
        }
        if (Array.isArray(raw.options.trackMutes)) options.trackMutes = raw.options.trackMutes.slice(0, 16).map(Boolean);
        if (Array.isArray(raw.options.trackSolos)) options.trackSolos = raw.options.trackSolos.slice(0, 16).map(Boolean);
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
      const files = Array.from(d.midiFile.files || []);
      d.midiFile.value = '';
      if (files.length) this._loadMidiFiles(files);
    });
    d.midiBusImportBtn?.addEventListener('click', () => d.midiFile.click());
    this._bindMidiBus();
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
    for (const [key, input] of [['themeBg', d.themeBg], ['themeWindow', d.themeWindow], ['themeText', d.themeText], ['themeChart', d.themeChart]]) {
      input?.addEventListener('input', () => this._setThemeColor(key, input.value));
    }
    d.themeChartFollow?.addEventListener('change', () => {
      this.state.settings.themeChartFollow = d.themeChartFollow.value;
      this._applyThemePalette({ silent: true });
    });
    d.bgColorPickBtn.addEventListener('click', () => this._openColorPicker('background'));
    d.openShortcutsBtn.addEventListener('click', () => this._openShortcuts());
    d.openShortcutsBtn2.addEventListener('click', () => this._openShortcuts());
    d.glow.addEventListener('input', () => {
      this.state.settings.glow = Number(d.glow.value);
      d.glowOut.textContent = `${d.glow.value}%`;
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
      const mod = this._selected();
      if (!mod) return;
      const midiColor = e.target.closest('[data-midi-color]');
      if (midiColor) {
        const index = Number(midiColor.dataset.midiColor);
        const colors = Array.isArray(mod.options?.trackColors) ? mod.options.trackColors.slice() : [];
        colors[index] = midiColor.value;
        mod.options = { ...(mod.options || {}), trackColors: colors };
        this._persist();
        return;
      }
      const midiDepth = e.target.closest('[data-midi-depth]');
      if (midiDepth) {
        const index = Number(midiDepth.dataset.midiDepth);
        const depths = Array.isArray(mod.options?.trackDepths) ? mod.options.trackDepths.slice() : [];
        depths[index] = Number(midiDepth.value);
        mod.options = { ...(mod.options || {}), trackDepths: depths };
        const output = d.moduleOptions.querySelector(`[data-midi-depth-out="${index}"]`);
        if (output) output.textContent = `${Math.round(depths[index])}%`;
        this._persist();
        return;
      }
      const control = e.target.closest('[data-opt-key]');
      if (!control) return;
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
    d.moduleOptions.addEventListener('click', (e) => {
      const mod = this._selected();
      if (!mod) return;
      const midi = (this.state.midiLayers || []).find((layer) => layer.id === mod.options?.midiId) || this.state.midi;
      const up = e.target.closest('[data-midi-up]');
      if (up) {
        this._moveMidiTrack(mod, midi, Number(up.dataset.midiUp), -1);
        this._syncModuleOptions(mod);
        return;
      }
      const down = e.target.closest('[data-midi-down]');
      if (down) {
        this._moveMidiTrack(mod, midi, Number(down.dataset.midiDown), 1);
        this._syncModuleOptions(mod);
        return;
      }
      const mute = e.target.closest('[data-midi-mute]');
      if (mute) {
        const index = Number(mute.dataset.midiMute);
        const mutes = Array.isArray(mod.options?.trackMutes) ? mod.options.trackMutes.slice() : [];
        mutes[index] = !mutes[index];
        mod.options = { ...(mod.options || {}), trackMutes: mutes };
        mute.classList.toggle('active', mutes[index]);
        mute.classList.toggle('mute', mutes[index]);
        this._persist();
        return;
      }
      const solo = e.target.closest('[data-midi-solo]');
      if (solo) {
        const index = Number(solo.dataset.midiSolo);
        const solos = Array.isArray(mod.options?.trackSolos) ? mod.options.trackSolos.slice() : [];
        solos[index] = !solos[index];
        mod.options = { ...(mod.options || {}), trackSolos: solos };
        solo.classList.toggle('active', solos[index]);
        solo.classList.toggle('solo', solos[index]);
        this._persist();
      }
    });
    d.resetModuleOptionsBtn.addEventListener('click', () => {
      const mod = this._selected();
      if (!mod) return;
      const midiId = mod.options?.midiId;
      mod.options = midiId ? { midiId } : {};
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
    this.dom.uiFont?.addEventListener('change', () => this._applyUiFont(this.dom.uiFont.value));
    this.dom.uiFontReset?.addEventListener('click', () => this._applyUiFont('default'));
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

  _bindConfirmUI() {
    this.dom.confirmOk?.addEventListener('click', () => this._closeConfirm(true));
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-confirm-cancel]')) this._closeConfirm(false);
    });
    document.addEventListener('keydown', (e) => {
      if (!this.dom.confirmModal || this.dom.confirmModal.classList.contains('hidden')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._closeConfirm(false);
      }
    }, true);
  }

  _showConfirm(message, { title = '确认操作', confirmText = '确认恢复', cancelText = '取消' } = {}) {
    if (!this.dom.confirmModal) return Promise.resolve(false);
    this.dom.confirmMessage.textContent = message;
    const titleEl = this.dom.confirmModal.querySelector('#confirmTitle');
    if (titleEl) titleEl.textContent = title;
    const ok = this.dom.confirmModal.querySelector('[data-confirm-ok]');
    if (ok) ok.textContent = confirmText;
    for (const btn of this.dom.confirmModal.querySelectorAll('[data-confirm-cancel]')) {
      if (btn.classList.contains('btn')) btn.textContent = cancelText;
    }
    this.dom.confirmModal.classList.remove('hidden');
    return new Promise((resolve) => {
      this._confirmResolve = resolve;
      requestAnimationFrame(() => this.dom.confirmOk?.focus());
    });
  }

  _closeConfirm(value) {
    if (!this.dom.confirmModal || this.dom.confirmModal.classList.contains('hidden')) return;
    this.dom.confirmModal.classList.add('hidden');
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    if (resolve) resolve(!!value);
  }

  _bindAboutUI() {
    this.dom.aboutDeveloperBtn?.addEventListener('click', () => this._openModal('developer'));
    this.dom.aboutRepositoryBtn?.addEventListener('click', () => {
      this._openExternal('https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization');
    });
    this.dom.developerSiteBtn?.addEventListener('click', () => {
      this._openExternal('https://space.bilibili.com/3546631108561311');
    });
    this.dom.aboutLicensesBtn?.addEventListener('click', () => {
      this._renderLicenses();
      this._openModal('licenses');
    });
    this.dom.licenseList?.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      e.preventDefault();
      this._openExternal(link.href);
    });
  }

  _openExternal(url) {
    try {
      if (this._isNative && window.chrome?.webview) {
        window.chrome.webview.postMessage({ action: 'open-external', url });
        return;
      }
    } catch { /* fall through */ }
    window.open(url, '_blank', 'noopener');
  }

  _renderLicenses() {
    if (!this.dom.licenseList) return;
    const items = [
      {
        name: '.NET Runtime / Windows Forms / ASP.NET Core',
        copyright: 'Copyright © .NET Foundation and contributors.',
        license: 'Licensed under the MIT License.',
        source: 'https://github.com/dotnet/runtime',
        doc: 'https://github.com/dotnet/runtime/blob/main/LICENSE.TXT',
      },
      {
        name: 'Microsoft.Web.WebView2 SDK',
        copyright: 'Copyright © Microsoft Corporation.',
        license: 'Licensed under the BSD 3-Clause License.',
        source: 'https://learn.microsoft.com/microsoft-edge/webview2/',
        doc: 'https://github.com/MicrosoftEdge/WebView2Samples/blob/main/LICENSE.txt',
      },
      {
        name: 'FFmpeg（可选外部组件）',
        copyright: 'Copyright © FFmpeg developers.',
        license: '通常以 LGPL 2.1+ 分发；具体取决于所使用的构建。本程序不捆绑 FFmpeg。',
        source: 'https://ffmpeg.org/',
        doc: 'https://ffmpeg.org/legal.html',
      },
    ];
    this.dom.licenseList.innerHTML = items.map((item) => `
      <div class="license-item">
        <div class="license-name">${item.name}</div>
        <div>
          <div class="license-copy">${item.copyright}<br>${item.license}</div>
          <div class="license-links">
            <a href="${item.source}" target="_blank" rel="noopener">查看来源网站</a>
            <a href="${item.doc}" target="_blank" rel="noopener">查看许可文档</a>
          </div>
        </div>
      </div>`).join('');
  }

  _openStageWindow() {
    if (this._isNative) {
      try { window.chrome.webview.postMessage({ action: 'open-stage-window' }); } catch { /* noop */ }
    } else {
      const win = window.open(`${location.origin}/?stage=1`, 'neon-stage', 'width=1280,height=720');
      if (!win) this._toast('舞台窗口被浏览器拦截，请允许弹出窗口', 'error');
    }
    this._initStageBroadcast();
  }

  _initStageBroadcast() {
    if (this._stageChannel) return;
    try {
      this._stageChannel = new BroadcastChannel('neon-scope-stage-v1');
      this._stageLastSeen = 0;
      this._stageChannel.onmessage = (event) => {
        const data = event.data;
        if (data?.type === 'stage-ready' || data?.type === 'stage-heartbeat') {
          this._stageLastSeen = performance.now();
          this._startStageFrames();
        }
      };
      this._stageWatch = setInterval(() => {
        if (!this._stageLastSeen) return;
        if (performance.now() - this._stageLastSeen > 3200) this._stopStageFrames();
      }, 900);
    } catch { /* BroadcastChannel is optional */ }
  }

  _startStageFrames() {
    if (this._stageTimer || !this._stageChannel) return;
    const off = document.createElement('canvas');
    off.width = 960;
    off.height = 540;
    const offCtx = off.getContext('2d');
    let busy = false;
    this._stageTimer = setInterval(() => {
      if (busy || !this.visualizer?.canvas) return;
      busy = true;
      try {
        offCtx.drawImage(this.visualizer.canvas, 0, 0, off.width, off.height);
        off.toBlob((blob) => {
          busy = false;
          if (!blob || !this._stageChannel) return;
          this._stageChannel.postMessage({ type: 'frame', blob, time: this.audio.getTime() });
        }, 'image/jpeg', 0.78);
      } catch {
        busy = false;
      }
    }, 105);
  }

  _stopStageFrames() {
    if (this._stageTimer) clearInterval(this._stageTimer);
    this._stageTimer = null;
    this._stageLastSeen = 0;
  }

  _bindTimeline() {
    if (!this.dom.timelinePanel) return;
    this._timelineZoom = 1;
    this._timelineHome = { parent: this.dom.timelinePanel.parentNode, next: this.dom.timelinePanel.nextSibling };
    this._tlSelectedId = null;
    this._timelineScrubbing = false;
    this._timelineSnap = this.dom.timelineSnap.checked;
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
    this.dom.timelineAddCue.addEventListener('click', () => this._openActionBuilder('effect'));
    this.dom.timelineScroll.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.tl-bar')) return;
      this._timelineScrubbing = true;
      this._seekFromTimeline(e.clientX);
    });
    document.addEventListener('pointermove', (e) => {
      if (this._timelineScrubbing) this._seekFromTimeline(e.clientX);
    });
    document.addEventListener('pointerup', () => { this._timelineScrubbing = false; });
    this.dom.stageDetachBtn.addEventListener('click', () => this._openStageWindow());
    this._initStageBroadcast();
    this.dom.timelineContent.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._openTimelineMenu(e);
    });
    this.dom.timelineMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.dom.timelineMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-timeline-menu]');
      if (!btn) return;
      this._runTimelineMenuAction(btn.dataset.timelineMenu);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#timelineMenu')) this._closeTimelineMenu();
    });
    this.dom.timelineContent.addEventListener('click', (e) => {
      const del = e.target.closest('.tl-del');
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      const guard = this._delPointer;
      this._delPointer = null;
      if (guard && Math.hypot(e.clientX - guard.x, e.clientY - guard.y) > 4) return;
      this.state.animationCues = this.state.animationCues.filter((cue) => cue.id !== del.dataset.cueId);
      this._renderAnimationCues();
      this._persist();
    });
    this.dom.timelineContent.addEventListener('dblclick', (e) => {
      const bar = e.target.closest('.tl-bar');
      if (bar) {
        const cue = this.state.animationCues.find((item) => item.id === bar.dataset.cueId);
        if (cue) {
          this._selectTimelineCue(cue.id);
          this._openActionBuilder(cue.type, cue);
        }
        return;
      }
      const rect = this.dom.timelineContent.getBoundingClientRect();
      const time = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (this._tlDuration || 0);
      this._openActionBuilder('effect', null, time);
    });
    this.dom.timelineSelStart.addEventListener('change', () => {
      const cue = this._selectedTimelineCue();
      if (!cue) return;
      const start = clamp(Number(this.dom.timelineSelStart.value) || 0, 0, 36000);
      const end = start + cue.duration;
      cue.time = start;
      this.state.animationCues.sort((a, b) => a.time - b.time);
      this._renderTimeline();
      this._syncTimelineSelection();
      this.dom.timelineSelEnd.value = end.toFixed(2);
      this._persist();
    });
    this.dom.timelineSelEnd.addEventListener('change', () => {
      const cue = this._selectedTimelineCue();
      if (!cue) return;
      const end = clamp(Number(this.dom.timelineSelEnd.value) || 0, cue.time + 0.1, 36000);
      cue.duration = clamp(end - cue.time, 0.1, 60);
      this._renderTimeline();
      this._syncTimelineSelection();
      this._persist();
    });
    this.dom.timelineSelectionEdit.addEventListener('click', () => {
      const cue = this._selectedTimelineCue();
      if (cue) this._openActionBuilder(cue.type, cue);
    });
    this.dom.timelineSelectionDelete.addEventListener('click', () => this._deleteSelectedTimelineCue());
    this.dom.timelineSnap.addEventListener('change', () => {
      this._timelineSnap = this.dom.timelineSnap.checked;
    });
    this.dom.timelineContent.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const keyMarker = e.target.closest('.tl-key-marker');
      const del = e.target.closest('.tl-del');
      const bar = e.target.closest('.tl-bar');
      if (keyMarker) {
        e.preventDefault();
        e.stopPropagation();
        const cue = this.state.animationCues.find((item) => item.id === keyMarker.dataset.keyCue);
        if (cue) {
          this._selectTimelineCue(cue.id);
          this.audio.seek(cue.time);
          this._updateTransport(cue.time);
          this._syncTimelinePlayhead(cue.time);
        }
        return;
      }
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        // Delete only on click, never as a side effect of starting a drag.
        this._delPointer = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!bar) return;
      const cue = this.state.animationCues.find((item) => item.id === bar.dataset.cueId);
      if (!cue) return;
      e.preventDefault();
      e.stopPropagation();
      this._selectTimelineCue(cue.id);
      const leftTrim = !!e.target.closest('.tl-trim-left');
      const rightTrim = !!e.target.closest('.tl-resize');
      const startX = e.clientX;
      const startTime = cue.time;
      const startDuration = cue.duration;
      const screenPps = this.dom.timelineContent.getBoundingClientRect().width / Math.max(0.1, this._tlDuration);
      const snap = (value) => this._timelineSnap ? Math.round(value * 10) / 10 : value;
      const move = (ev) => {
        const delta = (ev.clientX - startX) / Math.max(0.001, screenPps);
        if (rightTrim) {
          cue.duration = clamp(snap(startDuration + delta), 0.1, 60);
        } else if (leftTrim) {
          const nextTime = clamp(snap(startTime + delta), 0, startTime + startDuration - 0.1);
          cue.duration = clamp(snap(startDuration - (nextTime - startTime)), 0.1, 60);
          cue.time = nextTime;
        } else {
          cue.time = clamp(snap(startTime + delta), 0, Math.max(0.1, this._tlDuration));
        }
        this.state.animationCues.sort((a, b) => a.time - b.time);
        this._renderTimeline();
        this._syncTimelineSelection();
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
    this._bindTimelineFloat();
    this._applyTimelineOpen(this.state.settings.timelineOpen !== false, { silent: true });
    this._applyTimelineLayout();
    this._renderTimeline();
  }

  _openTimelineMenu(e) {
    const marker = e.target.closest('.tl-key-marker');
    const bar = e.target.closest('.tl-bar');
    const barCue = bar ? this.state.animationCues.find((cue) => cue.id === bar.dataset.cueId) : null;
    const markerCue = marker ? this.state.animationCues.find((cue) => cue.id === marker.dataset.keyCue) : null;
    const cue = barCue || markerCue || null;
    if (cue) this._selectTimelineCue(cue.id);
    const rect = this.dom.timelineContent.getBoundingClientRect();
    const time = cue ? cue.time : clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (this._tlDuration || 0);
    this._timelineMenuCueId = cue?.id || null;
    this._timelineMenuTime = time;
    const edit = this.dom.timelineMenu.querySelector('[data-timeline-menu="edit"]');
    const keys = this.dom.timelineMenu.querySelector('[data-timeline-menu="keys"]');
    const duplicate = this.dom.timelineMenu.querySelector('[data-timeline-menu="duplicate"]');
    const del = this.dom.timelineMenu.querySelector('[data-timeline-menu="delete"]');
    if (edit) edit.disabled = !cue;
    if (keys) keys.disabled = !cue;
    if (duplicate) duplicate.disabled = !cue;
    if (del) del.disabled = !cue;
    const snap = this.dom.timelineMenu.querySelector('[data-timeline-menu="snap"] .menu-state');
    if (snap) snap.textContent = this._timelineSnap ? 'ON' : 'OFF';
    this.dom.timelineMenu.classList.remove('hidden');
    const vp = this._panelViewport();
    const localX = e.clientX / vp.scale;
    const localY = e.clientY / vp.scale;
    const mw = this.dom.timelineMenu.offsetWidth || 218;
    const mh = this.dom.timelineMenu.offsetHeight || 240;
    this.dom.timelineMenu.style.left = `${clamp(localX, 8, vp.w - mw - 8)}px`;
    this.dom.timelineMenu.style.top = `${clamp(localY, 8, vp.h - mh - 8)}px`;
  }

  _closeTimelineMenu() {
    this.dom.timelineMenu?.classList.add('hidden');
    this._timelineMenuCueId = null;
  }

  _runTimelineMenuAction(action) {
    const cue = this.state.animationCues.find((item) => item.id === this._timelineMenuCueId) || null;
    const time = Number(this._timelineMenuTime) || 0;
    this._closeTimelineMenu();
    if (action === 'add') { this._openActionBuilder('effect', null, time); return; }
    if (!cue && ['edit', 'duplicate', 'delete'].includes(action)) return;
    if (action === 'edit') { this._openActionBuilder(cue.type, cue); return; }
    if (action === 'keys') { this._openKeyframeEditor(cue); return; }
    if (action === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(cue));
      copy.id = uid('cue');
      copy.time = clamp(cue.time + 0.5, 0, 36000);
      this.state.animationCues.push(copy);
      this.state.animationCues.sort((a, b) => a.time - b.time);
      this._tlSelectedId = copy.id;
      this._renderAnimationCues();
      this._persist();
      return;
    }
    if (action === 'delete') {
      this.state.animationCues = this.state.animationCues.filter((item) => item.id !== cue.id);
      this._tlSelectedId = null;
      this._renderAnimationCues();
      this._persist();
      return;
    }
    if (action === 'locate') {
      const t = cue ? cue.time : time;
      this.audio.seek(t);
      this._updateTransport(t);
      this._syncTimelinePlayhead(t);
      return;
    }
    if (action === 'keyframes') {
      this._showKeyframeRack();
      return;
    }
    if (action === 'float') { this._toggleTimelineFloat(); return; }
    if (action === 'snap') {
      this.dom.timelineSnap.checked = !this.dom.timelineSnap.checked;
      this._timelineSnap = this.dom.timelineSnap.checked;
    }
  }

  _showKeyframeRack() {
    const st = this.subpanelState.keyframes;
    if (!st) return;
    if (st.hidden || !st.floating) {
      st.hidden = false;
      st.floating = true;
      this._applySubpanelState();
    }
  }

  _applyTimelineLabelWidth() {
    const width = clamp(Number(this.timelineState.labelWidth) || 148, 110, 420);
    this.timelineState.labelWidth = width;
    if (this.dom.timelineLabels) {
      this.dom.timelineLabels.style.width = `${width}px`;
      this.dom.timelineLabels.style.flexBasis = `${width}px`;
      this.dom.timelineLabels.style.flexGrow = '0';
      this.dom.timelineLabels.style.flexShrink = '0';
    }
  }

  _applyTimelineLayout() {
    const panel = this.dom.timelinePanel;
    if (!panel) return;
    const st = this.timelineState;
    const layer = this.dom.subpanelLayer;
    st.height = clamp(Number(st.height) || 220, 80, 620);
    panel.style.setProperty('--timeline-height', `${st.height}px`);
    if (this.dom.stageTimelineSplitter) this.dom.stageTimelineSplitter.style.display = st.floating ? 'none' : '';
    this._applyTimelineLabelWidth();
    if (st.floating) {
      if (layer && panel.parentNode !== layer) layer.appendChild(panel);
      panel.classList.add('timeline-floating');
      const vp = this._panelViewport();
      if (!Number.isFinite(st.w)) st.w = clamp(840, 500, vp.w - 24);
      if (!Number.isFinite(st.h)) st.h = clamp(300, 210, vp.h - 60);
      st.w = Math.round(clamp(st.w, 500, vp.w - 24));
      st.h = Math.round(clamp(st.h, 210, vp.h - 60));
      if (!Number.isFinite(st.x)) st.x = Math.round((vp.w - st.w) / 2);
      if (!Number.isFinite(st.y)) st.y = Math.round(vp.h - st.h - 64);
      st.x = Math.round(clamp(st.x, 4, vp.w - st.w - 4));
      st.y = Math.round(clamp(st.y, 4, vp.h - st.h - 4));
      panel.style.left = `${st.x}px`;
      panel.style.top = `${st.y}px`;
      panel.style.width = `${st.w}px`;
      panel.style.height = `${st.h}px`;
      if (this.dom.timelineFloatBtn) {
        const use = this.dom.timelineFloatBtn.querySelector('use');
        if (use) use.setAttribute('href', '#i-dock');
        this.dom.timelineFloatBtn.classList.add('active');
        this.dom.timelineFloatBtn.title = '停靠时间轴';
      }
    } else {
      panel.classList.remove('timeline-floating');
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
      if (this._timelineHome && this._timelineHome.parent && panel.parentNode !== this._timelineHome.parent) {
        this._timelineHome.parent.insertBefore(panel, this._timelineHome.next);
      }
      if (this.dom.timelineFloatBtn) {
        const use = this.dom.timelineFloatBtn.querySelector('use');
        if (use) use.setAttribute('href', '#i-window');
        this.dom.timelineFloatBtn.classList.remove('active');
        this.dom.timelineFloatBtn.title = '浮动时间轴';
      }
    }
    requestAnimationFrame(() => this._renderTimeline());
  }

  _toggleTimelineFloat() {
    this.timelineState.floating = !this.timelineState.floating;
    this._applyTimelineLayout();
    this._persist();
  }

  _bindTimelineFloat() {
    const panel = this.dom.timelinePanel;
    if (!panel) return;
    this.dom.timelineFloatBtn.addEventListener('click', () => this._toggleTimelineFloat());

    this.dom.timelineSplitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = Number(this.timelineState.labelWidth) || 148;
      const scale = this._panelViewport().scale || 1;
      const maxWidth = Math.max(180, panel.clientWidth - 220);
      const move = (ev) => {
        this.timelineState.labelWidth = clamp(startWidth + (ev.clientX - startX) / scale, 110, Math.min(420, maxWidth));
        this._applyTimelineLabelWidth();
        this._renderTimeline();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this.dom.timelineSplitter.classList.remove('dragging');
        this._persist();
      };
      this.dom.timelineSplitter.classList.add('dragging');
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    const head = panel.querySelector('.timeline-head');
    head.addEventListener('pointerdown', (e) => {
      if (!this.timelineState.floating || e.target.closest('button, input, select, .mini-action')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = Number(panel.style.left.replace('px', '')) || 0;
      const startTop = Number(panel.style.top.replace('px', '')) || 0;
      const scale = this._panelViewport().scale || 1;
      const move = (ev) => {
        const vp = this._panelViewport();
        const left = clamp(startLeft + (ev.clientX - startX) / scale, 4, vp.w - panel.offsetWidth - 4);
        const top = clamp(startTop + (ev.clientY - startY) / scale, 4, vp.h - panel.offsetHeight - 4);
        this.timelineState.x = Math.round(left);
        this.timelineState.y = Math.round(top);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this._persist();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    this.dom.stageTimelineSplitter?.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.timelineState.floating) return;
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = this.timelineState.height;
      const scale = this._panelViewport().scale || 1;
      const maxHeight = Math.max(90, (this.dom.timelinePanel.parentElement?.clientHeight || 900) - 150);
      const move = (ev) => {
        const h = clamp(startHeight - (ev.clientY - startY) / scale, 80, maxHeight);
        this.timelineState.height = Math.round(h);
        this.dom.timelinePanel.style.setProperty('--timeline-height', `${this.timelineState.height}px`);
        this._renderTimeline();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this.dom.stageTimelineSplitter.classList.remove('dragging');
        this._persist();
      };
      this.dom.stageTimelineSplitter.classList.add('dragging');
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    this.dom.timelineResizer.addEventListener('pointerdown', (e) => {
      if (!this.timelineState.floating) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = panel.offsetWidth;
      const startH = panel.offsetHeight;
      const scale = this._panelViewport().scale || 1;
      const move = (ev) => {
        const vp = this._panelViewport();
        const w = clamp(startW + (ev.clientX - startX) / scale, 500, vp.w - this.timelineState.x - 4);
        const h = clamp(startH + (ev.clientY - startY) / scale, 210, vp.h - this.timelineState.y - 4);
        this.timelineState.w = Math.round(w);
        this.timelineState.h = Math.round(h);
        panel.style.width = `${w}px`;
        panel.style.height = `${h}px`;
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this._renderTimeline();
        this._persist();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  _applyTimelineOpen(open, { silent = false } = {}) {
    this.state.settings.timelineOpen = !!open;
    this.dom.timelinePanel?.classList.toggle('collapsed', !open);
    this.dom.timelineToggle?.classList.toggle('active', !!open);
    if (open) requestAnimationFrame(() => this._renderTimeline());
    if (!silent) this._persist();
  }

  _timelineLabel(cue) {
    const p = cue.params || {};
    if (cue.type === 'text' || cue.type === 'subtitle') {
      return String(p.text || cue.value || cue.type).replace(/\s+/g, ' ').slice(0, 80);
    }
    if (cue.type === 'mash') return String(p.title || cue.value || 'mash').replace(/\s+/g, ' ').slice(0, 80);
    if (cue.type === 'color') return p.ink || p.accent || 'color';
    if (cue.type === 'effect') return p.effect || 'effect';
    if (cue.type === 'bpm') return `${p.bpm ?? cue.value ?? ''} BPM`;
    if (cue.type === 'genre') return p.name || cue.value || 'genre';
    if (cue.type === 'intro') return `blur ${p.blur ?? 0}`;
    if (cue.type === 'batch') return p.batch || cue.value || 'call';
    return cue.value || cue.type;
  }

  _addTimelineCue() {
    this._openActionBuilder('text');
  }

  _seekFromTimeline(clientX) {
    const rect = this.dom.timelineContent.getBoundingClientRect();
    // getBoundingClientRect is in screen pixels (UI scale included); _tlPps is
    // in local CSS pixels. Use the rendered width so a click at 20s is 20s at
    // every UI scale.
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const raw = ratio * (this._tlDuration || 0);
    const t = this._timelineSnap ? Math.round(raw * 10) / 10 : raw;
    this.audio.seek(t);
    this._updateTransport(t);
    this._syncTimelinePlayhead(t);
  }

  _selectedTimelineCue() {
    return (this.state.animationCues || []).find((cue) => cue.id === this._tlSelectedId) || null;
  }

  _selectTimelineCue(id) {
    this._tlSelectedId = id;
    this._syncTimelineSelection();
    this._renderTimeline();
  }

  _deleteSelectedTimelineCue() {
    const cue = this._selectedTimelineCue();
    if (!cue) return;
    this.state.animationCues = this.state.animationCues.filter((item) => item.id !== cue.id);
    this._tlSelectedId = null;
    this._renderAnimationCues();
    this._persist();
  }

  _syncTimelineSelection() {
    if (!this.dom.timelineSelectionLabel) return;
    const cue = this._selectedTimelineCue();
    const has = !!cue;
    for (const el of [this.dom.timelineSelStart, this.dom.timelineSelEnd, this.dom.timelineSelectionEdit, this.dom.timelineSelectionDelete]) {
      if (el) el.disabled = !has;
    }
    if (!has) {
      this.dom.timelineSelectionLabel.textContent = '未选择动作';
      this.dom.timelineSelStart.value = '';
      this.dom.timelineSelEnd.value = '';
      return;
    }
    this.dom.timelineSelectionLabel.textContent = `${this._timelineLabel(cue)} · ${cue.type}`;
    this.dom.timelineSelStart.value = Number(cue.time).toFixed(2);
    this.dom.timelineSelEnd.value = Number(cue.time + cue.duration).toFixed(2);
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
    const keyMarkers = [];
    const labelsMap = { text: 'TEXT', subtitle: 'SUB', mash: 'MASH', color: 'COLOR', effect: 'FX', bpm: 'BPM', genre: 'GENRE', intro: 'INTRO', batch: 'CALL', flash: 'FLASH', tint: 'TINT', fade: 'FADE' };
    for (const cue of cues) {
      labels.push(`<div class="tl-row-label"><span class="tl-type">${labelsMap[cue.type] || cue.type.toUpperCase()}</span><span class="tl-value">${this._timelineLabel(cue)}</span></div>`);
      const kfStart = cue.time * this._tlPps;
      const kfEnd = (cue.time + cue.duration) * this._tlPps;
      const kfSel = this._tlSelectedId === cue.id ? ' selected' : '';
      keyMarkers.push(`<span class="tl-key-marker ${cue.type}${kfSel}" data-key-cue="${cue.id}" style="left:${kfStart}px" title="${formatCueTime(cue.time)} · start"></span>`);
      keyMarkers.push(`<span class="tl-key-marker tl-key-marker-end ${cue.type}${kfSel}" data-key-cue="${cue.id}" style="left:${kfEnd}px" title="${formatCueTime(cue.time + cue.duration)} · end"></span>`);
      for (const [prop, keys] of Object.entries(cue.keys || {})) {
        if (!Array.isArray(keys)) continue;
        for (const key of keys) {
          if (key.t <= 0.01 || (cue.duration > 0 && key.t >= cue.duration - 0.01)) continue;
          const x = (cue.time + key.t) * this._tlPps;
          keyMarkers.push(`<span class="tl-key-marker tl-key-marker-auto ${cue.type}${kfSel}" data-key-cue="${cue.id}" style="left:${x}px" title="${formatCueTime(cue.time + key.t)} · ${prop}"></span>`);
        }
      }
      const left = cue.time * this._tlPps;
      const bw = Math.max(10, cue.duration * this._tlPps);
      lanes.push(`<div class="tl-row">
        <div class="tl-bar ${cue.type} ${this._tlSelectedId === cue.id ? 'selected' : ''}" data-cue-id="${cue.id}" style="left:${left}px;width:${bw}px" title="${formatCueTime(cue.time)} · ${cue.type}">
          <span class="tl-keyframe" title="起始关键帧"></span>
          <span class="tl-keyframe tl-keyframe-end" title="结束关键帧"></span>
          <span class="tl-trim-left" title="拖动改变开始时间"></span>
          <span class="tl-label">${this._timelineLabel(cue)}</span>
          <span class="tl-del" data-cue-id="${cue.id}" title="删除动作">×</span>
          <span class="tl-resize" title="拖动改变结束时间"></span>
        </div>
      </div>`);
    }
    if (!cues.length) {
      labels.push('<div class="tl-row-label"><span class="tl-type">EMPTY</span></div>');
      lanes.push('<div class="tl-row"><div class="timeline-empty">还没有动画动作 · 点击「+ 动作」或导入动画脚本</div></div>');
    }
    this.dom.timelineLabels.innerHTML = `<div style="height:22px"></div><div class="tl-row-label tl-key-label"><span class="tl-type">KEYS</span><span class="tl-value">${cues.length * 2} keyframes</span></div>${labels.join('')}`;
    this.dom.timelineLanes.innerHTML = `<div class="tl-key-row">${keyMarkers.join('')}</div>${lanes.join('')}`;
    const ruler = [];
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * this._tlPps >= 54) || 600;
    for (let t = 0; t <= duration + 0.001; t += step) {
      const x = t * this._tlPps;
      ruler.push(`<div class="tl-tick" style="left:${x}px"><span>${formatCueTime(t).slice(0, 6)}</span></div>`);
    }
    this.dom.timelineRuler.innerHTML = ruler.join('');
    if (this._tlSelectedId && !this.state.animationCues.some((cue) => cue.id === this._tlSelectedId)) {
      this._tlSelectedId = null;
    }
    this._syncTimelineSelection();
    this._syncTimelinePlayhead(this.audio.getTime() || 0);
    this._renderKeyframeManager();
  }

  _renderKeyframeManager() {
    if (!this.dom.keyframeList) return;
    const cues = (this.state.animationCues || []).slice().sort((a, b) => a.time - b.time);
    const total = Math.max(1, this.audio.duration || 36, ...cues.map((cue) => cue.time + cue.duration));
    const totalKeys = cues.reduce((sum, cue) => {
      const tracks = Object.values(cue.keys || {}).filter(Array.isArray);
      return sum + (tracks.length ? tracks.reduce((n, keys) => n + keys.length, 0) : 2);
    }, 0);
    this.dom.keyframeCount.textContent = `${cues.length} 个动画 · ${totalKeys} 关键帧`;
    if (!cues.length) {
      this.dom.keyframeList.innerHTML = '<div class="kf-empty">总线为空。点击「新建动作」或在时间轴右键添加动画。</div>';
      return;
    }
    const labels = { bpm: 'BPM', color: 'COLOR', genre: 'GENRE', effect: 'FX', intro: 'INTRO', text: 'TEXT', subtitle: 'SUB', mash: 'MASH', batch: 'CALL', flash: 'FLASH', tint: 'TINT', fade: 'FADE' };
    this.dom.keyframeList.innerHTML = cues.map((cue, index) => {
      const start = clamp(cue.time / total, 0, 1) * 100;
      const width = Math.max(1, cue.duration / total * 100);
      const extraKeys = [];
      for (const keys of Object.values(cue.keys || {})) {
        if (!Array.isArray(keys)) continue;
        for (const key of keys) {
          if (key.t <= 0.01 || (cue.duration > 0 && key.t >= cue.duration - 0.01)) continue;
          extraKeys.push(`<span class="kf-key kf-key-auto" style="left:${clamp((cue.time + key.t) / total, 0, 1) * 100}%"></span>`);
        }
      }
      return `<div class="kf-item ${this._tlSelectedId === cue.id ? 'selected' : ''}" data-kf-id="${cue.id}">
        <span class="kf-no">${String(index + 1).padStart(2, '0')}</span>
        <span class="kf-kind ${cue.type}">${labels[cue.type] || cue.type}</span>
        <div class="kf-main">
          <div class="kf-title">${String(this._timelineLabel(cue)).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</div>
          <div class="kf-track" title="${formatCueTime(cue.time)} → ${formatCueTime(cue.time + cue.duration)}">
            <span class="kf-fill" style="left:${start}%;width:${width}%"></span>
            <span class="kf-key" style="left:${start}%"></span>
            <span class="kf-key kf-key-end" style="left:${clamp(start + width, 0, 100)}%"></span>
            ${extraKeys.join('')}
          </div>
        </div>
        <span class="kf-time">${formatCueTime(cue.time).slice(0, 6)}</span>
        <div class="kf-actions">
          <button data-kf-action="locate" title="定位">◎</button>
          <button data-kf-action="keys" title="关键帧曲线">∿</button>
          <button data-kf-action="edit" title="编辑动作">✎</button>
          <button data-kf-action="delete" title="删除">×</button>
        </div>
      </div>`;
    }).join('');
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
        timelineState: this.timelineState,
        info: this.state.info,
        midi: this.state.midi,
        midiLayers: this.state.midiLayers,
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
      const confirmed = await this._showConfirm('导入存档会覆盖当前工程，继续吗？', {
        title: '导入工程', confirmText: '导入', cancelText: '取消',
      });
      if (!confirmed) return;
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
      ['composer', this.dom.infoComposer], ['album', this.dom.infoAlbum],
      ['genre', this.dom.infoGenre], ['bpm', this.dom.infoBpm], ['trackNo', this.dom.infoTrackNo],
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
    this.dom.animOpenBuilder.addEventListener('click', () => this._openActionBuilder('effect'));
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
    this.dom.actionBuilderType.addEventListener('change', () => {
      this._renderActionBuilderFields();
      this._captureActionBuilderSnapshot();
    });
    this.dom.actionBuilderTime.addEventListener('input', () => this._updateActionBuilderPreview());
    this.dom.actionBuilderFields.addEventListener('input', () => this._updateActionBuilderPreview());
    this.dom.actionBuilderFields.addEventListener('change', () => this._updateActionBuilderPreview());
    this.dom.actionBuilderFields.addEventListener('click', (e) => {
      const pageBtn = e.target.closest('[data-action-page-btn]');
      if (pageBtn) {
        this._setActionBuilderPage(pageBtn.dataset.actionPageBtn);
        return;
      }
      if (e.target.closest('[data-action-reset]')) {
        this._resetActionBuilderFields();
        return;
      }
      if (!e.target.closest('[data-action-use-colors]')) return;
      const palette = this._resolveThemeColors();
      const colors = {
        bg: palette.bg,
        primary: palette.window,
        accent: palette.text,
        ink: palette.chart,
        chartFollow: this.state.settings.themeChartFollow || 'custom',
      };
      for (const [slot, value] of Object.entries(colors)) {
        const el = this.dom.actionBuilderFields.querySelector(`[data-action-field="${slot}"]`);
        if (el) el.value = value;
      }
      this._updateActionBuilderPreview();
    });
    this.dom.actionBuilderInsert.addEventListener('click', () => this._insertActionFromBuilder());
    this.dom.actionBuilderModal.addEventListener('click', (e) => {
      if (e.target === this.dom.actionBuilderModal || e.target.closest('[data-action-builder-cancel]')) {
        this._closeActionBuilder();
      }
    });
    this.dom.keyframeAddBtn.addEventListener('click', () => this._openActionBuilder('effect'));
    this.dom.keyframeList.addEventListener('click', (e) => {
      const action = e.target.closest('[data-kf-action]');
      const row = e.target.closest('[data-kf-id]');
      if (!row) return;
      const cue = this.state.animationCues.find((item) => item.id === row.dataset.kfId);
      if (!cue) return;
      this._selectTimelineCue(cue.id);
      if (!action) return;
      const kind = action.dataset.kfAction;
      if (kind === 'locate') {
        this.audio.seek(cue.time);
        this._updateTransport(cue.time);
        this._syncTimelinePlayhead(cue.time);
      } else if (kind === 'keys') {
        this._openKeyframeEditor(cue);
      } else if (kind === 'edit') {
        this._openActionBuilder(cue.type, cue);
      } else if (kind === 'delete') {
        this.state.animationCues = this.state.animationCues.filter((item) => item.id !== cue.id);
        this._renderAnimationCues();
        this._persist();
      }
    });
    this.dom.keyframeList.addEventListener('dblclick', (e) => {
      const row = e.target.closest('[data-kf-id]');
      if (!row) return;
      const cue = this.state.animationCues.find((item) => item.id === row.dataset.kfId);
      if (cue) this._openActionBuilder(cue.type, cue);
    });
    this._bindKeyframeEditor();
    this._bindConfirmUI();
    this._bindAboutUI();
    this._syncInfoPanel();
    this._renderAnimationCues();
  }

  _bindKeyframeEditor() {
    this.dom.keyframePropSelect.addEventListener('change', () => {
      this._kfProp = this.dom.keyframePropSelect.value;
      this._kfSelectedKey = 0;
      this._ensureAutomation();
      this._renderKeyframeEditor();
    });
    this.dom.keyframeEditorAdd.addEventListener('click', () => this._addAutomationKey());
    this.dom.keyframeEditorDelete.addEventListener('click', () => this._deleteAutomationKey());
    this.dom.keyframeKeyList.addEventListener('change', (e) => this._onAutomationListChange(e));
    this.dom.keyframeKeyList.addEventListener('click', (e) => {
      const del = e.target.closest('[data-kf-delete]');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        this._kfSelectedKey = Number(del.dataset.kfDelete);
        this._deleteAutomationKey();
        return;
      }
      const row = e.target.closest('[data-kf-row]');
      if (row) {
        this._kfSelectedKey = Number(row.dataset.kfRow);
        this._renderKeyframeEditor();
      }
    });
    this.dom.keyframeEditorModal.addEventListener('click', (e) => {
      if (e.target === this.dom.keyframeEditorModal || e.target.closest('[data-keyframe-editor-close]')) {
        this._closeModal('keyframeEditor');
      }
    });
    this.dom.keyframeGraph.addEventListener('pointerdown', (e) => this._onAutomationGraphPointer(e));
    this.dom.keyframeGraph.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const point = e.target.closest('[data-kf-point]');
      if (!point) return;
      this._kfSelectedKey = Number(point.dataset.kfPoint);
      this._renderKeyframeEditor();
      this._openKeyframeMenu(e);
    });
    this.dom.keyframeMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.dom.keyframeMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-keyframe-menu]');
      if (!btn) return;
      const action = btn.dataset.keyframeMenu;
      this._closeKeyframeMenu();
      if (action === 'delete') this._deleteAutomationKey();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#keyframeMenu')) this._closeKeyframeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (this._activeModal !== 'keyframeEditor') return;
      if (this._isTypingTarget(e.target)) return;
      if (e.key === 'Delete' || e.code === 'NumpadDecimal' || e.code === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        this._deleteAutomationKey();
      }
    });
  }

  _openKeyframeMenu(e) {
    const vp = this._panelViewport();
    this.dom.keyframeMenu.classList.remove('hidden');
    const mw = this.dom.keyframeMenu.offsetWidth || 180;
    const mh = this.dom.keyframeMenu.offsetHeight || 64;
    this.dom.keyframeMenu.style.left = `${clamp(e.clientX / vp.scale, 8, vp.w - mw - 8)}px`;
    this.dom.keyframeMenu.style.top = `${clamp(e.clientY / vp.scale, 8, vp.h - mh - 8)}px`;
  }

  _closeKeyframeMenu() {
    this.dom.keyframeMenu?.classList.add('hidden');
  }

  _automationCue() {
    return this.state.animationCues.find((cue) => cue.id === this._kfCueId) || null;
  }

  _automationSpan(cue) {
    const maxKey = Object.values(cue.keys || {}).flat().reduce((max, key) => Math.max(max, Number(key.t) || 0), 0);
    return Math.max(0.1, cue.duration > 0 ? cue.duration : Math.max(5, this.audio.duration || 36, maxKey + 1));
  }

  _automationSpec(cue, prop) {
    return (AUTOMATION_PROPERTIES[cue.type] || { opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' } })[prop];
  }

  _automationBase(cue, prop, spec) {
    const p = cue.params || {};
    if (prop === 'opacity') return 1;
    if (prop === 'x') return p.x ?? 0;
    if (prop === 'y') return p.y ?? (cue.type === 'subtitle' ? 360 : 0);
    if (prop === 'size') return p.size ?? (cue.type === 'subtitle' ? 26 : 86);
    if (prop === 'fadeIn') return p.fadeIn ?? 0.35;
    if (prop === 'fadeOut') return p.fadeOut ?? 0.35;
    if (prop === 'lineGap') return p.lineGap ?? 8;
    if (prop === 'scaleX') return p.scaleX ?? 100;
    if (prop === 'scaleY') return p.scaleY ?? 100;
    if (prop === 'amount') return p.amount ?? 35;
    if (prop === 'blur') return p.blur ?? 35;
    if (prop === 'bpm') return p.bpm ?? (Number(cue.value) || 120);
    if (spec.kind === 'color') {
      return p[prop] || (prop === 'accent' ? this.state.settings.accent : prop === 'bg' ? this.state.settings.bgColor : '#0F1C4A');
    }
    return 0;
  }

  _ensureAutomation() {
    const cue = this._automationCue();
    const prop = this._kfProp;
    if (!cue || !prop) return null;
    cue.keys = cue.keys && typeof cue.keys === 'object' ? cue.keys : {};
    const spec = this._automationSpec(cue, prop);
    if (!spec) return null;
    if (!Array.isArray(cue.keys[prop])) {
      const base = this._automationBase(cue, prop, spec);
      const span = this._automationSpan(cue);
      cue.keys[prop] = [{ t: 0, v: base }, { t: span, v: base }];
    }
    cue.keys[prop].sort((a, b) => a.t - b.t);
    return cue.keys[prop];
  }

  _openKeyframeEditor(cue, prop = null) {
    if (!cue) return;
    this._kfCueId = cue.id;
    const props = AUTOMATION_PROPERTIES[cue.type] || { opacity: { label: '不透明度', min: 0, max: 1, step: 0.01, kind: 'number' } };
    this.dom.keyframePropSelect.innerHTML = Object.entries(props)
      .map(([key, spec]) => `<option value="${key}">${spec.label}</option>`).join('');
    this._kfProp = prop && props[prop] ? prop : Object.keys(props)[0];
    this.dom.keyframePropSelect.value = this._kfProp;
    this._kfSelectedKey = 0;
    this._ensureAutomation();
    this._openModal('keyframeEditor');
    this._renderKeyframeEditor();
  }

  _renderKeyframeEditor() {
    const cue = this._automationCue();
    if (!cue) return;
    const keys = this._ensureAutomation();
    const spec = this._automationSpec(cue, this._kfProp);
    if (!keys || !spec) return;
    const span = this._automationSpan(cue);
    const cueLabel = this._timelineLabel(cue).replace(/\s+/g, ' ').slice(0, 54);
    this.dom.keyframeEditorTitle.textContent = `关键帧编辑器 · ${cueLabel}`;
    this.dom.keyframeEditorCue.textContent = `${cue.type.toUpperCase()} · ${formatCueTime(cue.time)}`;
    this.dom.keyframeEditorRange.textContent = `${spec.label} · 0–${formatCueTime(span).slice(0, 6)}`;
    this.dom.keyframeEditorHint.textContent = spec.kind === 'color'
      ? '颜色关键帧会按时间自动插值。单击曲线轨道添加关键帧，拖动圆点调整时间。'
      : '单击曲线添加关键帧，拖动圆点调整时间和数值；数值会在关键帧之间自动插值。';
    this._renderAutomationGraph(cue, keys, spec, span);
    const selected = clamp(Number(this._kfSelectedKey) || 0, 0, Math.max(0, keys.length - 1));
    this._kfSelectedKey = selected;
    this.dom.keyframeKeyList.innerHTML = keys.map((key, index) => `
      <div class="kf-key-row ${index === selected ? 'selected' : ''}" data-kf-row="${index}">
        <span class="kf-key-no">${index + 1}</span>
        <input data-kf-field="time" type="number" min="0" step="0.01" value="${Number(key.t).toFixed(2)}" title="时间 s" />
        ${spec.kind === 'color'
          ? `<input data-kf-field="value" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(key.v) ? key.v : '#ff4f8b'}" />`
          : `<input data-kf-field="value" type="number" min="${spec.min ?? ''}" max="${spec.max ?? ''}" step="${spec.step ?? 'any'}" value="${Number(key.v).toFixed(3)}" />`}
        <button data-kf-delete="${index}" title="删除关键帧">×</button>
      </div>`).join('');
  }

  _renderAutomationGraph(cue, keys, spec, span) {
    const W = 720, H = 300, L = 44, R = 12, T = 16, B = 26;
    const plotW = W - L - R;
    const plotH = H - T - B;
    const kind = spec.kind;
    const min = kind === 'color' ? 0 : spec.min ?? 0;
    const max = kind === 'color' ? 1 : spec.max ?? 1;
    const xFor = (t) => L + clamp(t / span, 0, 1) * plotW;
    const yFor = (v) => kind === 'color' ? T + plotH / 2 : T + (1 - clamp((v - min) / Math.max(0.0001, max - min), 0, 1)) * plotH;
    const grid = [];
    for (let i = 0; i <= 4; i += 1) {
      const y = T + (plotH / 4) * i;
      grid.push(`<line class="kf-grid-line ${i === 0 || i === 4 ? 'major' : ''}" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}"/>`);
      if (kind !== 'color') {
        const value = max - ((max - min) / 4) * i;
        grid.push(`<text class="kf-axis-label" x="4" y="${y + 3}">${Number(value).toFixed(value < 10 ? 2 : 0)}</text>`);
      }
    }
    for (let i = 0; i <= 6; i += 1) {
      const x = L + (plotW / 6) * i;
      grid.push(`<line class="kf-grid-line" x1="${x}" y1="${T}" x2="${x}" y2="${H - B}"/>`);
      const tickTime = span * i / 6;
      const tickLabel = span <= 10 ? `${tickTime.toFixed(1)}s` : formatCueTime(tickTime).slice(0, 6);
      grid.push(`<text class="kf-axis-label" x="${x}" y="${H - 8}" text-anchor="middle">${tickLabel}</text>`);
    }
    let curve = '';
    if (kind === 'color') {
      const stops = keys.map((key) => `<stop offset="${clamp(key.t / span, 0, 1) * 100}%" stop-color="${/^#[0-9a-fA-F]{6}$/.test(key.v) ? key.v : '#ff4f8b'}"/>`).join('');
      curve = `<defs><linearGradient id="kfColorGradient">${stops}</linearGradient></defs>
        <rect class="kf-color-track" x="${L}" y="${T + plotH / 2 - 10}" width="${plotW}" height="20" fill="url(#kfColorGradient)" stroke="rgba(255,255,255,.2)"/>`;
    } else {
      const points = keys.map((key) => `${xFor(key.t).toFixed(1)},${yFor(Number(key.v) || 0).toFixed(1)}`).join(' ');
      curve = `<polyline class="kf-curve" points="${points}"/>`;
    }
    const circles = keys.map((key, index) => `<circle class="kf-curve-point ${index === this._kfSelectedKey ? 'selected' : ''}" data-kf-point="${index}" cx="${xFor(key.t)}" cy="${yFor(Number(key.v) || 0)}" r="6"/>`).join('');
    const rel = clamp(this.audio.getTime() - cue.time, 0, span);
    const playhead = cue.duration > 0 ? `<line class="kf-playhead" x1="${xFor(rel)}" y1="${T}" x2="${xFor(rel)}" y2="${H - B}"/>` : '';
    this.dom.keyframeGraph.innerHTML = `${grid.join('')}${curve}${playhead}${circles}`;
  }

  _automationPointFromEvent(e) {
    const cue = this._automationCue();
    const keys = this._ensureAutomation();
    const spec = this._automationSpec(cue, this._kfProp);
    if (!cue || !keys || !spec) return null;
    const W = 720, H = 300, L = 44, R = 12, T = 16, B = 26;
    const plotW = W - L - R, plotH = H - T - B;
    const rect = this.dom.keyframeGraph.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    const y = (e.clientY - rect.top) / rect.height * H;
    const span = this._automationSpan(cue);
    const t = clamp((x - L) / plotW, 0, 1) * span;
    const min = spec.kind === 'color' ? 0 : spec.min ?? 0;
    const max = spec.kind === 'color' ? 1 : spec.max ?? 1;
    const value = spec.kind === 'color' ? null : clamp(min + (1 - (y - T) / plotH) * (max - min), min, max);
    return { t, value, keys, spec, span };
  }

  _onAutomationGraphPointer(e) {
    if (e.button !== 0) return;
    const cue = this._automationCue();
    const data = this._automationPointFromEvent(e);
    if (!cue || !data) return;
    const point = e.target.closest('[data-kf-point]');
    let index;
    if (point) {
      index = Number(point.dataset.kfPoint);
    } else {
      const keys = data.keys;
      const kind = data.spec.kind;
      const value = kind === 'color'
        ? automationValueAt(keys, data.t, this._automationBase(cue, this._kfProp, data.spec), 'color')
        : data.value;
      const existing = keys.findIndex((key) => Math.abs(key.t - data.t) < 0.02);
      const entry = { t: Math.round(data.t * 100) / 100, v: value };
      if (existing >= 0) keys[existing] = entry; else keys.push(entry);
      keys.sort((a, b) => a.t - b.t);
      index = keys.findIndex((key) => Math.abs(key.t - entry.t) < 0.001);
    }
    this._kfSelectedKey = index;
    const snap = (v) => Math.round(v * 100) / 100;
    const move = (ev) => {
      const next = this._automationPointFromEvent(ev);
      if (!next) return;
      const key = data.keys[index];
      if (!key) return;
      key.t = snap(clamp(next.t, 0, next.span));
      if (data.spec.kind !== 'color') key.v = next.value;
      data.keys.sort((a, b) => a.t - b.t);
      this._kfSelectedKey = data.keys.indexOf(key);
      this._renderKeyframeEditor();
      this._renderTimeline();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this._persist();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    this._renderKeyframeEditor();
  }

  _addAutomationKey() {
    const cue = this._automationCue();
    const keys = this._ensureAutomation();
    if (!cue || !keys) return;
    const spec = this._automationSpec(cue, this._kfProp);
    const span = this._automationSpan(cue);
    const t = Math.round(clamp(this.audio.getTime() - cue.time, 0, span) * 100) / 100;
    const value = automationValueAt(keys, t, this._automationBase(cue, this._kfProp, spec), spec.kind);
    const existing = keys.findIndex((key) => Math.abs(key.t - t) < 0.02);
    if (existing >= 0) keys[existing].v = value;
    else keys.push({ t, v: value });
    keys.sort((a, b) => a.t - b.t);
    this._kfSelectedKey = keys.findIndex((key) => Math.abs(key.t - t) < 0.02);
    this._renderKeyframeEditor();
    this._renderTimeline();
    this._persist();
  }

  _deleteAutomationKey() {
    const keys = this._ensureAutomation();
    if (!keys || !keys.length) return;
    keys.splice(clamp(Number(this._kfSelectedKey) || 0, 0, keys.length - 1), 1);
    this._kfSelectedKey = Math.max(0, Math.min(this._kfSelectedKey, keys.length - 1));
    this._renderKeyframeEditor();
    this._renderTimeline();
    this._persist();
  }

  _onAutomationListChange(e) {
    const row = e.target.closest('[data-kf-row]');
    if (!row) return;
    const keys = this._ensureAutomation();
    if (!keys) return;
    const cue = this._automationCue();
    const spec = this._automationSpec(cue, this._kfProp);
    const index = clamp(Number(row.dataset.kfRow), 0, keys.length - 1);
    const field = e.target.dataset.kfField;
    if (field === 'time') keys[index].t = clamp(Number(e.target.value) || 0, 0, this._automationSpan(cue));
    if (field === 'value') keys[index].v = spec.kind === 'color' ? e.target.value : (Number(e.target.value) || 0);
    keys.sort((a, b) => a.t - b.t);
    this._kfSelectedKey = Math.min(index, keys.length - 1);
    this._renderKeyframeEditor();
    this._renderTimeline();
    this._persist();
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
    this.dom.infoComposer.value = info.composer || '';
    this.dom.infoAlbum.value = info.album || '';
    this.dom.infoGenre.value = info.genre || '';
    this.dom.infoBpm.value = info.bpm || '';
    this.dom.infoTrackNo.value = info.trackNo || '';
    this.dom.infoOverlay.checked = !!info.show;
    if (info.cover) {
      this.dom.infoCoverPreview.innerHTML = `<img alt="cover" src="${info.cover}">`;
    } else {
      this.dom.infoCoverPreview.innerHTML = '<span>COVER</span>';
    }
  }

  _actionArg(value) {
    const raw = String(value ?? '').trim().replace(/\r\n?/g, '\n');
    if (!raw) return '""';
    if (/^[^\s"']+$/.test(raw)) return raw;
    return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }

  _openActionBuilder(type = 'effect', cue = null, atTime = null) {
    if (!this.dom.actionBuilderModal) return;
    if (cue && !['bpm', 'color', 'genre', 'effect', 'intro', 'text', 'subtitle', 'mash', 'batch'].includes(cue.type)) {
      this._toast('该旧动作请在动画脚本区直接编辑', 'info');
      return;
    }
    this._editingCueId = cue?.id || null;
    if (this.dom.actionBuilderTitle) this.dom.actionBuilderTitle.textContent = cue ? '编辑动作' : '添加动作';
    if (this.dom.actionBuilderInsert) this.dom.actionBuilderInsert.textContent = cue ? '更新动作' : '插入动作';
    this.dom.actionBuilderType.value = type;
    const time = cue ? cue.time : (Number.isFinite(atTime) ? atTime : this.audio.getTime() || 0);
    this.dom.actionBuilderTime.value = formatCueTime(time);
    this._renderActionBuilderFields();
    if (cue) this._fillActionBuilderFromCue(cue);
    this._captureActionBuilderSnapshot();
    this._openModal('action');
    requestAnimationFrame(() => {
      this.dom.actionBuilderTime.focus();
      this.dom.actionBuilderTime.select();
    });
  }

  _fillActionBuilderFromCue(cue) {
    const p = cue.params || {};
    const set = (name, value) => {
      const el = this.dom.actionBuilderFields.querySelector(`[data-action-field="${name}"]`);
      if (el && value !== undefined && value !== null) el.value = String(value);
    };
    if (cue.type === 'bpm') set('bpm', p.bpm ?? cue.value);
    if (cue.type === 'color') {
      for (const slot of ['bg', 'primary', 'accent', 'ink']) set(slot, p[slot]);
      set('chartFollow', p.chartFollow || 'custom');
      set('duration', cue.duration);
      set('fadeIn', p.fadeIn ?? 0.35);
      set('fadeOut', p.fadeOut ?? 0.35);
    }
    if (cue.type === 'genre') set('genre', p.name || cue.value);
    if (cue.type === 'effect') {
      set('effect', p.effect || 'blur');
      set('duration', cue.duration);
      set('amount', p.amount ?? 35);
    }
    if (cue.type === 'intro') {
      set('duration', cue.duration);
      set('blur', p.blur ?? 35);
    }
    if (cue.type === 'text' || cue.type === 'subtitle') {
      set('text', p.text || cue.value);
      set('duration', cue.duration);
      set('x', p.x ?? 0);
      set('y', p.y ?? (cue.type === 'subtitle' ? 360 : 0));
      set('size', p.size ?? (cue.type === 'subtitle' ? 26 : 86));
      set('fadeIn', p.fadeIn ?? 0.35);
      set('fadeOut', p.fadeOut ?? 0.35);
      set('lineGap', p.lineGap ?? 8);
      set('scaleX', p.scaleX ?? 100);
      set('scaleY', p.scaleY ?? 100);
      set('role', p.role || 'main');
    }
    if (cue.type === 'mash') {
      set('title', p.title || cue.value);
      set('author', p.author || 'Artist');
      set('origin', p.origin || 'Origin');
      set('hold', cue.duration);
      set('x', p.x ?? 0);
      set('y', p.y ?? 0);
      set('scaleX', p.scaleX ?? 100);
      set('scaleY', p.scaleY ?? 100);
    }
    if (cue.type === 'batch') {
      set('batch', p.batch || cue.value);
      set('split', p.split ? 'true' : 'false');
      set('role', p.role || 'main');
      set('x', p.x ?? 0.5);
      set('y', p.y ?? 0.95);
    }
    this._updateActionBuilderPreview();
  }

  _closeActionBuilder() {
    this._editingCueId = null;
    this._closeModal('action');
  }

  _actionField(name, label, { type = 'text', value = '', placeholder = '', wide = false, min = '', max = '', step = '' } = {}) {
    return `<label class="action-builder-field ${wide ? 'action-builder-wide' : ''}"><span>${label}</span>
      <input data-action-field="${name}" type="${type}" value="${String(value).replace(/"/g, '&quot;')}" placeholder="${placeholder}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} ${step !== '' ? `step="${step}"` : ''} />
    </label>`;
  }

  _actionPager() {
    return `<div class="action-builder-pager">
      <button type="button" data-action-page-btn="prev" title="上一页">&lt;</button>
      <button type="button" data-action-page-btn="1" class="active">1</button>
      <button type="button" data-action-page-btn="2">2</button>
      <button type="button" data-action-page-btn="next" title="下一页">&gt;</button>
    </div>`;
  }

  _actionTextarea(name, label, value, { rows = 3, wide = true } = {}) {
    const text = String(value ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    return `<label class="action-builder-field ${wide ? 'action-builder-wide' : ''}"><span>${label}</span>
      <textarea data-action-field="${name}" rows="${rows}" spellcheck="false">${text}</textarea>
    </label>`;
  }

  _actionSelect(name, label, options, value, { wide = false } = {}) {
    const html = options.map((opt) => {
      const [val, text] = Array.isArray(opt) ? opt : [opt, opt];
      return `<option value="${val}" ${String(val) === String(value) ? 'selected' : ''}>${text}</option>`;
    }).join('');
    return `<label class="action-builder-field ${wide ? 'action-builder-wide' : ''}"><span>${label}</span>
      <select data-action-field="${name}">${html}</select>
    </label>`;
  }

  _captureActionBuilderSnapshot() {
    this._actionBuilderSnapshot = {};
    for (const el of this.dom.actionBuilderFields.querySelectorAll('[data-action-field]')) {
      this._actionBuilderSnapshot[el.dataset.actionField] = el.value;
    }
  }

  _setActionBuilderPage(page) {
    const pages = [...this.dom.actionBuilderFields.querySelectorAll('[data-action-page-index]')];
    if (!pages.length) return;
    const max = pages.length;
    const next = page === 'prev' ? Math.max(1, (this._actionBuilderPage || 1) - 1)
      : page === 'next' ? Math.min(max, (this._actionBuilderPage || 1) + 1)
        : clamp(Number(page) || 1, 1, max);
    this._actionBuilderPage = next;
    for (const el of pages) {
      el.classList.toggle('hidden', Number(el.dataset.actionPageIndex) !== next);
    }
    for (const btn of this.dom.actionBuilderFields.querySelectorAll('[data-action-page-btn]')) {
      const value = btn.dataset.actionPageBtn;
      btn.classList.toggle('active', value === String(next));
    }
  }

  async _resetActionBuilderFields() {
    if (!this._actionBuilderSnapshot) return;
    const confirmed = await this._showConfirm('是否将所有参数恢复为设置前的状态');
    if (!confirmed) return;
    for (const el of this.dom.actionBuilderFields.querySelectorAll('[data-action-field]')) {
      const value = this._actionBuilderSnapshot[el.dataset.actionField];
      if (value !== undefined) el.value = value;
    }
    this._setActionBuilderPage(1);
    this._updateActionBuilderPreview();
  }

  _renderActionBuilderFields() {
    const type = this.dom.actionBuilderType.value || 'effect';
    const d = this.dom.actionBuilderFields;
    const palette = this._resolveThemeColors();
    const colors = {
      bg: palette.bg,
      primary: palette.window,
      accent: palette.text,
      ink: palette.chart,
      chartFollow: this.state.settings.themeChartFollow || 'custom',
    };
    let body = '';
    if (type === 'bpm') {
      body = this._actionField('bpm', 'BPM', { type: 'number', value: '180', min: 1, max: 999, step: '0.01', wide: true });
    } else if (type === 'color') {
      body = [
        this._actionField('bg', '背景色', { value: colors.bg }),
        this._actionField('primary', '窗口颜色', { value: colors.primary }),
        this._actionField('accent', '字符颜色', { value: colors.accent }),
        this._actionField('ink', '图表颜色', { value: colors.ink }),
        this._actionSelect('chartFollow', '跟随颜色', [
          ['custom', '自定义图表颜色'],
          ['bg', '跟随背景色'],
          ['primary', '跟随窗口颜色'],
          ['accent', '跟随字符颜色'],
        ], colors.chartFollow),
        this._actionField('duration', '持续', { type: 'number', value: '0', min: 0, step: '0.1' }),
        this._actionField('fadeIn', '颜色淡入', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        this._actionField('fadeOut', '颜色淡出', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        `<button class="mini-action action-builder-use-colors" data-action-use-colors type="button">使用当前 UI 配色</button>`,
      ].join('');
    } else if (type === 'genre') {
      body = this._actionField('genre', 'Genre', { value: this.state.info.genre || 'Drum & Bass', wide: true });
    } else if (type === 'effect') {
      body = [
        this._actionSelect('effect', '特效', ['blur', 'motion-blur', 'exposure', 'glow', 'shake-x', 'shake-y', 'shake-zoom'], 'blur'),
        this._actionField('duration', '持续', { type: 'number', value: '1', min: 0.01, step: 'any' }),
        this._actionField('amount', '强度', { type: 'number', value: '35', min: 0, max: 100, step: 1 }),
        `<p class="action-builder-note">0–100；shake-* 的 duration 是单次摆动长度。</p>`,
      ].join('');
    } else if (type === 'intro') {
      body = [
        this._actionField('duration', '持续', { type: 'number', value: '5', min: 0.1, step: 0.1 }),
        this._actionField('blur', 'Blur', { type: 'number', value: '35', min: 0, max: 100, step: 1 }),
      ].join('');
    } else if (type === 'text') {
      body = [
        this._actionField('text', '文字', { value: 'Text overlay', wide: true }),
        this._actionField('duration', '持续', { type: 'number', value: '3', min: 0.1, step: 0.1 }),
        this._actionField('x', 'X（绝对）', { type: 'number', value: '0', step: 1 }),
        this._actionField('y', 'Y（绝对）', { type: 'number', value: '0', step: 1 }),
        this._actionField('size', '大小', { type: 'number', value: '86', min: 12, step: 1 }),
        this._actionField('fadeIn', '淡入', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        this._actionField('fadeOut', '淡出', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        `<p class="action-builder-note">X / Y 为绝对像素偏移，0 / 0 是画面正中心。</p>`,
      ].join('');
    } else if (type === 'subtitle') {
      const page1 = [
        this._actionTextarea('text', '字幕文字（可换行）', 'Subtitle line', { rows: 3 }),
        this._actionField('duration', '持续', { type: 'number', value: '4', min: 0.1, step: 0.1 }),
        this._actionField('size', '字号', { type: 'number', value: '26', min: 8, max: 200, step: 1 }),
        this._actionField('x', 'X（绝对）', { type: 'number', value: '0', step: 1 }),
        this._actionField('y', 'Y（绝对）', { type: 'number', value: '360', step: 1 }),
        this._actionField('fadeIn', '淡入', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        this._actionField('fadeOut', '淡出', { type: 'number', value: '0.35', min: 0, step: 0.05 }),
        this._actionField('lineGap', '行间距', { type: 'number', value: '8', min: 0, step: 1 }),
      ].join('');
      const page2 = [
        this._actionField('scaleX', '横向延展（%）', { type: 'number', value: '100', min: 20, max: 400, step: 1 }),
        this._actionField('scaleY', '纵向延展（%）', { type: 'number', value: '100', min: 20, max: 400, step: 1 }),
        this._actionSelect('role', '字幕角色', ['main', 'sub'], 'main'),
        `<button class="mini-action action-builder-reset" data-action-reset type="button">恢复为原本设置</button>`,
      ].join('');
      body = `
        <div class="action-builder-page" data-action-page-index="1">${page1}</div>
        <div class="action-builder-page hidden" data-action-page-index="2">${page2}</div>
        ${this._actionPager()}`;
    } else if (type === 'mash') {
      const page1 = [
        this._actionField('title', '标题', { value: 'Title', wide: true }),
        this._actionField('author', '作者', { value: 'Artist' }),
        this._actionField('origin', '来源', { value: 'Origin' }),
        this._actionField('hold', '保留', { type: 'number', value: '3', min: 0.1, step: 0.1 }),
        this._actionField('x', 'X（绝对）', { type: 'number', value: '0', step: 1 }),
        this._actionField('y', 'Y（绝对）', { type: 'number', value: '0', step: 1 }),
      ].join('');
      const page2 = [
        this._actionField('scaleX', '横向延展（%）', { type: 'number', value: '100', min: 20, max: 400, step: 1 }),
        this._actionField('scaleY', '纵向延展（%）', { type: 'number', value: '100', min: 20, max: 400, step: 1 }),
        `<button class="mini-action action-builder-reset" data-action-reset type="button">恢复为原本设置</button>`,
      ].join('');
      body = `
        <div class="action-builder-page" data-action-page-index="1">${page1}</div>
        <div class="action-builder-page hidden" data-action-page-index="2">${page2}</div>
        ${this._actionPager()}`;
    } else if (type === 'batch') {
      body = [
        this._actionField('batch', '动作组名称', { value: 'batch-name', wide: true }),
        this._actionSelect('split', '拆分子幕', ['false', 'true'], 'false'),
        this._actionSelect('role', '字幕角色', ['main', 'sub'], 'main'),
        this._actionField('x', 'X', { type: 'number', value: '0.5', step: 0.01 }),
        this._actionField('y', 'Y', { type: 'number', value: '0.95', step: 0.01 }),
        `<p class="action-builder-note">动作组需先在动画脚本中定义；这里生成 call 调用。</p>`,
      ].join('');
    }
    d.innerHTML = body;
    this._setActionBuilderPage(1);
    this._updateActionBuilderPreview();
  }

  _actionFieldValue(name) {
    return this.dom.actionBuilderFields.querySelector(`[data-action-field="${name}"]`)?.value.trim() || '';
  }

  _generateActionLine() {
    const type = this.dom.actionBuilderType.value;
    const time = this.dom.actionBuilderTime.value.trim() || formatCueTime(this.audio.getTime() || 0);
    if (type === 'bpm') return `${time} bpm ${this._actionFieldValue('bpm') || '180'}`;
    if (type === 'color') {
      const slots = ['bg', 'primary', 'accent', 'ink']
        .map((slot) => `${slot}=${this._actionFieldValue(slot)}`)
        .filter((part) => !part.endsWith('='));
      const follow = this._actionFieldValue('chartFollow') || 'custom';
      return `${time} color ${slots.join(' ')} chartFollow=${follow} duration=${this._actionFieldValue('duration') || '0'} fadeIn=${this._actionFieldValue('fadeIn') || '0'} fadeOut=${this._actionFieldValue('fadeOut') || '0'}`.trim();
    }
    if (type === 'genre') return `${time} genre name=${this._actionArg(this._actionFieldValue('genre') || 'Genre')}`;
    if (type === 'effect') {
      const effect = this._actionFieldValue('effect') || 'blur';
      const parts = [
        `${time} effect ${effect}`,
        `duration=${this._actionFieldValue('duration') || '1'}`,
        `amount=${this._actionFieldValue('amount') || '35'}`,
      ];
      if (effect === 'glow') parts.push('colors=2,3');
      return parts.join(' ');
    }
    if (type === 'intro') return `${time} intro duration=${this._actionFieldValue('duration') || '5'} blur=${this._actionFieldValue('blur') || '35'}`;
    if (type === 'text') {
      return `${time} text text=${this._actionArg(this._actionFieldValue('text') || 'Text overlay')} duration=${this._actionFieldValue('duration') || '3'} x=${this._actionFieldValue('x') || '0'} y=${this._actionFieldValue('y') || '0'} size=${this._actionFieldValue('size') || '86'} fadeIn=${this._actionFieldValue('fadeIn') || '0.35'} fadeOut=${this._actionFieldValue('fadeOut') || '0.35'}`;
    }
    if (type === 'subtitle') {
      return `${time} subtitle text=${this._actionArg(this._actionFieldValue('text') || 'Subtitle')} duration=${this._actionFieldValue('duration') || '4'} x=${this._actionFieldValue('x') || '0'} y=${this._actionFieldValue('y') || '360'} size=${this._actionFieldValue('size') || '26'} fadeIn=${this._actionFieldValue('fadeIn') || '0.35'} fadeOut=${this._actionFieldValue('fadeOut') || '0.35'} lineGap=${this._actionFieldValue('lineGap') || '8'} scaleX=${this._actionFieldValue('scaleX') || '100'} scaleY=${this._actionFieldValue('scaleY') || '100'} role=${this._actionFieldValue('role') || 'main'}`;
    }
    if (type === 'mash') {
      return `${time} mash title=${this._actionArg(this._actionFieldValue('title') || 'Title')} author=${this._actionArg(this._actionFieldValue('author') || 'Artist')} origin=${this._actionArg(this._actionFieldValue('origin') || 'Origin')} hold=${this._actionFieldValue('hold') || '3'} x=${this._actionFieldValue('x') || '0'} y=${this._actionFieldValue('y') || '0'} scaleX=${this._actionFieldValue('scaleX') || '100'} scaleY=${this._actionFieldValue('scaleY') || '100'}`;
    }
    if (type === 'batch') {
      const split = this._actionFieldValue('split') || 'false';
      const role = split === 'true' ? ` role=${this._actionFieldValue('role') || 'main'}` : '';
      return `${time} call ${this._actionFieldValue('batch') || 'batch-name'} split=${split}${role} x=${this._actionFieldValue('x') || '0.5'} y=${this._actionFieldValue('y') || '0.95'}`;
    }
    return `${time} bpm 180`;
  }

  _updateActionBuilderPreview() {
    if (this.dom.actionBuilderPreview) this.dom.actionBuilderPreview.textContent = this._generateActionLine();
  }

  _insertActionFromBuilder() {
    const line = this._generateActionLine();
    const cues = parseAnimationScript(line);
    if (!cues.length) {
      this._toast('动作参数不完整，无法生成', 'error');
      return;
    }
    const editing = this._editingCueId ? this.state.animationCues.find((cue) => cue.id === this._editingCueId) : null;
    if (editing) {
      const replacement = cues[0];
      replacement.id = editing.id;
      replacement.keys = editing.keys || {};
      const index = this.state.animationCues.indexOf(editing);
      this.state.animationCues[index] = replacement;
      this._tlSelectedId = replacement.id;
      this._toast('动作已更新', 'success');
    } else {
      this.state.animationCues.push(...cues);
      this._tlSelectedId = cues[0].id;
      this._toast('动作已插入', 'success');
    }
    this.state.animationCues.sort((a, b) => a.time - b.time);
    this._renderAnimationCues();
    this._persist();
    this._closeActionBuilder();
  }

  _renderAnimationCues() {
    if (!this.dom.animCueList) return;
    const labels = { flash: '闪白', text: '文字', subtitle: '字幕', tint: '染色', fade: '淡出', effect: '效果', mash: '标题卡', color: '调色', bpm: 'BPM', genre: '流派', intro: '开场', batch: '动作组' };
    const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const cues = this.state.animationCues || [];
    if (!cues.length) {
      this.dom.animCueList.innerHTML = '<div class="anim-empty">还没有动作。点击「添加动作」或右键时间轴创建。</div>';
      this._renderTimeline();
      this._renderKeyframeManager();
      return;
    }
    this.dom.animCueList.innerHTML = cues.map((cue) => {
      const p = cue.params || {};
      const detail = cue.type === 'mash' ? (p.title || cue.value)
        : cue.type === 'color' ? `${p.ink || p.accent || ''}`
        : cue.type === 'effect' ? `${p.effect || 'blur'} ${p.amount ?? ''}`
        : cue.type === 'bpm' ? `${p.bpm ?? cue.value} BPM`
        : cue.type === 'genre' ? (p.name || cue.value)
        : cue.type === 'intro' ? `blur ${p.blur ?? 0}`
        : cue.type === 'batch' ? (p.batch || cue.value)
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
    this._renderKeyframeManager();
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
        btn.title = id === 'stage' ? '在桌面新建独立舞台窗口' : (floating ? '停靠面板' : '浮动面板');
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
        if (floatBtn.dataset.panelFloat === 'stage') this._openStageWindow();
        else this._togglePanelFloat(floatBtn.dataset.panelFloat);
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
    const reserve = new Set(['source', 'library', 'info', 'animation', 'keyframes', 'midiBus', 'geometry', 'style', 'options', 'layer', 'about', 'output', 'tips']);
    const add = (id, el, title) => {
      if (!el || !reserve.has(id)) return;
      specs.push({ id, el, title: title || el.querySelector('.section-head > span')?.textContent || id });
    };
    const leftSections = $$('#panelModules > .panel-section');
    add('source', leftSections[0], '信号源');
    add('library', leftSections[1], '模块库');
    add('info', leftSections[2], '信息编辑');
    add('animation', leftSections[3], '动画设计');
    add('keyframes', leftSections[4], '关键帧管理总线');
    add('midiBus', leftSections[5], 'MIDI 模块总线');
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
        hidden: spec.id === 'info' || spec.id === 'animation' || spec.id === 'keyframes' || spec.id === 'midiBus',
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
    this._renderMidiBus();
  }

  _subpanelDefaults(index, el = null) {
    const vp = this._panelViewport();
    if (el?.id === 'midiBusPanel') {
      const mw = Math.round(clamp(vp.w * 0.32, 380, 460));
      const mh = Math.round(clamp(vp.h * 0.58, 360, 540));
      return {
        x: Math.round(clamp(vp.w - mw - 36, 8, vp.w - mw - 8)),
        y: Math.round(clamp(vp.h - mh - 72, 8, vp.h - mh - 8)),
        w: mw,
        h: mh,
      };
    }
    if (el?.id === 'keyframePanel') {
      const kw = Math.round(clamp(vp.w * 0.30, 340, 430));
      const kh = Math.round(clamp(vp.h * 0.38, 260, 370));
      return {
        x: Math.round(clamp(vp.w - kw - 36, 8, vp.w - kw - 8)),
        y: Math.round(clamp(vp.h - kh - 72, 8, vp.h - kh - 8)),
        w: kw,
        h: kh,
      };
    }
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
      st.floating = id === 'keyframes' || id === 'midiBus';
      this._applySubpanelState();
      if (id !== 'keyframes' && id !== 'midiBus') {
        setTimeout(() => this._subpanels[id]?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 40);
      }
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
      this.subpanelState[spec.id] = {
        hidden: spec.id === 'keyframes' || spec.id === 'midiBus',
        floating: false, x: null, y: null, w: null, h: null,
      };
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
      case 'toggle_timeline': this._applyTimelineOpen(!(this.state.settings.timelineOpen !== false)); break;
      case 'toggle_keyframes': this._showKeyframeRack(); break;
      case 'add_action': this._openActionBuilder('effect'); break;
      case 'open_stage_window': this._openStageWindow(); break;
      case 'reset_panels': this._resetPanels(); break;
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
      const midis = files.filter((f) => /\.(mid|midi)$/i.test(f.name));
      const audio = files.find((f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f.name));
      if (image) this._loadBackgroundFile(image);
      if (midis.length) this._loadMidiFiles(midis);
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
    if (!file) return this._loadMidiFiles([]);
    return this._loadMidiFiles([file]);
  }

  async _loadMidiFiles(files) {
    if (!files?.length) return;
    const token = (this._midiLoadToken = (this._midiLoadToken || 0) + 1);
    this._setEngineStatus('解析 MIDI…', 'busy');
    this._toast(`正在解析 ${files.length} 个 MIDI 可视化数据…`, '', 1800);
    const loaded = [];
    const failed = [];
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        if (token !== this._midiLoadToken) return;
        const midi = parseMidi(buf);
        midi.title = file.name.replace(/\.[^.]+$/, '');
        loaded.push(midi);
      } catch (err) {
        failed.push(`${file.name}: ${err.message || '解析失败'}`);
      }
    }
    if (token !== this._midiLoadToken) return;
    for (const midi of loaded) {
      const id = uid('midi');
      this.state.midiLayers.push({ ...midi, id });
    }
    if (loaded.length) {
      this._rebuildMidiMerged();
      const mod = this._ensureMidiMaster();
      this._syncSelectionUI(mod.id);
      this.visualizer.syncOverlay();
      this._renderLibrary();
      this._syncCanvasMeta();
      this._persist();
      this._renderMidiBus();
      const bus = this.subpanelState.midiBus;
      if (bus?.hidden) {
        bus.hidden = false;
        bus.floating = true;
        this._applySubpanelState();
      }
    }
    this._setEngineStatus(loaded.length ? 'MIDI 可视化已载入' : 'MIDI 解析失败', loaded.length ? 'ready' : 'error');
    if (!this.audio.hasAudio) {
      this._toast(`${loaded.length} 个 MIDI 已载入 · 请导入音频或播放 DEMO 作为时间轴`, 'info', 5200);
    } else if (loaded.length) {
      this._toast(`${loaded.length} 个 MIDI 可视化已载入${failed.length ? ` · ${failed.length} 个失败` : ''}`, 'success', 3800);
    }
    if (failed.length) this._toast(failed[0], 'error', 5200);
  }

  _ensurePianoRoll(layer = null) {
    let mod = this.state.modules.find((m) => m.type === 'pianoRoll' && (!layer || m.options?.midiId === layer.id));
    if (mod) {
      if (mod.hidden) {
        mod.hidden = false;
        this.visualizer.syncOverlay();
      }
      if (layer && !mod.options?.midiId) mod.options = { ...(mod.options || {}), midiId: layer.id };
      return mod;
    }
    const placement = this._findPlacement(MODULE_DEFS.pianoRoll.w, MODULE_DEFS.pianoRoll.h);
    mod = createModule('pianoRoll', placement);
    if (layer) {
      mod.title = String(layer.title || 'MIDI').slice(0, 44);
      mod.options = { ...(mod.options || {}), midiId: layer.id };
    }
    this.state.modules.push(mod);
    this.visualizer.syncOverlay();
    this._renderLibrary();
    this._syncCanvasMeta();
    this._persist();
    return mod;
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
    d.moduleOptionsHelp.textContent = mod.type === 'pianoRoll'
      ? '所有导入 MIDI 的轨道强制合并进同一 3D 场景；列表顺序决定纵深（上远下近），近大远小、近快远慢。'
      : schema.length
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
      if (option.type === 'color') {
        return `<label class="module-option-field module-option-color"><span>${option.label}</span><input type="color" data-opt-key="${option.key}" value="${/^#[0-9a-fA-F]{6}$/.test(String(value)) ? value : option.default}" /></label>`;
      }
      if (option.type === 'text') {
        return `<label class="module-option-field"><span>${option.label}</span><input type="text" data-opt-key="${option.key}" value="${String(value).replace(/"/g, '&quot;')}" maxlength="80" /></label>`;
      }
      const output = `${Math.round(Number(value))}${option.unit || ''}`;
      return `<div class="field-row module-option-range"><label class="field-label">${option.label} <output data-opt-output="${option.key}">${output}</output></label><input type="range" data-opt-key="${option.key}" min="${option.min}" max="${option.max}" step="${option.step}" value="${value}" /></div>`;
    }).join('') + (mod.type === 'pianoRoll' ? this._midiTrackOptions(mod) : '');
    if (this.subpanelState.midiBus && !this.subpanelState.midiBus.hidden) this._renderMidiBus();
  }

  _midiTrackOptions(mod) {
    const midi = (this.state.midiLayers || []).find((layer) => layer.id === mod.options?.midiId) || this.state.midi;
    const trackNames = Array.isArray(midi?.trackNames) ? midi.trackNames : [];
    const trackCount = Math.max(0, Number(midi?.trackCount) || trackNames.length);
    const tracks = Array.from({ length: trackCount }, (_, index) => ({
      name: trackNames[index] || `Track ${index + 1}`,
    }));
    if (!tracks.length) {
      return '<div class="midi-track-empty">导入 MIDI 后，可在这里设置每条轨道的颜色、深度和 M / S。</div>';
    }
    const fallback = [this.state.settings.accent || '#ff4f8b', '#68e8ff', '#a98bff', '#ffc46b', '#b9ff8a', '#ff8a6b'];
    const colors = Array.isArray(mod.options?.trackColors) ? mod.options.trackColors : [];
    const depths = Array.isArray(mod.options?.trackDepths) ? mod.options.trackDepths : [];
    const mutes = Array.isArray(mod.options?.trackMutes) ? mod.options.trackMutes : [];
    const solos = Array.isArray(mod.options?.trackSolos) ? mod.options.trackSolos : [];
    const defaultDepth = Number(this._moduleOptionValue(mod, { key: 'trackDepth', default: 55 })) || 55;
    const order = this._midiTrackOrder(mod, midi);
    return `<div class="midi-track-options"><div class="midi-track-head"><span>轨道 / TRACKS</span><em>顺序控制纵深 · 上远下近</em></div>
      <div class="midi-track-list">${order.slice(0, 16).map((trackIndex, orderIndex) => {
        const track = tracks[trackIndex] || { name: `Track ${trackIndex + 1}` };
        const color = /^#[0-9a-fA-F]{6}$/.test(colors[trackIndex] || '') ? colors[trackIndex] : fallback[trackIndex % fallback.length];
        const depth = clamp(Number(depths[trackIndex] ?? defaultDepth) || 0, 0, 100);
        const name = String(track.name || `Track ${trackIndex + 1}`).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        return `<div class="midi-track-row" data-midi-track="${trackIndex}">
          <span class="midi-track-no">${String(orderIndex + 1).padStart(2, '0')}</span>
          <span class="midi-track-name" title="${name}">${name}</span>
          <button type="button" class="midi-track-ms midi-track-move" data-midi-up="${trackIndex}" title="上移（更远）">↑</button>
          <button type="button" class="midi-track-ms midi-track-move" data-midi-down="${trackIndex}" title="下移（更近）">↓</button>
          <button type="button" class="midi-track-ms ${mutes[trackIndex] ? 'active mute' : ''}" data-midi-mute="${trackIndex}" title="静音">M</button>
          <button type="button" class="midi-track-ms ${solos[trackIndex] ? 'active solo' : ''}" data-midi-solo="${trackIndex}" title="独奏">S</button>
          <input type="color" data-midi-color="${trackIndex}" value="${color}" title="轨道颜色" />
          <input type="range" data-midi-depth="${trackIndex}" min="0" max="100" step="5" value="${depth}" title="额外深度偏移" />
          <output data-midi-depth-out="${trackIndex}">${Math.round(depth)}%</output>
        </div>`;
      }).join('')}</div></div>`;
  }

  _midiMasterModule() {
    return this.state.modules.find((m) => m.type === 'pianoRoll' && m.options?.midiMaster)
      || this.state.modules.find((m) => m.type === 'pianoRoll')
      || null;
  }

  _rebuildMidiMerged() {
    const layers = this.state.midiLayers || [];
    const tracks = [];
    const notes = [];
    let duration = 0;
    let bpm = 0;
    for (const layer of layers) {
      const count = Math.max(0, Number(layer.trackCount) || layer.trackNames?.length || 0);
      const names = Array.isArray(layer.trackNames) ? layer.trackNames : [];
      const offsets = [];
      for (let local = 0; local < count; local++) {
        const globalIndex = tracks.length;
        offsets[local] = globalIndex;
        tracks.push({
          index: globalIndex,
          layerId: layer.id,
          localTrack: local,
          name: `${layer.title || 'MIDI'} · ${names[local] || `Track ${local + 1}`}`,
          trackName: names[local] || `Track ${local + 1}`,
        });
      }
      for (const note of layer.notes || []) {
        const globalIndex = offsets[note.track];
        if (globalIndex === undefined) continue;
        notes.push({ ...note, track: globalIndex, layerId: layer.id });
      }
      duration = Math.max(duration, Number(layer.duration) || 0);
      bpm = Math.max(bpm, Number(layer.bpm) || 0);
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    this.state.midiMerged = {
      id: 'merged',
      title: 'ALL MIDI',
      tracks,
      notes,
      trackNames: tracks.map((track) => track.name),
      trackCount: tracks.length,
      noteCount: notes.length,
      duration,
      bpm,
    };
    this.state.midi = this.state.midiMerged;
    return this.state.midiMerged;
  }

  _ensureMidiMaster() {
    const modules = this.state.modules.filter((m) => m.type === 'pianoRoll');
    let master = modules.find((m) => m.options?.midiMaster);
    const primary = master || modules[0];
    const baseOptions = { ...(primary?.options || {}) };
    if (!master) {
      master = primary || createModule('pianoRoll', this._findPlacement(MODULE_DEFS.pianoRoll.w, MODULE_DEFS.pianoRoll.h));
      if (!primary) this.state.modules.push(master);
    }
    master.options = { ...baseOptions, midiMaster: true };
    delete master.options.midiId;
    if (modules.length > 1) {
      const colors = [], depths = [], mutes = [], solos = [];
      for (const layer of this.state.midiLayers || []) {
        const source = modules.find((m) => m.options?.midiId === layer.id) || modules[0];
        const count = Math.max(0, Number(layer.trackCount) || 0);
        for (let index = 0; index < count; index++) {
          colors.push(source?.options?.trackColors?.[index] ?? null);
          const depth = source?.options?.trackDepths?.[index];
          depths.push(depth === undefined || depth === null || depth === '' ? null : Number(depth));
          mutes.push(!!source?.options?.trackMutes?.[index]);
          solos.push(!!source?.options?.trackSolos?.[index]);
        }
      }
      master.options.trackColors = colors;
      master.options.trackDepths = depths;
      master.options.trackMutes = mutes;
      master.options.trackSolos = solos;
      master.options.trackOrder = [];
    }
    master.hidden = false;
    master.title = master.title && master.title !== 'MIDI / PIANO ROLL' ? master.title : 'MIDI 3D';
    if (!this.state.modules.includes(master)) this.state.modules.push(master);
    const removed = modules.filter((m) => m !== master);
    if (removed.length) {
      this.state.modules = this.state.modules.filter((m) => !removed.includes(m));
      for (const mod of removed) this.visualizer?.states.delete(mod.id);
    }
    this.state.selectedId = master.id;
    this.visualizer?.syncOverlay();
    return master;
  }

  _midiLayerModule(layer) {
    return this.state.modules.find((m) => m.type === 'pianoRoll'
      && (m.options?.midiId === layer.id || m.id === layer.moduleId)) || null;
  }

  _midiTrackOrder(mod, midi) {
    const count = Math.max(0, Number(midi?.trackCount) || 0);
    const order = [];
    const seen = new Set();
    for (const value of (Array.isArray(mod.options?.trackOrder) ? mod.options.trackOrder : [])) {
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < count && !seen.has(index)) {
        seen.add(index);
        order.push(index);
      }
    }
    for (let index = 0; index < count; index++) {
      if (!seen.has(index)) order.push(index);
    }
    return order;
  }

  _moveMidiTrack(mod, midi, trackIndex, delta) {
    const order = this._midiTrackOrder(mod, midi);
    const position = order.indexOf(trackIndex);
    const target = clamp(position + delta, 0, order.length - 1);
    if (position < 0 || target === position) return;
    order.splice(position, 1);
    order.splice(target, 0, trackIndex);
    mod.options = { ...(mod.options || {}), trackOrder: order };
    this._persist();
  }

  _renderMidiBus() {
    if (!this.dom.midiBusList) return;
    const layers = this.state.midiLayers || [];
    const midi = this.state.midiMerged || this._rebuildMidiMerged();
    if (this.dom.midiBusCount) this.dom.midiBusCount.textContent = midi?.trackCount || 0;
    if (!layers.length || !midi?.trackCount) {
      this.dom.midiBusList.innerHTML = '<div class="midi-bus-empty">还没有 MIDI。一次可以选择多个 .mid / .midi 文件，所有轨道会强制合并进同一个 3D 钢琴卷帘模块。</div>';
      return;
    }
    const mod = this._midiMasterModule() || this._ensureMidiMaster();
    const busId = mod.id;
    const options = mod.options || {};
    const value = (key, fallback) => options[key] === undefined || options[key] === null || options[key] === '' ? fallback : options[key];
    const escape = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const palette = [this.state.settings.accent || '#ff4f8b', '#68e8ff', '#a98bff', '#ffc46b', '#b9ff8a', '#ff8a6b'];
    const fonts = [['Bahnschrift', 'Bahnschrift'], ['Segoe UI', 'Segoe UI'], ['Microsoft YaHei UI', '微软雅黑'], ['Georgia', 'Georgia'], ['Cascadia Code', 'Cascadia Code']];
    const colors = Array.isArray(options.trackColors) ? options.trackColors : [];
    const depths = Array.isArray(options.trackDepths) ? options.trackDepths : [];
    const mutes = Array.isArray(options.trackMutes) ? options.trackMutes : [];
    const solos = Array.isArray(options.trackSolos) ? options.trackSolos : [];
    const depthValue = Number(value('trackDepth', 55));
    const defaultDepth = Number.isFinite(depthValue) ? depthValue : 55;
    const checkbox = (key, label) => `<label class="check-row compact"><input type="checkbox" data-bus-layer="${busId}" data-bus-key="${key}" ${value(key, true) ? 'checked' : ''}/><span>${label}</span></label>`;
    const colorControl = (key, label) => `<label class="module-option-field module-option-color"><span>${label}</span><input type="color" data-bus-layer="${busId}" data-bus-key="${key}" value="${/^#[0-9a-fA-F]{6}$/.test(String(value(key, '#C7F8FF'))) ? value(key, '#C7F8FF') : '#C7F8FF'}" /></label>`;
    const selectControl = (key, label, opts) => `<label class="module-option-field"><span>${label}</span><select data-bus-layer="${busId}" data-bus-key="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(value(key, v)) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const rangeControl = (key, label, min, max, step, fallback, unit = '') => `<div class="field-row module-option-range"><label class="field-label">${label} <output data-bus-output="${busId}:${key}">${Math.round(Number(value(key, fallback)))}${unit}</output></label><input type="range" data-bus-layer="${busId}" data-bus-key="${key}" min="${min}" max="${max}" step="${step}" value="${value(key, fallback)}" /></div>`;
    const order = this._midiTrackOrder(mod, midi);
    const trackRows = order.map((trackIndex, orderIndex) => {
      const track = midi.tracks[trackIndex] || { name: `Track ${trackIndex + 1}` };
      const color = /^#[0-9a-fA-F]{6}$/.test(colors[trackIndex] || '') ? colors[trackIndex] : palette[trackIndex % palette.length];
      const depth = clamp(Number(depths[trackIndex] ?? defaultDepth) || 0, 0, 100);
      const name = escape(track.name || `Track ${trackIndex + 1}`);
      return `<div class="midi-track-row" data-bus-track="${trackIndex}">
        <span class="midi-track-no">${String(orderIndex + 1).padStart(2, '0')}</span>
        <span class="midi-track-name" title="${name}">${name}</span>
        <button type="button" class="midi-track-ms midi-track-move" data-bus-up="${trackIndex}" data-bus-layer="${busId}" title="上移（更远）">↑</button>
        <button type="button" class="midi-track-ms midi-track-move" data-bus-down="${trackIndex}" data-bus-layer="${busId}" title="下移（更近）">↓</button>
        <button type="button" class="midi-track-ms ${mutes[trackIndex] ? 'active mute' : ''}" data-bus-mute="${trackIndex}" data-bus-layer="${busId}" title="静音">M</button>
        <button type="button" class="midi-track-ms ${solos[trackIndex] ? 'active solo' : ''}" data-bus-solo="${trackIndex}" data-bus-layer="${busId}" title="独奏">S</button>
        <input type="color" data-bus-color="${trackIndex}" data-bus-layer="${busId}" value="${color}" title="轨道颜色" />
        <input type="range" data-bus-depth="${trackIndex}" data-bus-layer="${busId}" min="0" max="100" step="5" value="${depth}" title="额外深度偏移" />
        <output data-bus-depth-out="${busId}:${trackIndex}">${Math.round(depth)}%</output>
      </div>`;
    }).join('');
    this.dom.midiBusList.innerHTML = `<details class="midi-bus-layer" data-bus-card="${busId}" open>
      <summary><span class="midi-bus-layer-name">MIDI 3D 合并层</span><em>${midi.noteCount || 0} NOTES · ${midi.trackCount} TRACKS · ${layers.length} FILES</em><button type="button" class="mini-action" data-bus-select="${busId}">定位</button></summary>
      <div class="midi-bus-grid">
        ${selectControl('noteStyle', '音符样式', [['rect', '长方形'], ['rounded', '圆角长方形']])}
        ${rangeControl('speed', '滚动速度', 50, 250, 5, 100, '%')}
        ${selectControl('window', '时间窗口', [['4', '4 秒'], ['6', '6 秒'], ['10', '10 秒'], ['16', '16 秒'], ['20', '20 秒']])}
        ${rangeControl('trackDepth', '默认深度', 0, 100, 5, 55, '%')}
        ${rangeControl('noteThickness', '音符厚度', 50, 200, 5, 100, '%')}
        ${rangeControl('centerY', '垂直中心', 0, 100, 5, 50, '%')}
        ${rangeControl('vibrato', 'Vibrato', 0, 100, 5, 0, '%')}
        ${checkbox('allTrackColor', '统一轨道颜色')}
        ${colorControl('globalTrackColor', '统一颜色')}
        ${checkbox('grid', '节拍网格')}${checkbox('labels', '音名标签')}
        ${checkbox('showTitle', '显示标题')}${checkbox('showChords', '显示和弦')}
        <label class="module-option-field"><span>标题文字</span><input type="text" data-bus-layer="${busId}" data-bus-key="title" value="${escape(value('title', ''))}" maxlength="80" placeholder="ALL MIDI" /></label>
        ${selectControl('titlePosition', '标题位置', [['topLeft', '左上'], ['topCenter', '顶部居中'], ['topRight', '右上']])}
        ${colorControl('titleColor', '标题颜色')}${colorControl('chordColor', '和弦颜色')}
        ${rangeControl('titleSize', '标题字号', 12, 64, 1, 40, 'px')}
        ${selectControl('titleFont', '标题字体', fonts)}
        ${selectControl('titleAnimation', '标题动画', [['none', '无'], ['slide', '滑入'], ['fade', '淡入']])}
      </div>
      <div class="midi-bus-tracks">${trackRows}</div>
    </details>`;
  }

  _busMidiModule(layerId) {
    return this.state.modules.find((m) => m.type === 'pianoRoll'
      && (m.id === layerId || m.options?.midiMaster)) || this._midiMasterModule();
  }

  _bindMidiBus() {
    const list = this.dom.midiBusList;
    if (!list) return;
    list.addEventListener('input', (e) => {
      const layerId = e.target.closest('[data-bus-layer]')?.dataset.busLayer;
      const mod = this._busMidiModule(layerId);
      if (!mod) return;
      const busId = mod.id;
      const colorIndex = e.target.closest('[data-bus-color]');
      if (colorIndex) {
        const index = Number(colorIndex.dataset.busColor);
        const colors = Array.isArray(mod.options?.trackColors) ? mod.options.trackColors.slice() : [];
        colors[index] = colorIndex.value;
        mod.options = { ...(mod.options || {}), trackColors: colors };
        this._persist();
        return;
      }
      const depthIndex = e.target.closest('[data-bus-depth]');
      if (depthIndex) {
        const index = Number(depthIndex.dataset.busDepth);
        const depths = Array.isArray(mod.options?.trackDepths) ? mod.options.trackDepths.slice() : [];
        depths[index] = Number(depthIndex.value);
        mod.options = { ...(mod.options || {}), trackDepths: depths };
        const output = list.querySelector(`[data-bus-depth-out="${busId}:${index}"]`);
        if (output) output.textContent = `${Math.round(depths[index])}%`;
        this._persist();
        return;
      }
      const key = e.target.closest('[data-bus-key]')?.dataset.busKey;
      if (!key) return;
      let value;
      if (e.target.type === 'checkbox') value = !!e.target.checked;
      else if (e.target.type === 'range') value = Number(e.target.value);
      else value = e.target.value;
      mod.options = { ...(mod.options || {}), [key]: value };
      if (e.target.type === 'range') {
        const output = list.querySelector(`[data-bus-output="${busId}:${key}"]`);
        if (output) output.textContent = `${Math.round(value)}${key === 'titleSize' ? 'px' : key === 'speed' || key === 'trackDepth' ? '%' : ''}`;
      }
      this._persist();
    });
    list.addEventListener('click', (e) => {
      const select = e.target.closest('[data-bus-select]');
      if (select) {
        const mod = this._busMidiModule(select.dataset.busSelect);
        if (mod) this._syncSelectionUI(mod.id);
        return;
      }
      const addModule = e.target.closest('[data-bus-add-module]');
      if (addModule) {
        const layer = (this.state.midiLayers || []).find((item) => item.id === addModule.dataset.busAddModule);
        if (!layer) return;
        const placement = this._findPlacement(MODULE_DEFS.pianoRoll.w, MODULE_DEFS.pianoRoll.h);
        const mod = createModule('pianoRoll', placement);
        mod.title = String(layer.title || 'MIDI').slice(0, 44);
        mod.options = { ...(mod.options || {}), midiId: layer.id };
        this.state.modules.push(mod);
        layer.moduleId = mod.id;
        this.visualizer.syncOverlay();
        this._renderLibrary();
        this._syncCanvasMeta();
        this._persist();
        this._renderMidiBus();
        this._syncSelectionUI(mod.id);
        return;
      }
      const up = e.target.closest('[data-bus-up]');
      if (up) {
        const mod = this._busMidiModule(up.dataset.busLayer);
        if (!mod) return;
        this._moveMidiTrack(mod, this.state.midiMerged, Number(up.dataset.busUp), -1);
        this._renderMidiBus();
        return;
      }
      const down = e.target.closest('[data-bus-down]');
      if (down) {
        const mod = this._busMidiModule(down.dataset.busLayer);
        if (!mod) return;
        this._moveMidiTrack(mod, this.state.midiMerged, Number(down.dataset.busDown), 1);
        this._renderMidiBus();
        return;
      }
      const mute = e.target.closest('[data-bus-mute]');
      if (mute) {
        const mod = this._busMidiModule(mute.dataset.busLayer);
        if (!mod) return;
        const index = Number(mute.dataset.busMute);
        const mutes = Array.isArray(mod.options?.trackMutes) ? mod.options.trackMutes.slice() : [];
        mutes[index] = !mutes[index];
        mod.options = { ...(mod.options || {}), trackMutes: mutes };
        mute.classList.toggle('active', mutes[index]);
        mute.classList.toggle('mute', mutes[index]);
        this._persist();
        return;
      }
      const solo = e.target.closest('[data-bus-solo]');
      if (solo) {
        const mod = this._busMidiModule(solo.dataset.busLayer);
        if (!mod) return;
        const index = Number(solo.dataset.busSolo);
        const solos = Array.isArray(mod.options?.trackSolos) ? mod.options.trackSolos.slice() : [];
        solos[index] = !solos[index];
        mod.options = { ...(mod.options || {}), trackSolos: solos };
        solo.classList.toggle('active', solos[index]);
        solo.classList.toggle('solo', solos[index]);
        this._persist();
      }
    });
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
    this._renderMidiBus();
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

  _syncRangeTrackColor(bgHex = null) {
    const style = getComputedStyle(document.body);
    const raw = style.backgroundColor || '';
    const match = raw.match(/rgba?\(([^)]+)\)/i);
    let rgb = /^#[0-9a-fA-F]{6}$/.test(bgHex || '') ? [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16)) : null;
    if (!rgb && match) {
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) rgb = parts.slice(0, 3);
    }
    let light = true;
    if (rgb) {
      const [r, g, b] = rgb;
      const luminanceValue = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      light = luminanceValue > 0.55;
    } else {
      light = document.body.dataset.uiTheme === 'catbot' || document.body.dataset.uiMode === 'light';
    }
    const root = document.documentElement;
    root.style.setProperty('--range-track', light ? 'rgba(24,18,40,.22)' : 'rgba(255,255,255,.16)');
    root.style.setProperty('--range-track-hover', light ? 'rgba(24,18,40,.30)' : 'rgba(255,255,255,.24)');
  }

  _applyUiMode(mode, { silent = false, noPersist = false } = {}) {
    const value = ['auto', 'dark', 'light'].includes(mode) ? mode : 'auto';
    this.state.settings.uiMode = value;
    document.body.dataset.uiMode = value;
    this._syncRangeTrackColor();
    $$('#settingsModal [data-ui-mode-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.uiModeBtn === value);
    });
    if (!noPersist) this._persist();
    if (!silent) {
      const label = value === 'dark' ? '深色模式' : value === 'light' ? '浅色模式' : '跟随主题';
      this._toast(`界面模式已切换 · ${label}`, 'info', 1300);
    }
  }

  _applyUiFont(font, { silent = false, noPersist = false } = {}) {
    const value = ['default', 'Bahnschrift', 'Segoe UI', 'Microsoft YaHei UI', 'Georgia', 'Arial', 'Times New Roman', 'Cascadia Code', 'Consolas'].includes(font)
      ? font : 'default';
    this.state.settings.uiFont = value;
    const root = document.documentElement;
    if (value === 'default') {
      root.style.removeProperty('--ui-font');
      document.body.classList.remove('ui-font-custom');
    } else {
      const stacks = {
        'Bahnschrift': '"Bahnschrift", "Microsoft YaHei UI", sans-serif',
        'Segoe UI': '"Segoe UI", "Microsoft YaHei UI", sans-serif',
        'Microsoft YaHei UI': '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        'Georgia': 'Georgia, "Microsoft YaHei UI", serif',
        'Arial': 'Arial, "Microsoft YaHei UI", sans-serif',
        'Times New Roman': '"Times New Roman", "Microsoft YaHei UI", serif',
        'Cascadia Code': '"Cascadia Code", Consolas, monospace',
        'Consolas': 'Consolas, "Cascadia Code", monospace',
      };
      root.style.setProperty('--ui-font', stacks[value] || stacks.Bahnschrift);
      document.body.classList.add('ui-font-custom');
    }
    if (this.dom.uiFont) this.dom.uiFont.value = value;
    if (!noPersist) this._persist();
    if (!silent) this._toast(value === 'default' ? '已恢复默认字体' : `界面字体已切换 · ${value}`, 'info', 1800);
  }

  _applyUiTheme(theme, { silent = false, noPersist = false } = {}) {
    if (theme === 'studio') theme = 'vidi';
    if (theme === 'aura') theme = 'catbot';
    const value = ['neon', 'vidi', 'catbot'].includes(theme) ? theme : 'neon';
    this.state.settings.uiTheme = value;
    document.body.dataset.uiTheme = value;
    this._syncRangeTrackColor();
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

  _resolveThemeColors(settings = this.state.settings) {
    return resolveThemeColors(settings);
  }

  _applyThemePalette({ silent = false, noPersist = false } = {}) {
    const colors = this._resolveThemeColors();
    const s = this.state.settings;
    s.themeChart = s.themeChartFollow === 'custom' ? colors.chart : s.themeChart;
    s.accent = colors.chart;
    this._applyAccent(colors.chart, s.accentAlpha, { silent: true, noPersist: true });
    const root = document.documentElement;
    const set = (name, value) => root.style.setProperty(name, value);
    set('--bg', colors.bg);
    set('--bg-2', mixHex(colors.bg, colors.window, 0.25));
    set('--panel', colors.window);
    set('--panel-2', mixHex(colors.window, colors.bg, 0.18));
    set('--panel-3', mixHex(colors.window, colors.bg, 0.32));
    set('--text', colors.text);
    set('--muted', mixHex(colors.text, colors.bg, 0.46));
    set('--dim', mixHex(colors.text, colors.bg, 0.68));
    const textRgb = hexToRgb(colors.text);
    set('--line', `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.12)`);
    if (this.dom.themeBg) this.dom.themeBg.value = colors.bg;
    if (this.dom.themeWindow) this.dom.themeWindow.value = colors.window;
    if (this.dom.themeText) this.dom.themeText.value = colors.text;
    if (this.dom.themeChart) this.dom.themeChart.value = s.themeChart;
    if (this.dom.themeChartFollow) this.dom.themeChartFollow.value = s.themeChartFollow;
    this._syncRangeTrackColor(colors.bg);
    this.visualizer?.applyBackgroundSettings();
    if (!noPersist) this._persist();
    if (!silent) this._toast('界面四色已更新', 'info', 1600);
  }

  _setThemeColor(key, value) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    if (key === 'themeChart') this.state.settings.themeChartFollow = 'custom';
    this.state.settings[key] = value;
    this._applyThemePalette({ silent: true });
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
    this._applyUiFont(s.uiFont, { silent: true, noPersist: true });
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
    if (name === 'action') return this.dom.actionBuilderModal;
    if (name === 'keyframeEditor') return this.dom.keyframeEditorModal;
    if (name === 'licenses') return this.dom.licenseModal;
    if (name === 'developer') return this.dom.developerModal;
    return null;
  }

  _openModal(name) {
    const modal = this._modalElement(name);
    if (!modal) return;
    this._closeTimelineMenu?.();
    this._closeModuleMenu?.();
    this._closeKeyframeMenu?.();
    this._closePanelMenu?.();
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
    if (name === 'keyframeEditor') this._closeKeyframeMenu();
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
      timelineState: this.timelineState,
      info: this.state.info,
      midi: this.state.midi,
      midiLayers: this.state.midiLayers,
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
    const firstToken = rest.split(/\s+/)[0] || '';
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
      base.params.effect = tokens.effect || firstToken || 'blur';
      base.params.amount = num('amount', 35);
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.effect;
    } else if (type === 'text' || type === 'subtitle') {
      base.type = type === 'subtitle' ? 'subtitle' : 'text';
      const rawText = tokens.text ?? tokens.value ?? rest.replace(/[a-zA-Z_]+=(?:"[^"]*"|'[^']*'|[^\s]+)/g, '').trim();
      base.params.text = String(rawText).replace(/\\n/g, '\n');
      base.params.x = num('x', 0);
      base.params.y = num('y', type === 'subtitle' ? 360 : 0);
      base.params.size = num('size', 26);
      base.params.fadeIn = Math.max(0, num('fadeIn', 0.35));
      base.params.fadeOut = Math.max(0, num('fadeOut', 0.35));
      base.params.coordMode = 'absolute';
      if (base.type === 'subtitle') {
        base.params.lineGap = Math.max(0, num('lineGap', 8));
        base.params.scaleX = clamp(num('scaleX', 100), 20, 400);
        base.params.scaleY = clamp(num('scaleY', 100), 20, 400);
        base.params.role = tokens.role || 'main';
      }
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.text || '';
    } else if (type === 'genre') {
      base.type = 'genre';
      base.params.name = tokens.name || tokens.genre || firstBare || 'Genre';
      base.value = base.params.name;
    } else if (type === 'intro') {
      base.type = 'intro';
      base.params.blur = num('blur', 35);
      base.duration = Math.max(0.1, base.duration);
      base.value = 'intro';
    } else if (type === 'mash') {
      base.type = 'mash';
      base.params.title = tokens.title || 'Title';
      base.params.author = tokens.author || 'Artist';
      base.params.origin = tokens.origin || 'Origin';
      base.params.x = num('x', 0);
      base.params.y = num('y', 0);
      base.params.scaleX = clamp(num('scaleX', 100), 20, 400);
      base.params.scaleY = clamp(num('scaleY', 100), 20, 400);
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.title;
    } else if (type === 'color') {
      base.type = 'color';
      base.params.bg = tokens.bg || '#DCDCE8';
      base.params.primary = tokens.primary || '#0F1C4A';
      base.params.accent = tokens.accent || '#DE9FCA';
      base.params.ink = tokens.ink || '#0a0a0a';
      base.params.chartFollow = ['bg', 'primary', 'accent'].includes(tokens.chartFollow) ? tokens.chartFollow : 'custom';
      base.params.fadeIn = Math.max(0, num('fadeIn', 0.35));
      base.params.fadeOut = Math.max(0, num('fadeOut', 0.35));
      base.duration = Math.max(0, base.duration);
      base.value = base.params.accent;
    } else if (type === 'call' || type === 'batch') {
      base.type = 'batch';
      base.params.batch = tokens.batch || firstToken || 'batch-name';
      base.params.split = tokens.split === 'true';
      base.params.role = tokens.role || 'main';
      base.params.x = num('x', 0.5);
      base.params.y = num('y', 0.95);
      base.duration = Math.max(0.1, base.duration);
      base.value = base.params.batch;
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
      if (cue.type === 'subtitle') {
        return `${t} subtitle text="${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}" duration=${Number(cue.duration).toFixed(2)} x=${p.x ?? 0} y=${p.y ?? 360} size=${p.size ?? 26} fadeIn=${Number(p.fadeIn ?? 0.35).toFixed(2)} fadeOut=${Number(p.fadeOut ?? 0.35).toFixed(2)} lineGap=${Number(p.lineGap ?? 8).toFixed(1)} scaleX=${Number(p.scaleX ?? 100).toFixed(1)} scaleY=${Number(p.scaleY ?? 100).toFixed(1)} role=${p.role || 'main'}`;
      }
      return `${t} text text="${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}" duration=${Number(cue.duration).toFixed(2)} x=${p.x ?? 0} y=${p.y ?? 0} size=${p.size ?? 26} fadeIn=${Number(p.fadeIn ?? 0.35).toFixed(2)} fadeOut=${Number(p.fadeOut ?? 0.35).toFixed(2)}`;
    }
    if (cue.type === 'genre') return `${t} genre name=${/^[^\s"']+$/.test(p.name || cue.value || 'Genre') ? (p.name || cue.value || 'Genre') : `"${String(p.name || cue.value || 'Genre').replace(/"/g, '\\"')}"`}`;
    if (cue.type === 'intro') return `${t} intro duration=${Number(cue.duration).toFixed(2)} blur=${p.blur ?? 0}`;
    if (cue.type === 'batch') {
      const split = p.split === true ? 'true' : 'false';
      const role = split === 'true' ? ` role=${p.role || 'main'}` : '';
      return `${t} call ${p.batch || cue.value || 'batch-name'} split=${split}${role} x=${p.x ?? 0.5} y=${p.y ?? 0.95}`;
    }
    if (cue.type === 'mash') {
      return `${t} mash title="${String(p.title || cue.value || 'Title').replace(/"/g, '\\"')}" author="${String(p.author || 'Artist').replace(/"/g, '\\"')}" origin="${String(p.origin || 'Origin').replace(/"/g, '\\"')}" hold=${Number(cue.duration).toFixed(2)} x=${p.x ?? 0} y=${p.y ?? 0} scaleX=${Number(p.scaleX ?? 100).toFixed(1)} scaleY=${Number(p.scaleY ?? 100).toFixed(1)}`;
    }
    if (cue.type === 'color') {
      return `${t} color bg=${p.bg || '#DCDCE8'} primary=${p.primary || '#0F1C4A'} accent=${p.accent || '#DE9FCA'} ink=${p.ink || '#0a0a0a'} chartFollow=${p.chartFollow || 'custom'} duration=${Number(cue.duration).toFixed(2)} fadeIn=${Number(p.fadeIn || 0).toFixed(2)} fadeOut=${Number(p.fadeOut || 0).toFixed(2)}`;
    }
    if (cue.type === 'bpm') return `${t} bpm ${p.bpm ?? cue.value ?? 120}`;
    return `${t} ${cue.type}${cue.value ? ` text="${String(cue.value).replace(/"/g, '\\"')}"` : ''} duration=${Number(cue.duration).toFixed(2)}`;
  }).join('\n');
}

function bootStageMirror() {
  document.body.classList.add('stage-window');
  document.title = 'NEON//SCOPE — 独立舞台';
  const canvas = document.getElementById('stageMirrorCanvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const channel = new BroadcastChannel('neon-scope-stage-v1');
    let drawing = false;
    channel.onmessage = async (event) => {
      const data = event.data;
      if (data?.type !== 'frame' || !data.blob || drawing) return;
      drawing = true;
      try {
        const bitmap = await createImageBitmap(data.blob);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
      } catch { /* ignore malformed frame */ }
      drawing = false;
    };
    channel.postMessage({ type: 'stage-ready' });
    const heartbeat = setInterval(() => channel.postMessage({ type: 'stage-heartbeat' }), 1000);
    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeat);
      try { channel.postMessage({ type: 'stage-closed' }); channel.close(); } catch { /* noop */ }
    });
  } catch {
    ctx.fillStyle = '#f4e6ec';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('当前浏览器不支持独立舞台通道', canvas.width / 2, canvas.height / 2);
  }
}

function boot() {
  try {
    if (new URLSearchParams(location.search).has('stage')) {
      bootStageMirror();
      return;
    }
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
