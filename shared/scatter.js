// Deterministic scattering of trees and rocks. The server generates once and ships the result to clients.
import { SEED, ROADS, INITIAL_BUILDINGS, BTYPES, LAKE, TOWN, SPAWN } from './layout.js';
import { mulberry32, fbm, smoothstep } from './util.js';
import { lakeD } from './terrain.js';

export function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/** Distance from (x,z) to the nearest road centreline, and that road's half-width. */
export function roadDist(x, z) {
  let best = 1e9, hw = 0;
  for (const r of ROADS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const d = segDist(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
      if (d < best) { best = d; hw = r.width / 2; }
    }
  }
  return { d: best, hw };
}

export function genTrees(terrain) {
  const rnd = mulberry32(SEED * 7 + 1);
  const out = [];
  const step = 5.4;
  for (let gx = -300; gx < 300; gx += step) {
    for (let gz = -300; gz < 300; gz += step) {
      const x = gx + rnd() * step, z = gz + rnd() * step;
      const r = Math.hypot(x, z);
      if (r > 292) continue;
      const y = terrain.base[0] === undefined ? 0 : terrain.height(x, z);
      if (y < 1.1 || lakeD(x, z) < 1.22) continue;
      const slope = terrain.slope(x, z);
      if (slope > 0.85) continue;
      const forest = fbm(x * 0.011 + 3, z * 0.011 + 9, 4, SEED + 5);
      const nearTown = Math.hypot((x - TOWN.x) / 1.9, z - TOWN.z) * 1.6;
      let dens = smoothstep(0.34, 0.55, forest) * 0.95 + 0.07;
      dens *= smoothstep(64, 100, nearTown) * 0.96 + 0.04;
      dens *= 0.55 + 0.45 * smoothstep(20, 90, r);
      if (rnd() > dens) continue;
      const rd = roadDist(x, z);
      if (rd.d < rd.hw + 5) continue;
      let blocked = false;
      for (const b of INITIAL_BUILDINGS) {
        const T = BTYPES[b.type];
        if (Math.hypot(x - b.x, z - b.z) < Math.hypot(T.w, T.d) / 2 + 7) { blocked = true; break; }
      }
      if (blocked) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 24) continue;
      const kind = y > 24 || fbm(x * 0.02, z * 0.02, 2, SEED + 40) > 0.55 ? 0 : (rnd() < 0.62 ? 0 : (rnd() < 0.55 ? 1 : 2)); // 0 pine 1 oak 2 birch
      const s = 0.78 + rnd() * 0.8;
      out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(s * 100) / 100, kind, Math.round(rnd() * 628) / 100]);
    }
  }
  return out;
}

export function genRocks(terrain) {
  const rnd = mulberry32(SEED * 13 + 5);
  const out = [];
  let guard = 0;
  while (out.length < 320 && guard++ < 6000) {
    const x = (rnd() - 0.5) * 560, z = (rnd() - 0.5) * 560;
    const y = terrain.height(x, z);
    const shore = Math.abs(lakeD(x, z) - 1.08) < 0.14;
    const steep = terrain.slope(x, z) > 0.55;
    if (!(shore || steep || rnd() < 0.05)) continue;
    if (y < -0.3) continue;
    const rd = roadDist(x, z);
    if (rd.d < rd.hw + 3) continue;
    if (Math.hypot((x - TOWN.x) / 1.9, z - TOWN.z) < 40) continue;
    out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round((0.5 + rnd() * rnd() * 2.6) * 100) / 100, Math.round(rnd() * 628) / 100]);
  }
  return out;
}
