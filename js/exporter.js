function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextFrame(timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, timeout);
  });
}

export function supportedMimeCandidates(format = 'webm', codec = '') {
  if (format === 'mp4') {
    return [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
    ];
  }
  if (codec === 'vp8') {
    return [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
  }
  if (codec === 'av1') {
    return [
      'video/webm;codecs=av01,opus',
      'video/webm;codecs=av01',
      'video/webm',
    ];
  }
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
}

export function pickMime(format = 'webm', codec = '') {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of supportedMimeCandidates(format, codec)) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch { /* noop */ }
  }
  return '';
}

export function pickDirectMime(container = 'mp4', codec = 'h264') {
  if (container === 'webm') return pickMime('webm', codec);
  if (container === 'mp4' && codec === 'h264') return pickMime('mp4');
  return '';
}

export function sanitizeFilename(name) {
  return String(name || 'neon-scope')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'neon-scope';
}

async function measureRefreshRate() {
  const samples = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let count = 0;
    const step = (ts) => {
      samples.push(ts - last);
      last = ts;
      count += 1;
      if (count >= 14) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(resolve, 400);
  });
  const usable = samples.slice(2).sort((a, b) => a - b);
  const median = usable[Math.floor(usable.length / 2)] || 16.7;
  return Math.max(24, Math.min(240, 1000 / median));
}

function newLogId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class VideoExporter {
  constructor({ visualizer, engine, onProgress, onLog }) {
    this.visualizer = visualizer;
    this.engine = engine;
    this.onProgress = onProgress || (() => {});
    this.onLog = onLog || (() => {});
    this.recorder = null;
    this.cancelled = false;
    this.active = false;
    this.clientLog = [];
    this.serverLog = [];
    this._convertAbort = null;
    this._convertLogId = '';
  }

  _log(line) {
    const text = String(line ?? '');
    if (!text) return;
    for (const part of text.split(/\r?\n/)) {
      if (part.trim()) this.clientLog.push(part);
    }
    if (this.clientLog.length > 160) this.clientLog.splice(0, this.clientLog.length - 160);
    this._emitLog();
  }

  _emitLog(done = false, error = null) {
    this.onLog({ lines: [...this.clientLog, ...this.serverLog], done, error });
  }

  async start({
    width = 1920, height = 1080, fps = 60,
    bitrateMbps = 24, format = 'webm', range = 'full',
    filename = 'neon-scope',
    codec = 'h264', crf = 'auto', preset = 'medium',
    audioCodec = 'aac', audioBitrate = 192, sampleRate = 48000, gop = 2,
    encoder = 'auto',
    ffmpegAvailable = true,
    audioSource = null,
  } = {}) {
    if (this.active) throw new Error('已有导出任务在进行');
    if (!this.engine.hasAudio) throw new Error('没有可导出的音频');
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder 视频录制');
    if (document.hidden) throw new Error('窗口处于后台，画布不会输出帧。请保持 NEON//SCOPE 在前台后重试。');
    this.active = true;
    this.cancelled = false;
    this.clientLog = [];
    this.serverLog = [];

    const container = ['webm', 'mp4', 'mkv', 'mov'].includes(format) ? format : 'mp4';
    const targetAudio = container === 'webm' ? 'opus'
      : (audioCodec === 'opus' && container !== 'mkv' ? 'aac' : audioCodec);
    const autoCrf = crf === 'auto' || crf === null || crf === undefined || crf === '';
    const crfValue = autoCrf ? null : Math.round(Number(crf));

    const fullDuration = this.engine.duration;
    let duration = fullDuration;
    if (range !== 'full') duration = Math.min(fullDuration, Number(range) || fullDuration);
    duration = Math.max(1, duration);

    // Real-time capture is limited by the display refresh and by how long a
    // frame takes to render at export resolution. Measure the actual render
    // throughput instead of trusting the preview's frame cost: if we record
    // slower than the renderer can deliver, FFmpeg has to duplicate frames to
    // hit the requested fps, which is what produced the huge dup counts.
    const refresh = await measureRefreshRate();
    let encoderPref = ['auto', 'software', 'nvidia', 'amd', 'intel'].includes(encoder) ? encoder : 'auto';
    if (!ffmpegAvailable && encoderPref !== 'auto') {
      this._log('[warn] 未检测到 FFmpeg，硬件编码选项不可用，本次使用浏览器直录。');
      encoderPref = 'auto';
    }
    this._log('[render] 测量导出分辨率的渲染吞吐…');
    this.visualizer.setExportMode(true, width, height, fps, fps);
    await nextFrame();
    await sleep(450);
    if (this.cancelled) return this._cancelEarly();
    const probeStart = performance.now();
    const probeBase = Number(this.visualizer.frameCount) || 0;
    await sleep(1200);
    const probeFrames = (Number(this.visualizer.frameCount) || 0) - probeBase;
    const probeSeconds = Math.max(0.2, (performance.now() - probeStart) / 1000);
    const measuredFps = probeFrames > 2 ? probeFrames / probeSeconds : 0;
    const previewPixels = Math.max(1, (this.visualizer.canvas.width || 1920) * (this.visualizer.canvas.height || 1080));
    const costScale = Math.max(1, Math.sqrt((width * height) / previewPixels));
    const fallbackFps = 1000 / Math.max(1, (Number(this.visualizer.frameMs) || 8) * costScale * 1.25);
    const achievable = Math.max(1, measuredFps || fallbackFps);
    const byRefresh = Math.min(1, refresh / fps);
    // Measured through rAF, so anything within a few percent of the target is
    // just sampling noise; only slow down when the renderer truly falls short.
    const byCost = achievable >= fps * 0.95 ? 1 : Math.min(1, (achievable * 0.98) / fps);
    let rate = Math.min(byRefresh, byCost);
    rate = rate > 0.97 ? 1 : Math.max(0.05, rate);
    if (rate < 1 && !ffmpegAvailable) {
      this._log(`[warn] 未检测到 FFmpeg，无法在封装时恢复速度；本次按原速 ${fps} FPS 录制，可能自动降帧。`);
      rate = 1;
    }
    const slowed = rate < 0.995;
    const captureFps = fps;
    const wallDuration = duration / rate;
    this._log(`[render] 实测渲染 ${achievable.toFixed(1)} FPS（${width}×${height}）· 刷新率 ${refresh.toFixed(0)} Hz`);

    const directMime = pickDirectMime(container, codec);
    const direct = !!directMime && crfValue === null && !slowed && encoderPref === 'auto';
    const mime = direct ? directMime : (pickMime('webm', 'vp9') || pickMime('webm'));
    if (!mime) {
      this.active = false;
      throw new Error('当前浏览器不支持 WebM / MP4 视频编码');
    }

    this._log(`[render] 目标 ${fps} FPS · 画布 ${width}×${height} · ${container.toUpperCase()} / ${codec.toUpperCase()}`);
    this._log(slowed
      ? `[render] 降速录制 ${rate.toFixed(2)}×（采集不设上限，预计耗时 ${formatSeconds(wallDuration)}），封装时恢复原速。`
      : `[render] 原速录制，采集上限 ${captureFps} FPS。`);
    this._log('[record] 初始化音频上下文与画布…');

    await this.engine.resume();
    this.engine.setLoop(false);
    this.engine.stop();
    this.engine.setPlaybackRate(rate);
    const oldVolume = this.engine.volume;
    this.engine.setVolume(oldVolume);
    this.visualizer.setExportMode(true, width, height, fps, captureFps);
    await nextFrame();

    const canvasStream = this.visualizer.canvas.captureStream(captureFps);
    const audioStream = this.engine.mediaDest.stream;
    const audioTrack = audioStream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    const stream = canvasStream;
    const options = {
      mimeType: mime,
      videoBitsPerSecond: Math.round(bitrateMbps * 1_000_000),
      audioBitsPerSecond: Math.round((direct ? audioBitrate : 192) * 1000),
    };
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (err) {
      this.visualizer.setExportMode(false);
      canvasStream.getVideoTracks().forEach((t) => t.stop());
      this.engine.setPlaybackRate(1);
      this.active = false;
      throw new Error(`无法创建视频编码器：${err.message}`);
    }

    this.recorder = recorder;
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (e) => reject(e.error || new Error('视频录制失败'));
    });

    this._log(`[record] MediaRecorder 启动 · ${mime} · ${bitrateMbps} Mbps`);
    this.onProgress({ phase: 'recording', percent: 0, time: 0, duration, message: '正在录制画布与音频…' });
    recorder.start(1000);
    await this.engine.play(0);

    const startedWall = performance.now();
    const frameBase = Number(this.visualizer.frameCount) || 0;
    let lastTime = 0;
    let hiddenSince = 0;
    try {
      while (!this.cancelled) {
        await sleep(100);
        if (document.hidden) {
          if (!hiddenSince) hiddenSince = performance.now();
          else if (performance.now() - hiddenSince > 1500) {
            throw new Error('窗口进入后台，画布已停止输出帧；请保持窗口在前台后重试');
          }
        } else {
          hiddenSince = 0;
        }
        const t = Math.min(this.engine.getTime(), duration);
        lastTime = t;
        const percent = Math.min(0.92, (t / duration) * 0.92);
        this.onProgress({
          phase: 'recording', percent, time: t, duration,
          message: slowed
            ? `降速录制 ${rate.toFixed(2)}× · ${formatSeconds(t)} / ${formatSeconds(duration)}`
            : `正在录制 · ${formatSeconds(t)} / ${formatSeconds(duration)}`,
        });
        if (t >= duration - 0.04) break;
        if (!this.engine.playing && t > 0.1) break;
        if (performance.now() - startedWall > (wallDuration + 30) * 1000) {
          throw new Error('录制超时，请保持页面在前台后重试');
        }
      }
    } catch (err) {
      this.cancelled = true;
      this._stopRecorder();
      await stopped.catch(() => {});
      this._cleanup(stream);
      this.visualizer.setExportMode(false);
      this.engine.stop();
      this.engine.setPlaybackRate(1);
      this.active = false;
      throw err;
    }

    if (!this.cancelled) {
      this.onProgress({ phase: 'finalizing', percent: 0.93, time: lastTime, duration, message: '正在完成视频编码…' });
      this._stopRecorder();
      try {
        await stopped;
      } catch (err) {
        this._cleanup(stream);
        this.visualizer.setExportMode(false);
        this.engine.stop();
        this.active = false;
        throw err;
      }
    } else {
      this._stopRecorder();
      await stopped.catch(() => {});
    }

    this.engine.stop();
    this._cleanup(stream);
    this.visualizer.setExportMode(false);

    const recSeconds = Math.max(0.1, (performance.now() - startedWall) / 1000);
    const recFrames = Math.max(0, (Number(this.visualizer.frameCount) || 0) - frameBase);
    this._log(`[record] 实际采集 ${(recFrames / recSeconds).toFixed(1)} FPS · ${recFrames} 帧 / ${recSeconds.toFixed(1)}s`);

    if (this.cancelled) {
      this.active = false;
      return { cancelled: true };
    }

    const directMp4 = direct && container === 'mp4';
    const raw = new Blob(chunks, { type: directMp4 ? 'video/mp4' : 'video/webm' });
    if (!raw.size) {
      this.active = false;
      throw new Error('录制结果为空，请重试');
    }
    this._log(`[record] 采集完成 · ${(raw.size / 1048576).toFixed(1)} MB`);

    let outBlob = raw;
    let ext = direct ? (directMp4 ? 'mp4' : 'webm') : 'webm';
    let convertedNote = direct
      ? (directMp4 ? 'MP4 / H.264 直接录制（硬件编码）' : `${codec.toUpperCase()} / OPUS 直接录制`)
      : '';
    if (!direct) {
      if (this.cancelled) {
        this.active = false;
        return { cancelled: true };
      }
      this.onProgress({ phase: 'converting', percent: 0.95, time: duration, duration, message: `正在使用本机 FFmpeg 封装 ${container.toUpperCase()}…` });
      const logId = newLogId();
      const headers = {
        'Content-Type': 'video/webm',
        'X-Output-Name': encodeURIComponent(filename),
        'X-Container': container,
        'X-Codec': codec,
        'X-Encoder': encoderPref,
        'X-Preset': preset,
        'X-Audio-Codec': targetAudio,
        'X-Audio-Bitrate': String(audioBitrate),
        'X-Sample-Rate': String(sampleRate),
        'X-Gop': String(gop),
        'X-Fps': String(fps),
        'X-Log-Id': logId,
      };
      if (crfValue !== null && Number.isFinite(crfValue)) headers['X-Video-CRF'] = String(crfValue);
      if (slowed) headers['X-Playback-Rate'] = rate.toFixed(4);
      const encoderLabel = encoderPref === 'auto' ? '自动（优先硬件）' : encoderPref.toUpperCase();
      this._log(`[ffmpeg] 提交转码任务 · ${codec.toUpperCase()} / ${container.toUpperCase()} · 编码器 ${encoderLabel} · CRF ${crfValue ?? 'auto'} · ${slowed ? `恢复 ${rate.toFixed(2)}× 速度` : `输出 ${fps} FPS`}`);
      const controller = new AbortController();
      this._convertAbort = controller;
      this._convertLogId = logId;
      let useOriginalAudio = false;
      let logPolling = true;
      const pollOnce = async () => {
        try {
          const res = await fetch(`/api/convert/log?id=${encodeURIComponent(logId)}`, { cache: 'no-store' });
          if (!res.ok) return true;
          const data = await res.json();
          if (Array.isArray(data.lines)) {
            this.serverLog = data.lines.slice(-160);
            this._emitLog(!!data.done, data.error || null);
          }
          return !!data.done;
        } catch {
          return true;
        }
      };
      const pollLoop = (async () => {
        while (logPolling) {
          await sleep(450);
          if (await pollOnce()) break;
        }
      })();
      try {
        if (audioSource && audioSource.bytes?.byteLength > 1024) {
          this.onProgress({ phase: 'converting', percent: 0.94, time: duration, duration, message: '正在上传原始音频…' });
          useOriginalAudio = await this._uploadAudioSource(audioSource, logId, controller.signal);
          if (useOriginalAudio) headers['X-Audio-Original'] = '1';
        }
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers,
          body: raw,
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }
        // res.blob() 在部分 Chromium/WebView2 上对大响应体会直接抛 Failed to fetch，改走 arrayBuffer。
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength < 1024) throw new Error('转码服务返回了空文件');
        outBlob = new Blob([bytes], { type: res.headers.get('content-type') || 'application/octet-stream' });
        ext = container;
        convertedNote = `${container.toUpperCase()} / ${codec.toUpperCase()} 已由本机 FFmpeg 转码${useOriginalAudio ? '（原始音轨）' : ''}`;
      } catch (err) {
        if (this.cancelled || err?.name === 'AbortError') {
          this._log('[ffmpeg] 已取消转码任务');
        } else {
          console.warn('[NEON//SCOPE] FFmpeg conversion failed, falling back to WebM:', err);
          this._log(`[ffmpeg] 转码失败：${err?.message || err}`);
          const reason = String(err?.message || '').includes('503')
            ? '未检测到 FFmpeg'
            : '转码失败';
          convertedNote = `${container.toUpperCase()} 转码不可用（${reason}），已自动回退为 WebM`;
          ext = 'webm';
          outBlob = raw;
        }
      } finally {
        logPolling = false;
        await pollLoop.catch(() => {});
        await pollOnce();
        this._emitLog(true);
        this._convertAbort = null;
        this._convertLogId = '';
      }
      if (this.cancelled) {
        this.active = false;
        return { cancelled: true };
      }
    }

    this.onProgress({ phase: 'done', percent: 1, time: duration, duration, message: '导出完成' });
    this.active = false;
    return {
      blob: outBlob,
      filename: `${sanitizeFilename(filename)}.${ext}`,
      note: convertedNote,
      duration,
      width,
      height,
      fps,
      container: ext,
      codec,
    };
  }

  async _uploadAudioSource(source, logId, signal) {
    const ext = (String(source.type || '').split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
    this._log(`[ffmpeg] 上传原始音频 · ${(source.bytes.byteLength / 1048576).toFixed(1)} MB · 封装时替换录制音轨`);
    try {
      const res = await fetch(`/api/audio-source?id=${encodeURIComponent(logId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Ext': ext },
        body: source.bytes,
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      this._log(`[ffmpeg] 原始音频已就绪 · ${(Number(data.bytes || source.bytes.byteLength) / 1048576).toFixed(1)} MB`);
      return true;
    } catch (err) {
      if (err?.name === 'AbortError' || this.cancelled) throw err;
      this._log(`[warn] 原始音频上传失败（${err?.message || err}），回退使用录制音轨`);
      return false;
    }
  }

  _stopRecorder() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* noop */ }
    }
  }

  _cancelEarly() {
    this.visualizer.setExportMode(false);
    this.active = false;
    return { cancelled: true };
  }

  _cleanup(stream) {
    try {
      for (const track of stream.getVideoTracks()) track.stop();
      // Keep the audio track alive for subsequent exports; only remove it.
      for (const track of stream.getAudioTracks()) stream.removeTrack(track);
    } catch { /* noop */ }
    try { this.engine.setPlaybackRate(1); } catch { /* noop */ }
    this.recorder = null;
  }

  cancel() {
    this.cancelled = true;
    this._stopRecorder();
    const controller = this._convertAbort;
    if (this._convertLogId) {
      try {
        fetch(`/api/convert/cancel?id=${encodeURIComponent(this._convertLogId)}`, { method: 'POST', keepalive: true }).catch(() => {});
      } catch { /* noop */ }
    }
    if (controller && !controller.signal.aborted) {
      try { controller.abort(); } catch { /* noop */ }
    }
  }
}

function formatSeconds(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function checkFfmpeg() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return { ok: false, version: '', codecs: [], audioCodecs: [], encoders: [], hwVendors: [] };
    const data = await res.json();
    return {
      ok: !!data.ffmpeg,
      version: data.version || '',
      codecs: Array.isArray(data.codecs) ? data.codecs : [],
      audioCodecs: Array.isArray(data.audioCodecs) ? data.audioCodecs : [],
      encoders: Array.isArray(data.encoders) ? data.encoders : [],
      hwVendors: Array.isArray(data.hwVendors) ? data.hwVendors : [],
    };
  } catch {
    return { ok: false, version: '', codecs: [], audioCodecs: [], encoders: [], hwVendors: [] };
  }
}
