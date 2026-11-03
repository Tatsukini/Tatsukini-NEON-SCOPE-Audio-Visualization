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

let ffmpegCache = null;
function getFfmpegInfo() {
  if (ffmpegCache) return Promise.resolve(ffmpegCache);
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffmpeg', ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      ffmpegCache = { ok: false, version: '' };
      resolve(ffmpegCache);
      return;
    }
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => { ffmpegCache = { ok: false, version: '' }; resolve(ffmpegCache); });
    proc.on('close', (code) => {
      const first = out.split(/\r?\n/)[0] || '';
      ffmpegCache = { ok: code === 0, version: first.replace(/^ffmpeg version\s*/i, '').slice(0, 80) };
      resolve(ffmpegCache);
    });
  });
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
  const crf = Math.max(12, Math.min(30, Number(req.headers['x-video-crf']) || 17));
  const tmpRoot = path.join(ROOT, '.neon-scope-tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmpDir = await mkdtemp(path.join(tmpRoot, 'job-'));
  const input = path.join(tmpDir, 'input.webm');
  const output = path.join(tmpDir, 'output.mp4');

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
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest', output,
    ];
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
    const asciiName = `${base.replace(/[^\x20-\x7E]/g, '_')}.mp4`;
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': info.size,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`${base}.mp4`)}`,
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
      ffmpeg: info.ok, version: info.version, platform: process.platform,
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
