import { STAGE_W, STAGE_H, clamp, formatTC, formatShortTime, mixHex, automationValueAt, resolveThemeColors } from './core.js';
import { BackgroundRenderer } from './background.js';
import { drawVisualModule } from './modules.js';

const GUIDE_THRESHOLD = 10;
const GRID = 8;
const MIN_W = 150;
const MIN_H = 100;
const STATIC_MODULE_TYPES = new Set(['basicInfo']);
const SLOW_MODULE_TYPES = new Set(['spectrogram', 'pianoRoll', 'peakSlope', 'stereoField', 'waveform', 'chladni']);

export class Visualizer {
  constructor({ canvas, stage, overlay, guideV, guideH, engine, state, callbacks = {} }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.stage = stage;
    this.overlay = overlay;
    this.guideV = guideV;
    this.guideH = guideH;
    this.engine = engine;
    this.state = state;
    this.callbacks = callbacks;
    this.states = new Map();
    this.moduleLayers = new Map();
    this.moduleKeys = new Map();
    this.layerFrame = 0;
    this.background = new BackgroundRenderer();
    this.running = false;
    this.exportMode = false;
    this._exportFps = 60;
    this.animClock = 0;
    this.lastTs = 0;
    this.fps = 0;
    this.frameMs = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsTimer = 0;
    this._previewW = 1280;
    this._previewH = 720;
    this._previewTimer = 0;
    this._lastDrawTs = 0;
    this._qualityAccum = 0;
    this.drag = null;
    this._guideTimer = 0;
    this._particles = Array.from({ length: 46 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 0.004,
      vy: -0.003 - Math.random() * 0.010,
      phase: Math.random() * Math.PI * 2,
      hue: i % 5,
    }));
    this._boundLoop = this._loop.bind(this);
    this._onResize = this._resize.bind(this);
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(stage.parentElement || stage);
    window.addEventListener('resize', this._onResize);
    this._bindStageEvents();
    this._resize();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    this._lastDrawTs = 0;
    this._qualityAccum = 0;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = 0;
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
    window.removeEventListener('resize', this._onResize);
  }

  setExportMode(on, width = 1920, height = 1080, fps = 60) {
    this.exportMode = !!on;
    this._exportFps = fps;
    this.overlay.style.display = on ? 'none' : '';
    if (on) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = true;
      this.background.resize(width, height);
      this._hideGuides();
    } else {
      this._resize();
    }
  }

  _applyPreviewResolution() {
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const quality = clamp(Number(this.state.settings.previewScale) || 100, 50, 120) / 100;
    const width = clamp(Math.round(rect.width * dpr * quality), 640, 1920);
    const height = Math.round(width * 9 / 16);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = true;
    }
    this._previewW = width;
    this._previewH = height;
    const backgroundScale = this.exportMode ? 1 : (this.state.settings.renderArchitecture === 'performance' ? 0.62 : 1);
    this.background.resize(Math.round(width * backgroundScale), Math.round(height * backgroundScale));
    this.callbacks.onPreviewResize?.({ width, height, cssWidth: Math.round(rect.width) });
  }

  _resize() {
    const viewport = this.stage.parentElement;
    if (!viewport) return;
    const vw = Math.max(120, viewport.clientWidth - 2);
    const vh = Math.max(80, viewport.clientHeight - 2);
    const scale = Math.min(vw / 16, vh / 9);
    const w = Math.max(160, Math.floor(scale * 16));
    const h = Math.max(90, Math.floor(scale * 9));
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    if (!this.exportMode) this._applyPreviewResolution();
    this.callbacks.onStageResize?.({ width: w, height: h });
  }

  _bindStageEvents() {
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.module-box')) return;
      if (this.exportMode) return;
      this.select(null);
    });
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.select(null);
    });
    this.overlay.addEventListener('contextmenu', (e) => {
      const box = e.target.closest('.module-box');
      if (!box || this.exportMode) return;
      e.preventDefault();
      e.stopPropagation();
      this.select(box.dataset.id);
      this.callbacks.onModuleMenu?.(box.dataset.id, e.clientX, e.clientY);
    });
    this.engine.onEnded = () => {
      this.callbacks.onEnded?.();
    };
  }

  select(id) {
    if (this.state.selectedId === id) return;
    this.state.selectedId = id;
    this.callbacks.onSelect?.(id);
    this.updateSelectionClasses();
  }

  updateSelectionClasses() {
    const boxes = this.overlay.querySelectorAll('.module-box');
    for (const box of boxes) {
      const selected = box.dataset.id === this.state.selectedId;
      box.classList.toggle('selected', selected);
      box.style.zIndex = selected ? '12' : '1';
    }
  }

  syncOverlay() {
    if (this.exportMode) return;
    const existing = new Map();
    for (const el of this.overlay.querySelectorAll('.module-box')) existing.set(el.dataset.id, el);
    const seen = new Set();
    for (const mod of this.state.modules) {
      seen.add(mod.id);
      let el = existing.get(mod.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'module-box';
        el.dataset.id = mod.id;
        el.innerHTML = `
          <span class="handle nw"></span><span class="handle ne"></span>
          <span class="handle sw"></span><span class="handle se"></span>
          <div class="resize-hint"></div>`;
        el.addEventListener('pointerdown', (e) => this._beginDrag(e, mod.id, el));
        this.overlay.appendChild(el);
      }
      el.dataset.label = (mod.title || mod.type).toUpperCase();
      el.style.left = `${mod.x / STAGE_W * 100}%`;
      el.style.top = `${mod.y / STAGE_H * 100}%`;
      el.style.width = `${mod.w / STAGE_W * 100}%`;
      el.style.height = `${mod.h / STAGE_H * 100}%`;
      el.style.display = mod.hidden ? 'none' : '';
      const selected = mod.id === this.state.selectedId;
      el.classList.toggle('selected', selected);
      el.style.zIndex = selected ? '12' : '1';
    }
    for (const [id, el] of existing) {
      if (!seen.has(id)) el.remove();
    }
    for (const id of this.moduleLayers.keys()) {
      if (!seen.has(id)) {
        this.moduleLayers.delete(id);
        this.moduleKeys.delete(id);
      }
    }
    this.overlay.style.pointerEvents = this.state.settings.editing && !this.exportMode ? '' : 'none';
  }

  updateModuleElement(mod) {
    const el = this.overlay.querySelector(`.module-box[data-id="${mod.id}"]`);
    if (!el) return;
    el.style.left = `${mod.x / STAGE_W * 100}%`;
    el.style.top = `${mod.y / STAGE_H * 100}%`;
    el.style.width = `${mod.w / STAGE_W * 100}%`;
    el.style.height = `${mod.h / STAGE_H * 100}%`;
  }

  _beginDrag(e, id, el) {
    if (e.button !== 0 || this.exportMode || !this.state.settings.editing) return;
    const mod = this.state.modules.find((m) => m.id === id);
    if (!mod) return;
    e.preventDefault();
    e.stopPropagation();
    this.select(id);
    const handle = e.target.closest('.handle');
    const mode = handle ? Array.from(handle.classList).find((c) => ['nw', 'ne', 'sw', 'se'].includes(c)) || 'move' : 'move';
    const rect = this.stage.getBoundingClientRect();
    this.drag = {
      id, mode, el,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: mod.x, startY: mod.y, startW: mod.w, startH: mod.h,
      scaleX: STAGE_W / rect.width,
      scaleY: STAGE_H / rect.height,
      moved: false,
      point: { x: 0, y: 0 },
    };
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => this._moveDrag(ev);
    const up = (ev) => {
      if (!this.drag) return;
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const moved = this.drag.moved;
      this.drag = null;
      this._hideGuides();
      if (moved) this.callbacks.onLayoutCommit?.(mod);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  _moveDrag(e) {
    const d = this.drag;
    if (!d) return;
    const mod = this.state.modules.find((m) => m.id === d.id);
    if (!mod) return;
    const dx = (e.clientX - d.startClientX) * d.scaleX;
    const dy = (e.clientY - d.startClientY) * d.scaleY;
    if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) d.moved = true;

    const snap = this.state.settings.snap;
    if (d.mode === 'move') {
      let nx = d.startX + dx;
      let ny = d.startY + dy;
      nx = clamp(nx, 0, STAGE_W - mod.w);
      ny = clamp(ny, 0, STAGE_H - mod.h);
      if (snap) {
        const sx = this._snapMoveAxis(nx, mod.w, 'x');
        const sy = this._snapMoveAxis(ny, mod.h, 'y');
        nx = sx.value;
        ny = sy.value;
        this._showGuides(sx.guide, sy.guide);
      } else {
        this._hideGuides();
      }
      mod.x = Math.round(nx);
      mod.y = Math.round(ny);
    } else {
      const geom = this._resizeGeometry(d.mode, dx, dy, d);
      if (snap) this._snapResize(geom, d.mode);
      this._applyResize(mod, geom);
    }
    this.updateModuleElement(mod);
    this.callbacks.onGeometry?.(mod);
  }

  _resizeGeometry(mode, dx, dy, d) {
    let x = d.startX, y = d.startY, w = d.startW, h = d.startH;
    if (mode.includes('e')) w = d.startW + dx;
    if (mode.includes('s')) h = d.startH + dy;
    if (mode.includes('w')) { x = d.startX + dx; w = d.startW - dx; }
    if (mode.includes('n')) { y = d.startY + dy; h = d.startH - dy; }
    return { x, y, w, h };
  }

  _applyResize(mod, g) {
    let x = g.x, y = g.y, w = g.w, h = g.h;
    if (w < MIN_W) {
      if (g.x !== mod.x) x = mod.x + mod.w - MIN_W;
      w = MIN_W;
    }
    if (h < MIN_H) {
      if (g.y !== mod.y) y = mod.y + mod.h - MIN_H;
      h = MIN_H;
    }
    x = clamp(x, 0, STAGE_W - w);
    y = clamp(y, 0, STAGE_H - h);
    w = Math.min(w, STAGE_W - x);
    h = Math.min(h, STAGE_H - y);
    mod.x = Math.round(x);
    mod.y = Math.round(y);
    mod.w = Math.round(w);
    mod.h = Math.round(h);
  }

  _snapMoveAxis(value, size, axis) {
    const threshold = GUIDE_THRESHOLD;
    const candidates = [];
    const stageSize = axis === 'x' ? STAGE_W : STAGE_H;
    candidates.push(
      { pos: 24, guide: 24 },
      { pos: (stageSize - size) / 2, guide: stageSize / 2 },
      { pos: stageSize - 24 - size, guide: stageSize - 24 },
    );
    for (const m of this.state.modules) {
      if (m.id === this.state.selectedId || m.hidden) continue;
      if (axis === 'x') {
        const center = m.x + m.w / 2;
        candidates.push(
          { pos: m.x, guide: m.x },
          { pos: m.x + m.w, guide: m.x + m.w },
          { pos: center - size / 2, guide: center },
        );
      } else {
        const center = m.y + m.h / 2;
        candidates.push(
          { pos: m.y, guide: m.y },
          { pos: m.y + m.h, guide: m.y + m.h },
          { pos: center - size / 2, guide: center },
        );
      }
    }
    let best = null;
    for (const candidate of candidates) {
      const diff = Math.abs(value - candidate.pos);
      if (diff <= threshold && (!best || diff < best.diff)) {
        best = { pos: candidate.pos, guide: candidate.guide, diff };
      }
    }
    if (best) return { value: best.pos, guide: best.guide };
    // Fine grid fallback, DAW-style.
    const grid = Math.round(value / GRID) * GRID;
    if (Math.abs(grid - value) <= 4.1) return { value: grid, guide: null };
    return { value, guide: null };
  }

  _snapResize(g, mode) {
    const threshold = GUIDE_THRESHOLD;
    const selected = this.state.modules.find((m) => m.id === this.state.selectedId);
    const candidatesX = [24, STAGE_W - 24, STAGE_W / 2];
    const candidatesY = [24, STAGE_H - 24, STAGE_H / 2];
    for (const m of this.state.modules) {
      if (m.id === selected?.id || m.hidden) continue;
      candidatesX.push(m.x, m.x + m.w, m.x + m.w / 2);
      candidatesY.push(m.y, m.y + m.h, m.y + m.h / 2);
    }
    if (mode.includes('e')) {
      const right = g.x + g.w;
      let best = null;
      for (const c of candidatesX) {
        const diff = Math.abs(right - c);
        if (diff <= threshold && (!best || diff < best.diff)) best = { c, diff };
      }
      if (best) { g.w = best.c - g.x; this._showGuides(best.c, null); }
      else g.w = Math.round(g.w / GRID) * GRID;
    }
    if (mode.includes('s')) {
      const bottom = g.y + g.h;
      let best = null;
      for (const c of candidatesY) {
        const diff = Math.abs(bottom - c);
        if (diff <= threshold && (!best || diff < best.diff)) best = { c, diff };
      }
      if (best) { g.h = best.c - g.y; this._showGuides(null, best.c); }
      else g.h = Math.round(g.h / GRID) * GRID;
    }
    if (mode.includes('w')) g.x = Math.round(g.x / GRID) * GRID;
    if (mode.includes('n')) g.y = Math.round(g.y / GRID) * GRID;
  }

  _showGuides(gx, gy) {
    if (gx != null) {
      this.guideV.style.left = `${(gx / STAGE_W) * 100}%`;
      this.guideV.classList.add('on');
    } else {
      this.guideV.classList.remove('on');
    }
    if (gy != null) {
      this.guideH.style.top = `${(gy / STAGE_H) * 100}%`;
      this.guideH.classList.add('on');
    } else {
      this.guideH.classList.remove('on');
    }
  }

  _hideGuides() {
    this.guideV.classList.remove('on');
    this.guideH.classList.remove('on');
  }

  nudgeSelected(dx, dy) {
    const mod = this.state.modules.find((m) => m.id === this.state.selectedId);
    if (!mod || !this.state.settings.editing) return false;
    mod.x = Math.round(clamp(mod.x + dx, 0, STAGE_W - mod.w));
    mod.y = Math.round(clamp(mod.y + dy, 0, STAGE_H - mod.h));
    this.updateModuleElement(mod);
    this.callbacks.onGeometry?.(mod);
    this.callbacks.onLayoutCommit?.(mod);
    return true;
  }

  _canvasAccent() {
    const s = this.state.settings;
    const alpha = s.accentAlpha == null ? 1 : s.accentAlpha;
    return alpha >= 0.999 ? s.accent : mixHex(s.accent, '#060309', 1 - alpha);
  }

  _moduleAccent(mod) {
    const s = this.state.settings;
    if (!mod.color) return this._canvasAccent();
    const alpha = mod.colorAlpha == null ? 1 : mod.colorAlpha;
    return alpha >= 0.999 ? mod.color : mixHex(mod.color, '#060309', 1 - alpha);
  }

  applyBackgroundSettings() {
    const s = this.state.settings;
    this.background.setAccent(this._canvasAccent());
    this.background.setMode(s.bgMode);
    this.background.setRendererMode(s.rendererMode);
    this.background.setAmount(s.bgEnergy);
    this.background.setImageSettings(s.bgDim, s.bgBlur, s.bgContain);
    this.background.setColorSettings(s.bgColor, s.bgColorAlpha);
    this.background.setMotion(s.bgMotion, s.bgMotionAmount, s.bgMotionSpeed, s.bgMotionDirection);
  }

  setBackgroundImage(img, meta = {}) {
    this.background.setImage(img, meta);
    this.background.setImageSettings(this.state.settings.bgDim, this.state.settings.bgBlur, this.state.settings.bgContain);
  }

  _previewTargetFps() {
    if (this.exportMode) return Math.max(1, Number(this._exportFps) || 60);
    const value = Number(this.state.settings.previewFps);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  _scheduleNext() {
    if (!this.running) return;
    const vsync = this.exportMode || this.state.settings.previewVsync !== false;
    const fps = this._previewTargetFps();
    if (vsync || fps === 0) {
      if (fps === 0 && !vsync) {
        this._previewTimer = setTimeout(() => {
          this._previewTimer = 0;
          this._loop(performance.now());
        }, 0);
      } else {
        this._raf = requestAnimationFrame(this._boundLoop);
      }
      return;
    }
    const elapsed = this._lastDrawTs ? performance.now() - this._lastDrawTs : 0;
    const delay = Math.max(0, 1000 / fps - elapsed);
    this._previewTimer = setTimeout(() => {
      this._previewTimer = 0;
      this._loop(performance.now());
    }, delay);
  }

  _loop(ts) {
    if (!this.running) return;
    const target = this._previewTargetFps();
    const vsync = this.exportMode || this.state.settings.previewVsync !== false;
    const interval = target ? 1000 / target : 0;
    if (interval && this._lastDrawTs && ts - this._lastDrawTs < interval - 1) {
      this._scheduleNext();
      return;
    }
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.1) dt = 0.1;
    this._lastDrawTs = ts;
    this.animClock += dt;
    this._fpsAccum += dt;
    this._fpsFrames += 1;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._fpsTimer = 0;
      this.callbacks.onFps?.(this.fps);
    }

    const drawStarted = performance.now();
    const frame = this.engine.analyze(dt);
    this.engine.onEnded = this.engine.onEnded || null;
    this._draw(frame, dt);
    this.callbacks.onTick?.(frame, this.fps, dt);
    const drawMs = performance.now() - drawStarted;
    this.frameMs = this.frameMs ? this.frameMs * 0.88 + drawMs * 0.12 : drawMs;
    if (!this.exportMode && this.state.settings.dynamicResolution !== false) {
      this._qualityAccum += dt;
      if (this._qualityAccum >= 1.8) {
        this._qualityAccum = 0;
        const targetFps = Math.max(10, Number(this.state.settings.previewFps) || 60);
        const targetMs = 1000 / targetFps;
        const current = clamp(Number(this.state.settings.previewScale) || 100, 50, 120);
        let next = current;
        if (this.frameMs > targetMs * 1.22 && current > 50) next = Math.max(50, current - 5);
        else if (this.frameMs < targetMs * 0.62 && current < 100) next = Math.min(100, current + 5);
        if (next !== current) {
          this.state.settings.previewScale = next;
          this._applyPreviewResolution();
          this.callbacks.onPreviewScale?.(next);
        }
      }
    }
    this._scheduleNext();
  }

  _basePalette() {
    return resolveThemeColors(this.state.settings);
  }

  _stagePalette(time) {
    let palette = this._basePalette();
    for (const cue of this.state.animationCues || []) {
      if (cue.type !== 'color' || time < cue.time) continue;
      if (cue.duration > 0 && time > cue.time + cue.duration) continue;
      const p = cue.params || {};
      const relative = time - cue.time;
      const auto = (prop, fallback, kind = 'number') => automationValueAt(cue.keys?.[prop], relative, fallback, kind);
      const fadeIn = Math.max(0, Number(auto('fadeIn', p.fadeIn ?? 0.35)) || 0);
      const fadeOut = Math.max(0, Number(auto('fadeOut', p.fadeOut ?? 0.35)) || 0);
      let weight = 1;
      if (fadeIn > 0) weight = Math.min(weight, relative / fadeIn);
      if (cue.duration > 0 && fadeOut > 0) weight = Math.min(weight, (cue.duration - relative) / fadeOut);
      weight = clamp(weight, 0, 1);
      const colors = {
        bg: auto('bg', p.bg || palette.bg, 'color'),
        window: auto('primary', p.primary || palette.window, 'color'),
        text: auto('accent', p.accent || palette.text, 'color'),
      };
      const follow = p.chartFollow || 'custom';
      colors.chart = follow === 'bg' ? colors.bg
        : follow === 'primary' ? colors.window
          : follow === 'accent' ? colors.text
            : auto('ink', p.ink || palette.chart, 'color');
      palette = {
        bg: mixHex(palette.bg, colors.bg, weight),
        window: mixHex(palette.window, colors.window, weight),
        text: mixHex(palette.text, colors.text, weight),
        chart: mixHex(palette.chart, colors.chart, weight),
      };
    }
    return palette;
  }

  _draw(frame, dt) {
    const ctx = this.ctx;
    const w = STAGE_W, h = STAGE_H;
    const s = this.state.settings;
    const palette = this._stagePalette(frame.time);
    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060309';
    ctx.fillRect(0, 0, w, h);

    this.background.setMode(s.bgMode);
    this.background.setRendererMode(s.rendererMode);
    this.background.setAccent(this._canvasAccent());
    this.background.setAmount(s.bgEnergy);
    this.background.setImageSettings(s.bgDim, s.bgBlur, s.bgContain);
    this.background.setColorSettings(s.bgColor, s.bgColorAlpha);
    this.background.setMotion(s.bgMotion, s.bgMotionAmount, s.bgMotionSpeed, s.bgMotionDirection);
    this.background.render(ctx, w, h, frame, this.animClock, {
      amount: s.bgEnergy, dim: s.bgDim,
    });

    this._drawAtmosphere(ctx, w, h, frame, s);
    const sorted = this.state.modules.filter((m) => !m.hidden);
    const renderArchitecture = s.renderArchitecture || 'adaptive';
    const computeArchitecture = s.computeArchitecture || 'deferred';
    const layered = renderArchitecture !== 'direct' && computeArchitecture !== 'main';
    this.layerFrame++;
    for (const mod of sorted) {
      if (layered) this._drawModuleLayered(ctx, mod, this._moduleAccent(mod), frame, palette, renderArchitecture, computeArchitecture);
      else this._drawModuleSafe(ctx, mod, this._moduleAccent(mod), frame, palette);
    }
    this._drawOverlayEffects(ctx, w, h, frame, s);
    this._drawInfoCard(ctx, w, h);
    this._drawAnimationCues(ctx, w, h, frame);
    this._drawMotionOverlay(ctx, w, h, frame, s);

    if (this.exportMode && s.watermark) this._drawWatermark(ctx, w, h, frame);
  }

  _drawInfoCard(ctx, w, h) {
    const info = this.state.info;
    if (!info?.show) return;
    const title = info.title || 'Untitled signal';
    const artist = info.artist || 'Unknown source';
    const album = info.album || '';
    const bpm = info.bpm ? `${info.bpm} BPM` : '';
    const accent = hexToRgbSafe(this.state.settings.accent);
    const x = 46, y = 46, cw = 370, ch = 112;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(5,3,9,.78)';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},.48)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    const cover = info.cover;
    if (cover) {
      if (this._infoCoverSrc !== cover) {
        this._infoCoverSrc = cover;
        const img = new Image();
        img.onload = () => { this._infoCoverImage = img; };
        img.src = cover;
      }
      if (this._infoCoverImage) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 12, y + 14, 84, 84);
        ctx.clip();
        ctx.drawImage(this._infoCoverImage, x + 12, y + 14, 84, 84);
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},.35)`;
        ctx.fillRect(x + 12, y + 14, 84, 84);
      }
    } else {
      ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},.24)`;
      ctx.fillRect(x + 12, y + 14, 84, 84);
      ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},.5)`;
      ctx.strokeRect(x + 12.5, y + 14.5, 83, 83);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '8px "Cascadia Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('COVER', x + 54, y + 60);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff4f8';
    ctx.font = '600 20px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
    ctx.fillText(title, x + 110, y + 36, cw - 124);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '11px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
    ctx.fillText(artist, x + 110, y + 56, cw - 124);
    ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},.82)`;
    ctx.font = '8px "Cascadia Code", monospace';
    const meta = [album, info.genre, bpm].filter(Boolean).join('  ·  ');
    if (meta) ctx.fillText(meta, x + 110, y + 80, cw - 124);
    ctx.fillStyle = 'rgba(255,255,255,.32)';
    ctx.font = '7px "Cascadia Code", monospace';
    ctx.fillText('NOW PLAYING', x + 110, y + 98);
    ctx.restore();
  }

  _drawIntroBand(ctx, w, h, cue, progress, alpha) {
    if (alpha <= 0.005) return;
    const info = this.state.info || {};
    const engine = this.engine || {};
    const basic = (this.state.modules || []).find((mod) => mod.type === 'basicInfo');
    const opt = basic?.options || {};
    const primaryColor = /^#[0-9a-fA-F]{6}$/.test(opt.primaryColor || '') ? opt.primaryColor : '#111a3b';
    const secondaryColor = /^#[0-9a-fA-F]{6}$/.test(opt.secondaryColor || '') ? opt.secondaryColor : 'rgba(25,28,60,.5)';
    const cardBg = /^#[0-9a-fA-F]{6}$/.test(opt.cardBg || '') ? opt.cardBg : '#eeebf4';
    const accent = this.state.settings.accent || '#ff4f8b';
    const title = info.title || engine.track?.name || 'Untitled signal';
    const composer = info.composer || info.artist || engine.track?.artist || 'Unknown source';
    const album = info.album || 'Album';
    const trackNo = info.trackNo || '—';

    const relative = Number(cue.duration) > 0 ? progress * Number(cue.duration) : 0;
    const blurAmount = clamp(Number(automationValueAt(cue.keys?.blur, relative, cue.params?.blur ?? 35)) || 0, 0, 100);
    const blurPx = 6 + blurAmount * 0.45;

    // Keep only the central information band; the world outside it is a
    // defocused copy of the live scene.
    try {
      if (!this._introBlurCanvas) this._introBlurCanvas = document.createElement('canvas');
      if (this._introBlurCanvas.width !== w || this._introBlurCanvas.height !== h) {
        this._introBlurCanvas.width = w;
        this._introBlurCanvas.height = h;
      }
      const blurCtx = this._introBlurCanvas.getContext('2d');
      blurCtx.clearRect(0, 0, w, h);
      blurCtx.drawImage(ctx.canvas, 0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
      ctx.drawImage(this._introBlurCanvas, -24, -24, w + 48, h + 48);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha * 0.28;
      ctx.fillStyle = '#09050d';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    } catch { /* optional */ }

    const ease = Math.min(1, progress * 6) * Math.min(1, (1 - progress) * 6);
    const scale = 0.985 + ease * 0.015;
    const bandTop = h * 0.18;
    const bandH = h * 0.64;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, bandTop, w, bandH);
    ctx.fillStyle = 'rgba(25,28,60,.035)';
    for (let x = 0; x < w; x += Math.max(34, w / 22)) ctx.fillRect(x, bandTop, 1, bandH);
    for (let y = bandTop; y < bandTop + bandH; y += Math.max(30, bandH / 5)) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = accent;
    ctx.fillRect(0, bandTop, w, 2);
    ctx.fillRect(0, bandTop + bandH - 2, w, 2);

    const pad = w * 0.045;
    const cover = Math.min(bandH - pad * 1.2, w * 0.235);
    const coverX = pad;
    const coverY = bandTop + (bandH - cover) / 2;
    ctx.fillStyle = 'rgba(25,28,60,.06)';
    ctx.fillRect(coverX, coverY, cover, cover);
    const coverSrc = info.cover || '';
    if (coverSrc && this._introCoverSrc !== coverSrc) {
      this._introCoverSrc = coverSrc;
      const img = new Image();
      img.onload = () => { this._introCoverImage = img; };
      img.src = coverSrc;
    }
    if (this._introCoverImage) {
      const img = this._introCoverImage;
      const sc = Math.max(cover / img.width, cover / img.height);
      const dw = img.width * sc;
      const dh = img.height * sc;
      ctx.save();
      ctx.beginPath(); ctx.rect(coverX, coverY, cover, cover); ctx.clip();
      ctx.drawImage(img, coverX + (cover - dw) / 2, coverY + (cover - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(25,28,60,.2)';
      ctx.setLineDash([5, 6]);
      ctx.strokeRect(coverX + 10, coverY + 10, cover - 20, cover - 20);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(25,28,60,.35)';
      ctx.font = `600 ${Math.max(8, cover * 0.06)}px "Cascadia Code", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('COVER ART', coverX + cover / 2, coverY + cover / 2);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = 'rgba(25,28,60,.34)';
    ctx.lineWidth = 1;
    ctx.strokeRect(coverX + 0.5, coverY + 0.5, cover - 1, cover - 1);

    const tx = coverX + cover + w * 0.045;
    const tw = w - tx - pad;
    const tiny = w * 0.0072;
    const titleSize = Math.min(w * 0.068, bandH * 0.24);
    ctx.fillStyle = primaryColor;
    ctx.font = `700 ${titleSize}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
    ctx.fillText(`{${title}}`, tx, bandTop + bandH * 0.34, tw);
    ctx.fillStyle = accent;
    ctx.fillRect(tx, bandTop + bandH * 0.4, Math.min(tw * 0.45, w * 0.22), 2);

    const rowY = bandTop + bandH * 0.62;
    const colW = tw / 3;
    const labels = ['ARTIST', 'ALBUM', 'TRACK'];
    const values = [composer, album, trackNo];
    for (let i = 0; i < 3; i += 1) {
      const cx = tx + i * colW;
      ctx.fillStyle = secondaryColor;
      ctx.font = `500 ${tiny}px "Cascadia Code", monospace`;
      ctx.fillText(labels[i], cx, rowY);
      ctx.fillStyle = primaryColor;
      ctx.font = `600 ${w * 0.011}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
      ctx.fillText(String(values[i]), cx, rowY + bandH * 0.115, colW - 14);
    }
    ctx.fillStyle = secondaryColor;
    ctx.font = `500 ${tiny}px "Cascadia Code", monospace`;
    ctx.fillText(`GENRE ${info.genre || 'Genre'}    BPM ${info.bpm || '—'}    SAMPLE ${engine.sampleRate ? (engine.sampleRate / 1000).toFixed(1) + ' kHz' : '—'}    DURATION ${engine.duration ? formatShortTime(engine.duration) : '—'}`, tx, bandTop + bandH * 0.86, tw);
    ctx.restore();
  }

  _drawAnimationCues(ctx, w, h, frame) {
    const cues = this.state.animationCues || [];
    if (!cues.length) return;
    const t = Number(frame?.time) || 0;
    const activeSubtitles = [];
    for (const cue of cues) {
      const persistent = Number(cue.duration) <= 0;
      if (persistent ? t < cue.time : (t < cue.time || t > cue.time + cue.duration)) continue;
      const p = cue.params || {};
      const relative = Math.max(0, t - cue.time);
      const auto = (prop, fallback, kind = 'number') => automationValueAt(cue.keys?.[prop], relative, fallback, kind);
      const progress = persistent ? 0.5 : clamp((t - cue.time) / Math.max(0.1, cue.duration), 0, 1);
      const alpha = (persistent ? 0.62 : Math.sin(Math.min(1, progress) * Math.PI) * 0.8 + 0.2) * clamp(auto('opacity', 1), 0, 1);
      if (cue.type === 'subtitle') {
        activeSubtitles.push(cue);
        continue;
      }
      if (cue.type === 'flash') {
        const rgb = hexToRgbSafe(/^#[0-9a-fA-F]{6}$/.test(cue.value) ? cue.value : '#ffffff');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.38})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (cue.type === 'color') {
        // Palette is resolved before modules are drawn; a color cue must not
        // tint the application UI or the stage background.
      } else if (cue.type === 'tint') {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const color = cue.value || this.state.settings.accent;
        const rgb = hexToRgbSafe(/^#[0-9a-fA-F]{6}$/.test(color) ? color : this.state.settings.accent);
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.20})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (cue.type === 'fade') {
        const a = Math.min(1, progress < 0.35 ? progress / 0.35 : (1 - progress) / 0.35);
        ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1) * 0.92})`;
        ctx.fillRect(0, 0, w, h);
      } else if (cue.type === 'genre') {
        const genre = p.name || cue.value || 'Genre';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(5,3,9,.55)';
        ctx.fillRect(36, h - 74, 260, 32);
        ctx.strokeStyle = rgbaSafe(this.state.settings.accent, .45);
        ctx.strokeRect(36.5, h - 73.5, 259, 31);
        ctx.fillStyle = 'rgba(255,255,255,.78)';
        ctx.font = '11px "Cascadia Code", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(genre, 50, h - 53);
        ctx.restore();
      } else if (cue.type === 'intro') {
        const fade = Math.min(1, progress * 5, (1 - progress) * 5);
        this._drawIntroBand(ctx, w, h, cue, progress, Math.max(0, fade));
      } else if (cue.type === 'effect') {
        const effect = p.effect || 'blur';
        if (effect === 'blur' || effect === 'motion-blur') {
          try {
            const amount = clamp(Number(auto('amount', p.amount ?? 35)) || 35, 1, 100);
            if (!this._fxCanvas) this._fxCanvas = document.createElement('canvas');
            if (this._fxCanvas.width !== w || this._fxCanvas.height !== h) {
              this._fxCanvas.width = w;
              this._fxCanvas.height = h;
            }
            const fx = this._fxCanvas.getContext('2d');
            fx.clearRect(0, 0, w, h);
            fx.drawImage(ctx.canvas, 0, 0, w, h);
            ctx.save();
            ctx.globalAlpha = Math.min(0.72, alpha * 0.7);
            ctx.filter = `blur(${Math.round(amount / 7)}px)`;
            ctx.drawImage(this._fxCanvas, 0, 0, w, h);
            ctx.restore();
          } catch { /* optional */ }
        } else if (effect === 'exposure') {
          const exposure = clamp(Number(auto('amount', p.amount ?? 28)) || 28, 0, 100) / 100;
          ctx.save();
          ctx.fillStyle = `rgba(255,255,255,${alpha * exposure * 0.55})`;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        } else if (effect === 'glow') {
          const rgb = hexToRgbSafe(this.state.settings.accent);
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.28})`;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
      } else if (cue.type === 'bpm') {
        const label = `${auto('bpm', p.bpm ?? cue.value ?? 120)} BPM`;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(5,3,9,.55)';
        ctx.fillRect(w - 176, 36, 140, 40);
        ctx.fillStyle = '#fff4f8';
        ctx.font = '600 16px "Cascadia Code", monospace';
        ctx.fillText(label, w - 48, 61);
        ctx.restore();
      } else if (cue.type === 'mash') {
        const title = p.title || cue.value || 'Title';
        const author = p.author || 'Artist';
        const origin = p.origin || 'Origin';
        ctx.save();
        ctx.globalAlpha = alpha;
        const bw = Math.min(w * 0.62, 760);
        const bh = Math.min(h * 0.42, 300);
        const ox = Number(auto('x', p.x ?? 0));
        const oy = Number(auto('y', p.y ?? 0));
        const sx = clamp((Number(auto('scaleX', p.scaleX ?? 100)) || 100) / 100, 0.2, 4);
        const sy = clamp((Number(auto('scaleY', p.scaleY ?? 100)) || 100) / 100, 0.2, 4);
        ctx.translate(w / 2 + ox, h / 2 + oy);
        ctx.scale(sx, sy);
        const x = -bw / 2;
        const y = -bh / 2;
        ctx.fillStyle = 'rgba(5, 8, 20, .72)';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = rgbaSafe(p.accent || this.state.settings.accent, .65);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 38px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
        ctx.fillText(title, 0, y + 54, bw - 40);
        ctx.fillStyle = rgbaSafe(p.accent || this.state.settings.accent, .92);
        ctx.font = '600 15px "Cascadia Code", monospace';
        ctx.fillText(author, 0, y + 88, bw - 40);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.font = '10px "Cascadia Code", monospace';
        ctx.fillText(origin, 0, y + 112, bw - 40);
        ctx.restore();
      } else if (cue.type === 'batch') {
        // Action groups are expanded by the editor; the call marker itself is silent.
      } else {
        const text = p.text || cue.value || 'NEON//SCOPE';
        const size = clamp(Number(auto('size', p.size ?? 26)) || 26, 8, 200) * (h / 1080);
        const x = w / 2 + Number(auto('x', p.x ?? 0));
        const y = h / 2 + Number(auto('y', p.y ?? 0));
        const fadeIn = Math.max(0, Number(auto('fadeIn', p.fadeIn ?? 0.35)) || 0);
        const fadeOut = Math.max(0, Number(auto('fadeOut', p.fadeOut ?? 0.35)) || 0);
        let textFade = 1;
        if (!persistent) {
          if (fadeIn > 0) textFade = Math.min(textFade, clamp(relative / fadeIn, 0, 1));
          if (fadeOut > 0) textFade = Math.min(textFade, clamp((cue.duration - relative) / fadeOut, 0, 1));
        }
        ctx.save();
        ctx.globalAlpha = clamp(auto('opacity', 1), 0, 1) * textFade;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = `600 ${size}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
        ctx.fillText(text, x, y, w * 0.84);
        ctx.restore();
      }
    }
    if (activeSubtitles.length) this._drawSubtitles(ctx, w, h, t, activeSubtitles);
  }

  _drawSubtitles(ctx, w, h, time, cues) {
    const sorted = cues.slice().sort((a, b) => a.time - b.time);
    const layouts = [];
    for (const cue of sorted) {
      const p = cue.params || {};
      const persistent = Number(cue.duration) <= 0;
      const relative = Math.max(0, time - cue.time);
      const auto = (prop, fallback, kind = 'number') => automationValueAt(cue.keys?.[prop], relative, fallback, kind);
      const size = clamp(Number(auto('size', p.size ?? 26)) || 26, 8, 200) * (h / 1080);
      const lineGap = Math.max(0, Number(auto('lineGap', p.lineGap ?? 8)) || 0) * (h / 1080);
      const lineH = size * 1.24 + lineGap;
      const x = w / 2 + Number(auto('x', p.x ?? 0));
      const y = h / 2 + Number(auto('y', p.y ?? 360));
      const fadeIn = Math.max(0, Number(auto('fadeIn', p.fadeIn ?? 0.35)) || 0);
      const fadeOut = Math.max(0, Number(auto('fadeOut', p.fadeOut ?? 0.35)) || 0);
      let fade = 1;
      if (!persistent) {
        if (fadeIn > 0) fade = Math.min(fade, clamp(relative / fadeIn, 0, 1));
        if (fadeOut > 0) fade = Math.min(fade, clamp((cue.duration - relative) / fadeOut, 0, 1));
      }
      const alpha = clamp(auto('opacity', 1), 0, 1) * fade;
      const scaleX = clamp((Number(auto('scaleX', p.scaleX ?? 100)) || 100) / 100, 0.2, 4);
      const scaleY = clamp((Number(auto('scaleY', p.scaleY ?? 100)) || 100) / 100, 0.2, 4);
      ctx.font = `500 ${size}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
      const maxWidth = w * 0.82;
      const text = String(p.text || cue.value || '').replace(/\r\n?/g, '\n');
      const lines = [];
      for (const paragraph of text.split('\n')) {
        if (!paragraph) { lines.push(''); continue; }
        let line = '';
        for (const ch of Array.from(paragraph)) {
          if (line && ctx.measureText(line + ch).width > maxWidth) {
            lines.push(line);
            line = ch;
          } else {
            line += ch;
          }
        }
        if (line) lines.push(line);
      }
      if (!lines.length) lines.push('');
      const maxLine = Math.max(...lines.map((line) => ctx.measureText(line).width));
      layouts.push({ cue, p, x, y, size, lineH, lines, maxLine, alpha, scaleX, scaleY });
    }
    if (!layouts.length) return;
    const baseBottom = Math.max(...layouts.map((item) => item.y));
    let bottom = baseBottom;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const item of layouts) {
      const boxW = Math.max(180, Math.min(w * 0.88, item.maxLine + 44));
      const boxH = Math.max(item.lineH + 22, item.lines.length * item.lineH + 20);
      const scaledH = boxH * item.scaleY;
      const top = bottom - scaledH;
      const centerY = top + scaledH / 2;
      ctx.save();
      ctx.translate(item.x, centerY);
      ctx.scale(item.scaleX, item.scaleY);
      ctx.globalAlpha = item.alpha;
      ctx.shadowColor = 'rgba(20,15,35,.35)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = 'rgba(246,243,249,.94)';
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = 'rgba(45,38,68,.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-boxW / 2 + 0.5, -boxH / 2 + 0.5, boxW - 1, boxH - 1);
      ctx.fillStyle = 'rgba(255,79,139,.8)';
      ctx.fillRect(-boxW / 2, -boxH / 2, 3, boxH);
      ctx.fillStyle = '#29243a';
      ctx.font = `500 ${item.size}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
      const startY = -((item.lines.length - 1) * item.lineH) / 2;
      item.lines.forEach((line, i) => ctx.fillText(line, 0, startY + i * item.lineH));
      ctx.restore();
      bottom = top - 10;
    }
    ctx.restore();
  }

  _drawMotionOverlay(ctx, w, h, frame, s) {
    const duration = Number(frame?.duration) || 0;
    const time = Number(frame?.time) || 0;
    const fadeIn = clamp(Number(s.exportFadeIn) || 0, 0, 3);
    const fadeOut = clamp(Number(s.exportFadeOut) || 0, 0, 3);
    let fade = 0;
    if (fadeIn > 0 && time < fadeIn) fade = Math.max(fade, 1 - time / fadeIn);
    if (fadeOut > 0 && duration > 0) {
      const remain = duration - time;
      if (remain < fadeOut) fade = Math.max(fade, 1 - remain / fadeOut);
    }
    if (fade > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${clamp(fade, 0, 1)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    const pulse = clamp(Number(s.exportPulse) || 0, 0, 100) / 100;
    const beat = clamp(frame?.beatPulse || 0, 0, 1);
    if (pulse > 0 && beat > 0) {
      const rgb = hexToRgbSafe(s.accent);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${(0.04 + beat * 0.16) * pulse})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  _moduleCacheKey(mod, color, palette) {
    return [
      mod.x, mod.y, mod.w, mod.h, mod.title || '', mod.color || '', mod.colorAlpha ?? 1, mod.opacity ?? 1,
      JSON.stringify(mod.options || {}), JSON.stringify(this.state.info || {}),
      this.engine.track?.name || '', this.engine.duration || 0,
      palette.bg, palette.window, palette.text, palette.chart,
    ].join('|');
  }

  _drawModuleLayered(ctx, mod, color, frame, palette, renderArchitecture, computeArchitecture) {
    const isStatic = STATIC_MODULE_TYPES.has(mod.type);
    const isSlow = SLOW_MODULE_TYPES.has(mod.type);
    if (!isStatic && !isSlow) {
      this._drawModuleSafe(ctx, mod, color, frame, palette);
      return;
    }
    const key = this._moduleCacheKey(mod, color, palette);
    const width = Math.max(1, Math.round(mod.w));
    const height = Math.max(1, Math.round(mod.h));
    let layer = this.moduleLayers.get(mod.id);
    if (!layer || layer.width !== width || layer.height !== height) {
      layer = document.createElement('canvas');
      layer.width = width;
      layer.height = height;
      this.moduleLayers.set(mod.id, layer);
      this.moduleKeys.delete(mod.id);
    }
    const cadence = isStatic ? Infinity
      : (renderArchitecture === 'performance' ? 3 : (computeArchitecture === 'quality' ? 1 : 2));
    const due = this.moduleKeys.get(mod.id) !== key || (Number.isFinite(cadence) && this.layerFrame % cadence === 0);
    if (due) {
      const lctx = layer.getContext('2d', { alpha: true });
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, width, height);
      lctx.save();
      lctx.translate(-mod.x, -mod.y);
      this._drawModuleSafe(lctx, mod, color, frame, palette);
      lctx.restore();
      this.moduleKeys.set(mod.id, key);
    }
    ctx.drawImage(layer, mod.x, mod.y, mod.w, mod.h);
  }

  _drawModuleSafe(ctx, mod, color, frame, palette) {
    try {
      drawVisualModule(ctx, mod, color, {
        frame,
        settings: this.state.settings,
        states: this.states,
        engine: this.engine,
        midi: this.state.midi,
        midiMerged: this.state.midiMerged,
        midiLayers: this.state.midiLayers,
        info: this.state.info,
        palette,
      });
    } catch (err) {
      console.error('[NEON//SCOPE] Module render failure:', mod.type, err);
    }
  }

  _drawAtmosphere(ctx, w, h, frame, s) {
    const energy = clamp(frame.energy, 0, 1.6);
    const accentRgb = hexToRgbSafe(s.accent);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this._particles) {
      p.x += p.vx * (0.3 + energy) * 0.6;
      p.y += p.vy * (0.3 + energy) * 0.6;
      if (p.y < -0.03) { p.y = 1.03; p.x = Math.random(); }
      if (p.x < -0.03) p.x = 1.03;
      if (p.x > 1.03) p.x = -0.03;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(this.animClock * 0.8 + p.phase));
      const alpha = (0.06 + energy * 0.16) * twinkle;
      ctx.fillStyle = p.hue === 0
        ? `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${alpha})`
        : p.hue === 1
          ? `rgba(120,230,255,${alpha * 0.7})`
          : `rgba(255,235,245,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.r * (0.75 + energy * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawOverlayEffects(ctx, w, h, frame, s) {
    // Soft vignette.
    const v = ctx.createRadialGradient(w * 0.5, h * 0.46, h * 0.25, w * 0.5, h * 0.5, w * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    if (s.scanlines) {
      ctx.save();
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = '#000';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
      ctx.restore();
    }

    // Subtle edge frame.
    ctx.strokeStyle = rgbaSafe(s.accent, 0.14);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  _drawWatermark(ctx, w, h, frame) {
    const s = this.state.settings;
    ctx.save();
    ctx.font = '10px "Cascadia Code", "Consolas", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('NEON//SCOPE', w - 22, h - 24);
    ctx.font = '9px "Cascadia Code", "Consolas", monospace';
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    const tc = formatTC(frame.time, this._exportFps || 60);
    const label = `REC  ${tc}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(7,3,10,.48)';
    ctx.fillRect(w - 22 - tw - 10, h - 48, tw + 10, 17);
    ctx.fillStyle = rgbaSafe(s.accent, 0.95);
    ctx.beginPath();
    ctx.arc(w - 22 - tw - 3, h - 39.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.fillText(label, w - 24, h - 36);
    ctx.restore();
  }

  screenshot() {
    return this.canvas.toDataURL('image/png');
  }
}

function hexToRgbSafe(hex) {
  const s = String(hex || '#ff4f8b').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbaSafe(hex, a) {
  const c = hexToRgbSafe(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
