function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }

export function supportedMimeCandidates(format = 'webm') {
  if (format === 'mp4') {
    return [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
    ];
  }
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
}

export function pickMime(format = 'webm') {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of supportedMimeCandidates(format)) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch { /* noop */ }
  }
  return '';
}

export function sanitizeFilename(name) {
  return String(name || 'neon-scope')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'neon-scope';
}

export class VideoExporter {
  constructor({ visualizer, engine, onProgress }) {
    this.visualizer = visualizer;
    this.engine = engine;
    this.onProgress = onProgress || (() => {});
    this.recorder = null;
    this.cancelled = false;
    this.active = false;
  }

  async start({
    width = 1920, height = 1080, fps = 60,
    bitrateMbps = 24, format = 'webm', range = 'full',
    filename = 'neon-scope',
  } = {}) {
    if (this.active) throw new Error('已有导出任务在进行');
    if (!this.engine.hasAudio) throw new Error('没有可导出的音频');
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder 视频录制');
    this.active = true;
    this.cancelled = false;
    const directMp4 = format === 'mp4' && !!pickMime('mp4');
    const mime = directMp4 ? pickMime('mp4') : pickMime('webm');
    if (!mime) {
      this.active = false;
      throw new Error('当前浏览器不支持 WebM / MP4 视频编码');
    }

    const fullDuration = this.engine.duration;
    let duration = fullDuration;
    if (range !== 'full') duration = Math.min(fullDuration, Number(range) || fullDuration);
    duration = Math.max(1, duration);

    await this.engine.resume();
    this.engine.setLoop(false);
    this.engine.stop();
    const oldVolume = this.engine.volume;
    this.engine.setVolume(oldVolume);
    this.visualizer.setExportMode(true, width, height, fps);
    await nextFrame();

    const canvasStream = this.visualizer.canvas.captureStream(fps);
    const audioStream = this.engine.mediaDest.stream;
    const audioTrack = audioStream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    const stream = canvasStream;
    const options = {
      mimeType: mime,
      videoBitsPerSecond: Math.round(bitrateMbps * 1_000_000),
      audioBitsPerSecond: 192_000,
    };
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (err) {
      this.visualizer.setExportMode(false);
      canvasStream.getVideoTracks().forEach((t) => t.stop());
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

    this.onProgress({ phase: 'recording', percent: 0, time: 0, duration, message: '正在录制画布与音频…' });
    recorder.start(1000);
    await this.engine.play(0);

    const startedWall = performance.now();
    let lastTime = 0;
    try {
      while (!this.cancelled) {
        await sleep(100);
        const t = Math.min(this.engine.getTime(), duration);
        lastTime = t;
        const percent = Math.min(0.92, (t / duration) * 0.92);
        this.onProgress({
          phase: 'recording', percent, time: t, duration,
          message: `正在录制 · ${formatSeconds(t)} / ${formatSeconds(duration)}`,
        });
        if (t >= duration - 0.04) break;
        if (!this.engine.playing && t > 0.1) break;
        if (performance.now() - startedWall > (duration + 25) * 1000) {
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

    if (this.cancelled) {
      this.active = false;
      return { cancelled: true };
    }

    const raw = new Blob(chunks, { type: directMp4 ? 'video/mp4' : 'video/webm' });
    if (!raw.size) {
      this.active = false;
      throw new Error('录制结果为空，请重试');
    }

    let outBlob = raw;
    let ext = directMp4 ? 'mp4' : 'webm';
    let convertedNote = directMp4 ? 'MP4 / H.264 直接录制（硬件编码）' : '';
    if (format === 'mp4' && !directMp4) {
      this.onProgress({ phase: 'converting', percent: 0.95, time: duration, duration, message: '正在使用本机 FFmpeg 封装 MP4…' });
      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'video/webm',
            'X-Output-Name': encodeURIComponent(filename),
            'X-Video-CRF': '17',
          },
          body: raw,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }
        outBlob = await res.blob();
        ext = 'mp4';
        convertedNote = 'MP4 / H.264 已由本机 FFmpeg 转码';
      } catch (err) {
        console.warn('[NEON//SCOPE] MP4 conversion failed, falling back to WebM:', err);
        convertedNote = 'MP4 转码不可用，已自动回退为 WebM';
        ext = 'webm';
        outBlob = raw;
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
    };
  }

  _stopRecorder() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* noop */ }
    }
  }

  _cleanup(stream) {
    try {
      for (const track of stream.getVideoTracks()) track.stop();
      // Keep the audio track alive for subsequent exports; only remove it.
      for (const track of stream.getAudioTracks()) stream.removeTrack(track);
    } catch { /* noop */ }
    this.recorder = null;
  }

  cancel() {
    this.cancelled = true;
    this._stopRecorder();
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
    if (!res.ok) return { ok: false, version: '' };
    const data = await res.json();
    return { ok: !!data.ffmpeg, version: data.version || '' };
  } catch {
    return { ok: false, version: '' };
  }
}
