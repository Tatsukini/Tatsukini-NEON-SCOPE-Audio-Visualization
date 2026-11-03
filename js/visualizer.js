import { STAGE_W, STAGE_H, clamp, formatTC, mixHex } from './core.js';
import { BackgroundRenderer } from './background.js';
import { drawVisualModule } from './modules.js';

const GUIDE_THRESHOLD = 10;
const GRID = 8;
const MIN_W = 150;
const MIN_H = 100;

export class Visualizer {
  constructor({ canvas, stage, overlay, guideV, guideH, engine, state, callbacks = {} }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.stage = stage;
    this.overlay = overlay;
    this.guideV = guideV;
    this.guideH = guideH;
    this.engine = engine;
    this.state = state;
    this.callbacks = callbacks;
    this.states = new Map();
    this.background = new BackgroundRenderer();
    this.running = false;
    this.exportMode = false;
    this._exportFps = 60;
    this.animClock = 0;
    this.lastTs = 0;
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsTimer = 0;
    this._previewW = 1280;
    this._previewH = 720;
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
    this._raf = requestAnimationFrame(this._boundLoop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = clamp(Math.round(rect.width * dpr), 1280, 1920);
    const height = Math.round(width * 9 / 16);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = true;
    }
    this._previewW = width;
    this._previewH = height;
    this.background.resize(width, height);
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

  _loop(ts) {
    if (!this.running) return;
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (dt > 0.1) dt = 0.1;
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

    const frame = this.engine.analyze(dt);
    this.engine.onEnded = this.engine.onEnded || null;
    this._draw(frame, dt);
    this.callbacks.onTick?.(frame, this.fps, dt);
    this._raf = requestAnimationFrame(this._boundLoop);
  }

  _draw(frame, dt) {
    const ctx = this.ctx;
    const w = STAGE_W, h = STAGE_H;
    const s = this.state.settings;
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
    for (const mod of sorted) {
      this._drawModuleSafe(ctx, mod, this._moduleAccent(mod), frame);
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

  _drawAnimationCues(ctx, w, h, frame) {
    const cues = this.state.animationCues || [];
    if (!cues.length) return;
    const t = Number(frame?.time) || 0;
    for (const cue of cues) {
      const persistent = Number(cue.duration) <= 0;
      if (persistent ? t < cue.time : (t < cue.time || t > cue.time + cue.duration)) continue;
      const p = cue.params || {};
      const progress = persistent ? 0.5 : clamp((t - cue.time) / Math.max(0.1, cue.duration), 0, 1);
      const alpha = persistent ? 0.62 : Math.sin(Math.min(1, progress) * Math.PI) * 0.8 + 0.2;
      if (cue.type === 'flash') {
        const rgb = hexToRgbSafe(/^#[0-9a-fA-F]{6}$/.test(cue.value) ? cue.value : '#ffffff');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.38})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (cue.type === 'tint' || cue.type === 'color') {
        const color = cue.type === 'color' ? (p.accent || cue.value || this.state.settings.accent) : (cue.value || this.state.settings.accent);
        const rgb = hexToRgbSafe(/^#[0-9a-fA-F]{6}$/.test(color) ? color : this.state.settings.accent);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * (cue.type === 'color' ? 0.24 : 0.20)})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (cue.type === 'fade') {
        const a = Math.min(1, progress < 0.35 ? progress / 0.35 : (1 - progress) / 0.35);
        ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1) * 0.92})`;
        ctx.fillRect(0, 0, w, h);
      } else if (cue.type === 'effect') {
        if ((p.effect || 'blur') === 'blur') {
          try {
            const amount = clamp(Number(p.amount) || 35, 1, 100);
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
        } else {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.22})`;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
      } else if (cue.type === 'bpm') {
        const label = `${p.bpm ?? cue.value ?? ''} BPM`;
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
        const x = (w - bw) / 2;
        const y = (h - bh) / 2;
        ctx.fillStyle = 'rgba(5, 8, 20, .72)';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = rgbaSafe(p.accent || this.state.settings.accent, .65);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 38px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
        ctx.fillText(title, w / 2, y + 54, bw - 40);
        ctx.fillStyle = rgbaSafe(p.accent || this.state.settings.accent, .92);
        ctx.font = '600 15px "Cascadia Code", monospace';
        ctx.fillText(author, w / 2, y + 88, bw - 40);
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.font = '10px "Cascadia Code", monospace';
        ctx.fillText(origin, w / 2, y + 112, bw - 40);
        ctx.restore();
      } else {
        const text = p.text || cue.value || 'NEON//SCOPE';
        const subtitle = cue.type === 'subtitle';
        const size = clamp(Number(p.size) || (subtitle ? 15 : 26), 8, 160) * (h / 1080);
        const x = clamp(Number(p.x) || 0.5, 0, 1) * w;
        const y = clamp(Number(p.y) || (subtitle ? 0.88 : 0.34), 0, 1) * h;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = p.align === 'left' ? 'left' : p.align === 'right' ? 'right' : 'center';
        if (subtitle) {
          ctx.fillStyle = 'rgba(5,3,9,.68)';
          ctx.fillRect(w * 0.18, y - 28, w * 0.64, 42);
          ctx.fillStyle = '#fff4f8';
          ctx.font = `600 ${size}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
          ctx.fillText(text, x, y, w * 0.78);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.92)';
          ctx.font = `600 ${size}px "Bahnschrift", "Microsoft YaHei UI", sans-serif`;
          ctx.fillText(text, x, y, w * 0.84);
        }
        ctx.restore();
      }
    }
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

  _drawModuleSafe(ctx, mod, color, frame) {
    try {
      drawVisualModule(ctx, mod, color, {
        frame,
        settings: this.state.settings,
        states: this.states,
        engine: this.engine,
        midi: this.state.midi,
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
