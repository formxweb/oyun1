// Everything players and the server put *into* the world: physics props, charges, signs, planks, graves,
// statues, beacons, portals, ghosts and localized fog banks.
import * as THREE from 'three';
import { Humanoid, nameSprite, speechSprite } from './characters.js';
import { textTexture } from './tex.js';
import { pushSample, sample, INTERP_MS } from './interp.js';

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function stripes(w, h, c1, c2, n = 6) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const c = cv.getContext('2d');
  c.fillStyle = c1; c.fillRect(0, 0, 64, 64); c.fillStyle = c2;
  for (let i = 0; i < n; i++) if (i % 2) c.fillRect(0, (i * 64) / n, 64, 64 / n);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class WorldObjects {
  constructor(scene, underGroup, tex, world, terrain, hooks) {
    this.scene = scene; this.under = underGroup; this.tex = tex; this.world = world; this.terrain = terrain; this.hooks = hooks;
    this.props = new Map(); this.charges = new Map(); this.signs = new Map(); this.planks = new Map(); this.graves = new Map();
    this.monuments = new Map(); this.portals = new Map(); this.ghosts = new Map(); this.time = 0;
    this.group = new THREE.Group(); scene.add(this.group);
    this.mats = {
      wood: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.8 }), dark: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.8 }), stone: new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.95 }),
      barrel: new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.55, metalness: 0.5 }), fuel: new THREE.MeshStandardMaterial({ map: stripes(1, 1, '#b8281e', '#e9c93a', 10), roughness: 0.5, metalness: 0.4 }),
      rock: new THREE.MeshStandardMaterial({ map: tex.rock, roughness: 0.95, color: 0xb0aaa0 }),
      glow: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb050, emissiveIntensity: 2.2 }),
      black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
    };
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 64; const bx = bc.getContext('2d');
    const cols = ['#e8433c', '#f2f2f2', '#2f7de1', '#f2f2f2', '#f4c430', '#f2f2f2']; cols.forEach((c, i) => { bx.fillStyle = c; bx.fillRect((i * 128) / 6, 0, 128 / 6 + 1, 64); });
    const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace; this.mats.ball = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.4 });
  }

  // ------------------------------------------------------------ dynamic props
  makePropMesh(type, meta = {}) {
    const M = this.mats;
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    switch (type) {
      case 'crate': case 'bigcrate': {
        const s = type === 'crate' ? 0.6 : 1.0;
        add(new THREE.BoxGeometry(s, s, s), M.wood);
        for (const [x, z, w, d] of [[0, 0.5, 1, 0.09], [0, -0.5, 1, 0.09], [0.5, 0, 0.09, 1], [-0.5, 0, 0.09, 1]]) add(new THREE.BoxGeometry(w * s + 0.02, s + 0.02, d * s), M.dark, x * s, 0, z * s).scale.y = 1;
        add(new THREE.BoxGeometry(s * 0.9, 0.06, 0.06), M.dark, 0, 0, s / 2 + 0.01).rotation.z = 0.78;
        break;
      }
      case 'barrel': case 'fuel': {
        const f = type === 'fuel';
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), f ? M.fuel : M.barrel);
        for (const y of [-0.3, 0.3]) add(new THREE.TorusGeometry(0.3, 0.02, 6, 16), M.iron, 0, y, 0).rotation.x = Math.PI / 2;
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), M.iron, 0.12, 0.47, 0.1);
        break;
      }
      case 'stone': { const gg = new THREE.IcosahedronGeometry(0.24, 1); const p = gg.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.85 + Math.sin(p.getX(i) * 17 + p.getZ(i) * 11) * 0.15; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } gg.computeVertexNormals(); add(gg, M.rock); break; }
      case 'ball': add(new THREE.SphereGeometry(0.38, 20, 14), M.ball); break;
      case 'lantern': {
        add(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffa030, emissiveIntensity: 2.4, transparent: true, opacity: 0.9 }));
        add(new THREE.BoxGeometry(0.24, 0.04, 0.24), M.iron, 0, 0.17, 0); add(new THREE.BoxGeometry(0.24, 0.04, 0.24), M.iron, 0, -0.17, 0);
        add(new THREE.TorusGeometry(0.09, 0.012, 6, 12, Math.PI), M.iron, 0, 0.19, 0);
        break;
      }
      case 'gnome': {
        const gilded = meta.gilded;
        const body = gilded ? new THREE.MeshStandardMaterial({ color: 0xffd25a, metalness: 0.9, roughness: 0.25, emissive: 0x7a5a10, emissiveIntensity: 0.6 }) : new THREE.MeshStandardMaterial({ color: 0x2f6fbf, roughness: 0.7 });
        const skin = new THREE.MeshStandardMaterial({ color: gilded ? 0xffe28a : 0xe8b895, roughness: gilded ? 0.25 : 0.6, metalness: gilded ? 0.9 : 0 });
        const hat = new THREE.MeshStandardMaterial({ color: gilded ? 0xffd25a : 0xd83a2e, roughness: 0.6, metalness: gilded ? 0.9 : 0 });
        const beard = new THREE.MeshStandardMaterial({ color: gilded ? 0xffe9a0 : 0xf2f0ea, roughness: 0.9, metalness: gilded ? 0.8 : 0 });
        add(new THREE.CylinderGeometry(0.11, 0.14, 0.24, 10), body, 0, -0.1, 0);
        add(new THREE.SphereGeometry(0.09, 12, 10), skin, 0, 0.06, 0);
        add(new THREE.ConeGeometry(0.11, 0.3, 10), hat, 0, 0.24, 0);
        add(new THREE.SphereGeometry(0.1, 10, 8), beard, 0, 0.0, 0.05).scale.set(1, 1.2, 0.8);
        add(new THREE.SphereGeometry(0.02, 6, 6), skin, 0, 0.05, 0.1);
        add(new THREE.BoxGeometry(0.26, 0.03, 0.2), M.black, 0, -0.23, 0.02);
        if (gilded) { const l = new THREE.PointLight(0xffd070, 6, 8, 2); l.position.y = 0.2; g.add(l); }
        break;
      }
      case 'relic': {
        const hue = meta.kind === 'meteorite' ? 0x4a3020 : meta.kind === 'lake' ? 0x30ffd0 : meta.kind === 'gathering' ? 0xffe070 : 0xb070ff;
        const emissive = meta.kind === 'meteorite' ? 0xff5a20 : hue;
        const m = add(new THREE.OctahedronGeometry(0.28, 1), new THREE.MeshStandardMaterial({ color: hue, emissive, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.4 }));
        m.userData.spin = true;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex(), color: emissive, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7, fog: false }));
        halo.scale.set(2.2, 2.2, 1); g.add(halo);
        g.userData.relic = true;
        break;
      }
      case 'tire': add(new THREE.TorusGeometry(0.36, 0.14, 10, 18), M.black).rotation.x = Math.PI / 2; break;
      case 'plank_d': add(new THREE.BoxGeometry(0.1, 0.1, 1.8), M.wood); break;
      case 'brick_d': add(new THREE.BoxGeometry(0.26, 0.14, 0.14), new THREE.MeshStandardMaterial({ map: this.tex.brick, roughness: 0.9 })); break;
      case 'shingle_d': add(new THREE.BoxGeometry(0.6, 0.04, 0.4), M.dark); break;
      default: add(new THREE.BoxGeometry(0.4, 0.4, 0.4), M.wood);
    }
    return g;
  }

  haloTex() {
    if (this._halo) return this._halo;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64); return (this._halo = new THREE.CanvasTexture(cv));
  }

  addProp(m) {
    this.removeProp(m.id);
    const mesh = this.makePropMesh(m.ty, m.meta || {});
    const e = { id: m.id, type: m.ty, mesh, meta: m.meta || {}, held: m.held || null };
    this.group.add(mesh);
    if (m.pose) { mesh.position.set(m.pose[0], m.pose[1], m.pose[2]); mesh.quaternion.set(m.pose[3], m.pose[4], m.pose[5], m.pose[6]); pushSample(e, 0, m.pose); }
    this.props.set(m.id, e);
    return e;
  }
  removeProp(id) {
    const e = this.props.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose(); });
    this.props.delete(id);
  }
  onSnapProps(list, ts) { for (const p of list) { const e = this.props.get(p[0]); if (e) pushSample(e, ts, p.slice(1)); } }

  // ------------------------------------------------------------ charges
  addCharge(m) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 10), new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.5 })); body.castShadow = true; g.add(body);
    for (const y of [-0.1, 0.1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 10), this.mats.black); b.position.y = y; g.add(b); }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 3 })); led.position.set(0, 0.2, 0); g.add(led);
    g.position.set(m.x, m.y + 0.17, m.z);
    this.group.add(g);
    this.charges.set(m.id, { id: m.id, g, led, at: m.at });
  }
  removeCharge(id) { const c = this.charges.get(id); if (c) { this.group.remove(c.g); this.charges.delete(id); } }

  // ------------------------------------------------------------ patches from the world state
  onPatch(parts, v) {
    const [kind, id] = parts;
    if (parts.length > 2 && kind !== 'portals') return this.syncKind(kind, id);
    this.syncKind(kind, id);
  }
  syncKind(kind, id) {
    const w = this.world;
    const sync = (map, coll, make, remove) => {
      const cur = coll || {};
      if (id) { if (cur[id]) { if (!map.has(id)) make(cur[id]); else remove(id, true, cur[id]); } else remove(id); }
      else { for (const k of [...map.keys()]) if (!cur[k]) remove(k); for (const k in cur) if (!map.has(k)) make(cur[k]); }
    };
    switch (kind) {
      case 'signs': sync(this.signs, w.signs, (s) => this.makeSign(s), (i, keep) => { if (!keep) this.removeMap(this.signs, i); }); break;
      case 'planks': sync(this.planks, w.planks, (s) => this.makePlank(s), (i, keep) => { if (!keep) this.removeMap(this.planks, i); }); break;
      case 'graves': sync(this.graves, w.graves, (s) => this.makeGrave(s), (i, keep) => { if (!keep) this.removeMap(this.graves, i); }); break;
      case 'monuments': sync(this.monuments, w.monuments, (s) => this.makeMonument(s), (i, keep) => { if (!keep) this.removeMap(this.monuments, i); }); break;
      case 'portals': this.rebuildPortal(id); break;
      case 'ghosts': sync(this.ghosts, w.ghosts, (s) => this.makeGhost(s), (i, keep) => { if (!keep) this.removeMap(this.ghosts, i); }); break;
      default:
    }
  }
  removeMap(map, id) {
    const e = map.get(id);
    if (!e) return;
    e.g.parent?.remove(e.g);
    e.g.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material?.map?.userData?.own) o.material.map.dispose(); });
    map.delete(id);
  }
  syncAll() {
    const w = this.world;
    for (const s of Object.values(w.signs || {})) this.makeSign(s);
    for (const s of Object.values(w.planks || {})) this.makePlank(s);
    for (const s of Object.values(w.graves || {})) this.makeGrave(s);
    for (const s of Object.values(w.monuments || {})) this.makeMonument(s);
    for (const id in w.portals || {}) this.rebuildPortal(id);
    for (const s of Object.values(w.ghosts || {})) this.makeGhost(s);
  }

  makeSign(s) {
    if (this.signs.has(s.id)) return;
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.7, 6), this.mats.wood); post.position.y = 0.85; post.castShadow = true; g.add(post);
    const tex = textTexture('', { w: 512, h: 256, lines: wrap(s.text, 18), font: 'bold 54px "Comic Sans MS", "Trebuchet MS", Arial', color: '#1e1a14', bg: '#d8c491', pad: 16 });
    tex.userData.own = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.72, 0.06), [this.mats.dark, this.mats.dark, this.mats.dark, this.mats.dark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), this.mats.dark]);
    board.position.y = 1.55; board.castShadow = true; g.add(board);
    const by = nameSprite(s.by, { color: '#e8d8a8', sub: '' }); by.scale.set(0.9, 0.22, 1); by.position.set(0, 1.05, 0.06); by.material.opacity = 0.75; g.add(by);
    g.position.set(s.x, s.y, s.z); g.rotation.y = s.yaw;
    (s.zone === 'under' ? this.under : this.group).add(g);
    this.signs.set(s.id, { id: s.id, g, data: s });
  }

  makePlank(p) {
    if (this.planks.has(p.id)) return;
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 3.2), new THREE.MeshStandardMaterial({ map: this.plankTex(), roughness: 0.85 }));
    mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    for (const z of [-1.1, 1.1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.06, 0.16), this.mats.dark); c.position.set(0, 0.12, z); g.add(c); }
    g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw;
    this.group.add(g); this.planks.set(p.id, { id: p.id, g });
  }
  plankTex() {
    if (this._pt) return this._pt;
    const t = this.tex.wood.clone(); t.repeat.set(1, 3); t.needsUpdate = true; return (this._pt = t);
  }

  makeGrave(s) {
    if (this.graves.has(s.id)) return;
    const g = new THREE.Group();
    const kind = s.kind;
    if (kind === 'ruin') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.2), this.mats.stone); slab.position.y = 0.25; slab.rotation.x = -0.25; slab.castShadow = true; g.add(slab);
      const tex = textTexture('', { w: 512, h: 170, lines: ['HERE STOOD', s.name.toUpperCase()], font: 'bold 56px Georgia, serif', color: '#2a2622', bg: '#9a958a', pad: 10 }); tex.userData.own = true;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.46), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); p.position.set(0, 0.28, 0.115); p.rotation.x = -0.25; g.add(p);
    } else {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 12, 1, false, 0, Math.PI), this.mats.stone); stone.rotation.z = 0; stone.rotation.y = -Math.PI / 2; stone.position.y = 0.45; stone.scale.set(1, 1, 0.24); stone.castShadow = true; g.add(stone);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.4), this.mats.stone); base.position.y = 0.07; g.add(base);
      const tex = textTexture('', { w: 256, h: 256, lines: [kind === 'npc' ? '†' : '✝', s.name.slice(0, 14), (s.words ? '“' + s.words.slice(0, 22) + '”' : '')], font: 'bold 42px Georgia, serif', color: '#241f1a', bg: '#8f8a80', pad: 10 }); tex.userData.own = true;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); p.position.set(0, 0.48, 0.1); g.add(p);
      if (kind === 'player') { const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), this.mats.glow); l.position.set(0.5, 0.1, 0.25); g.add(l); }
    }
    g.position.set(s.x, this.terrain.height(s.x, s.z), s.z);
    g.rotation.y = s.kind === 'ruin' ? Math.PI : (hashN(s.id) % 100) / 100 * 0.6 - 0.3 + Math.PI;
    this.group.add(g); this.graves.set(s.id, { id: s.id, g });
  }

  makeMonument(s) {
    if (this.monuments.has(s.id)) return;
    const g = new THREE.Group();
    const e = { id: s.id, g, data: s };
    if (s.kind === 'statue') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.5), this.mats.stone); base.position.y = 0.35; base.castShadow = true; g.add(base);
      const h = new Humanoid({ scale: 1.15, build: 1.05, style: 'short', hair: '#777', shirt: '#888', pants: '#888', skin: '#999' }, { stone: true });
      h.root.position.y = 0.7; g.add(h.root); h.update(0.016, { act: 0, mood: 1 }); h.arms[1].sh.rotation.x = -2.6; e.h = h;
      const tex = textTexture('', { w: 512, h: 200, lines: [s.name.slice(0, 16).toUpperCase(), (s.title || '').slice(0, 34)], font: 'bold 60px Georgia, serif', color: '#1c1916', bg: '#a8a296', pad: 12 }); tex.userData.own = true;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); p.position.set(0, 0.35, 0.76); g.add(p);
      g.position.set(s.x, this.terrain.height(s.x, s.z), s.z); g.rotation.y = s.yaw || Math.PI;
    } else if (s.kind === 'beacon') {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 160, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0x70ffe0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.position.y = 80; g.add(beam); e.beam = beam;
      const l = new THREE.PointLight(0x50ffd0, 40, 40, 2); l.position.y = 4; g.add(l);
      g.position.set(s.x, this.terrain.height(s.x, s.z), s.z);
    }
    this.group.add(g); this.monuments.set(s.id, e);
  }

  rebuildPortal(id) {
    const old = this.portals.get(id);
    if (old) { old.g.parent?.remove(old.g); this.portals.delete(id); }
    const p = this.world.portals?.[id];
    if (!p) return;
    const g = new THREE.Group();
    const e = { id, g, data: p };
    if (p.kind === 'hatch' && p.found) {
      const y = p.y ?? this.terrain.height(p.x, p.z);
      g.position.set(p.x, y + 0.02, p.z);
      const hole = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 1.1), new THREE.MeshBasicMaterial({ color: 0x02060a })); g.add(hole);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 1.1), this.mats.wood); door.geometry.translate(0, 0, 0.55); door.position.set(0, 0.03, -0.55); door.rotation.x = -1.7; g.add(door);
      const gl = new THREE.PointLight(0x40ffe0, 12, 12, 2); gl.position.y = -0.3; g.add(gl);
      for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.25), this.mats.stone); s.position.set(0, -0.2 - i * 0.22, -0.3 + i * 0.08); g.add(s); }
      this.group.add(g);
    } else if (p.kind === 'sinkhole') {
      g.position.set(p.x, this.terrain.height(p.x, p.z), p.z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 20), new THREE.MeshBasicMaterial({ color: 0x010304 })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc);
      const gl = new THREE.PointLight(0x40ffe0, 30, 22, 2); gl.position.y = 1.2; g.add(gl);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 26, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x40ffe0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); beam.position.y = 13; g.add(beam);
      e.beam = beam;
      this.group.add(g);
    } else if (p.kind === 'ladder') {
      g.position.set(p.x, this.world.buildings?.u_archive ? -119.85 : -119.85, p.z);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false })); shaft.position.y = 15; g.add(shaft);
      for (const sx of [-0.35, 0.35]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5, 0.06), this.mats.iron); r.position.set(sx, 2.5, 0); g.add(r); }
      for (let i = 0; i < 12; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), this.mats.iron); r.position.set(0, 0.3 + i * 0.4, 0); g.add(r); }
      const gl = new THREE.PointLight(0xbfe8ff, 20, 20, 2); gl.position.y = 4; g.add(gl);
      this.under.add(g);
    } else return;
    this.portals.set(id, e);
  }

  makeGhost(s) {
    if (this.ghosts.has(s.id)) return;
    const g = new THREE.Group();
    const h = new Humanoid({ scale: 1.0, style: s.kind === 'npc' ? 'short' : 'wild', hair: '#aef', shirt: '#9ef', pants: '#9ef', skin: '#bff' }, { ghost: true });
    g.add(h.root);
    const ns = nameSprite(s.name, { color: '#bff8ff', sub: s.kind === 'npc' ? 'resident' : 'player' }); ns.position.y = 2.2; g.add(ns);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.12, 14), this.mats.stone); ped.position.y = 0.06; g.add(ped);
    h.root.position.y = 0.12;
    g.position.set(s.x, -119.85, s.z); g.rotation.y = (s.yaw || 0) + Math.PI + (Math.random() - 0.5) * 0.3;
    this.under.add(g);
    this.ghosts.set(s.id, { id: s.id, g, h, data: s, ns, speech: null });
  }

  // ------------------------------------------------------------ frame update
  update(dt, time, serverNow, cam, localHeld) {
    this.time = time;
    const rt = serverNow - INTERP_MS;
    for (const e of this.props.values()) {
      const a = sample(e, rt);
      if (!a) continue;
      e.mesh.position.set(a[0], a[1], a[2]);
      if (a.length >= 7) {
        // quaternion slerp between bracketing samples
        const b = e.buf; let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        if (i > 0 && rt < b[i].t) { const A = b[i - 1], B = b[i], k = (rt - A.t) / Math.max(1, B.t - A.t); _q1.set(A.a[3], A.a[4], A.a[5], A.a[6]); _q2.set(B.a[3], B.a[4], B.a[5], B.a[6]); e.mesh.quaternion.copy(_q1.slerp(_q2, Math.min(1, Math.max(0, k)))); }
        else e.mesh.quaternion.set(a[3], a[4], a[5], a[6]);
      }
      if (e.mesh.userData.relic) { e.mesh.children[0].rotation.y = time * 1.4; e.mesh.children[0].rotation.x = Math.sin(time * 0.9) * 0.3; }
    }
    for (const c of this.charges.values()) {
      const left = (c.at - serverNow) / 1000;
      const rate = left < 1.2 ? 14 : left < 2.5 ? 6 : 2.5;
      c.led.material.emissiveIntensity = Math.sin(time * rate * 3) > 0 ? 4 : 0.2;
      const sc = 1 + Math.max(0, 0.6 - left) * 0.2; c.g.scale.setScalar(sc);
    }
    for (const m of this.monuments.values()) {
      if (m.beam) { m.beam.material.opacity = 0.12 + 0.05 * Math.sin(time * 2); m.beam.rotation.y = time * 0.2; }
      if (m.data.kind === 'beacon' && m.data.until && serverNow > m.data.until) m.g.visible = false;
    }
    for (const p of this.portals.values()) if (p.beam) p.beam.material.opacity = 0.1 + 0.04 * Math.sin(time * 1.7);
    for (const gh of this.ghosts.values()) {
      gh.h.update(dt, { act: 0, mood: 2, gaze: null });
      gh.g.children[0].position.y = 0.12 + Math.sin(time * 0.8 + gh.g.position.x) * 0.06;
      const near = Math.hypot(cam.position.x - gh.g.position.x, cam.position.z - gh.g.position.z) < 7 && cam.position.y < -100;
      if (near && !gh.speech && gh.data.words) { gh.speech = speechSprite('“' + gh.data.words + '”'); gh.speech.position.y = 3.3; gh.g.add(gh.speech); }
      else if (!near && gh.speech) { gh.g.remove(gh.speech); gh.speech = null; }
    }
    // hatch glows
  }
}

function wrap(text, n) { const w = text.split(' '); const l = []; let c = ''; for (const x of w) { if ((c + ' ' + x).trim().length > n && c) { l.push(c); c = x; } else c = (c + ' ' + x).trim(); } if (c) l.push(c); return l.slice(0, 4); }
function hashN(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
