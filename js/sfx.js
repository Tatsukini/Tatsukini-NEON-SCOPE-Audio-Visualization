// Copyright (C) 2026 Tatsukini
// Procedural UI sound effects. Everything is synthesised on the fly so the
// app keeps its zero-asset footprint and works offline.

const THROTTLE_MS = { click: 45, sliderDown: 60, sliderUp: 60, toast: 40 };

export class Sfx {
  constructor() {
    this.enabled = true;
    this.volume = 55;
    this.ctx = null;
    this.master = null;
    this._lastPlayed = new Map();
  }

  setEnabled(value) {
    this.enabled = value !== false;
    if (this.master) this.master.gain.value = this.enabled ? this._gain() : 0;
  }

  setVolume(value) {
    const v = Number(value);
    this.volume = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 55;
    if (this.master) this.master.gain.value = this.enabled ? this._gain() : 0;
  }

  unlock() {
    try {
      this._ensure();
    } catch {
      // Audio is a nicety; never let it break interaction.
    }
  }

  play(name) {
    if (!this.enabled || this.volume <= 0) return;
    const throttle = THROTTLE_MS[name] || 0;
    if (throttle) {
      const now = performance.now();
      if (now - (this._lastPlayed.get(name) || 0) < throttle) return;
      this._lastPlayed.set(name, now);
    }
    let ctx;
    try {
      ctx = this._ensure();
    } catch {
      return;
    }
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    switch (name) {
      case 'click': this._click(t); break;
      case 'confirm': this._confirm(t); break;
      case 'toast': this._toast(t); break;
      case 'success': this._success(t); break;
      case 'fail': this._fail(t); break;
      case 'module': this._module(t); break;
      case 'sliderDown': this._tick(t, 880, 0.028, 0.16); break;
      case 'sliderUp': this._tick(t, 1180, 0.024, 0.13); break;
      default: break;
    }
  }

  _gain() {
    return Math.pow(this.volume / 100, 1.35) * 0.5;
  }

  _ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this._gain() : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  _envelope(gain, t, attack, hold, release, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gain.gain.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  _tone(type, freq, t, { attack = 0.004, hold = 0.02, release = 0.06, peak = 0.2, slideTo = null } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + attack + hold + release);
    this._envelope(gain, t, attack, hold, release, peak);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + hold + release + 0.02);
  }

  _tick(t, freq, len, peak) {
    this._tone('triangle', freq, t, { attack: 0.002, hold: len * 0.4, release: len, peak });
  }

  _click(t) {
    this._tone('triangle', 1250, t, { attack: 0.002, hold: 0.008, release: 0.045, peak: 0.14, slideTo: 860 });
  }

  _confirm(t) {
    this._tone('sine', 700, t, { attack: 0.004, hold: 0.03, release: 0.07, peak: 0.2 });
    this._tone('sine', 1050, t + 0.085, { attack: 0.004, hold: 0.04, release: 0.1, peak: 0.22 });
  }

  _toast(t) {
    this._tone('sine', 540, t, { attack: 0.005, hold: 0.015, release: 0.08, peak: 0.13, slideTo: 430 });
  }

  _success(t) {
    this._tone('sine', 660, t, { attack: 0.004, hold: 0.02, release: 0.07, peak: 0.13 });
    this._tone('sine', 880, t + 0.065, { attack: 0.004, hold: 0.02, release: 0.07, peak: 0.13 });
    this._tone('sine', 1174, t + 0.13, { attack: 0.004, hold: 0.025, release: 0.1, peak: 0.12 });
  }

  _fail(t) {
    this._tone('sawtooth', 330, t, { attack: 0.006, hold: 0.03, release: 0.1, peak: 0.1, slideTo: 196 });
    this._tone('square', 220, t + 0.08, { attack: 0.006, hold: 0.03, release: 0.12, peak: 0.07, slideTo: 146 });
  }

  _module(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.14);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(940, t + 0.14);
    this._envelope(gain, t, 0.008, 0.05, 0.12, 0.1);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
    this._tone('sine', 1560, t + 0.12, { attack: 0.003, hold: 0.01, release: 0.05, peak: 0.09 });
  }
}
