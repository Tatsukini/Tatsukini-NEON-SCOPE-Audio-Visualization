import { clamp, formatTime } from './core.js';

/**
 * AudioEngine
 * ------------
 * Owns the Web Audio graph, transport and real-time analysis.
 *
 * Graph:
 *   source ─┬─> masterGain ─┬─> destination
 *           │               └─> mediaStreamDestination (used by video export)
 *           └─> channelSplitter ─> analyserL/R ─> silent sinks
 *
 * The analysers expose 8192-sample time-domain windows, 4096 FFT bins.
 * All transport times are derived from AudioContext.currentTime for A/V sync.
 */
export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('当前浏览器不支持 Web Audio API');
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.ctx.suspend().catch(() => {});

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.78;
    this.master.connect(this.ctx.destination);

    this.mediaDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.mediaDest);

    this.splitter = this.ctx.createChannelSplitter(2);
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    for (const an of [this.analyserL, this.analyserR]) {
      an.fftSize = 8192;
      an.smoothingTimeConstant = 0.78;
      an.minDecibels = -96;
      an.maxDecibels = -10;
    }
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);

    // Analysers need a sink to be pulled by the graph, but stay inaudible.
    this.sinkL = this.ctx.createGain();
    this.sinkR = this.ctx.createGain();
    this.sinkL.gain.value = 0;
    this.sinkR.gain.value = 0;
    this.analyserL.connect(this.sinkL).connect(this.ctx.destination);
    this.analyserR.connect(this.sinkR).connect(this.ctx.destination);

    this.tdL = new Float32Array(this.analyserL.fftSize);
    this.tdR = new Float32Array(this.analyserR.fftSize);
    this.freqL = new Float32Array(this.analyserL.frequencyBinCount);
    this.freqR = new Float32Array(this.analyserR.frequencyBinCount);
    this.freqNorm = new Float32Array(this.analyserL.frequencyBinCount);
    this.binCount = this.analyserL.frequencyBinCount;

    this.buffer = null;
    this.duration = 0;
    this.sampleRate = this.ctx.sampleRate;
    this.channels = 2;
    this.track = null;
    this.playing = false;
    this.loop = false;
    this.volume = 0.78;
    this._offset = 0;
    this._startCtx = 0;
    this._source = null;
    this._startedAt = 0;
    this._lastFrame = null;
    this._integrated = 0;
    this._integratedN = 0;
    this._truePeak = 0;

    this.overviewMin = null;
    this.overviewMax = null;
    this.overviewBuckets = 2200;

    this.beat = {
      pulse: 0,
      phase: 0,
      bpm: 0,
      lastAt: -10,
      intervals: [],
      avgLow: 0,
      threshold: 1.22,
    };

    this.onEnded = null;
    this.onState = null;
  }

  get context() { return this.ctx; }
  get currentTime() { return this.getTime(); }
  get hasAudio() { return !!this.buffer; }

  async resume() {
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* browser may still block */ }
    }
    return this.ctx.state === 'running';
  }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.volume, t, 0.02);
  }

  setLoop(v) { this.loop = !!v; }

  setSmoothing(v) {
    const s = clamp(Number(v) / 100, 0, 0.96);
    this.analyserL.smoothingTimeConstant = s;
    this.analyserR.smoothingTimeConstant = s;
  }

  setBuffer(buffer, meta = {}) {
    this.stop();
    this.buffer = buffer;
    this.duration = buffer.duration;
    this.sampleRate = buffer.sampleRate;
    this.channels = buffer.numberOfChannels;
    this.track = { ...meta, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
    this._offset = 0;
    this._integrated = 0;
    this._integratedN = 0;
    this._truePeak = 0;
    this._lastFrame = null;
    this.overviewMin = new Float32Array(this.overviewBuckets);
    this.overviewMax = new Float32Array(this.overviewBuckets);
    this._buildOverview();
    this.onState?.('loaded', this.track);
  }

  _buildOverview() {
    const buf = this.buffer;
    if (!buf) return;
    const chans = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
    const n = buf.length;
    const buckets = this.overviewBuckets;
    const step = Math.max(1, Math.floor(n / buckets));
    for (let i = 0; i < buckets; i++) {
      const start = i * step;
      const end = Math.min(n, start + step);
      let lo = 0, hi = 0;
      for (let j = start; j < end; j++) {
        let s = 0;
        for (const ch of chans) s += ch[j];
        s /= chans.length || 1;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      this.overviewMin[i] = lo;
      this.overviewMax[i] = hi;
    }
  }

  async play(from = this._offset) {
    if (!this.buffer) return false;
    await this.resume();
    const startOffset = clamp(Number(from) || 0, 0, Math.max(0, this.duration - 0.002));
    this._stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop && this.duration > 0.2;
    src.connect(this.master);
    src.connect(this.splitter);
    const at = this.ctx.currentTime + 0.02;
    src.start(at, startOffset);
    this._source = src;
    this._offset = startOffset;
    this._startCtx = at;
    this._startedAt = performance.now();
    this.playing = true;
    src.onended = () => {
      if (this._source !== src) return;
      if (src.loop) return;
      this._source = null;
      this.playing = false;
      this._offset = this.duration;
      this._startCtx = 0;
      this.onState?.('ended');
      this.onEnded?.();
    };
    this.onState?.('playing');
    return true;
  }

  pause() {
    if (!this.playing) return;
    const t = this.getTime();
    this._stopSource();
    this.playing = false;
    this._offset = t;
    this.onState?.('paused');
  }

  stop() {
    this._stopSource();
    this.playing = false;
    this._offset = 0;
    this._startCtx = 0;
    this.onState?.('stopped');
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    this.play(this._offset >= this.duration ? 0 : this._offset);
    return true;
  }

  seek(sec) {
    const target = clamp(Number(sec) || 0, 0, this.duration || 0);
    if (this.playing) {
      this.play(target);
    } else {
      this._offset = target;
    }
    return target;
  }

  getTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return clamp(this._offset, 0, this.duration);
    let t = this._offset + (this.ctx.currentTime - this._startCtx);
    if (this.loop && this.duration > 0) {
      t = ((t % this.duration) + this.duration) % this.duration;
    }
    return clamp(t, 0, this.duration);
  }

  _stopSource() {
    if (this._source) {
      const src = this._source;
      this._source = null;
      src.onended = null;
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* noop */ }
    }
  }

  /** Analyze the current analyser window. Returned arrays are reused per frame. */
  analyze(dt = 1 / 60) {
    const now = this.getTime();
    if (!this.buffer) return this._emptyFrame(now);

    if (!this.playing && this._lastFrame) {
      const f = this._lastFrame;
      return {
        ...f,
        time: now,
        playing: false,
        beatPulse: 0,
        energy: 0,
        fade: Math.max(0, (f.fade ?? 1) - dt * 1.2),
      };
    }

    this.analyserL.getFloatTimeDomainData(this.tdL);
    this.analyserR.getFloatTimeDomainData(this.tdR);
    this.analyserL.getFloatFrequencyData(this.freqL);
    this.analyserR.getFloatFrequencyData(this.freqR);

    const n = this.tdL.length;
    let sumL2 = 0, sumR2 = 0, peakL = 0, peakR = 0, corr = 0;
    for (let i = 0; i < n; i++) {
      const l = this.tdL[i], r = this.tdR[i];
      sumL2 += l * l;
      sumR2 += r * r;
      corr += l * r;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
    }
    const rmsL = Math.sqrt(sumL2 / n);
    const rmsR = Math.sqrt(sumR2 / n);
    const rms = Math.sqrt((sumL2 + sumR2) / (n * 2));
    const peak = Math.max(peakL, peakR);
    const denom = Math.sqrt(sumL2 * sumR2);
    const correlation = denom > 1e-9 ? clamp(corr / denom, -1, 1) : 0;
    const balance = (rmsR - rmsL) / Math.max(1e-7, rmsR + rmsL);

    // Frequency domain: normalize dBFS to 0..1, then average channels.
    // The analyser runs at the AudioContext rate even when the buffer came
    // from a 44.1 kHz MIDI render inside a 48 kHz context.
    const analysisRate = this.ctx.sampleRate;
    let lowE = 0, midE = 0, highE = 0, lowN = 0, midN = 0, highN = 0;
    let centroidNum = 0, centroidDen = 0;
    const binHz = analysisRate / this.analyserL.fftSize;
    let peakBin = 1, peakVal = -1;
    for (let i = 1; i < this.binCount; i++) {
      const dbL = this.freqL[i], dbR = this.freqR[i];
      const db = Math.max(-96, (dbL + dbR) * 0.5);
      const v = clamp((db + 96) / 86, 0, 1);
      this.freqNorm[i] = v;
      const hz = i * binHz;
      if (hz >= 30 && hz < 180) { lowE += v; lowN++; }
      else if (hz >= 180 && hz < 2400) { midE += v; midN++; }
      else if (hz >= 2400 && hz < 18000) { highE += v; highN++; }
      if (hz > 35 && hz < 18000) {
        centroidNum += v * Math.log2(hz);
        centroidDen += v;
        if (v > peakVal) { peakVal = v; peakBin = i; }
      }
    }
    const low = lowN ? lowE / lowN : 0;
    const mid = midN ? midE / midN : 0;
    const high = highN ? highE / highN : 0;
    const centroid = centroidDen > 0 ? Math.pow(2, centroidNum / centroidDen) : 0;

    const sens = this._sensitivity || 1;
    const energy = clamp(rms * 3.2 * sens, 0, 1.7);
    const lowDrive = clamp(low * 1.55 * sens, 0, 1.5);
    this._detectBeat(now, lowDrive, dt);

    const truePeakDb = peak > 1e-8 ? 20 * Math.log10(peak) : -60;
    if (this.playing) {
      this._truePeak = Math.max(this._truePeak * 0.9997, peak);
      this._integratedN += 1;
      const ms = rms > 1e-7 ? 10 * Math.log10(rms * rms) : -70;
      if (this._integrated === 0) this._integrated = ms;
      else this._integrated = this._integrated * 0.9994 + ms * 0.0006;
    }
    const lufsS = rms > 1e-7 ? 20 * Math.log10(rms) - 0.691 : -60;
    const lufsI = this._integratedN > 4 ? this._integrated - 0.691 : -60;

    const frame = {
      time: now,
      duration: this.duration,
      playing: this.playing,
      tdL: this.tdL,
      tdR: this.tdR,
      freq: this.freqNorm,
      binCount: this.binCount,
      sampleRate: analysisRate,
      rms,
      rmsL,
      rmsR,
      peak,
      peakL,
      peakR,
      correlation,
      balance,
      lufsS,
      lufsI,
      truePeakDb,
      truePeak: this._truePeak,
      low,
      mid,
      high,
      centroid,
      peakHz: peakBin * binHz,
      spectrumPeak: peakVal,
      energy,
      beatPulse: this.beat.pulse,
      beatPhase: this.beat.phase,
      bpm: this.track?.bpm || this.beat.bpm || 0,
      fade: 1,
    };
    this._lastFrame = frame;
    return frame;
  }

  _emptyFrame(time = 0) {
    if (this._lastFrame && !this.playing) {
      return { ...this._lastFrame, time, playing: false, beatPulse: 0, energy: 0, fade: 0 };
    }
    return {
      time,
      duration: this.duration,
      playing: false,
      tdL: this.tdL,
      tdR: this.tdR,
      freq: this.freqNorm,
      binCount: this.binCount,
      sampleRate: this.ctx.sampleRate,
      rms: 0, rmsL: 0, rmsR: 0, peak: 0, peakL: 0, peakR: 0,
      correlation: 0, balance: 0,
      lufsS: -60, lufsI: -60, truePeakDb: -60, truePeak: 0,
      low: 0, mid: 0, high: 0, centroid: 0, peakHz: 0, spectrumPeak: 0,
      energy: 0, beatPulse: 0, beatPhase: 0, bpm: this.track?.bpm || 0, fade: 1,
    };
  }

  _detectBeat(time, lowEnergy, dt) {
    const b = this.beat;
    b.pulse = Math.max(0, b.pulse - dt * 4.8);
    b.phase = (b.phase + dt * (b.bpm / 60 || 0.5)) % 1;
    if (!this.playing) return;
    b.avgLow = b.avgLow * 0.965 + lowEnergy * 0.035;
    const threshold = b.avgLow * 1.45 + 0.035;
    if (lowEnergy > threshold && time - b.lastAt > 0.20) {
      const interval = time - b.lastAt;
      if (interval > 0.22 && interval < 1.6) {
        b.intervals.push(interval);
        if (b.intervals.length > 14) b.intervals.shift();
        // Median-ish estimate, folded into 70–180 BPM.
        const sorted = [...b.intervals].sort((a, c) => a - c);
        const med = sorted[Math.floor(sorted.length / 2)];
        let bpm = 60 / med;
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        if (bpm > 60 && bpm < 220) b.bpm = bpm;
      }
      b.lastAt = time;
      b.pulse = 1;
      b.phase = 0;
    }
    if (b.bpm) {
      const expected = 60 / b.bpm;
      if (time - b.lastAt > expected * 2.2) b.bpm *= 0.999;
    }
  }

  setSensitivity(percent) {
    this._sensitivity = clamp(Number(percent) / 100, 0.2, 2.2);
  }

  /** Compute a concise frequency snapshot for the preview thumbnail. */
  getMiniSpectrum(out, bars = 32) {
    const f = this.analyze(1 / 60);
    for (let i = 0; i < bars; i++) {
      const t = i / (bars - 1);
      const hz = 30 * Math.pow(600, t);
      const bin = clamp(Math.round(hz / (this.ctx.sampleRate / 8192)), 0, this.binCount - 1);
      out[i] = f.freq[bin] || 0;
    }
    return out;
  }

  /** Preview render duration for UI. */
  getTrackLabel() {
    if (!this.track) return 'NO SIGNAL';
    return `${this.track.name || 'Untitled'} · ${formatTime(this.duration, false)}`;
  }

  async decodeFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    return buffer;
  }

  connectMediaDestination() {
    // master is permanently connected; returning the stream keeps callers simple.
    return this.mediaDest.stream;
  }

  destroy() {
    this._stopSource();
    try { this.ctx.close(); } catch { /* noop */ }
  }
}
