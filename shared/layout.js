// Static description of Hollowmere: building archetypes, the initial town, roads, landmarks.
// Everything here is the *genesis* state. Live state (destroyed, moved, renamed…) lives in the persistent world.

export const SEED = 1937;
export const WATER_LEVEL = 0;

export const LAKE = { x: 30, z: -70, r: 74 };
export const TOWN = { x: 0, z: 56, y: 2.3 };
export const HILLS = [
  { x: -22, z: -190, h: 27, s: 46 }, // Saint Anselm's Hill
  { x: 178, z: 26, h: 21, s: 38 },   // Radio Hill
  { x: -160, z: -60, h: 14, s: 52 },
  { x: 125, z: -150, h: 17, s: 60 },
  { x: -120, z: 150, h: 12, s: 50 },
];

export const SPAWN = { x: 112, z: 57, yaw: -Math.PI / 2 }; // arrival bus stop, looking west down Main Street
export const UNDER = { y: -120, r: 104, ceiling: 34 };

/** Roads: polylines of [x,z]. Main road exits the valley to the east at the barricade. */
export const ROADS = [
  { id: 'main', width: 7.5, pts: [[300, 46], [235, 50], [170, 54], [112, 55], [60, 55], [0, 55], [-60, 55], [-104, 55], [-124, 36], [-120, -22], [-104, -84], [-82, -140], [-52, -176], [-30, -190]] },
  { id: 'radio', width: 5, pts: [[112, 55], [136, 42], [160, 30], [176, 28]] },
  { id: 'pier', width: 4, pts: [[10, 52], [10, 30], [10, 12]] },
];

/** Interior furniture kinds are drawn by the client; `solid` ones also block movement. m = material key. */
const F = (m, x, z, w, d, h, o = {}) => ({ m, x, z, w, d, h, y: o.y || 0, solid: o.solid !== false, ...o });

export const BTYPES = {
  house: {
    label: 'House', w: 9, d: 8, h: 3.2, hp: 120, door: 1.4, roof: 'gable', siding: 'wood',
    furn: [F('bed', -3, -2.6, 2.2, 1.2, 0.6), F('wood', 1.5, -1.8, 1.6, 1.0, 0.8), F('wood', 3.3, 2.2, 1.0, 0.8, 1.6), F('rug', 0, 0.6, 3.0, 2.2, 0.02, { solid: false })],
    lamps: [[0, 2.5, 0]], value: 3,
  },
  cottage: {
    label: 'Cottage', w: 7, d: 6.5, h: 2.9, hp: 100, door: 1.3, roof: 'gable', siding: 'wood',
    furn: [F('bed', -2, -2, 2.0, 1.1, 0.55), F('wood', 1.6, -1.6, 1.3, 0.9, 0.8), F('rug', 0, 0.8, 2.6, 1.8, 0.02, { solid: false })],
    lamps: [[0, 2.3, 0]], value: 2,
  },
  store: {
    label: 'Store', w: 11, d: 8, h: 3.6, hp: 140, door: 1.8, roof: 'flat', siding: 'brick', awning: true,
    furn: [F('counter', 2.6, 1.2, 4.6, 0.8, 1.05), F('shelf', -4.6, -1, 0.6, 5, 2.0), F('shelf', 0, -3.4, 5, 0.6, 2.0), F('shelf', -1.6, -0.8, 0.6, 3, 1.5)],
    lamps: [[-2, 3.1, 0], [3, 3.1, -1]], value: 5,
  },
  diner: {
    label: 'Diner', w: 13, d: 8, h: 3.4, hp: 140, door: 1.8, roof: 'flat', siding: 'diner', awning: true, neon: true,
    furn: [F('counter', 0, -1.4, 8.2, 0.9, 1.05), F('booth', -5, 1.5, 1.6, 2.4, 0.9), F('booth', -5, -2.2, 1.6, 2.2, 0.9), F('booth', 5.2, 1.5, 1.6, 2.4, 0.9), F('jukebox', 5.6, -2.6, 1.0, 0.7, 1.6), F('stool', -2.4, 0, 0.5, 0.5, 0.7), F('stool', 0, 0, 0.5, 0.5, 0.7), F('stool', 2.4, 0, 0.5, 0.5, 0.7)],
    lamps: [[-3, 3.0, 0], [3, 3.0, 0]], value: 6,
  },
  radio: {
    label: 'Radio Station', w: 9, d: 8, h: 3.4, hp: 150, door: 1.4, roof: 'flat', siding: 'concrete', mast: true,
    furn: [F('console', 0, -2.6, 4.2, 1.1, 1.0), F('wood', -3.2, 1.0, 1.0, 2.6, 1.7), F('rug', 1, 1.2, 3.0, 2.4, 0.02, { solid: false })],
    lamps: [[0, 3.0, 0]], value: 7, radioAt: [0, 1.15, -2.7],
  },
  garage: {
    label: 'Garage', w: 11, d: 10, h: 4.2, hp: 160, door: 4.6, roof: 'shed', siding: 'metal',
    furn: [F('bench', -4.2, -3.6, 3.2, 1.0, 1.0), F('tire', 3.8, -3.6, 1.2, 1.2, 1.2), F('car', 0.6, -0.8, 4.6, 2.0, 1.4)],
    lamps: [[0, 3.6, 0]], value: 5,
  },
  constabulary: {
    label: 'Constabulary', w: 10, d: 8, h: 3.5, hp: 170, door: 1.5, roof: 'hip', siding: 'brick',
    furn: [F('wood', 0, -2.6, 3, 1.2, 0.85), F('cell', 3.6, -1.5, 0.2, 3.5, 2.4), F('wood', -3.6, -2.4, 1.4, 1.0, 1.2)],
    lamps: [[-1, 3.0, 0]], value: 5,
  },
  inn: {
    label: 'Inn', w: 17, d: 10, h: 3.7, hp: 180, door: 1.8, roof: 'gable', siding: 'wood',
    furn: [F('counter', 4.5, -2.5, 4.2, 0.8, 1.05), F('wood', -3, 0.5, 1.6, 1.6, 0.8), F('wood', -6.5, 0.5, 1.6, 1.6, 0.8), F('bed', -6.6, -3.6, 2.2, 1.2, 0.6), F('bed', -3.2, -3.6, 2.2, 1.2, 0.6), F('rug', 0, 1.6, 6.0, 2.6, 0.02, { solid: false })],
    lamps: [[-4, 3.2, 0], [4, 3.2, 0]], value: 8,
  },
  chapel: {
    label: 'Chapel', w: 8, d: 15, h: 4.6, hp: 230, door: 1.8, roof: 'gable', siding: 'stone', steeple: true,
    furn: [F('pew', -2.2, 2.8, 2.6, 0.6, 0.9), F('pew', 2.2, 2.8, 2.6, 0.6, 0.9), F('pew', -2.2, 0.6, 2.6, 0.6, 0.9), F('pew', 2.2, 0.6, 2.6, 0.6, 0.9), F('altar', 0, -6.3, 2.6, 1.0, 1.1), F('rug', 0.5, -4.0, 2.4, 3.2, 0.03, { solid: false, id: 'chapelRug', rot: 0.35 })],
    lamps: [[0, 3.6, -3.5], [0, 3.6, 3.5]], value: 9, hatchAt: [0.5, -4.0],
  },
  boathouse: {
    label: 'Boathouse', w: 8, d: 7, h: 3.2, hp: 100, door: 2.4, roof: 'gable', siding: 'wood',
    furn: [F('wood', -2.4, -2, 2.4, 1.2, 0.5), F('crate', 2.6, -2.2, 1.2, 1.2, 1.2)],
    lamps: [[0, 2.7, 0]], value: 3,
  },
  hall: {
    label: 'Hall', w: 28, d: 20, h: 8, hp: 400, door: 3.2, roof: 'flat', siding: 'stone',
    furn: [F('archive', 0, -6, 12, 1.2, 3.4), F('pew', -6, 2, 5, 0.7, 0.9), F('pew', 6, 2, 5, 0.7, 0.9)],
    lamps: [[-6, 6.5, -2], [6, 6.5, -2], [0, 6.5, 5]], value: 0,
  },
  pier: { label: 'Pier', w: 3.6, d: 38, h: 0, hp: 220, slab: true, value: 2, furn: [], lamps: [] },
  tower: { label: 'Water Tower', w: 7, d: 7, h: 24, hp: 200, watertower: true, value: 4, furn: [], lamps: [] },
  billboard: { label: 'Billboard', w: 13, d: 1, h: 10, hp: 90, billboard: true, value: 2, furn: [], lamps: [] },
};

/** id, type, name, x, z, yaw (front/door faces local +z). yaw=0 → faces south (+z). */
export const INITIAL_BUILDINGS = [
  // North side of Main Street (front faces the street, south)
  { id: 'b_whitlock', type: 'house', name: 'Whitlock House', x: -80, z: 42, yaw: 0 },
  { id: 'b_lund', type: 'cottage', name: "Ada Lund's Cottage", x: -60, z: 42.5, yaw: 0 },
  { id: 'b_store', type: 'store', name: "Pell's Provisions", x: -36, z: 42, yaw: 0 },
  { id: 'b_diner', type: 'diner', name: 'Marrow Diner', x: -8, z: 42, yaw: 0 },
  { id: 'b_radio', type: 'radio', name: 'KRNX 1370 — The Last Voice', x: 20, z: 42, yaw: 0 },
  { id: 'b_garage', type: 'garage', name: "Dutch's Garage", x: 49, z: 41, yaw: 0 },
  { id: 'b_okafor', type: 'house', name: 'Okafor House', x: 76, z: 42, yaw: 0 },
  // South side (front faces north)
  { id: 'b_inn', type: 'inn', name: 'Hollow Inn', x: -66, z: 68, yaw: Math.PI },
  { id: 'b_corvin', type: 'cottage', name: 'Corvin Cottage', x: -38, z: 67.5, yaw: Math.PI },
  { id: 'b_constab', type: 'constabulary', name: 'Constabulary', x: -12, z: 68, yaw: Math.PI },
  { id: 'b_sable', type: 'cottage', name: 'Sable Cottage', x: 14, z: 67.5, yaw: Math.PI },
  { id: 'b_brandt', type: 'house', name: 'Brandt House', x: 42, z: 68, yaw: Math.PI },
  // Landmarks
  { id: 'b_chapel', type: 'chapel', name: "Saint Anselm's Chapel", x: -19, z: -184, yaw: 0.25 },
  { id: 'b_boathouse', type: 'boathouse', name: 'Piet\'s Boathouse', x: 30, z: 10, yaw: Math.PI },
  { id: 'b_pier', type: 'pier', name: 'Hollow Pier', x: 10, z: -9, yaw: 0, floorY: 1.0 },
  { id: 'b_tower', type: 'tower', name: 'Water Tower', x: -104, z: 30, yaw: 0 },
  { id: 'b_billboard', type: 'billboard', name: 'Welcome Billboard', x: 92, z: 45, yaw: 0 },
];

/** Wall thickness of hollow buildings. */
export const WALL = 0.28;

/** Local (building-space) collision boxes: {x,z,hx,hz,y0,y1,kind}. y is relative to floorY. */
export function buildingLocalBoxes(type) {
  const T = BTYPES[type];
  const { w, d, h } = T;
  const boxes = [];
  const hw = w / 2, hd = d / 2;
  if (T.slab) {
    boxes.push({ x: 0, z: 0, hx: hw, hz: hd, y0: -3, y1: 0, kind: 'slab' });
    return boxes;
  }
  // foundation slab (walkable floor, slightly bigger than walls = porch)
  if (T.watertower) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxes.push({ x: sx * 2.6, z: sz * 2.6, hx: 0.45, hz: 0.45, y0: 0, y1: 14, kind: 'wall' });
    return boxes;
  }
  if (T.billboard) {
    for (const sx of [-1, 1]) boxes.push({ x: sx * (hw - 1.2), z: 0, hx: 0.4, hz: 0.4, y0: 0, y1: h, kind: 'wall' });
    return boxes;
  }
  boxes.push({ x: 0, z: 0, hx: hw + 0.35, hz: hd + 0.5, y0: -3, y1: 0, kind: 'slab' });
  const t = WALL / 2;
  boxes.push({ x: 0, z: -hd + t, hx: hw, hz: t, y0: 0, y1: h, kind: 'wall' }); // back
  boxes.push({ x: -hw + t, z: 0, hx: t, hz: hd, y0: 0, y1: h, kind: 'wall' }); // left
  boxes.push({ x: hw - t, z: 0, hx: t, hz: hd, y0: 0, y1: h, kind: 'wall' });  // right
  const dw = T.door / 2;
  const segW = hw - dw;
  boxes.push({ x: -dw - segW / 2, z: hd - t, hx: segW / 2, hz: t, y0: 0, y1: h, kind: 'wall' }); // front-left
  boxes.push({ x: dw + segW / 2, z: hd - t, hx: segW / 2, hz: t, y0: 0, y1: h, kind: 'wall' });  // front-right
  for (const f of T.furn || []) {
    if (!f.solid) continue;
    boxes.push({ x: f.x, z: f.z, hx: f.w / 2, hz: f.d / 2, y0: f.y, y1: f.y + f.h, kind: 'solid' });
  }
  return boxes;
}

/** Boxes that currently exist for a building record (ruins keep only their foundation slab). */
export function activeLocalBoxes(b) {
  const all = buildingLocalBoxes(b.type);
  if (!b.ruined) return all;
  if (BTYPES[b.type].slab) return [];
  return all.filter((l) => l.kind === 'slab');
}

/** Simple deterministic label for a world position, used for "last seen near…" and event text. */
export function districtAt(x, z, places) {
  if (places) {
    let best = null, bd = 1e9;
    for (const id in places) {
      const p = places[id];
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 26 && d < bd) { bd = d; best = p.name; }
    }
    if (best) return best;
  }
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r * 0.95) return 'Lake Hollow';
  if (Math.hypot(x - 10, z - 12) < 22 && z < 20) return 'the Pier';
  if (Math.hypot(x + 20, z + 188) < 55) return "Saint Anselm's Hill";
  if (Math.hypot(x - 176, z - 28) < 40) return 'Radio Hill';
  if (Math.hypot(x, z - 56) < 34 && Math.abs(z - 55) < 20 && Math.abs(x) < 140) {
    if (x > 60) return 'Eastgate';
    if (x < -60) return 'West End';
    return 'Marrow Street';
  }
  if (dl < LAKE.r * 1.35) return 'the Lakeshore';
  if (x > 200 && Math.abs(z - 46) < 30) return 'the Barricade Road';
  const r = Math.hypot(x, z);
  if (r > 260) return 'the Rim';
  if (z < -100) return 'the Northwoods';
  if (x < -100) return 'the Westwoods';
  if (x > 100) return 'the Eastwoods';
  if (z > 110) return 'the Southfields';
  return 'the Pinewood';
}

export const SIGN_MAX = 60;
export const NAME_MAX = 16;
