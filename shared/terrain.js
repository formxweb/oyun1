// Deterministic valley terrain + a mutable height grid that both server and client use.
// Craters and "erased" zones are applied on top of the pristine grid, so history reshapes the land.
import { SEED, LAKE, TOWN, HILLS, INITIAL_BUILDINGS, BTYPES, UNDER } from './layout.js';
import { fbm, lerp, smoothstep, clamp } from './util.js';

export const SIZE = 640;
export const HALF = SIZE / 2;
export const N = 320; // cells per side
export const CELL = SIZE / N;
export const VERTS = N + 1;
export const VOID_DEPTH = -46;

export function lakeD(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.16 * Math.sin(a * 3 + 1.3) + 0.09 * Math.sin(a * 5 + 0.4) + 0.05 * Math.sin(a * 9 + 2.0);
  return Math.hypot(dx, dz) / (LAKE.r * wob);
}

export function heightNoPads(x, z) {
  const r = Math.hypot(x, z);
  let h = 4.4 + (fbm(x * 0.0055 + 11, z * 0.0055 + 5, 4, SEED) - 0.5) * 8.5 + (fbm(x * 0.028, z * 0.028, 3, SEED + 9) - 0.5) * 1.8;
  if (h < 2.4) h = 2.4 + (h - 2.4) * 0.25; // no accidental ponds outside the lake
  for (const H of HILLS) {
    const d2 = ((x - H.x) ** 2 + (z - H.z) ** 2) / (2 * H.s * H.s);
    h += H.h * Math.exp(-d2);
  }
  const w = smoothstep(170, 300, r);
  h += w * w * 85 + w * 18 + fbm(x * 0.012 + 40, z * 0.012, 4, SEED + 3) * w * 40;
  const td = Math.hypot((x - TOWN.x) / 1.9, z - TOWN.z);
  h = lerp(h, TOWN.y, 1 - smoothstep(40, 84, td));
  const d = lakeD(x, z);
  const b = 1 - smoothstep(0.62, 1.12, d);
  if (b > 0) {
    const bottom = -9.5 + (fbm(x * 0.03, z * 0.03, 3, SEED + 21) - 0.5) * 3.5;
    h = lerp(h, bottom, b * b * (3 - 2 * b));
  }
  return h;
}

export function initialFloorY(b) {
  if (b.floorY != null) return b.floorY;
  return heightNoPads(b.x, b.z) + 0.15;
}

const PADS = INITIAL_BUILDINGS.filter((b) => b.type !== 'pier').map((b) => {
  const T = BTYPES[b.type];
  return { x: b.x, z: b.z, r: Math.hypot(T.w, T.d) / 2 + 3, y: initialFloorY(b) - 0.15 };
});

export function baseHeight(x, z) {
  let h = heightNoPads(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 9) h = lerp(h, p.y, 1 - smoothstep(p.r, p.r + 9, d));
  }
  return h;
}

export class Terrain {
  constructor() {
    this.base = new Float32Array(VERTS * VERTS);
    this.h = new Float32Array(VERTS * VERTS);
    this.version = 0;
    for (let j = 0; j < VERTS; j++) {
      for (let i = 0; i < VERTS; i++) {
        this.base[j * VERTS + i] = baseHeight(i * CELL - HALF, j * CELL - HALF);
      }
    }
    this.h.set(this.base);
  }

  /** Recompute the live grid from pristine + all craters/erasures. */
  applyMods(craters = {}, erased = {}) {
    this.h.set(this.base);
    for (const id in craters) this._crater(craters[id]);
    for (const id in erased) this._erase(erased[id]);
    this.version++;
  }

  _each(cx, cz, rad, fn) {
    const i0 = Math.max(0, Math.floor((cx - rad + HALF) / CELL)), i1 = Math.min(N, Math.ceil((cx + rad + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - rad + HALF) / CELL)), j1 = Math.min(N, Math.ceil((cz + rad + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * CELL - HALF - cx, j * CELL - HALF - cz);
      fn(j * VERTS + i, d);
    }
  }

  _crater(c) {
    const rad = c.r * 1.5;
    this._each(c.x, c.z, rad, (idx, d) => {
      if (d < c.r) { const t = 1 - (d / c.r) ** 2; this.h[idx] -= c.d * t * t; }
      const rim = Math.exp(-(((d - c.r * 1.05) / (c.r * 0.28)) ** 2)) * 0.22 * c.d;
      this.h[idx] += rim;
    });
  }

  _erase(e) {
    this._each(e.x, e.z, e.r + 6, (idx, d) => {
      const t = 1 - smoothstep(e.r - 2.5, e.r + 0.5, d);
      if (t > 0) this.h[idx] = lerp(this.h[idx], VOID_DEPTH, t);
    });
  }

  /** Bilinear height at world x,z. */
  height(x, z) {
    const gx = clamp((x + HALF) / CELL, 0, N - 0.0001), gz = clamp((z + HALF) / CELL, 0, N - 0.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const k = j * VERTS + i, h = this.h;
    const a = h[k], b = h[k + 1], c = h[k + VERTS], d = h[k + VERTS + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  slope(x, z) {
    const e = 1.2;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  isVoid(x, z) { return this.height(x, z) < VOID_DEPTH * 0.5; }
}

export function underFloor() { return UNDER.y; }
