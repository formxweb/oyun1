// Buildings: hollow shells with real window openings, furnished interiors, roofs, signage, damage and ruins.
// Geometry is merged per-material for cheap draw calls; the same local boxes drive collision on the server.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BTYPES, WALL, buildingLocalBoxes } from '/shared/layout.js';
import { mulberry32 } from '/shared/util.js';
import { textTexture } from './tex.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

function boxGeo(w, h, d, us = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * sizes[f][0] * us, uv.getY(k) * sizes[f][1] * us); }
  return g;
}

class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s);
    geo.applyMatrix4(_m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
  }
  box(mat, x, y, z, w, h, d, us = 0.5, rx = 0, ry = 0, rz = 0) { this.add(mat, boxGeo(w, h, d, us), x, y, z, rx, ry, rz); }
  cyl(mat, x, y, z, rt, rb, h, seg = 10, rx = 0, ry = 0, rz = 0) { this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz); }
  build(group, { cast = true, receive = true } = {}) {
    const out = [];
    for (const [mat, list] of this.map) {
      const norm = list.map((g) => { const n = g.index ? g.toNonIndexed() : g; return n; });
      const merged = mergeGeometries(norm, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast && !mat.transparent; mesh.receiveShadow = receive;
      group.add(mesh); out.push(mesh);
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

const SIDING_COLORS = [0xd9d3c3, 0x9db2a0, 0x8fa6b8, 0xa8503c, 0xd1b26a, 0xb9a89a, 0x6f8a80];
const ROOF_COLORS = { house: 0x4a4038, cottage: 0x3d4a45, inn: 0x5a3a2e, chapel: 0x39424a, boathouse: 0x4d3a30, constabulary: 0x3d3d46, garage: 0x555a5e, hall: 0x2d3338 };

export class BuildingsView {
  constructor(scene, tex, world, quality) {
    this.scene = scene; this.tex = tex; this.world = world; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.underGroup = new THREE.Group(); scene.add(this.underGroup); this.underGroup.visible = false;
    this.views = new Map();
    this.lamps = [];
    this.smokers = [];
    this.boardTex = new Map();
    this.M = this.makeMaterials();
    this.time = 0;
    this.glass = [];   // materials whose emissive follows the lighting state
  }

  makeMaterials() {
    const t = this.tex;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = {
      trim: std({ color: 0xe8e2d2, roughness: 0.7 }),
      darkTrim: std({ color: 0x2a2622, roughness: 0.8 }),
      brick: std({ map: t.brick, roughness: 0.9 }), concrete: std({ map: t.concrete, roughness: 0.95 }), metal: std({ map: t.metal, roughness: 0.6, metalness: 0.5 }),
      stone: std({ map: t.stone, roughness: 0.95 }), floor: std({ map: t.floor, roughness: 0.75 }), wood: std({ map: t.wood, roughness: 0.75 }),
      darkWood: std({ map: t.wood, color: 0x6a5040, roughness: 0.7 }),
      foundation: std({ map: t.concrete, color: 0x9a9a94, roughness: 1 }),
      chrome: std({ color: 0xd6dbe0, roughness: 0.22, metalness: 0.95 }),
      vinyl: std({ color: 0x8a1f24, roughness: 0.5 }), formica: std({ color: 0xe8e0c8, roughness: 0.4 }), cloth: std({ color: 0xf0ece0, roughness: 0.9 }),
      blanket: std({ color: 0x3a5a7a, roughness: 0.95 }), black: std({ color: 0x141414, roughness: 0.6 }), rust: std({ color: 0x7a4a2c, roughness: 0.85, metalness: 0.4 }),
      green: std({ color: 0x3a5a3a, roughness: 0.9 }), iron: std({ color: 0x2c2f33, roughness: 0.5, metalness: 0.85 }),
      candle: std({ color: 0xffe6a0, emissive: 0xffb050, emissiveIntensity: 2.2 }),
      lampBulb: std({ color: 0xfff0c0, emissive: 0xffc070, emissiveIntensity: 2.5 }),
      rubble: std({ color: 0x4a423a, roughness: 1 }), char: std({ color: 0x1a1512, roughness: 1 }),
      glow: std({ color: 0x223344, emissive: 0x66ffee, emissiveIntensity: 1.8 }),
    };
    M.sidingCache = new Map();
    return M;
  }

  siding(kind, tint) {
    const M = this.M;
    if (kind === 'brick') return M.brick;
    if (kind === 'concrete') return M.concrete;
    if (kind === 'metal') return M.metal;
    if (kind === 'stone') return M.stone;
    const col = kind === 'diner' ? 0x9cc9c4 : SIDING_COLORS[Math.floor(tint * SIDING_COLORS.length) % SIDING_COLORS.length];
    if (!M.sidingCache.has(col)) M.sidingCache.set(col, new THREE.MeshStandardMaterial({ map: this.tex.clap(col), roughness: 0.85 }));
    return M.sidingCache.get(col);
  }
  roofMat(type, tint) {
    const key = 'roof' + type;
    if (this.M[key]) return this.M[key];
    const col = ROOF_COLORS[type] || 0x4a4038;
    const flat = ['store', 'diner', 'radio'].includes(type);
    this.M[key] = flat ? new THREE.MeshStandardMaterial({ map: this.tex.concrete, color: 0x555a5e, roughness: 1 }) : new THREE.MeshStandardMaterial({ map: this.tex.shingle(col), roughness: 0.9 });
    return this.M[key];
  }
  glassMat() {
    if (!this.M.glassMat) {
      this.M.glassMat = new THREE.MeshStandardMaterial({ color: 0x7a95a8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, emissive: 0xffc27a, emissiveIntensity: 0, depthWrite: false });
      this.M.glassMat.userData.glass = true;
    }
    return this.M.glassMat;
  }

  // ---------------------------------------------------------------- build
  add(b) {
    this.remove(b.id);
    const T = BTYPES[b.type];
    const root = new THREE.Group();
    const view = { id: b.id, b, root, T, parts: {}, lampsW: [], boardMeshes: {}, pos: new THREE.Vector3(b.x, b.floorY, b.z), yaw: b.yaw, lit: 0 };
    root.position.set(b.x, b.floorY, b.z); root.rotation.y = b.yaw;
    const inGroup = b.zone === 'under' ? this.underGroup : this.group;
    inGroup.add(root);
    this.views.set(b.id, view);
    if (b.ruined) this.buildRuin(view);
    else this.buildIntact(view);
    this.applyDamage(view);
    return view;
  }

  remove(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.root.parent?.remove(v.root);
    v.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.lamps = this.lamps.filter((l) => l.bid !== id);
    this.smokers = this.smokers.filter((s) => s.bid !== id);
    this.views.delete(id);
  }

  buildIntact(v) {
    const { b, T, root } = v;
    const M = this.M;
    const rnd = mulberry32(hashId(b.id));
    const side = this.siding(T.siding, b.tint ?? 0.3);
    const P = new Parts(), R = new Parts(), G = new Parts(), F = new Parts(), E = new Parts();
    const hw = T.w / 2, hd = T.d / 2, h = T.h;
    const local = buildingLocalBoxes(b.type);

    if (T.slab) return this.buildPier(v);
    if (T.watertower) return this.buildTower(v);
    if (T.billboard) return this.buildBillboard(v);

    // foundation slab (below floor level; walkable top sits at y=0)
    const slab = local.find((l) => l.kind === 'slab');
    P.box(M.foundation, slab.x, -1.5, slab.z, slab.hx * 2, 3, slab.hz * 2, 0.4);
    // interior floor
    F.box(M.floor, 0, 0.012, 0, T.w - WALL * 2, 0.02, T.d - WALL * 2, 0.4);

    // ---- walls with window openings
    const walls = local.filter((l) => l.kind === 'wall');
    const frame = M.trim;
    const wallSpec = (w) => {
      const alongX = w.hx > w.hz;
      const L = (alongX ? w.hx : w.hz) * 2;
      return { alongX, L, th: (alongX ? w.hz : w.hx) * 2 };
    };
    const winDefs = this.windowSpec(b.type, T);
    const front = walls.filter((w) => w.z > 0 && w.hx > w.hz);
    for (const w of walls) {
      const { alongX, L, th } = wallSpec(w);
      const isFront = front.includes(w);
      const back = w.z < -hd + 1 && alongX;
      let wins = [];
      const spec = isFront ? winDefs.front : back ? winDefs.back : winDefs.side;
      if (spec && L > spec.minLen) {
        const n = Math.max(1, Math.floor((L - 0.6) / spec.pitch));
        for (let i = 0; i < n; i++) wins.push({ s: -L / 2 + (i + 0.5) * (L / n), w: spec.w, h: spec.h, sill: spec.sill });
      }
      // pieces along the wall's length axis: s from -L/2..L/2
      const put = (s0, s1, y0, y1) => {
        if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
        const len = s1 - s0, sm = (s0 + s1) / 2, ym = (y0 + y1) / 2;
        if (alongX) P.box(side, w.x + sm, ym, w.z, len, y1 - y0, th, 0.5); else P.box(side, w.x, ym, w.z + sm, th, y1 - y0, len, 0.5);
      };
      wins.sort((a, c) => a.s - c.s);
      let cur = -L / 2;
      let lo = 0, hi = h;
      if (wins.length) {
        // full-height pillars between windows, base strips below, header strips above
        for (const wi of wins) {
          const s0 = wi.s - wi.w / 2, s1 = wi.s + wi.w / 2;
          put(cur, s0, 0, h);
          put(s0, s1, 0, wi.sill);
          put(s0, s1, wi.sill + wi.h, h);
          cur = s1;
          // glass + frame
          const ym = wi.sill + wi.h / 2;
          if (alongX) {
            G.box(this.glassMat(), w.x + wi.s, ym, w.z, wi.w, wi.h, 0.03, 1);
            for (const [ox, oy, sw, sh] of [[0, wi.h / 2, wi.w + 0.16, 0.08], [0, -wi.h / 2, wi.w + 0.16, 0.1], [-wi.w / 2, 0, 0.08, wi.h], [wi.w / 2, 0, 0.08, wi.h], [0, 0, 0.04, wi.h], [0, 0, wi.w, 0.04]]) E.box(frame, w.x + wi.s + ox, ym + oy, w.z, sw, sh, th + 0.09, 1);
          } else {
            G.box(this.glassMat(), w.x, ym, w.z + wi.s, 0.03, wi.h, wi.w, 1);
            for (const [oz, oy, sw, sh] of [[0, wi.h / 2, wi.w + 0.16, 0.08], [0, -wi.h / 2, wi.w + 0.16, 0.1], [-wi.w / 2, 0, 0.08, wi.h], [wi.w / 2, 0, 0.08, wi.h], [0, 0, 0.04, wi.h], [0, 0, wi.w, 0.04]]) E.box(frame, w.x, ym + oy, w.z + wi.s + oz, th + 0.09, sh, sw, 1);
          }
        }
        put(cur, L / 2, 0, h);
      } else put(-L / 2, L / 2, 0, h);
    }
    // lintel above the door
    const dw = T.door;
    P.box(side, 0, (2.35 + h) / 2, hd - WALL / 2, dw, Math.max(0.05, h - 2.35), WALL, 0.5);
    for (const sx of [-1, 1]) E.box(frame, sx * (dw / 2 + 0.05), 1.18, hd - WALL / 2, 0.1, 2.36, WALL + 0.12, 1);
    E.box(frame, 0, 2.38, hd - WALL / 2, dw + 0.2, 0.1, WALL + 0.12, 1);
    // an open door leaf
    if (T.door < 3) {
      const leaf = new THREE.Mesh(boxGeo(T.door * 0.96, 2.28, 0.06, 0.6), M.darkWood);
      leaf.geometry.translate(T.door * 0.48, 0, 0);
      leaf.position.set(-T.door / 2, 1.14, hd + 0.03); leaf.rotation.y = -1.25; leaf.castShadow = true;
      root.add(leaf); v.door = leaf;
    } else {
      P.box(M.metal, 0, h - 0.55, hd - 0.5, T.door, 1.0, 0.12, 0.5); // roll-up door raised
    }

    // ---- roof
    this.buildRoof(v, R, side);
    // ---- interior
    this.furnish(v, F, rnd);
    // ---- exterior details
    this.decorate(v, P, E, R, rnd);

    // lamps
    for (const [lx, ly, lz] of T.lamps) {
      F.cyl(M.lampBulb, lx, ly, lz, 0.12, 0.12, 0.2, 8);
      F.cyl(M.iron, lx, ly + 0.5, lz, 0.015, 0.015, 0.8, 4);
      const wp = new THREE.Vector3(lx, ly, lz);
      const lamp = { bid: b.id, local: wp, world: new THREE.Vector3(), color: 0xffc98a, intensity: 6, dist: 15, on: false, zone: b.zone };
      this.lamps.push(lamp); v.lampsW.push(lamp);
    }

    v.parts.walls = P.build(root); v.parts.roof = R.build(root); v.parts.inner = F.build(root, { cast: false });
    v.parts.trim = E.build(root); v.parts.glass = G.build(root, { cast: false });
    v.glassMeshes = v.parts.glass;
    if (b.relocated) this.addPlaque(v);
    // name sign
    if (!['house', 'cottage', 'chapel', 'boathouse', 'hall'].includes(b.type) || b.type === 'chapel') this.addNameSign(v);
  }

  windowSpec(type, T) {
    switch (type) {
      case 'diner': return { front: { minLen: 3, pitch: 3.5, w: 2.6, h: 1.25, sill: 0.95 }, back: { minLen: 3, pitch: 4, w: 1.2, h: 1.0, sill: 1.2 }, side: { minLen: 3, pitch: 4, w: 1.2, h: 1.1, sill: 1.1 } };
      case 'store': return { front: { minLen: 2.5, pitch: 3.2, w: 2.1, h: 1.5, sill: 0.8 }, back: null, side: { minLen: 3, pitch: 4, w: 1.1, h: 1.1, sill: 1.1 } };
      case 'garage': return { front: null, back: { minLen: 3, pitch: 3.6, w: 1.2, h: 0.7, sill: 2.6 }, side: { minLen: 3, pitch: 3.4, w: 1.2, h: 0.7, sill: 2.7 } };
      case 'chapel': return { front: { minLen: 2, pitch: 3.2, w: 0.9, h: 2.0, sill: 1.2 }, back: null, side: { minLen: 3, pitch: 3.3, w: 0.9, h: 2.3, sill: 1.3 } };
      case 'radio': return { front: { minLen: 2.5, pitch: 3.1, w: 1.5, h: 1.2, sill: 1.0 }, back: { minLen: 3, pitch: 4, w: 1.2, h: 1.0, sill: 1.2 }, side: { minLen: 3, pitch: 4, w: 1.2, h: 1.0, sill: 1.1 } };
      case 'inn': return { front: { minLen: 2.5, pitch: 3.0, w: 1.15, h: 1.25, sill: 0.95 }, back: { minLen: 3, pitch: 3.6, w: 1.1, h: 1.2, sill: 1.0 }, side: { minLen: 3, pitch: 3.6, w: 1.1, h: 1.2, sill: 1.0 } };
      default: return { front: { minLen: 2.2, pitch: 3.4, w: 1.15, h: 1.25, sill: 0.95 }, back: { minLen: 3, pitch: 3.6, w: 1.1, h: 1.2, sill: 1.0 }, side: { minLen: 3, pitch: 3.6, w: 1.1, h: 1.2, sill: 1.0 } };
    }
  }

  buildRoof(v, R, side) {
    const { b, T } = v;
    const M = this.M;
    const hw = T.w / 2, hd = T.d / 2, h = T.h;
    const rm = this.roofMat(b.type, b.tint);
    const ov = 0.55, th = 0.16;
    if (T.roof === 'flat') {
      R.box(rm, 0, h + 0.15, 0, T.w + 0.3, 0.3, T.d + 0.3, 0.3);
      for (const [x, z, w, d] of [[0, hd + 0.1, T.w + 0.4, 0.22], [0, -hd - 0.1, T.w + 0.4, 0.22], [hw + 0.1, 0, 0.22, T.d], [-hw - 0.1, 0, 0.22, T.d]]) R.box(M.concrete, x, h + 0.55, z, w, 0.5, d, 0.5);
      R.box(M.metal, hw * 0.4, h + 0.9, -hd * 0.3, 1.6, 0.9, 1.2, 0.5);
      R.cyl(M.iron, -hw * 0.5, h + 0.75, hd * 0.2, 0.1, 0.1, 1.0, 6);
    } else if (T.roof === 'shed') {
      const rise = 1.4, span = Math.hypot(T.d + ov * 2, rise), a = Math.atan2(rise, T.d + ov * 2);
      R.box(rm, 0, h + rise / 2 + 0.05, 0, T.w + ov * 2, th, span, 0.5, a, 0, 0);
    } else if (T.roof === 'hip') {
      const rise = 2.2;
      const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4);
      g.scale((T.w / 2 + ov) * Math.SQRT2, rise, (T.d / 2 + ov) * Math.SQRT2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 3);
      R.add(rm, g, 0, h + rise / 2, 0);
    } else { // gable
      const ridgeZ = T.d > T.w * 1.35;
      const W = ridgeZ ? T.d : T.w, D = ridgeZ ? T.w : T.d;
      const rise = Math.min(2.6, D * 0.38);
      const half = D / 2 + ov;
      const a = Math.atan2(rise, half), span = Math.hypot(half, rise);
      const ry = ridgeZ ? Math.PI / 2 : 0;
      for (const sign of [-1, 1]) {
        const g = boxGeo(W + ov * 2, th, span, 0.6);
        _e.set(sign * a, 0, 0); _q.setFromEuler(_e); _m.compose(new THREE.Vector3(0, 0, sign * half / 2), _q, _s); g.applyMatrix4(_m);
        _e.set(0, ry, 0); _q.setFromEuler(_e); _m.compose(new THREE.Vector3(0, h + rise / 2 + th / 2, 0), _q, _s); g.applyMatrix4(_m);
        R.map.has(rm) ? R.map.get(rm).push(g) : R.map.set(rm, [g]);
      }
      // gable end triangles
      const shape = new THREE.Shape(); shape.moveTo(-D / 2, 0); shape.lineTo(D / 2, 0); shape.lineTo(0, rise); shape.lineTo(-D / 2, 0);
      for (const sx of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(shape, { depth: WALL, bevelEnabled: false });
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
        g.translate(0, 0, -WALL / 2);
        // extruded along z, shape in xy: rotate so the shape lies across the roof's short axis
        _e.set(0, ridgeZ ? (sx > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        _q.setFromEuler(_e);
        const pos = ridgeZ ? new THREE.Vector3(0, h, sx * (W / 2 - WALL / 2)) : new THREE.Vector3(sx * (W / 2 - WALL / 2), h, 0);
        _m.compose(pos, _q, _s); g.applyMatrix4(_m);
        const arr = R.map.get(side) || []; arr.push(g); R.map.set(side, arr);
      }
    }
  }

  /** Buildings reborn in the Understory carry a plaque about how they fell. */
  addPlaque(v) {
    const { b, T, root } = v;
    const when = b.relocated.at ? new Date(b.relocated.at).toISOString().slice(11, 19) + ' UTC' : '';
    const tex = textTexture('', { w: 512, h: 220, lines: ['FORMERLY', b.name.toUpperCase().slice(0, 24), b.relocated.by ? `brought down by ${b.relocated.by}`.slice(0, 32) : 'it fell', when], font: 'bold 44px Georgia, serif', color: '#a8fff2', bg: '#071618', pad: 10 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), this.M.stone); post.position.set(T.w / 2 - 0.6, 0.25, T.d / 2 + 2.4); root.add(post);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.66, 0.07), [this.M.stone, this.M.stone, this.M.stone, this.M.stone, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.6 }), this.M.stone]);
    plate.position.set(T.w / 2 - 0.6, 0.72, T.d / 2 + 2.4); plate.rotation.x = -0.25; root.add(plate);
  }

  addNameSign(v) {
    const { b, T } = v;
    const tex = textTexture(shortName(b.name), { w: 512, h: 100, font: 'bold 60px "Trebuchet MS", Arial', color: '#f6ecd0', bg: '#2b2a28', stroke: null });
    const wS = Math.min(T.w - 1.2, b.type === 'diner' || b.type === 'store' ? 3.6 : 5.0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.0 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(wS, wS * 100 / 512, 0.1), mat);
    m.position.set(b.type === 'chapel' ? 0 : (T.door > 2 ? 0 : T.w * 0.24), b.type === 'garage' ? T.h - 0.35 : b.type === 'diner' || b.type === 'store' ? T.h - 0.45 : Math.min(T.h - 0.45, 3.1), T.d / 2 + 0.12);
    if (b.type === 'diner' || b.type === 'store') m.position.x = 0;
    if (b.type === 'radio') m.position.x = -T.w * 0.22;
    m.castShadow = true;
    v.root.add(m); v.sign = m;
  }

  // ---------------------------------------------------------------- decoration
  decorate(v, P, E, R, rnd) {
    const { b, T } = v, M = this.M;
    const hw = T.w / 2, hd = T.d / 2, h = T.h;
    const chimney = (x, z) => { P.box(M.brick, x, h + 1.4, z, 0.9, 3.2, 0.9, 0.5); P.box(M.concrete, x, h + 3.05, z, 1.1, 0.18, 1.1, 0.5); v.chimney = new THREE.Vector3(x, h + 3.2, z); this.smokers.push({ bid: b.id, kind: 'chimney', world: new THREE.Vector3(), active: false }); };
    if (b.type === 'house' || b.type === 'cottage' || b.type === 'inn') {
      chimney(hw * 0.55, -hd * 0.25);
      // porch
      const pw = Math.min(4.6, T.w * 0.5);
      P.box(M.wood, 0, 0.1, hd + 0.9, pw, 0.2, 1.6, 0.4);
      for (const sx of [-1, 1]) P.box(M.trim, sx * (pw / 2 - 0.12), 1.2, hd + 1.55, 0.14, 2.4, 0.14, 1);
      R.box(this.roofMat(b.type), 0, 2.5, hd + 0.9, pw + 0.5, 0.12, 2.0, 0.6, 0.12, 0, 0);
      P.box(M.trim, 0, 0.55, hd + 1.62, pw - 0.3, 0.06, 0.06, 1);
      // steps
      P.box(M.wood, 0, 0.05, hd + 1.95, 1.8, 0.1, 0.4, 0.4);
    }
    if (b.type === 'store' || b.type === 'diner') {
      // striped awning
      const aw = new THREE.Mesh(new THREE.BoxGeometry(T.w - 1.2, 0.08, 1.7), new THREE.MeshStandardMaterial({ map: stripeTex(b.type === 'diner' ? '#c9433a' : '#2f6f57'), roughness: 0.9 }));
      aw.position.set(0, 2.42, hd + 0.85); aw.rotation.x = 0.26; aw.castShadow = true; v.root.add(aw);
      for (const sx of [-1, 1]) P.cyl(M.iron, sx * (T.w / 2 - 0.9), 1.4, hd + 1.6, 0.04, 0.04, 2.8, 6);
    }
    if (b.type === 'diner') {
      P.box(M.chrome, 0, 1.1, hd + 0.02, T.w, 0.18, 0.05, 1);
      P.box(M.chrome, 0, 0.55, hd + 0.02, T.w, 0.1, 0.05, 1);
      const neonTex = textTexture('DINER', { w: 256, h: 128, font: 'bold 96px "Trebuchet MS", Arial', color: '#ff6a90', bg: '#120810', glow: '#ff2a70' });
      const neon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.12), new THREE.MeshStandardMaterial({ map: neonTex, emissiveMap: neonTex, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5 }));
      neon.position.set(T.w * 0.32, h + 1.25, hd - 0.4); neon.castShadow = false;
      v.root.add(neon); v.neon = neon;
      P.box(M.trim, T.w * 0.32 - 1.0, h + 0.7, hd - 0.4, 0.1, 1.4, 0.1, 1); P.box(M.trim, T.w * 0.32 + 1.0, h + 0.7, hd - 0.4, 0.1, 1.4, 0.1, 1);
    }
    if (b.type === 'radio') {
      // lattice mast
      const mx = hw * 0.6, mz = -hd * 0.4;
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) P.cyl(M.iron, mx + dx * 0.7, h + 9, mz + dz * 0.7, 0.04, 0.05, 18, 5);
      for (let i = 0; i < 12; i++) { const y = h + 1 + i * 1.5; P.box(M.iron, mx, y, mz, 0.72 * (1 - i * 0.02), 0.04, 0.04, 1); P.box(M.iron, mx, y, mz, 0.04, 0.04, 0.72 * (1 - i * 0.02), 1); }
      P.cyl(M.iron, mx, h + 19.5, mz, 0.03, 0.05, 3, 5);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 3 }));
      blink.position.set(mx, h + 21, mz); v.root.add(blink); v.blink = blink;
      v.mastTop = new THREE.Vector3(mx, h + 21, mz);
      // on-air light
      const onair = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 2.4 }));
      onair.position.set(hw * 0.2, 2.6, hd + 0.08); v.root.add(onair); v.onair = onair;
    }
    if (b.type === 'garage') {
      P.box(M.concrete, 0, 0.02, hd + 1.8, T.door + 1, 0.06, 3.4, 0.4);
      const hang = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.8), M.darkWood); hang.position.set(T.door / 2 + 0.5, 3.4, hd + 0.4); v.root.add(hang);
    }
    if (b.type === 'constabulary') {
      P.cyl(M.iron, hw - 0.4, 3.2, hd + 1.0, 0.05, 0.05, 6.4, 6);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a3f7a, side: THREE.DoubleSide, roughness: 0.9 }));
      flag.position.set(hw - 1.1, 5.7, hd + 1.0); v.root.add(flag); v.flag = flag;
      // notice board beside the door for wanted posters
      P.box(M.darkWood, hw * 0.55, 1.6, hd + 0.08, 1.9, 1.3, 0.08, 0.5);
      v.boardSlot = { x: hw * 0.55, y: 1.6, z: hd + 0.15, w: 1.7, h: 1.15 };
    }
    if (b.type === 'chapel') {
      // steeple
      const tz = hd - 1.7;
      P.box(M.stone, 0, h + 2.2, tz, 3.0, 5.6, 3.0, 0.4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(M.stone, sx * 1.5, h + 5.2, tz + sz * 1.5, 0.35, 0.8, 0.35, 0.5);
      const g = new THREE.ConeGeometry(2.05, 5.2, 4, 1); g.rotateY(Math.PI / 4);
      R.add(this.roofMat('chapel'), g, 0, h + 5 + 2.6 + 0.4, tz);
      P.box(M.iron, 0, h + 5 + 5.6 + 0.9, tz, 0.1, 1.6, 0.1, 1); P.box(M.iron, 0, h + 5 + 5.6 + 1.2, tz, 0.7, 0.1, 0.1, 1);
      // belfry openings
      for (const [x, z, ry] of [[0, tz + 1.51, 0], [0, tz - 1.51, 0], [1.51, tz, Math.PI / 2], [-1.51, tz, Math.PI / 2]]) E.box(M.black, x, h + 3.9, z, ry ? 0.05 : 1.0, 1.6, ry ? 1.0 : 0.05, 1);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.55, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.8, roughness: 0.35 }));
      bell.position.set(0, h + 4.2, tz); v.root.add(bell); v.bell = bell;
      // rose window on the front (stained glass)
      const rose = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshStandardMaterial({ map: roseTex(), emissiveMap: roseTex(), emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3 }));
      rose.position.set(0, h - 0.9, hd + 0.02); v.root.add(rose); v.rose = rose;
      // buttresses
      for (const sx of [-1, 1]) for (const z of [-hd * 0.5, 0, hd * 0.5]) P.box(M.stone, sx * (hw + 0.25), 1.6, z, 0.5, 3.2, 0.7, 0.5);
      // steps up to the door
      P.box(M.stone, 0, 0.05, hd + 1.0, 2.6, 0.2, 1.6, 0.5);
    }
    if (b.type === 'boathouse') {
      P.box(M.wood, 0, 0.06, hd + 1.6, T.door + 1.0, 0.1, 3.2, 0.4);
      P.box(M.darkWood, 0, 0.35, -1.5, 3.4, 0.4, 1.2, 0.5); // upturned boat hull
    }
    if (b.type === 'hall') {
      for (const sx of [-1, 1]) for (const sz of [0.3, 0.7]) P.cyl(M.stone, sx * (hw - 1), h / 2, hd * sz * 1.4 - 1, 0.8, 0.9, h, 10);
    }
  }

  // ---------------------------------------------------------------- interiors
  furnish(v, F, rnd) {
    const { b, T } = v, M = this.M;
    for (const f of T.furn) {
      const { x, z, w, d, h } = f, y0 = f.y || 0;
      switch (f.m) {
        case 'rug': {
          const g = boxGeo(w, h, d, 0.5);
          F.add(rugMat(b.id + x), g, x, y0 + h / 2 + 0.025, z, 0, f.rot || 0, 0);
          if (f.id === 'chapelRug') v.rugPos = { x, z, rot: f.rot || 0 };
          break;
        }
        case 'bed':
          F.box(M.darkWood, x, 0.25, z, w, 0.3, d, 0.6); F.box(M.cloth, x, 0.5, z, w - 0.1, 0.22, d - 0.1, 0.6); F.box(M.blanket, x + 0.25, 0.63, z, w * 0.6, 0.1, d - 0.05, 0.6);
          F.box(M.cloth, x - w / 2 + 0.35, 0.68, z, 0.5, 0.14, d * 0.6, 1); F.box(M.darkWood, x - w / 2 - 0.04, 0.6, z, 0.08, 0.7, d, 0.6);
          break;
        case 'counter':
          F.box(M.darkWood, x, h / 2 - 0.03, z, w, h - 0.06, d, 0.6); F.box(M.formica, x, h - 0.03, z, w + 0.1, 0.06, d + 0.12, 0.6);
          if (b.type === 'diner') { F.box(M.chrome, x, h + 0.02, z + d / 2, w, 0.03, 0.03, 1); F.box(M.cloth, x - 1.5, h + 0.16, z, 0.3, 0.26, 0.3, 1); F.cyl(M.chrome, x + 1.0, h + 0.22, z, 0.12, 0.12, 0.38, 8); }
          break;
        case 'shelf':
          F.box(M.darkWood, x, h / 2, z, w, h, d, 0.6);
          for (let i = 0; i < 5; i++) {
            const alongX = w > d;
            for (let j = 0; j < 4; j++) {
              const col = new THREE.Color().setHSL(rnd(), 0.5, 0.5);
              const gm = this.goodMat(col.getHex());
              const gx = alongX ? x - w / 2 + 0.4 + j * (w - 0.8) / 3.2 : x + (d > 0 ? 0 : 0) + (rnd() - 0.5) * 0.2;
              const gz = alongX ? z + (rnd() - 0.5) * 0.15 : z - d / 2 + 0.4 + j * (d - 0.8) / 3.2;
              const hh = 0.18 + rnd() * 0.18;
              F.box(gm, gx, 0.3 + i * 0.4 + hh / 2, gz + (alongX ? (z < 0 ? 0.18 : -0.05) : 0), 0.22, hh, 0.22, 1);
            }
          }
          break;
        case 'booth':
          F.box(M.vinyl, x, 0.25, z, w, 0.5, d, 0.6);
          F.box(M.vinyl, x + (x > 0 ? w / 2 - 0.08 : -w / 2 + 0.08), 0.75, z, 0.16, 0.9, d, 0.6);
          F.box(M.formica, x + (x > 0 ? -w * 0.9 : w * 0.9), 0.72, z, 0.9, 0.05, d * 0.7, 0.6); F.cyl(M.chrome, x + (x > 0 ? -w * 0.9 : w * 0.9), 0.36, z, 0.05, 0.05, 0.72, 6);
          break;
        case 'stool': F.cyl(M.chrome, x, 0.33, z, 0.04, 0.06, 0.66, 6); F.cyl(M.vinyl, x, 0.7, z, 0.2, 0.2, 0.1, 10); break;
        case 'jukebox': {
          F.box(M.vinyl, x, h / 2, z, w, h, d, 0.6);
          const jm = jukeMat();
          F.box(jm, x - 0.0, h * 0.62, z + d / 2 + 0.01, w * 0.8, h * 0.5, 0.02, 1);
          F.cyl(M.chrome, x, h + 0.03, z, w * 0.5, w * 0.5, 0.06, 12);
          break;
        }
        case 'console': {
          F.box(M.darkWood, x, h / 2 - 0.05, z, w, h - 0.1, d, 0.6); F.box(M.black, x, h - 0.03, z + 0.05, w - 0.1, 0.08, d - 0.05, 1);
          for (let i = 0; i < 6; i++) F.box(this.M.glow, x - w / 2 + 0.5 + i * 0.5, h + 0.03, z, 0.32, 0.03, 0.12, 1);
          F.cyl(M.iron, x + 0.8, h + 0.4, z + 0.2, 0.015, 0.015, 0.8, 4, 0.9, 0, 0); F.cyl(M.black, x + 0.8, h + 0.78, z + 0.55, 0.06, 0.06, 0.1, 8);
          v.radioLocal = new THREE.Vector3(x - 1.4, h + 0.18, z);
          F.box(M.rust, x - 1.4, h + 0.18, z, 0.55, 0.32, 0.22, 1);
          break;
        }
        case 'bench': F.box(M.darkWood, x, h / 2, z, w, h, d, 0.6); F.box(M.iron, x, h + 0.02, z, w * 0.9, 0.04, d * 0.9, 1); F.box(M.rust, x - 0.6, h + 0.18, z, 0.5, 0.3, 0.3, 1); break;
        case 'tire': { const g = new THREE.TorusGeometry(0.4, 0.17, 8, 14); F.add(M.black, g, x, 0.6, z, Math.PI / 2, 0, 0); break; }
        case 'car':
          F.box(M.rust, x, 0.65, z, w, 0.7, d, 0.6); F.box(M.rust, x - w * 0.12, 1.2, z, w * 0.45, 0.6, d * 0.92, 0.6);
          F.box(this.glassMat(), x - w * 0.12, 1.2, z, w * 0.4, 0.42, d * 0.94, 1);
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.cyl(M.black, x + sx * w * 0.32, 0.35, z + sz * (d / 2), 0.35, 0.35, 0.28, 12, Math.PI / 2, 0, 0);
          F.box(M.chrome, x + w / 2 - 0.02, 0.6, z, 0.06, 0.25, d * 0.8, 1);
          break;
        case 'cell':
          for (let i = 0; i < 15; i++) F.cyl(M.iron, x, 1.2, z - d / 2 + 0.15 + i * (d - 0.3) / 14, 0.03, 0.03, 2.4, 5);
          F.box(M.iron, x, 2.35, z, 0.08, 0.08, d, 1); F.box(M.iron, x, 0.1, z, 0.08, 0.08, d, 1); F.box(M.iron, x, 1.2, z, 0.06, 0.06, d, 1);
          break;
        case 'pew': F.box(M.darkWood, x, 0.28, z, w, 0.12, d + 0.3, 0.6); F.box(M.darkWood, x, 0.6, z - 0.32, w, 0.7, 0.1, 0.6); F.box(M.darkWood, x - w / 2 + 0.05, 0.25, z, 0.1, 0.5, d + 0.3, 0.6); F.box(M.darkWood, x + w / 2 - 0.05, 0.25, z, 0.1, 0.5, d + 0.3, 0.6); break;
        case 'altar': {
          F.box(M.stone, x, h / 2, z, w, h, d, 0.6); F.box(M.cloth, x, h + 0.01, z, w * 0.9, 0.03, d * 1.05, 1);
          for (const sx of [-1, 1]) { F.cyl(M.candle, x + sx * 0.9, h + 0.25, z, 0.05, 0.05, 0.4, 6); }
          F.box(M.iron, x, h + 0.35, z - 0.2, 0.06, 0.6, 0.06, 1); F.box(M.iron, x, h + 0.5, z - 0.2, 0.34, 0.06, 0.06, 1);
          v.candles = [new THREE.Vector3(x - 0.9, h + 0.5, z), new THREE.Vector3(x + 0.9, h + 0.5, z)];
          break;
        }
        case 'crate': F.box(M.wood, x, h / 2, z, w, h, d, 0.6); break;
        case 'archive': { v.archiveSlot = { x, y: h / 2 + 0.2, z: z + 0.7, w: w, h: h }; F.box(M.stone, x, h / 2, z - 0.1, w + 0.6, h + 0.3, 0.5, 0.4); break; }
        default: // 'wood' — table / wardrobe
          if (h < 1.0) { F.box(M.wood, x, h - 0.04, z, w, 0.08, d, 0.8); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.box(M.darkWood, x + sx * (w / 2 - 0.08), h / 2 - 0.04, z + sz * (d / 2 - 0.08), 0.08, h - 0.08, 0.08, 1); }
          else F.box(M.wood, x, h / 2, z, w, h, d, 0.6);
      }
    }
  }

  goodMat(hex) {
    const k = 'good' + hex;
    return this.M[k] || (this.M[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 }));
  }

  // ---------------------------------------------------------------- special structures
  buildPier(v) {
    const { b, T, root } = v, M = this.M;
    const P = new Parts();
    const hw = T.w / 2, hd = T.d / 2;
    P.box(M.wood, 0, -0.06, 0, T.w, 0.14, T.d, 0.5);
    for (let z = -hd + 1.5; z < hd; z += 3.2) for (const sx of [-1, 1]) P.cyl(M.darkWood, sx * (hw - 0.15), -2.5, z, 0.13, 0.14, 5.5, 6);
    for (let z = -hd + 1.5; z < hd - 1; z += 3.2) for (const sx of [-1, 1]) P.cyl(M.darkWood, sx * (hw - 0.05), 0.55, z, 0.05, 0.05, 1.1, 5);
    for (const sx of [-1, 1]) P.box(M.darkWood, sx * (hw - 0.05), 1.02, 0, 0.06, 0.06, T.d - 4, 1);
    P.box(M.darkWood, 0, 0.3, -hd + 0.6, hw * 2 - 0.4, 0.5, 0.5, 0.5); // bench at the end
    v.parts.walls = P.build(root);
    const lamp = { bid: b.id, local: new THREE.Vector3(0, 2.6, -hd + 0.5), world: new THREE.Vector3(), color: 0xffd08a, intensity: 6, dist: 16, on: false, zone: 'surface' };
    P.map.clear();
    const Q = new Parts(); Q.cyl(M.iron, 0, 1.4, -hd + 0.5, 0.04, 0.05, 2.8, 6); Q.cyl(M.lampBulb, 0, 2.7, -hd + 0.5, 0.16, 0.16, 0.24, 8); Q.build(root, { cast: false });
    this.lamps.push(lamp); v.lampsW.push(lamp);
  }

  buildTower(v) {
    const { b, T, root } = v, M = this.M;
    const P = new Parts();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(M.iron, sx * 2.6, 7, sz * 2.6, 0.22, 0.32, 14, 8);
    for (let i = 0; i < 4; i++) { const y = 2 + i * 3.2; for (const [x, z, w, d] of [[0, 2.6, 5.2, 0.08], [0, -2.6, 5.2, 0.08], [2.6, 0, 0.08, 5.2], [-2.6, 0, 0.08, 5.2]]) P.box(M.iron, x, y, z, w, 0.12, d, 1); }
    for (let i = 0; i < 3; i++) { const y = 3.6 + i * 3.2; P.box(M.iron, 0, y, 2.6, 6.4, 0.08, 0.08, 1, 0, 0, 0.66); P.box(M.iron, 0, y, 2.6, 6.4, 0.08, 0.08, 1, 0, 0, -0.66); }
    P.cyl(M.metal, 0, 15.9, 0, 3.1, 3.1, 3.6, 20);
    P.cyl(M.rust, 0, 14.0, 0, 3.15, 3.15, 0.3, 20);
    P.add(M.rust, new THREE.ConeGeometry(3.35, 2.0, 20), 0, 18.7, 0);
    P.cyl(M.iron, 0, 20.2, 0, 0.05, 0.05, 1.6, 4);
    P.box(M.iron, 3.15, 8, 0, 0.08, 16, 0.5, 1); // ladder rail
    v.parts.walls = P.build(root);
    const tex = textTexture('HOLLOWMERE', { w: 512, h: 128, font: 'bold 84px "Trebuchet MS", Arial', color: '#e8e2d0', bg: null });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7 }));
    label.position.set(0, 16, 3.14); root.add(label);
  }

  buildBillboard(v) {
    const { b, T, root } = v, M = this.M;
    const P = new Parts();
    for (const sx of [-1, 1]) P.cyl(M.iron, sx * (T.w / 2 - 1.2), 4.5, 0, 0.16, 0.2, 9, 8);
    P.box(M.iron, 0, 5.1, -0.35, T.w - 1.6, 0.16, 0.2, 1);
    P.box(M.iron, 0, 9.6, -0.35, T.w - 1.6, 0.16, 0.2, 1);
    P.box(M.darkTrim, 0, 7.4, 0, T.w, 5.0, 0.35, 0.5);
    v.parts.walls = P.build(root);
    v.boardCanvas = document.createElement('canvas'); v.boardCanvas.width = 1024; v.boardCanvas.height = 400;
    v.boardTexture = new THREE.CanvasTexture(v.boardCanvas); v.boardTexture.colorSpace = THREE.SRGBColorSpace; v.boardTexture.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: v.boardTexture, emissiveMap: v.boardTexture, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.6 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(T.w - 0.6, 4.6), mat);
    face.position.set(0, 7.4, 0.19); root.add(face); v.face = face; v.faceMat = mat;
    // flood lights
    for (const sx of [-3.6, 0, 3.6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffe0a0, emissiveIntensity: 1.2 })); l.position.set(sx, 4.85, 1.1); root.add(l); }
    this.drawBoard(v, this.world.boards?.bb_main);
  }

  drawBoard(v, board) {
    if (!v.boardCanvas) return;
    const c = v.boardCanvas, ctx = c.getContext('2d');
    const prophecy = board && board.kind === 'prophecy';
    ctx.fillStyle = prophecy ? '#0b0b0d' : '#213a5a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = prophecy ? '#8a1c1c' : '#e9dfbf'; ctx.lineWidth = 10; ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = board ? board.text : 'WELCOME TO HOLLOWMERE', sub = board ? board.sub : '';
    let size = 130; ctx.font = `900 ${size}px "Trebuchet MS", Arial`;
    while (ctx.measureText(text).width > c.width - 100 && size > 30) { size -= 6; ctx.font = `900 ${size}px "Trebuchet MS", Arial`; }
    ctx.fillStyle = prophecy ? '#ff3b3b' : '#f6f0d8'; ctx.shadowColor = prophecy ? '#ff0000' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = prophecy ? 24 : 6;
    ctx.fillText(text, c.width / 2, c.height * 0.42);
    ctx.shadowBlur = 0; ctx.font = `600 46px "Courier New", monospace`; ctx.fillStyle = prophecy ? '#d9a0a0' : '#c9d7e8';
    ctx.fillText(sub || '', c.width / 2, c.height * 0.76);
    v.boardTexture.needsUpdate = true;
  }

  setBoard(id, board) {
    if (id === 'bb_main') { const v = this.views.get('b_billboard'); if (v) this.drawBoard(v, board); }
    if (id === 'bd_wanted') this.wanted = board, this.refreshWanted();
  }
  refreshWanted() {
    const v = this.views.get('b_constab');
    if (!v || !v.boardSlot) return;
    if (v.wantedMesh) { v.root.remove(v.wantedMesh); v.wantedMesh = null; }
    const bd = this.wanted || this.world.boards?.bd_wanted;
    if (!bd) return;
    const tex = textTexture('', { w: 256, h: 340, lines: ['WANTED', bd.text.replace('WANTED: ', ''), '', bd.sub.slice(0, 26)], font: 'bold 44px "Courier New", monospace', color: '#2a1a10', bg: '#e6d3a3' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.position.set(v.boardSlot.x, v.boardSlot.y, v.boardSlot.z + 0.02); v.root.add(m); v.wantedMesh = m;
  }

  // ---------------------------------------------------------------- ruins & damage
  buildRuin(v) {
    const { b, T, root } = v, M = this.M;
    const rnd = mulberry32(hashId(b.id) + 5);
    const P = new Parts();
    if (!T.slab && !T.watertower && !T.billboard) {
      const local = buildingLocalBoxes(b.type).find((l) => l.kind === 'slab');
      P.box(M.foundation, local.x, -1.5, local.z, local.hx * 2, 3, local.hz * 2, 0.4);
      P.box(M.char, 0, 0.01, 0, T.w, 0.02, T.d, 0.3);
      const n = 34;
      for (let i = 0; i < n; i++) {
        const x = (rnd() - 0.5) * (T.w - 0.6), z = (rnd() - 0.5) * (T.d - 0.6);
        const kind = rnd();
        const mat = kind < 0.35 ? M.char : kind < 0.65 ? M.wood : kind < 0.85 ? M.rubble : M.concrete;
        const len = 0.4 + rnd() * 2.2, th = 0.08 + rnd() * 0.22;
        const y = 0.15 + rnd() * 0.5;
        P.box(mat, x, y, z, len, th, th * (1 + rnd() * 2), 0.5, (rnd() - 0.5) * 0.9, rnd() * 3.14, (rnd() - 0.5) * 0.9);
      }
      for (let i = 0; i < 6; i++) P.box(M.char, (rnd() - 0.5) * T.w * 0.8, 0.9 + rnd() * 0.9, (rnd() - 0.5) * T.d * 0.8, 0.14, 1.4 + rnd() * 1.8, 0.14, 1, (rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35);
      // a stub of a wall or two
      for (let i = 0; i < 2; i++) P.box(this.siding(T.siding, b.tint ?? 0.3), (rnd() - 0.5) * T.w * 0.7, 0.55, i ? T.d / 2 - 0.2 : -T.d / 2 + 0.2, 1.4 + rnd() * 1.6, 0.9 + rnd() * 0.6, WALL, 0.5, 0, 0, (rnd() - 0.5) * 0.25);
      if (['house', 'cottage', 'inn'].includes(b.type)) { P.box(M.brick, T.w * 0.3, 1.4, -T.d * 0.12, 0.9, 2.8, 0.9, 0.5, 0, 0, 0.05); }
      if (b.type === 'chapel') { P.box(M.stone, 0, 1.8, T.d / 2 - 1.7, 2.6, 3.6, 2.6, 0.4, 0.04, 0, 0.06); }
      v.smoke = true;
      this.smokers.push({ bid: b.id, world: new THREE.Vector3(b.x, b.floorY + 1.2, b.z), kind: 'ruin', ruinedAt: b.ruinedAt || 0 });
    }
    v.parts.walls = P.build(root);
    if (T.watertower) { const P2 = new Parts(); for (let i = 0; i < 14; i++) P2.box(M.rust, (rnd() - 0.5) * 8, 0.3, (rnd() - 0.5) * 8, 1 + rnd() * 2, 0.3, 0.3, 1, rnd(), rnd() * 3, rnd()); P2.build(root); }
  }

  applyDamage(v) {
    const { b, T } = v;
    if (b.ruined) return;
    const ratio = b.hp / T.hp;
    v.damaged = ratio;
    this.smokers = this.smokers.filter((s) => !(s.bid === b.id && s.kind === 'dmg'));
    if (ratio < 0.5) this.smokers.push({ bid: b.id, world: new THREE.Vector3(b.x, b.floorY + T.h + 0.4, b.z), kind: 'dmg', level: ratio });
    // soot on the walls
    v.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.color && !o.material.userData.glass && v.parts.walls?.includes(o)) {
        if (!o.userData.own) { o.material = o.material.clone(); o.userData.own = true; }
        o.material.color.setScalar(0.45 + 0.55 * Math.min(1, ratio + 0.15));
      }
    });
  }

  // ---------------------------------------------------------------- state sync
  patch(b) {
    const v = this.views.get(b.id);
    if (!v) return this.add(b);
    const wasRuined = v.b.ruined;
    v.b = b;
    if (b.ruined !== wasRuined || b.zone !== v.b.zone) return this.add(b);
    this.applyDamage(v);
  }

  /** Called every frame. lightsOn: 0..1 — how lit the windows should be. */
  update(dt, time, env, blackout, playerBuildingId, playerPos) {
    this.time = time;
    const night = env.nightAmt;
    const wantLit = blackout ? 0 : Math.max(night * 1.0, env.dim * 0.7, 0.0);
    this.glassEmissive = (this.glassEmissive ?? 0) + (wantLit - (this.glassEmissive ?? 0)) * Math.min(1, dt * 1.5);
    const glass = this.glassMat();
    glass.emissiveIntensity = this.glassEmissive * 1.6;
    for (const v of this.views.values()) {
      const b = v.b;
      // smooth movement towards replicated state
      const k = Math.min(1, dt * 6);
      v.pos.x += (b.x - v.pos.x) * k; v.pos.y += (b.floorY - v.pos.y) * k; v.pos.z += (b.z - v.pos.z) * k;
      if (Math.abs(b.x - v.pos.x) < 0.001) v.pos.x = b.x;
      v.root.position.copy(v.pos); v.root.rotation.y = b.yaw;
      if (v.blink) v.blink.material.emissiveIntensity = 0.2 + 3.2 * (Math.sin(time * 3.1) > 0.4 ? 1 : 0);
      if (v.neon) v.neon.material.emissiveIntensity = blackout ? 0 : 1.1 + 0.4 * Math.sin(time * 40) * (Math.random() < 0.02 ? 1 : 0) + night * 0.8;
      if (v.sign) { v.sign.material.emissiveIntensity = blackout ? 0 : night * 0.35; }
      if (v.rose) v.rose.material.emissiveIntensity = blackout ? 0 : 0.15 + night * 1.6;
      if (v.faceMat) v.faceMat.emissiveIntensity = 0.12 + night * 0.4;
      if (v.flag) v.flag.rotation.y = Math.sin(time * 2.2) * 0.25;
      if (v.bell && v.bellSwing) { v.bellSwing *= 0.985; v.bell.rotation.z = Math.sin(time * 6) * v.bellSwing; }
      if (v.parts.roof) for (const m of v.parts.roof) m.visible = true;
      v.lit = blackout ? 0 : 1;
      if (v.chimney) { for (const sm of this.smokers) if (sm.bid === b.id && sm.kind === 'chimney') { sm.world.copy(v.chimney).applyMatrix4(v.root.matrixWorld); sm.active = !blackout && !b.ruined && (night > 0.35 || env.rainI > 0.3); } }
    }
    for (const l of this.lamps) {
      const v = this.views.get(l.bid);
      if (!v) continue;
      l.world.copy(l.local).applyMatrix4(v.root.matrixWorld);
      l.on = v.b.zone === 'under' ? true : !blackout && !v.b.ruined && (night > 0.25 || env.dim > 0.4);
    }
  }

  ringBell() { const v = this.views.get('b_chapel'); if (v) v.bellSwing = 0.6; }

  insideBuilding(x, z, zone) {
    for (const v of this.views.values()) {
      const b = v.b;
      if (b.ruined || (b.zone || 'surface') !== zone || v.T.slab || v.T.watertower || v.T.billboard) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < v.T.w / 2 && Math.abs(lz) < v.T.d / 2) return b.id;
    }
    return null;
  }
}

// ---------------------------------------------------------------- helpers
function hashId(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shortName(n) { return n.replace(/^KRNX 1370 — /, 'KRNX 1370 · ').replace("Saint Anselm's Chapel", "ST ANSELM'S").toUpperCase(); }

const stripeCache = new Map();
function stripeTex(col) {
  if (stripeCache.has(col)) return stripeCache.get(col);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
  const c = cv.getContext('2d'); for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2eee2' : col; c.fillRect(i * 16, 0, 16, 32); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; stripeCache.set(col, t); return t;
}
let _rose = null;
function roseTex() {
  if (_rose) return _rose;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  c.fillStyle = '#222'; c.fillRect(0, 0, 256, 256);
  const cols = ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'];
  for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(128, 128); c.arc(128, 128, 122, (i / 12) * 6.283, ((i + 1) / 12) * 6.283); c.closePath(); c.fillStyle = cols[i % 6]; c.fill(); c.strokeStyle = '#111'; c.lineWidth = 5; c.stroke(); }
  c.beginPath(); c.arc(128, 128, 30, 0, 6.283); c.fillStyle = '#f5e6a8'; c.fill(); c.strokeStyle = '#111'; c.lineWidth = 6; c.stroke();
  _rose = new THREE.CanvasTexture(cv); _rose.colorSpace = THREE.SRGBColorSpace; return _rose;
}
const rugCache = new Map();
function rugMat(key) {
  const cols = [['#7a2b2b', '#c9a86a'], ['#2b4a7a', '#d9c9a0'], ['#3f6a4a', '#c8b88a'], ['#5a2f5a', '#d8c090']];
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const pair = cols[Math.abs(h) % cols.length];
  if (rugCache.has(pair[0])) return rugCache.get(pair[0]);
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = pair[0]; c.fillRect(0, 0, 128, 128); c.strokeStyle = pair[1]; c.lineWidth = 6; c.strokeRect(8, 8, 112, 112); c.lineWidth = 3; c.strokeRect(20, 20, 88, 88);
  c.fillStyle = pair[1]; c.beginPath(); c.moveTo(64, 34); c.lineTo(94, 64); c.lineTo(64, 94); c.lineTo(34, 64); c.closePath(); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); rugCache.set(pair[0], m); return m;
}
let _juke = null;
function jukeMat() {
  if (_juke) return _juke;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#ff5a5a'); g.addColorStop(0.35, '#ffd25a'); g.addColorStop(0.7, '#5affb0'); g.addColorStop(1, '#5a9aff'); c.fillStyle = g; c.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  _juke = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 });
  return _juke;
}
