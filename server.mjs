import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8642;
const HOST = process.env.HOST || '127.0.0.1';
const OPEN_BROWSER = !process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const EMPTY_FFMPEG = { ok: false, version: '', encoders: [], hwVendors: [], codecs: [], audioCodecs: [] };
let ffmpegCache = null;

function listEncoders() {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawn('ffmpeg', ['-hide_banner', '-encoders'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve([]);
      return;
    }
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      const names = [];
      for (const line of out.split(/\r?\n/)) {
        const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
        if (match && /^[A-Za-z0-9_.-]{2,}$/.test(match[1])) names.push(match[1]);
      }
      resolve(names);
    });
  });
}

function probeEncoder(name) {
  // FFmpeg builds list every encoder they support, including GPUs that are not
  // installed. Encode one tiny frame to find out what this machine can really use.
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    let proc;
    try {
      proc = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'lavfi', '-i', 'nullsrc=s=320x240:d=0.1',
        '-frames:v', '2', '-pix_fmt', 'yuv420p', '-c:v', name, '-f', 'null', '-',
      ], { windowsHide: true, stdio: 'ignore' });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } finish(false); }, 6000);
    proc.on('error', () => { clearTimeout(timer); finish(false); });
    proc.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

async function detectHwVendors(encoders) {
  const vendors = [];
  await Promise.all(Object.entries(HW_ENCODERS).map(async ([vendor, map]) => {
    const name = map.h264;
    if (!name) return;
    if (encoders.length && !encoders.includes(name)) return;
    if (await probeEncoder(name)) vendors.push(vendor);
  }));
  return ['nvidia', 'amd', 'intel'].filter((v) => vendors.includes(v));
}

function getFfmpegInfo() {
  if (ffmpegCache) return ffmpegCache;
  ffmpegCache = new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffmpeg', ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(EMPTY_FFMPEG);
      return;
    }
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(EMPTY_FFMPEG));
    proc.on('close', async (code) => {
      if (code !== 0) {
        resolve(EMPTY_FFMPEG);
        return;
      }
      const first = out.split(/\r?\n/)[0] || '';
      const encoders = await listEncoders();
      const has = (...names) => names.some((name) => encoders.includes(name));
      const codecs = [];
      if (has('libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv')) codecs.push('h264');
      if (has('libx265', 'hevc_nvenc', 'hevc_amf', 'hevc_qsv')) codecs.push('h265');
      if (has('libvpx-vp9')) codecs.push('vp9');
      if (has('libvpx')) codecs.push('vp8');
      if (has('libsvtav1', 'libaom-av1', 'av1_nvenc', 'av1_amf', 'av1_qsv')) codecs.push('av1');
      const audioCodecs = [];
      if (has('aac')) audioCodecs.push('aac');
      if (has('libopus', 'opus')) audioCodecs.push('opus');
      const hwVendors = await detectHwVendors(encoders);
      resolve({
        ok: true,
        version: first.replace(/^ffmpeg version\s*/i, '').slice(0, 80),
        encoders,
        hwVendors,
        codecs,
        audioCodecs,
      });
    });
  });
  return ffmpegCache;
}

const CONTAINER_TYPES = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
const VIDEO_CODECS = ['h264', 'h265', 'av1', 'vp9', 'vp8'];
const AUDIO_CODECS = ['aac', 'opus'];
const X264_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);
const VPX_SPEED = { ultrafast: 8, fast: 6, medium: 4, slow: 2, veryslow: 1 };
const SVT_PRESET = { ultrafast: 12, fast: 8, medium: 6, slow: 4, veryslow: 3 };
const CRF_DEFAULT = { h264: 20, h265: 24, vp9: 32, vp8: 28, av1: 30 };
const CRF_MAX = { h264: 51, h265: 51, vp9: 63, vp8: 63, av1: 63 };

const HW_ENCODERS = {
  nvidia: { h264: 'h264_nvenc', h265: 'hevc_nvenc', av1: 'av1_nvenc' },
  amd: { h264: 'h264_amf', h265: 'hevc_amf', av1: 'av1_amf' },
  intel: { h264: 'h264_qsv', h265: 'hevc_qsv', av1: 'av1_qsv' },
};
const SOFTWARE_ENCODERS = { h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9', vp8: 'libvpx' };
const NVENC_PRESET = { ultrafast: 1, superfast: 2, veryfast: 3, faster: 4, fast: 4, medium: 5, slow: 6, slower: 7, veryslow: 7 };
const AMF_QUALITY = { ultrafast: 'speed', superfast: 'speed', veryfast: 'speed', faster: 'balanced', fast: 'balanced', medium: 'balanced', slow: 'quality', slower: 'quality', veryslow: 'quality' };
const QSV_PRESET = { ultrafast: 'veryfast', superfast: 'veryfast', veryfast: 'veryfast', faster: 'faster', fast: 'fast', medium: 'medium', slow: 'slow', slower: 'slower', veryslow: 'veryslow' };
const ENCODER_VENDORS = ['auto', 'software', 'nvidia', 'amd', 'intel'];

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function encoderKind(name) {
  if (!name) return '';
  if (name.endsWith('_nvenc')) return 'nvidia';
  if (name.endsWith('_amf')) return 'amd';
  if (name.endsWith('_qsv')) return 'intel';
  return 'software';
}

function softwareEncoder(codec, encoders) {
  const hasList = Array.isArray(encoders) && encoders.length > 0;
  const has = (name) => !hasList || encoders.includes(name);
  if (codec === 'av1') {
    if (has('libsvtav1')) return 'libsvtav1';
    if (has('libaom-av1')) return 'libaom-av1';
    return hasList ? null : 'libsvtav1';
  }
  const name = SOFTWARE_ENCODERS[codec];
  return name && has(name) ? name : null;
}

function resolveEncoder(codec, vendor, encoders, hwVendors = []) {
  const hasList = Array.isArray(encoders) && encoders.length > 0;
  const has = (name) => !hasList || encoders.includes(name);
  if (vendor !== 'software' && (vendor !== 'auto' || hasList)) {
    const detected = new Set(hwVendors);
    const order = vendor === 'auto'
      ? ['nvidia', 'amd', 'intel'].filter((v) => detected.has(v))
      : [vendor];
    for (const v of order) {
      const name = HW_ENCODERS[v]?.[codec];
      if (name && has(name)) return name;
    }
  }
  return softwareEncoder(codec, encoders);
}

function videoEncoderArgs(name, preset, crf, codec) {
  const kind = encoderKind(name);
  if (kind === 'nvidia') {
    return ['-c:v', name, '-preset', `p${NVENC_PRESET[preset] || 5}`, '-rc', 'vbr', '-cq', String(crf), '-b:v', '0'];
  }
  if (kind === 'amd') {
    return ['-c:v', name, '-quality', AMF_QUALITY[preset] || 'balanced', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-qp_b', String(crf)];
  }
  if (kind === 'intel') {
    return ['-c:v', name, '-preset', QSV_PRESET[preset] || 'medium', '-global_quality', String(crf)];
  }
  if (name === 'libx264' || name === 'libx265') {
    return ['-c:v', name, '-preset', preset, '-crf', String(crf)];
  }
  if (name === 'libsvtav1') {
    return ['-c:v', 'libsvtav1', '-preset', String(SVT_PRESET[preset] || 6), '-crf', String(crf)];
  }
  if (name === 'libaom-av1') {
    return ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-crf', String(crf), '-b:v', '0'];
  }
  // vp8 / vp9
  return ['-c:v', name, '-crf', String(crf), '-b:v', '0', '-cpu-used', String(VPX_SPEED[preset] || 4), '-row-mt', '1'];
}

function needsHvc1Tag(name) {
  return name.startsWith('hevc_') || name === 'libx265';
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

const convertJobs = new Map();
const convertProcs = new Map();
const CONVERT_LOG_TTL = 10 * 60 * 1000;

function pruneConvertJobs() {
  const now = Date.now();
  for (const [id, job] of convertJobs) {
    if (now - job.updatedAt > CONVERT_LOG_TTL) convertJobs.delete(id);
  }
}

function convertLogJob(id) {
  if (!id) return null;
  pruneConvertJobs();
  let job = convertJobs.get(id);
  if (!job) {
    job = { lines: [], done: false, error: null, updatedAt: Date.now() };
    convertJobs.set(id, job);
  }
  job.updatedAt = Date.now();
  return job;
}

function pushConvertLog(job, text) {
  if (!job) return;
  for (const part of String(text).split(/[\r\n]+/)) {
    const line = part.trim();
    if (!line) continue;
    job.lines.push(line);
  }
  if (job.lines.length > 220) job.lines.splice(0, job.lines.length - 220);
  job.updatedAt = Date.now();
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safeName(value, fallback = 'neon-scope') {
  const decoded = (() => { try { return decodeURIComponent(value || ''); } catch { return value || ''; } })();
  return String(decoded || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

const audioSources = new Map();
const AUDIO_SOURCE_TTL = 30 * 60 * 1000;

function pruneAudioSources() {
  const now = Date.now();
  for (const [id, entry] of audioSources) {
    if (now - entry.at <= AUDIO_SOURCE_TTL) continue;
    audioSources.delete(id);
    rm(entry.path, { force: true }).catch(() => {});
  }
}

async function handleAudioSource(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const id = String(new URL(req.url, 'http://localhost').searchParams.get('id') || '')
    .replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  if (!id) return sendJson(res, 400, { error: '缺少任务 id' });
  const ext = String(req.headers['x-audio-ext'] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const tmpRoot = path.join(ROOT, '.neon-scope-tmp');
  await mkdir(tmpRoot, { recursive: true });
  pruneAudioSources();
  const target = path.join(tmpRoot, `audio-${id}.${ext}`);
  if ((Number(req.headers['content-length']) || 0) > 2 * 1024 * 1024 * 1024) {
    return sendJson(res, 413, { error: '音频文件超过 2GB 限制' });
  }
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, done) { bytes += chunk.length; done(null, chunk); },
  });
  try {
    await pipeline(req, counter, createWriteStream(target));
    if (bytes < 1024) {
      await rm(target, { force: true }).catch(() => {});
      return sendJson(res, 400, { error: '音频数据为空' });
    }
    audioSources.set(id, { path: target, at: Date.now() });
    sendJson(res, 200, { ok: true, bytes });
  } catch (err) {
    await rm(target, { force: true }).catch(() => {});
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || '音频上传失败' });
  }
}

async function handleConvert(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const ffmpeg = await getFfmpegInfo();
  if (!ffmpeg.ok) return sendJson(res, 503, { error: '未检测到 FFmpeg。请安装 FFmpeg 并加入 PATH，或改用 WebM 导出。' });
  const contentLength = Number(req.headers['content-length']) || 0;
  if (contentLength > 3 * 1024 * 1024 * 1024) {
    return sendJson(res, 413, { error: '文件超过 3GB 限制' });
  }

  const base = safeName(req.headers['x-output-name'], 'neon-scope');
  const container = oneOf(req.headers['x-container'], Object.keys(CONTAINER_TYPES), 'mp4');
  const codec = oneOf(req.headers['x-codec'], VIDEO_CODECS, 'h264');
  const encoders = ffmpeg.encoders || [];
  const requestedVendor = oneOf(String(req.headers['x-encoder'] || 'auto').toLowerCase(), ENCODER_VENDORS, 'auto');
  const hwVendors = ffmpeg.hwVendors || [];
  const encoder = resolveEncoder(codec, requestedVendor, encoders, hwVendors);
  if (!encoder) {
    return sendJson(res, 400, { error: `当前 FFmpeg 不支持 ${codec.toUpperCase()} 编码，请改用其他编码或更新 FFmpeg。` });
  }
  const crfRaw = Number(req.headers['x-video-crf']);
  const crf = Number.isFinite(crfRaw)
    ? Math.max(0, Math.min(CRF_MAX[codec], Math.round(crfRaw)))
    : CRF_DEFAULT[codec];
  const preset = X264_PRESETS.has(req.headers['x-preset']) ? req.headers['x-preset'] : 'medium';
  const fps = Math.max(1, Math.min(240, Number(req.headers['x-fps']) || 60));
  const gopSeconds = Math.max(0.5, Math.min(10, Number(req.headers['x-gop']) || 2));
  const gopFrames = Math.max(1, Math.round(gopSeconds * fps));
  const sampleRate = Number(req.headers['x-sample-rate']) === 44100 ? 44100 : 48000;
  const audioBitrate = Math.max(64, Math.min(512, Math.round(Number(req.headers['x-audio-bitrate']) || 192)));
  let audioCodec = oneOf(req.headers['x-audio-codec'], AUDIO_CODECS, container === 'webm' ? 'opus' : 'aac');
  if (container === 'webm') audioCodec = 'opus';
  if (container === 'mp4' || container === 'mov') audioCodec = 'aac';
  const audioEncoder = audioCodec === 'opus'
    ? (encoders.length === 0 || encoders.includes('libopus') ? 'libopus'
      : encoders.includes('opus') ? 'opus' : null)
    : 'aac';
  if (!audioEncoder) {
    return sendJson(res, 400, { error: '当前 FFmpeg 不支持 OPUS 编码，无法封装 WebM。' });
  }
  const logId = String(req.headers['x-log-id'] || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  const logJob = convertLogJob(logId);
  const playbackRate = Math.max(0.05, Math.min(1, Number(req.headers['x-playback-rate']) || 1));
  const retime = playbackRate < 0.995;
  if (logJob) {
    logJob.lines.length = 0;
    pushConvertLog(logJob, `retime ${playbackRate.toFixed(4)}x  fps ${fps}  codec ${codec}`);
    pushConvertLog(logJob, `encoder ${encoder}  vendor ${requestedVendor}  hardware ${encoderKind(encoder) !== 'software' ? 'yes' : 'no'}`);
  }
  const tmpRoot = path.join(ROOT, '.neon-scope-tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmpDir = await mkdtemp(path.join(tmpRoot, 'job-'));
  const input = path.join(tmpDir, 'input.webm');
  const output = path.join(tmpDir, `output.${container}`);
  const audioEntry = req.headers['x-audio-original'] === '1' ? audioSources.get(logId) : null;
  const originalAudio = audioEntry && existsSync(audioEntry.path) ? audioEntry.path : null;
  audioSources.delete(logId);
  if (logJob) {
    pushConvertLog(logJob, originalAudio ? 'audio source: original file' : 'audio source: recorded stream');
  }

  let bytes = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 3 * 1024 * 1024 * 1024) tooLarge = true;
  });

  try {
    await pipeline(req, createWriteStream(input));
    if (tooLarge) {
      await rm(tmpDir, { recursive: true, force: true });
      return sendJson(res, 413, { error: '文件超过 3GB 限制' });
    }
    if (!existsSync(input) || bytes < 1024) {
      await rm(tmpDir, { recursive: true, force: true });
      return sendJson(res, 400, { error: '上传的视频流为空或损坏' });
    }

    const buildArgs = (videoEncoder) => {
      const args = [
        '-hide_banner', '-loglevel', 'info', '-stats', '-stats_period', '1', '-y',
        '-i', input,
      ];
      if (originalAudio) args.push('-i', originalAudio);
      args.push(
        '-map', '0:v:0', '-map', originalAudio ? '1:a:0' : '0:a:0?',
        '-vf', `${retime ? `setpts=${playbackRate.toFixed(4)}*PTS,` : ''}scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      );
      if (retime) args.push('-r', String(fps));
      args.push(...videoEncoderArgs(videoEncoder, preset, crf, codec));
      if (needsHvc1Tag(videoEncoder)) args.push('-tag:v', 'hvc1');
      args.push('-pix_fmt', 'yuv420p', '-g', String(gopFrames));
      if (retime && !originalAudio) args.push('-af', `atempo=${(1 / playbackRate).toFixed(4)}`);
      if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
      args.push('-c:a', audioEncoder, '-b:a', `${audioBitrate}k`);
      args.push('-ar', audioCodec === 'opus' ? '48000' : String(sampleRate));
      args.push('-shortest', output);
      return args;
    };

    const fallback = encoderKind(encoder) === 'software' ? null : resolveEncoder(codec, 'software', encoders);
    const attempts = fallback && fallback !== encoder ? [encoder, fallback] : [encoder];
    let code = -1;
    let errText = '';
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      if (logJob?.cancelled) break;
      const current = attempts[attempt];
      if (attempt > 0) pushConvertLog(logJob, `硬件编码失败，回退软件编码 ${current}`);
      let ff;
      try {
        ff = spawn('ffmpeg', buildArgs(current), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (err) {
        errText = err.message;
        code = -1;
        break;
      }
      if (logId) convertProcs.set(logId, ff);
      let logBuffer = '';
      const onClose = () => {
        if (ff.exitCode === null && !ff.killed) {
          killProcessTree(ff);
          if (logJob) { logJob.done = true; logJob.error = '客户端已取消'; logJob.cancelled = true; }
        }
      };
      res.once('close', onClose);
      ff.stderr.on('data', (d) => {
        const text = d.toString();
        errText += text;
        if (errText.length > 8000) errText = errText.slice(-8000);
        if (logJob) {
          logBuffer += text;
          if (logBuffer.length > 64 * 1024) logBuffer = logBuffer.slice(-8192);
          const cut = Math.max(logBuffer.lastIndexOf('\n'), logBuffer.lastIndexOf('\r'));
          if (cut >= 0) {
            pushConvertLog(logJob, logBuffer.slice(0, cut));
            logBuffer = logBuffer.slice(cut + 1);
          }
        }
      });
      code = await new Promise((resolve) => {
        ff.on('error', (err) => { errText = `${errText}\n${err.message}`; resolve(-1); });
        ff.on('close', resolve);
      });
      res.off('close', onClose);
      if (logId) convertProcs.delete(logId);
      if (logJob && logBuffer.trim()) pushConvertLog(logJob, logBuffer);
      if (code === 0) {
        if (attempt > 0) pushConvertLog(logJob, `已回退到 ${current} 完成编码`);
        break;
      }
      if (logJob?.cancelled) break;
      if (attempt + 1 < attempts.length) pushConvertLog(logJob, `${current} 失败（exit ${code}），尝试软件编码…`);
    }
    if (logJob) {
      logJob.done = true;
      logJob.error = logJob.cancelled ? '已取消' : code === 0 ? null : `FFmpeg exit ${code}`;
      if (code === 0) pushConvertLog(logJob, '封装完成');
    }
    if (logJob?.cancelled) {
      await rm(tmpDir, { recursive: true, force: true });
      if (!res.headersSent && !res.destroyed) sendJson(res, 499, { error: '已取消' });
      return;
    }
    if (code !== 0) {
      await rm(tmpDir, { recursive: true, force: true });
      return sendJson(res, 500, { error: `FFmpeg 转码失败：${errText.slice(-1000) || `exit ${code}`}` });
    }
    const info = await stat(output);
    const asciiName = `${base.replace(/[^\x20-\x7E]/g, '_')}.${container}`;
    res.writeHead(200, {
      'Content-Type': CONTAINER_TYPES[container],
      'Content-Length': info.size,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`${base}.${container}`)}`,
      'Cache-Control': 'no-store',
    });
    const stream = createReadStream(output);
    stream.pipe(res);
    stream.on('close', () => rm(tmpDir, { recursive: true, force: true }).catch(() => {}));
    stream.on('error', () => {
      if (!res.headersSent) sendJson(res, 500, { error: '读取转码文件失败' });
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });
  } catch (err) {
    if (logJob && !logJob.cancelled) {
      logJob.done = true;
      logJob.error = err?.message || '转码服务异常';
      pushConvertLog(logJob, `error: ${logJob.error}`);
    }
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || '转码服务异常' });
  } finally {
    if (originalAudio) rm(originalAudio, { force: true }).catch(() => {});
  }
}

let clientConnected = false;
async function handleStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/index.html' && !clientConnected) {
    clientConnected = true;
    console.log('  Browser connected. NEON//SCOPE is ready.');
  }
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 / Not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/health')) {
    getFfmpegInfo().then((info) => sendJson(res, 200, {
      ffmpeg: info.ok,
      version: info.version,
      platform: process.platform,
      codecs: info.codecs || [],
      audioCodecs: info.audioCodecs || [],
      encoders: info.encoders || [],
      hwVendors: info.hwVendors || [],
    }));
    return;
  }
  if (req.url?.startsWith('/api/convert/cancel')) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    const key = String(id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
    const job = key ? convertJobs.get(key) : null;
    const child = key ? convertProcs.get(key) : null;
    let killed = false;
    if (child) {
      killProcessTree(child);
      killed = true;
      convertProcs.delete(key);
    }
    if (job) {
      job.cancelled = true;
      job.done = true;
      job.error = '已取消';
      job.updatedAt = Date.now();
      pushConvertLog(job, '已取消（客户端请求）');
    }
    sendJson(res, 200, { ok: true, killed });
    return;
  }
  if (req.url?.startsWith('/api/audio-source')) {
    handleAudioSource(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: err?.message || '音频上传失败' });
    });
    return;
  }
  if (req.url?.startsWith('/api/convert/log')) {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    const job = convertJobs.get(String(id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64));
    sendJson(res, 200, {
      lines: job ? job.lines : [],
      done: job ? job.done : false,
      error: job ? job.error : null,
    });
    return;
  }
  if (req.url?.startsWith('/api/convert')) {
    handleConvert(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: err?.message || 'internal error' });
    });
    return;
  }
  handleStatic(req, res);
});

server.listen(PORT, HOST, async () => {
  const ff = await getFfmpegInfo();
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  NEON//SCOPE  /  realtime audio visualizer');
  console.log('  -------------------------------------------');
  console.log(`  Workbench  ${url}`);
  console.log(`  FFmpeg     ${ff.ok ? ff.version : 'not found - WebM export only'}`);
  console.log('  (Ctrl+C to stop the server)');
  console.log('');
  if (OPEN_BROWSER) console.log('  Opening the workbench in your default browser...');
  else console.log('  Open http://127.0.0.1:8642 if the app window did not open.');
  if (OPEN_BROWSER) {
    setTimeout(() => {
      const cmd = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }, 450);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。设置 PORT 环境变量或关闭占用该端口的程序。`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
