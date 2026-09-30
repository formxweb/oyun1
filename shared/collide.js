// Oriented-box collision shared by the client (player movement) and the server (NPCs, validation).
// Boxes come from buildings (walls, floor slabs, furniture) and player-built planks.
import { activeLocalBoxes, BTYPES, UNDER } from './layout.js';

export const STEP = 0.5;      // max ledge a walking body steps up
export const PLAYER_R = 0.38;
export const PLAYER_H = 1.8;

const CELL_SZ = 16;
const key = (i, j) => i * 73856093 ^ j * 19349663;

export function buildingWorldBoxes(b) {
  const local = activeLocalBoxes(b);
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const zone = b.zone || 'surface';
  return local.map((l) => ({
    id: b.id, kind: l.kind, zone,
    x: b.x + l.x * c + l.z * s, z: b.z - l.x * s + l.z * c,
    hx: l.hx, hz: l.hz, c, s,
    y0: b.floorY + l.y0, y1: b.floorY + l.y1,
  }));
}

export function plankWorldBox(p) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { id: p.id, kind: 'plank', zone: 'surface', x: p.x, z: p.z, hx: 0.5, hz: 1.6, c, s, y0: p.y - 0.09, y1: p.y + 0.09 };
}

export class Collision {
  constructor() { this.grid = new Map(); this.byId = new Map(); this.stamp = 1; }

  set(id, boxes) {
    this.remove(id);
    if (!boxes.length) return;
    this.byId.set(id, boxes);
    for (const bx of boxes) {
      bx._cells = [];
      const rad = Math.hypot(bx.hx, bx.hz);
      const i0 = Math.floor((bx.x - rad) / CELL_SZ), i1 = Math.floor((bx.x + rad) / CELL_SZ);
      const j0 = Math.floor((bx.z - rad) / CELL_SZ), j1 = Math.floor((bx.z + rad) / CELL_SZ);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(bx); bx._cells.push(arr);
      }
    }
  }

  remove(id) {
    const boxes = this.byId.get(id);
    if (!boxes) return;
    for (const bx of boxes) for (const arr of bx._cells) { const k = arr.indexOf(bx); if (k >= 0) arr.splice(k, 1); }
    this.byId.delete(id);
  }

  near(x, z, r, zone = 'surface') {
    const out = [];
    const st = ++this.stamp;
    const i0 = Math.floor((x - r) / CELL_SZ), i1 = Math.floor((x + r) / CELL_SZ);
    const j0 = Math.floor((z - r) / CELL_SZ), j1 = Math.floor((z + r) / CELL_SZ);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.grid.get(key(i, j));
      if (!arr) continue;
      for (const bx of arr) if (bx._st !== st && bx.zone === zone) { bx._st = st; out.push(bx); }
    }
    return out;
  }
}

/** Point (px,pz) in the box's local frame. */
function toLocal(bx, px, pz) {
  const dx = px - bx.x, dz = pz - bx.z;
  return [dx * bx.c - dz * bx.s, dx * bx.s + dz * bx.c];
}

export function insideBox(bx, px, pz, margin = 0) {
  const [lx, lz] = toLocal(bx, px, pz);
  return Math.abs(lx) <= bx.hx + margin && Math.abs(lz) <= bx.hz + margin;
}

/** Push a circle out of blocking boxes. Mutates pos {x,z}. Returns true if anything pushed. */
export function resolveXZ(col, pos, r, feetY, headY, zone = 'surface') {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    const boxes = col.near(pos.x, pos.z, r + 3, zone);
    for (const bx of boxes) {
      if (!(bx.y1 > feetY + STEP && bx.y0 < headY)) continue;
      const [lx, lz] = toLocal(bx, pos.x, pos.z);
      const cx = Math.max(-bx.hx, Math.min(bx.hx, lx));
      const cz = Math.max(-bx.hz, Math.min(bx.hz, lz));
      let dx = lx - cx, dz = lz - cz;
      const d2 = dx * dx + dz * dz;
      let px, pz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); const k = (r - d) / d; px = dx * k; pz = dz * k; }
      else { // centre inside the box: exit through the nearest face
        const ox = bx.hx - Math.abs(lx), oz = bx.hz - Math.abs(lz);
        if (ox < oz) { px = (lx >= 0 ? 1 : -1) * (ox + r); pz = 0; } else { px = 0; pz = (lz >= 0 ? 1 : -1) * (oz + r); }
      }
      pos.x += px * bx.c + pz * bx.s;
      pos.z += -px * bx.s + pz * bx.c;
      hit = true;
    }
  }
  return hit;
}

/** Highest standable surface under (x,z) that is reachable from feetY. */
export function groundAt(col, terrain, x, z, feetY, zone = 'surface') {
  if (zone === 'under') {
    let g = UNDER.y;
    for (const bx of col.near(x, z, 2, 'under')) {
      if (bx.y1 <= feetY + STEP + 0.01 && insideBox(bx, x, z, 0.05)) g = Math.max(g, bx.y1);
    }
    return g;
  }
  let g = terrain.height(x, z);
  for (const bx of col.near(x, z, 2, 'surface')) {
    if (bx.y1 <= feetY + STEP + 0.01 && bx.y1 > g && insideBox(bx, x, z, 0.05)) g = bx.y1;
  }
  return g;
}

/** Is (x,z) inside a hollow building's footprint (used for roof hiding, NPC "indoors", etc.). */
export function insideFootprint(b, x, z, margin = 0) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const dx = x - b.x, dz = z - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const T = BTYPES[b.type];
  return lx > -T.w / 2 - margin && lx < T.w / 2 + margin && lz > -T.d / 2 - margin && lz < T.d / 2 + margin;
}
