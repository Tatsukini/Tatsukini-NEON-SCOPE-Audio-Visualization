import { hexToRgb, clamp } from './core.js';

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uEnergy;
uniform float uBeat;
uniform float uAmount;
uniform vec3 uAccent;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y * 2.0;
  float t = uTime * 0.13;
  vec3 accent = uAccent;
  float lower = smoothstep(0.35, -0.60, uv.y);
  float edge = 0.44 + 0.56 * lower;

  vec3 col = vec3(0.0035, 0.0012, 0.008);
  col += vec3(0.04, 0.005, 0.085) * exp(-length((uv - vec2(-0.55, 0.10)) * vec2(0.62, 1.0)) * 1.45);
  col += accent * 0.032 * exp(-length((uv - vec2(0.35, -0.35)) * vec2(0.72, 0.95)) * 1.8);
  float fog = fbm(uv * 1.12 + vec2(t * 0.10, -t * 0.08));
  col += mix(vec3(0.018, 0.003, 0.045), vec3(0.075, 0.010, 0.145), fog) * 0.72;

  // Sparse bright dust.
  vec2 gp = floor(uv * 96.0 + vec2(t * 5.0, -t * 2.0));
  float star = step(0.9963, hash21(gp));
  col += vec3(1.0, 0.80, 0.91) * star * (0.25 + uEnergy * 1.05) * edge;

  // Domain-warped electric filaments.
  vec2 p = uv;
  p.x += sin(uv.y * 2.8 + t * 1.1) * 0.10;
  p.y += cos(uv.x * 2.3 - t * 0.9) * 0.07;
  vec2 q = vec2(
    fbm(p * 1.6 + vec2(t * 0.80, -t * 0.55)),
    fbm(p * 1.6 + vec2(2.7 - t * 0.45, t * 0.70))
  );
  float n = fbm(p * 1.9 + q * 2.2 + vec2(-t * 0.50, t * 0.25));
  float rid = 1.0 - abs(n * 2.0 - 1.0);
  float veins = pow(smoothstep(0.80, 0.995, rid), 3.0);
  float sparks = pow(smoothstep(0.92, 0.9995, rid), 8.0);
  vec3 hot = mix(accent, vec3(1.0, 0.90, 0.96), 0.60);
  col += hot * veins * edge * (0.52 + uEnergy * 1.45 + uBeat * 0.48) * uAmount;
  col += vec3(1.0, 0.97, 1.0) * sparks * edge * (0.34 + uEnergy * 1.15 + uBeat * 0.38) * uAmount;
  float contour = sin((n * 7.0 + uv.x * 1.8 - uv.y * 2.2 - t * 2.0) * 6.2831);
  col += accent * smoothstep(0.95, 0.998, abs(contour)) * edge * 0.16 * uAmount;

  // Concentric neon orb, positioned in the open lower-right area of the stage.
  vec2 c = uv - vec2(1.03, -0.53);
  float r = length(c * vec2(0.92, 1.0));
  float ang = atan(c.y, c.x);
  float fall = smoothstep(1.08, 0.02, r);
  float phase = r * 34.0 - t * 4.6 + sin(ang * 5.0 + t * 1.8) * 1.4;
  float wave = sin(phase) * 0.5 + 0.5;
  float rings = smoothstep(0.74, 0.995, wave) * fall;
  vec3 orbCol = mix(vec3(0.05, 0.58, 1.0), accent, smoothstep(0.02, 0.55, r));
  col += orbCol * rings * (0.32 + uEnergy * 0.92 + uBeat * 0.34) * uAmount;
  float crisp = pow(smoothstep(0.90, 0.999, wave), 5.0) * fall;
  col += vec3(0.82, 0.95, 1.0) * crisp * (0.24 + uEnergy * 0.55 + uBeat * 0.20);
  float spokes = pow(max(0.0, sin(ang * 7.0 + t * 0.7)), 26.0) * fall * smoothstep(0.12, 0.82, r);
  col += vec3(0.10, 0.70, 1.0) * spokes * (0.24 + uEnergy * 0.40);
  float core = exp(-r * r * 64.0);
  col += mix(accent, vec3(1.0, 0.82, 0.95), 0.50) * core * 0.64;
  col += vec3(0.28, 0.12, 0.75) * exp(-r * 2.6) * 0.36;

  // A secondary arc hugging the left edge.
  vec2 c2 = uv - vec2(-1.34, -0.28);
  float r2 = length(c2);
  float ang2 = atan(c2.y, c2.x);
  float arc = pow(max(0.0, sin(r2 * 22.0 - t * 2.2 + sin(ang2 * 3.0 + t) * 1.2)), 50.0);
  col += mix(accent, vec3(1.0), 0.42) * arc * 0.28 * smoothstep(1.5, 0.1, r2) * edge;

  // Lower-stage ambience and optical vignette.
  col += accent * 0.032 * exp(-length((uv - vec2(-0.10, -0.82)) * vec2(0.72, 1.0)) * 2.0);
  col *= 0.68 + 0.32 * lower;
  col *= 1.0 - 0.32 * length(uv * vec2(0.50, 0.65));
  gl_FragColor = vec4(col, 1.0);
}`;

export class BackgroundRenderer {
  constructor() {
    this.mode = 'plasma';
    this.rendererMode = 'gpu';
    this.accent = '#ff4f8b';
    this.amount = 0.7;
    this.bgColor = '#1a0b22';
    this.bgColorAlpha = 1;
    this.motion = 'kenburns';
    this.motionAmount = 0.35;
    this.motionSpeed = 1;
    this.motionDirection = 'auto';
    this.image = null;
    this.imageMeta = null;
    this.imageCache = null;
    this.imageCacheKey = '';
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = 1152;
    this.glCanvas.height = 648;
    this.cpuCanvas = document.createElement('canvas');
    this.cpuCanvas.width = 1152;
    this.cpuCanvas.height = 648;
    this.cpuCtx = this.cpuCanvas.getContext('2d');
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this.glFailed = false;
    this._initGL();
  }

  _initGL() {
    try {
      const gl = this.glCanvas.getContext('webgl', {
        antialias: false, alpha: false, depth: false, stencil: false,
        preserveDrawingBuffer: true, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL unavailable');
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw new Error(log || 'shader compile failed');
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link failed');
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      this.uniforms = {
        uRes: gl.getUniformLocation(program, 'uRes'),
        uTime: gl.getUniformLocation(program, 'uTime'),
        uEnergy: gl.getUniformLocation(program, 'uEnergy'),
        uBeat: gl.getUniformLocation(program, 'uBeat'),
        uAmount: gl.getUniformLocation(program, 'uAmount'),
        uAccent: gl.getUniformLocation(program, 'uAccent'),
      };
      this.gl = gl;
      this.program = program;
      gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    } catch (err) {
      console.warn('[NEON//SCOPE] WebGL background unavailable, using CPU fallback:', err?.message || err);
      this.glFailed = true;
      this.gl = null;
    }
  }

  get gpuAvailable() { return !!this.gl; }

  setMode(mode) { this.mode = mode || 'plasma'; }
  setRendererMode(mode) { this.rendererMode = mode === 'cpu' ? 'cpu' : 'gpu'; }
  setAccent(hex) { this.accent = hex; }
  setAmount(percent) { this.amount = clamp(Number(percent) / 100, 0, 1.5); }
  setColorSettings(hex, alpha = 1) {
    this.bgColor = hex || '#1a0b22';
    this.bgColorAlpha = clamp(Number(alpha), 0, 1);
  }

  setMotion(motion, amount = 35, speed = 100, direction = 'auto') {
    this.motion = ['static', 'kenburns', 'drift', 'breathe', 'sway', 'beat'].includes(motion) ? motion : 'kenburns';
    this.motionAmount = clamp(Number(amount) / 100, 0, 1);
    this.motionSpeed = clamp(Number(speed) / 100, 0, 2);
    this.motionDirection = ['auto', 'left', 'right', 'up', 'down'].includes(direction) ? direction : 'auto';
  }

  setImage(image, meta = {}) {
    this.image = image || null;
    this.imageMeta = meta;
    this.imageCache = null;
    this.imageCacheKey = '';
  }

  setImageSettings(dim, blur, contain) {
    this.dim = dim;
    this.blurPx = blur;
    this.contain = contain;
    const key = `${this.image?.src || this.image?.width || ''}_${blur}_${contain}`;
    if (key !== this.imageCacheKey) {
      this.imageCacheKey = key;
      this.imageCache = null;
    }
  }

  _ensureImageCache(w, h) {
    if (!this.image) return null;
    const blur = clamp(Number(this.blurPx) || 0, 0, 30);
    const key = `${this.image.src || this.image.width}_${blur}_${this.contain}_${w}x${h}`;
    if (this.imageCache && this.imageCacheKey === key) return this.imageCache;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.fillStyle = '#07040b';
    c.fillRect(0, 0, w, h);
    const iw = this.image.naturalWidth || this.image.width;
    const ih = this.image.naturalHeight || this.image.height;
    if (!iw || !ih) return null;
    const scale = this.contain ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    if (blur > 0) c.filter = `blur(${blur}px)`;
    c.drawImage(this.image, dx - (blur * 2), dy - (blur * 2), dw + blur * 4, dh + blur * 4);
    c.filter = 'none';
    this.imageCache = canvas;
    this.imageCacheKey = key;
    return canvas;
  }

  render(ctx, w, h, frame, animTime, settings = {}) {
    const mode = this.mode;
    const dim = clamp(Number(settings.dim ?? this.dim ?? 35) / 100, 0, 0.95);
    this.amount = clamp(Number(settings.amount ?? this.amount * 100) / 100, 0, 1.5);
    const energy = clamp(frame?.energy || 0, 0, 1.8);
    const beat = clamp(frame?.beatPulse || 0, 0, 1);
    ctx.save();
    if (mode === 'image' && this.image) {
      if (!this._drawImageScene(ctx, w, h, animTime, energy, beat, dim)) {
        this._renderFallback(ctx, w, h, frame, animTime);
      }
    } else if (mode === 'color') {
      const rgb = hexToRgb(this.bgColor || this.accent);
      const alpha = clamp(this.bgColorAlpha, 0, 1);
      const base = ctx.createLinearGradient(0, 0, w, h);
      base.addColorStop(0, '#08050d');
      base.addColorStop(0.5, '#050309');
      base.addColorStop(1, '#030206');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      ctx.fillRect(0, 0, w, h);
      const rg = ctx.createRadialGradient(w * 0.7, h * 0.35, 0, w * 0.7, h * 0.35, w * 0.65);
      rg.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${(0.06 + energy * 0.06) * alpha})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    } else if (this.rendererMode === 'gpu' && this.gl && !this.glFailed) {
      this._renderGL(frame, animTime);
      ctx.drawImage(this.glCanvas, 0, 0, w, h);
    } else {
      this._renderFallback(ctx, w, h, frame, animTime);
    }
    ctx.restore();
  }

  _drawImageScene(ctx, w, h, time, energy, beat, dim = null) {
    const cache = this._ensureImageCache(1280, 720);
    if (!cache) return false;
    const amt = this.motionAmount;
    const speed = this.motionSpeed;
    const t = time * (0.28 + speed * 0.72);
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let rotation = 0;
    const dirX = this.motionDirection === 'left' ? -1 : this.motionDirection === 'right' ? 1 : 0;
    const dirY = this.motionDirection === 'up' ? -1 : this.motionDirection === 'down' ? 1 : 0;

    if (this.motion === 'kenburns') {
      zoom = 1 + amt * (0.035 + 0.075 * (0.5 + 0.5 * Math.sin(t * 0.18)));
      panX = Math.sin(t * 0.16) * w * 0.032 * amt * (dirX || 1);
      panY = Math.cos(t * 0.12) * h * 0.022 * amt * (dirY || 1);
    } else if (this.motion === 'drift') {
      zoom = 1.035 + amt * 0.035;
      panX = Math.sin(t * 0.33) * w * 0.085 * amt * (dirX || 1);
      panY = Math.sin(t * 0.17) * h * 0.03 * amt * (dirY || 1);
    } else if (this.motion === 'breathe') {
      const breath = 0.5 + 0.5 * Math.sin(t * 0.9);
      zoom = 1 + amt * (0.012 + breath * 0.035 + energy * 0.045 + beat * 0.035);
      panX = Math.sin(t * 0.12) * w * 0.012 * amt;
      panY = Math.cos(t * 0.1) * h * 0.012 * amt;
    } else if (this.motion === 'sway') {
      zoom = 1.03 + amt * 0.045;
      rotation = Math.sin(t * 0.42) * 0.012 * amt;
      panX = Math.sin(t * 0.2) * w * 0.04 * amt * (dirX || 1);
      panY = Math.sin(t * 0.14) * h * 0.022 * amt;
    } else if (this.motion === 'beat') {
      zoom = 1 + amt * (0.012 + beat * 0.09 + energy * 0.035);
      panX = Math.sin(t * 0.22) * w * 0.045 * amt * (dirX || 1);
      panY = Math.cos(t * 0.16) * h * 0.025 * amt * (dirY || 1);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.translate(w / 2 + panX, h / 2 + panY);
    if (rotation) ctx.rotate(rotation);
    ctx.scale(zoom, zoom);
    ctx.drawImage(cache, -w / 2, -h / 2, w, h);
    ctx.restore();

    const dimAlpha = clamp(Number(dim ?? this.dim ?? 35) / 100, 0, 0.95);
    ctx.fillStyle = `rgba(5,2,9,${dimAlpha})`;
    ctx.fillRect(0, 0, w, h);
    const rgb = hexToRgb(this.accent);
    const g = ctx.createRadialGradient(w * 0.67, h * 0.62, 0, w * 0.67, h * 0.62, w * 0.55);
    g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.10 + energy * 0.10})`);
    g.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.035 + beat * 0.035})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    return true;
  }

  _renderGL(frame, animTime) {
    const gl = this.gl;
    const now = animTime;
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.useProgram(this.program);
    const rgb = hexToRgb(this.accent);
    gl.uniform2f(this.uniforms.uRes, this.glCanvas.width, this.glCanvas.height);
    gl.uniform1f(this.uniforms.uTime, now);
    gl.uniform1f(this.uniforms.uEnergy, clamp(frame?.energy || 0, 0, 1.8));
    gl.uniform1f(this.uniforms.uBeat, clamp(frame?.beatPulse || 0, 0, 1));
    gl.uniform1f(this.uniforms.uAmount, this.amount);
    gl.uniform3f(this.uniforms.uAccent, rgb.r / 255, rgb.g / 255, rgb.b / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _renderFallback(ctx, w, h, frame, animTime) {
    const t = animTime * 0.11;
    const rgb = hexToRgb(this.accent);
    const energy = clamp(frame?.energy || 0, 0, 1.8);
    const beat = clamp(frame?.beatPulse || 0, 0, 1);
    const amount = this.amount;
    const accent = (a) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    const hash = (i) => {
      const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };

    // Base atmosphere.
    const bg = ctx.createLinearGradient(0, 0, w * 0.2, h);
    bg.addColorStop(0, '#07030d');
    bg.addColorStop(0.55, '#0b0513');
    bg.addColorStop(1, '#1b0821');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    const glows = [
      { x: 0.77, y: 0.70, r: 0.52, c: accent(0.20 * amount) },
      { x: 0.56, y: 0.82, r: 0.38, c: `rgba(47,119,230,${0.15 * amount})` },
      { x: 0.12, y: 0.28, r: 0.5, c: `rgba(111,30,180,${0.14 * amount})` },
      { x: 0.08, y: 0.86, r: 0.5, c: accent(0.10 * amount) },
    ];
    for (const g0 of glows) {
      const g = ctx.createRadialGradient(w * g0.x, h * g0.y, 0, w * g0.x, h * g0.y, w * g0.r);
      g.addColorStop(0, g0.c);
      g.addColorStop(0.5, g0.c.replace(/[\d.]+\)$/, `${parseFloat(g0.c.match(/[\d.]+\)$/)?.[0] || '0.1') * 0.35})`));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Dust.
    for (let i = 0; i < 46; i++) {
      const x = hash(i * 2.1) * w;
      const y = (hash(i * 3.7 + 8) + t * 0.004 * (i % 3 + 1)) % 1 * h;
      const a = (0.06 + energy * 0.22) * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i)));
      ctx.fillStyle = i % 3 === 0 ? accent(a) : `rgba(220,235,255,${a * 0.55})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + hash(i + 4) * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Electric filaments, brightest in the open lower-right stage.
    ctx.lineCap = 'round';
    for (let s = 0; s < 9; s++) {
      const seed = s * 2.43 + 1.7;
      const x0 = w * (0.06 + 0.9 * hash(s + 1));
      let px = x0;
      let py = h * 1.02;
      const pts = [[px, py]];
      const segs = 9 + (s % 4);
      for (let k = 0; k < segs; k++) {
        px += Math.sin(seed + k * 2.2 + t * 0.9) * (w * 0.025 + k * 2);
        py -= (h * 0.52) / segs;
        pts.push([px, py]);
      }
      const grad = ctx.createLinearGradient(x0, h, px, py);
      grad.addColorStop(0, accent(0));
      grad.addColorStop(0.35, accent((0.10 + energy * 0.16) * amount));
      grad.addColorStop(0.78, accent((0.30 + energy * 0.35) * amount));
      grad.addColorStop(1, `rgba(255,236,248,${(0.32 + beat * 0.15) * amount})`);
      ctx.strokeStyle = grad;
      ctx.shadowColor = accent(0.55);
      ctx.shadowBlur = 15;
      ctx.lineWidth = 3 + (s % 3);
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1 + (s % 2) * 0.5;
      ctx.stroke();
      // A small branch off the main arc.
      if (s % 2 === 0) {
        const [bx, by] = pts[Math.floor(pts.length * 0.62)];
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + Math.sin(seed) * 36, by - 42, bx + Math.sin(seed + 2) * 80, by - 70);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = accent(0.15);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // Neon orb in the lower-right.
    const cx = w * 0.76;
    const cy = h * 0.68;
    const base = Math.min(w, h);
    for (let i = 0; i < 22; i++) {
      const rr = base * (0.035 + i * 0.0115) + Math.sin(t * 2.8 + i * 0.8) * 2.5;
      const a = (i % 4 === 0 ? 0.22 : 0.10 + beat * 0.08) * amount;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * 0.94, 0.2, 0, Math.PI * 2);
      ctx.strokeStyle = i % 3 === 0
        ? `rgba(86,205,255,${a})`
        : i % 3 === 1 ? accent(a * 1.2) : `rgba(190,92,255,${a * 0.8})`;
      ctx.lineWidth = i % 6 === 0 ? 2.2 : 0.8;
      ctx.stroke();
    }
    // Radial spokes.
    ctx.save();
    ctx.translate(cx, cy);
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + t * 0.2;
      const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * base * 0.34, Math.sin(a) * base * 0.34);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.72, `rgba(115,220,255,${0.12 * amount})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + 0.15) * base * 0.12, Math.sin(a + 0.15) * base * 0.12, Math.cos(a) * base * 0.36, Math.sin(a) * base * 0.36);
      ctx.stroke();
    }
    ctx.restore();
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.2);
    core.addColorStop(0, `rgba(255,235,250,${0.55 + beat * 0.2})`);
    core.addColorStop(0.18, `rgba(255,160,220,${0.30 + energy * 0.12})`);
    core.addColorStop(0.55, accent(0.14));
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(cx - base * 0.24, cy - base * 0.24, base * 0.48, base * 0.48);

    // Vignette.
    ctx.globalCompositeOperation = 'source-over';
    const v = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.6)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  drawPreview(canvas, w, h, time = 0, energy = 0, beat = 0) {
    const c = canvas.getContext('2d');
    canvas.width = Math.max(2, Math.floor(w * 2));
    canvas.height = Math.max(2, Math.floor(h * 2));
    const frame = { energy, beatPulse: beat };
    if (this.mode === 'image' && this.image) {
      this._drawImageScene(c, canvas.width, canvas.height, time, energy, beat);
    } else if (this.mode === 'color') {
      const rgb = hexToRgb(this.bgColor || this.accent);
      const alpha = clamp(this.bgColorAlpha, 0, 1);
      c.fillStyle = '#06030a';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      c.fillRect(0, 0, canvas.width, canvas.height);
    } else if (this.rendererMode === 'gpu' && this.gl && !this.glFailed) {
      this._renderGL(frame, time);
      c.drawImage(this.glCanvas, 0, 0, canvas.width, canvas.height);
    } else {
      this._renderFallback(c, canvas.width, canvas.height, frame, time);
    }
  }

  resize(width, height) {
    const aspect = width / Math.max(1, height);
    let w = Math.min(1280, Math.max(640, Math.round(width)));
    let h = Math.round(w / aspect);
    if (h > 720) { h = 720; w = Math.round(h * aspect); }
    w = Math.max(2, Math.round(w / 2) * 2);
    h = Math.max(2, Math.round(h / 2) * 2);
    if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
      this.glCanvas.width = w;
      this.glCanvas.height = h;
      this.cpuCanvas.width = w;
      this.cpuCanvas.height = h;
      if (this.gl) this.gl.viewport(0, 0, w, h);
    }
  }
}
