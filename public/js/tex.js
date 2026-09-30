// Procedural textures. The game ships with zero image assets — everything is painted at load time.
import * as THREE from 'three';
import { mulberry32 } from '/shared/util.js';

const smooth01 = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Tileable value-noise field shared by all painters (256², wraps). */
class TileNoise {
  constructor(size = 256, seed = 7) {
    this.n = size;
    this.data = new Float32Array(size * size);
    const rnd = mulberry32(seed);
    // sum of a few tileable lattice octaves
    const octs = [[4, 0.5], [8, 0.28], [16, 0.14], [32, 0.08]];
    for (const [cells, amp] of octs) {
      const lat = new Float32Array(cells * cells).map(() => rnd());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = lat[(y0 % cells) * cells + (x0 % cells)], b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
        const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)], d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
        this.data[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  /** u,v in [0,1) wrapped; k scales frequency (integer multiples stay seamless). */
  at(u, v, k = 1) {
    const n = this.n;
    let x = ((u * k) % 1 + 1) % 1 * n, y = ((v * k) % 1 + 1) % 1 * n;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const d = this.data;
    const a = d[y0 * n + x0], b = d[y0 * n + x1], c = d[y1 * n + x0], e = d[y1 * n + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  }
}

let NOISE = null;
export const noise = () => (NOISE ||= new TileNoise(256, 7));

function paint(size, fn, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, out, x, y);
    const o = (y * size + x) * 4;
    px[o] = clamp255(out[0]); px[o + 1] = clamp255(out[1]); px[o + 2] = clamp255(out[2]); px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (opts.post) opts.post(ctx, size);
  return cv;
}

function toTex(cv, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function makeTextures(quality = 'high') {
  const N = noise();
  const S = quality === 'low' ? 256 : 512;
  const T = {};

  T.grass = toTex(paint(S, (u, v, o) => {
    const n1 = N.at(u, v, 2), n2 = N.at(u, v, 8), n3 = N.at(u, v, 24);
    const c = mix3(hex(0x3a5a22), hex(0x6f8a34), n1 * 0.6 + n2 * 0.5);
    const streak = N.at(u * 1, v * 0.06, 32) - 0.5;
    const d = 0.72 + n3 * 0.5 + streak * 0.5;
    o[0] = c[0] * d; o[1] = c[1] * d; o[2] = c[2] * d;
  }));
  T.dirt = toTex(paint(S, (u, v, o) => {
    const n1 = N.at(u, v, 3), n2 = N.at(u, v, 14), n3 = N.at(u, v, 40);
    const c = mix3(hex(0x5b4630), hex(0x8b7350), n1);
    const pebble = n3 > 0.62 ? 0.7 : 1;
    const d = (0.7 + n2 * 0.55) * pebble;
    o[0] = c[0] * d; o[1] = c[1] * d; o[2] = c[2] * d;
  }));
  T.rock = toTex(paint(S, (u, v, o) => {
    const n1 = N.at(u, v, 2), n2 = N.at(u, v, 9), n3 = N.at(u, v, 30);
    const strata = Math.sin((v + n1 * 0.4) * 60) * 0.5 + 0.5;
    const c = mix3(hex(0x5c5852), hex(0x9a948a), n1 * 0.7 + strata * 0.25);
    const crack = 0.82 + 0.18 * smooth01(Math.abs(n2 - 0.5) * 9);
    const d = (0.78 + n3 * 0.4) * crack;
    o[0] = c[0] * d; o[1] = c[1] * d; o[2] = c[2] * d;
  }));
  T.sand = toTex(paint(S >> 1, (u, v, o) => {
    const n = N.at(u, v, 6), g = N.at(u, v, 50);
    const c = mix3(hex(0xb8a274), hex(0xd9c79a), n);
    const d = 0.86 + g * 0.3;
    o[0] = c[0] * d; o[1] = c[1] * d; o[2] = c[2] * d;
  }));

  const clap = (base) => {
    const bc = hex(base);
    return paint(256, (u, v, o) => {
      const row = (v * 12) % 1;
      const line = row < 0.07 ? 0.55 : row < 0.13 ? 0.85 : 1;
      const grain = 0.86 + N.at(u * 0.25, v, 16) * 0.28 + N.at(u, v, 3) * 0.15;
      const wear = 0.9 + N.at(u, v, 6) * 0.14;
      const d = line * grain * wear;
      o[0] = bc[0] * d; o[1] = bc[1] * d; o[2] = bc[2] * d;
    });
  };
  T.clap = (color) => toTex(clap(color), { repeat: [1, 1] });

  T.brick = toTex(paint(256, (u, v, o) => {
    const rows = 14, bh = 1 / rows;
    const r = Math.floor(v / bh);
    const off = (r % 2) * 0.5;
    const bw = 1 / 6;
    const x = (u + off * bw * 2) % (bw), y = v % bh;
    const mortar = x < 0.008 || y < 0.006;
    const id = Math.floor((u + off * bw * 2) / bw) + r * 7;
    const jitter = ((id * 9301 + 49297) % 233280) / 233280;
    const c = mix3(hex(0x8a3f30), hex(0xa8573f), jitter);
    const n = 0.8 + N.at(u, v, 20) * 0.4;
    if (mortar) { o[0] = 150 * n; o[1] = 145 * n; o[2] = 135 * n; } else { o[0] = c[0] * n; o[1] = c[1] * n; o[2] = c[2] * n; }
  }));
  T.concrete = toTex(paint(256, (u, v, o) => {
    const n = N.at(u, v, 3), f = N.at(u, v, 30), st = N.at(u * 0.4, v, 6);
    const d = 0.68 + n * 0.3 + f * 0.18 - (st > 0.6 ? 0.12 : 0);
    o[0] = 150 * d; o[1] = 152 * d; o[2] = 150 * d;
  }));
  T.metal = toTex(paint(256, (u, v, o) => {
    const rib = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
    const rust = N.at(u, v, 5) > 0.66 ? 0.6 : 1;
    const d = (0.62 + rib * 0.3) * (0.8 + N.at(u, v, 14) * 0.3);
    o[0] = (120 * d) * (rust < 1 ? 1.25 : 1); o[1] = (128 * d) * rust; o[2] = (132 * d) * rust;
  }));
  T.stone = toTex(paint(256, (u, v, o) => {
    const rows = 8, bh = 1 / rows;
    const r = Math.floor(v / bh), off = (r % 3) * 0.33;
    const bw = 1 / 4;
    const x = (u + off * bw) % bw, y = v % bh;
    const mortar = x < 0.01 || y < 0.012;
    const id = Math.floor((u + off * bw) / bw) + r * 5;
    const j = ((id * 7919 + 1237) % 1000) / 1000;
    const n = 0.75 + N.at(u, v, 12) * 0.45;
    const c = mix3(hex(0x77746c), hex(0xa29c90), j);
    if (mortar) { o[0] = 60 * n; o[1] = 58 * n; o[2] = 54 * n; } else { o[0] = c[0] * n; o[1] = c[1] * n; o[2] = c[2] * n; }
  }));
  T.shingle = (color) => {
    const bc = hex(color);
    return toTex(paint(256, (u, v, o) => {
      const rows = 10, bh = 1 / rows;
      const r = Math.floor(v / bh);
      const y = (v % bh) / bh;
      const cols = 8, cw = 1 / cols, off = (r % 2) * 0.5 * cw;
      const x = ((u + off) % cw) / cw;
      const edge = y > 0.86 ? 0.55 : 1;
      const side = x < 0.04 ? 0.6 : 1;
      const j = ((Math.floor((u + off) / cw) * 31 + r * 17) % 100) / 100;
      const d = (0.75 + j * 0.3 + N.at(u, v, 20) * 0.2) * edge * side;
      o[0] = bc[0] * d; o[1] = bc[1] * d; o[2] = bc[2] * d;
    }));
  };
  T.floor = toTex(paint(256, (u, v, o) => {
    const rows = 8, r = Math.floor(v * rows);
    const j = ((r * 12.9898) % 1 + 1) % 1;
    const line = (v * rows) % 1 < 0.05 ? 0.5 : 1;
    const grain = 0.75 + N.at(u * 0.2 + j, v, 24) * 0.4;
    o[0] = 130 * grain * line; o[1] = 92 * grain * line; o[2] = 58 * grain * line;
  }));
  T.wood = toTex(paint(256, (u, v, o) => {
    const grain = 0.65 + N.at(u * 0.15, v, 20) * 0.5;
    o[0] = 122 * grain; o[1] = 86 * grain; o[2] = 52 * grain;
  }));
  T.asphalt = toTex(paint(256, (u, v, o) => {
    const s = N.at(u, v, 30), n = N.at(u, v, 4);
    const crack = Math.abs(N.at(u, v, 7) - 0.5) < 0.012 ? 0.55 : 1;
    let d = (0.42 + n * 0.16 + s * 0.14) * crack;
    let r = 74 * d * 1.5, g = 76 * d * 1.5, b = 82 * d * 1.5;
    // centre dashes (u is across the road, v along it)
    const cx = Math.abs(u - 0.5);
    if (cx < 0.012 && (v * 4) % 1 < 0.55) { r = 220 * (0.8 + s * 0.3); g = 185 * (0.8 + s * 0.3); b = 60; }
    if (Math.abs(u - 0.06) < 0.008 || Math.abs(u - 0.94) < 0.008) { r = 190 * (0.7 + s * 0.3); g = 190 * (0.7 + s * 0.3); b = 185 * (0.7 + s * 0.3); }
    o[0] = r; o[1] = g; o[2] = b;
  }), { });
  T.dirtRoad = toTex(paint(256, (u, v, o) => {
    const n = N.at(u, v, 6), s = N.at(u, v, 30);
    const rut = Math.abs(u - 0.3) < 0.07 || Math.abs(u - 0.7) < 0.07 ? 0.82 : 1;
    const d = (0.6 + n * 0.4 + s * 0.1) * rut;
    o[0] = 118 * d; o[1] = 96 * d; o[2] = 68 * d;
  }));
  T.fabric = toTex(paint(128, (u, v, o) => { const n = N.at(u, v, 30); const d = 0.85 + n * 0.25; o[0] = 210 * d; o[1] = 205 * d; o[2] = 195 * d; }));

  // water normals (tileable, from summed sines + noise heights)
  const wn = 256;
  const h = new Float32Array(wn * wn);
  for (let y = 0; y < wn; y++) for (let x = 0; x < wn; x++) {
    const u = x / wn, v = y / wn;
    h[y * wn + x] = N.at(u, v, 4) * 1.0 + N.at(u, v, 8) * 0.55 + N.at(u, v, 16) * 0.28 + Math.sin(u * 6.283 * 6 + N.at(u, v, 2) * 6) * 0.05;
  }
  const wcv = paint(wn, (u, v, o, x, y) => {
    const xl = h[y * wn + ((x + wn - 1) % wn)], xr = h[y * wn + ((x + 1) % wn)];
    const yu = h[((y + wn - 1) % wn) * wn + x], yd = h[((y + 1) % wn) * wn + x];
    const nx = (xl - xr) * 3.2, ny = (yu - yd) * 3.2;
    const l = Math.hypot(nx, ny, 1);
    o[0] = (nx / l * 0.5 + 0.5) * 255; o[1] = (ny / l * 0.5 + 0.5) * 255; o[2] = (1 / l * 0.5 + 0.5) * 255;
  });
  T.waterN = toTex(wcv, { srgb: false });

  // raw noise texture for shaders (clouds etc.): RGBA independent fields
  const ncv = document.createElement('canvas'); ncv.width = ncv.height = 256;
  const nctx = ncv.getContext('2d'); const nimg = nctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = x / 256, v = y / 256, o = (y * 256 + x) * 4;
    nimg.data[o] = clamp255(N.at(u, v, 1) * 255); nimg.data[o + 1] = clamp255(N.at(u, v, 3) * 255); nimg.data[o + 2] = clamp255(N.at(u + 0.31, v + 0.17, 1) * 255); nimg.data[o + 3] = clamp255(N.at(u + 0.6, v + 0.4, 2) * 255);
  }
  nctx.putImageData(nimg, 0, 0);
  T.noise = toTex(ncv, { srgb: false });
  T.noise.minFilter = THREE.LinearFilter; T.noise.generateMipmaps = false;

  return T;
}

/** Canvas text texture: crisp signage. */
export function textTexture(text, { w = 512, h = 128, font = 'bold 64px "Trebuchet MS", Arial', color = '#f4efe2', bg = null, stroke = null, align = 'center', pad = 12, lines = null, glow = null } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  const arr = lines || [text];
  let size = parseInt(/(\d+)px/.exec(font)[1], 10);
  // shrink to fit
  const setFont = (s) => { ctx.font = font.replace(/\d+px/, `${s}px`); };
  setFont(size);
  const maxw = Math.max(...arr.map((l) => ctx.measureText(l).width));
  if (maxw > w - pad * 2) { size = Math.floor(size * (w - pad * 2) / maxw); setFont(size); }
  const lh = size * 1.08;
  const y0 = h / 2 - ((arr.length - 1) * lh) / 2;
  const x = align === 'center' ? w / 2 : pad;
  arr.forEach((l, i) => {
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 18; }
    if (stroke) { ctx.lineWidth = Math.max(3, size / 9); ctx.strokeStyle = stroke; ctx.strokeText(l, x, y0 + i * lh); }
    ctx.fillStyle = color; ctx.fillText(l, x, y0 + i * lh);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
