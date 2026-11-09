import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';
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

const EMPTY_FFMPEG = { ok: false, version: '', encoders: [], codecs: [], audioCodecs: [] };
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
        if (match) names.push(match[1]);
      }
      resolve(names);
    });
  });
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
      if (has('libx264')) codecs.push('h264');
      if (has('libx265')) codecs.push('h265');
      if (has('libvpx-vp9')) codecs.push('vp9');
      if (has('libvpx')) codecs.push('vp8');
      if (has('libsvtav1', 'libaom-av1')) codecs.push('av1');
      const audioCodecs = [];
      if (has('aac')) audioCodecs.push('aac');
      if (has('libopus', 'opus')) audioCodecs.push('opus');
      resolve({
        ok: true,
        version: first.replace(/^ffmpeg version\s*/i, '').slice(0, 80),
        encoders,
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

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function encoderFor(codec, encoders) {
  if (!encoders || encoders.length === 0) {
    // Encoder probing failed but FFmpeg exists; let FFmpeg report real errors.
    return { h264: 'libx264', h265: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9', vp8: 'libvpx' }[codec] || null;
  }
  const has = (name) => encoders.includes(name);
  if (codec === 'h264') return has('libx264') ? 'libx264' : null;
  if (codec === 'h265') return has('libx265') ? 'libx265' : null;
  if (codec === 'vp9') return has('libvpx-vp9') ? 'libvpx-vp9' : null;
  if (codec === 'vp8') return has('libvpx') ? 'libvpx' : null;
  if (codec === 'av1') return has('libsvtav1') ? 'libsvtav1' : has('libaom-av1') ? 'libaom-av1' : null;
  return null;
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
  const encoder = encoderFor(codec, ffmpeg.encoders || []);
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
  const encoders = ffmpeg.encoders || [];
  const audioEncoder = audioCodec === 'opus'
    ? (encoders.length === 0 || encoders.includes('libopus') ? 'libopus'
      : encoders.includes('opus') ? 'opus' : null)
    : 'aac';
  if (!audioEncoder) {
    return sendJson(res, 400, { error: '当前 FFmpeg 不支持 OPUS 编码，无法封装 WebM。' });
  }
  const tmpRoot = path.join(ROOT, '.neon-scope-tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmpDir = await mkdtemp(path.join(tmpRoot, 'job-'));
  const input = path.join(tmpDir, 'input.webm');
  const output = path.join(tmpDir, `output.${container}`);

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

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    ];
    if (encoder === 'libx264' || encoder === 'libx265') {
      args.push('-c:v', encoder, '-preset', preset, '-crf', String(crf));
      if (encoder === 'libx265') args.push('-tag:v', 'hvc1');
    } else if (encoder === 'libsvtav1') {
      args.push('-c:v', 'libsvtav1', '-preset', String(SVT_PRESET[preset] || 6), '-crf', String(crf));
    } else if (encoder === 'libaom-av1') {
      args.push('-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-crf', String(crf), '-b:v', '0');
    } else {
      args.push('-c:v', encoder, '-crf', String(crf), '-b:v', '0', '-cpu-used', String(VPX_SPEED[preset] || 4), '-row-mt', '1');
    }
    args.push('-pix_fmt', 'yuv420p', '-g', String(gopFrames));
    if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
    args.push('-c:a', audioEncoder, '-b:a', `${audioBitrate}k`);
    args.push('-ar', audioCodec === 'opus' ? '48000' : String(sampleRate));
    args.push('-shortest', output);
    let ff;
    try {
      ff = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      return sendJson(res, 503, { error: `无法启动 FFmpeg：${err.message}` });
    }
    let errText = '';
    ff.stderr.on('data', (d) => { errText += d.toString(); if (errText.length > 8000) errText = errText.slice(-8000); });
    const code = await new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', resolve);
    });
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
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || '转码服务异常' });
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
    }));
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
