// Server-authoritative rigid-body physics (Rapier). Props, debris, buildings-as-colliders, the terrain
// heightfield (rebuilt when the land is scarred), buoyancy in Lake Hollow, and blast waves.
import RAPIER from '@dimforge/rapier3d-compat';
import { N, VERTS, SIZE, HALF } from '../shared/terrain.js';
import { UNDER, activeLocalBoxes } from '../shared/layout.js';
import { lakeD } from '../shared/terrain.js';

export const G = 9.81;

// mass (kg), rho = density relative to water (<1 floats), shape, dims
export const PROP_TYPES = {
  crate:   { shape: 'box', d: [0.3, 0.3, 0.3], mass: 14, rho: 0.55, rest: 0.15, fric: 0.7, pick: true, label: 'Crate' },
  bigcrate:{ shape: 'box', d: [0.5, 0.5, 0.5], mass: 60, rho: 0.6, rest: 0.1, fric: 0.8, pick: false, label: 'Big crate' },
  barrel:  { shape: 'cyl', d: [0.45, 0.3], mass: 18, rho: 0.5, rest: 0.2, fric: 0.6, pick: true, label: 'Barrel' },
  fuel:    { shape: 'cyl', d: [0.45, 0.3], mass: 22, rho: 0.8, rest: 0.2, fric: 0.6, pick: true, label: 'Fuel drum', hp: 26, explosive: true },
  stone:   { shape: 'ball', d: [0.22], mass: 6, rho: 2.6, rest: 0.25, fric: 0.8, pick: true, label: 'Stone' },
  ball:    { shape: 'ball', d: [0.38], mass: 0.6, rho: 0.06, rest: 0.85, fric: 0.5, pick: true, label: 'Beach ball' },
  lantern: { shape: 'box', d: [0.12, 0.2, 0.12], mass: 1.5, rho: 0.7, rest: 0.2, fric: 0.6, pick: true, label: 'Lantern' },
  gnome:   { shape: 'box', d: [0.14, 0.24, 0.14], mass: 3, rho: 1.7, rest: 0.2, fric: 0.7, pick: true, label: 'The Gnome', unique: true },
  relic:   { shape: 'ball', d: [0.28], mass: 4, rho: 0.95, rest: 0.3, fric: 0.6, pick: true, label: 'Relic' },
  tire:    { shape: 'cyl', d: [0.14, 0.36], mass: 9, rho: 0.45, rest: 0.4, fric: 0.9, pick: true, label: 'Tire' },
  plank_d: { shape: 'box', d: [0.05, 0.05, 0.9], mass: 3, rho: 0.5, rest: 0.1, fric: 0.6, pick: true, label: 'Board', debris: true },
  brick_d: { shape: 'box', d: [0.13, 0.07, 0.07], mass: 1.5, rho: 2.0, rest: 0.1, fric: 0.8, pick: true, label: 'Brick', debris: true },
  shingle_d:{ shape: 'box', d: [0.3, 0.02, 0.2], mass: 0.8, rho: 0.8, rest: 0.05, fric: 0.6, pick: true, label: 'Shingle', debris: true },
};

export function propRadius(t) {
  const T = PROP_TYPES[t];
  return Math.max(...T.d) * (T.shape === 'box' ? 1.2 : 1);
}

export class Phys {
  static async create(game) {
    await RAPIER.init();
    return new Phys(game);
  }

  constructor(game) {
    this.game = game;
    this.world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    this.world.timestep = 1 / 30;
    this.terrainCollider = null;
    this.props = new Map();        // id -> prop
    this.byCollider = new Map();   // collider handle -> prop
    this.kin = new Map();          // key -> {body, collider}
    this.bBodies = new Map();      // building id -> body
    this.plankBodies = new Map();
    this.nextId = 1;
    this.terrainDirty = false;
    // fixed floor for the Understory
    const fb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, UNDER.y - 1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(UNDER.r + 6, 1, UNDER.r + 6).setFriction(0.9), fb);
    // circular-ish rock wall ring (8 slabs) so props stay inside the cavern
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const wb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(Math.cos(a) * (UNDER.r + 3), UNDER.y + 15, Math.sin(a) * (UNDER.r + 3)).setRotation({ x: 0, y: Math.sin((-a + Math.PI / 2) / 2), z: 0, w: Math.cos((-a + Math.PI / 2) / 2) }));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(UNDER.r * 0.3, 20, 2), wb);
    }
  }

  // ---- terrain ----
  rebuildTerrain() {
    const t = this.game.terrain;
    const h = new Float32Array(VERTS * VERTS);
    for (let j = 0; j < VERTS; j++) for (let i = 0; i < VERTS; i++) h[i * VERTS + j] = t.h[j * VERTS + i];
    if (this.terrainCollider) this.world.removeCollider(this.terrainCollider, false);
    this.terrainCollider = this.world.createCollider(RAPIER.ColliderDesc.heightfield(N, N, h, { x: SIZE, y: 1, z: SIZE }).setFriction(0.9).setRestitution(0.1));
    this.terrainDirty = false;
  }

  // ---- static-ish structures ----
  setBuilding(b) {
    this.removeBuilding(b.id);
    const local = activeLocalBoxes(b);
    if (!local.length) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(b.x, b.floorY, b.z).setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) }));
    for (const l of local) {
      const hy = Math.max(0.02, (l.y1 - l.y0) / 2);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(l.hx, hy, l.hz).setTranslation(l.x, (l.y0 + l.y1) / 2, l.z).setFriction(0.8), body);
    }
    this.bBodies.set(b.id, body);
  }

  moveBuilding(b) {
    const body = this.bBodies.get(b.id);
    if (!body) return this.setBuilding(b);
    body.setNextKinematicTranslation({ x: b.x, y: b.floorY, z: b.z });
    body.setNextKinematicRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
  }

  removeBuilding(id) {
    const body = this.bBodies.get(id);
    if (body) { this.world.removeRigidBody(body); this.bBodies.delete(id); }
  }

  setPlank(p) {
    this.removePlank(p.id);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z).setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) }));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.09, 1.6).setFriction(0.9), body);
    this.plankBodies.set(p.id, body);
  }
  removePlank(id) { const b = this.plankBodies.get(id); if (b) { this.world.removeRigidBody(b); this.plankBodies.delete(id); } }

  // ---- players / npcs as kinematic capsules ----
  kinMove(key, x, y, z, zone) {
    let k = this.kin.get(key);
    if (!k) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + 1.05, z));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.34).setFriction(0.3), body);
      k = { body, collider };
      this.kin.set(key, k);
    }
    k.body.setNextKinematicTranslation({ x, y: y + 1.05, z });
  }
  kinRemove(key) { const k = this.kin.get(key); if (k) { this.world.removeRigidBody(k.body); this.kin.delete(key); } }

  // ---- props ----
  addProp({ id, type, x, y, z, q, meta = {}, persist = true, ttl = 0, vel, zone = 'surface' }) {
    const T = PROP_TYPES[type];
    if (!T) return null;
    id = id || `p${this.nextId++}`;
    if (this.props.has(id)) this.removeProp(id);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.08).setAngularDamping(0.35).setCcdEnabled(true);
    if (q) desc.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    const body = this.world.createRigidBody(desc);
    let cd;
    if (T.shape === 'box') cd = RAPIER.ColliderDesc.cuboid(...T.d);
    else if (T.shape === 'cyl') cd = RAPIER.ColliderDesc.cylinder(T.d[0], T.d[1]);
    else cd = RAPIER.ColliderDesc.ball(T.d[0]);
    const vol = T.shape === 'box' ? 8 * T.d[0] * T.d[1] * T.d[2] : T.shape === 'cyl' ? Math.PI * T.d[1] ** 2 * 2 * T.d[0] : (4 / 3) * Math.PI * T.d[0] ** 3;
    cd.setDensity(T.mass / vol).setRestitution(T.rest).setFriction(T.fric);
    const collider = this.world.createCollider(cd, body);
    if (vel) body.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    const p = {
      id, type, body, collider, T, r: propRadius(type), mass: T.mass, held: null, thrownBy: null, inWater: false,
      persist: persist && !T.debris, born: Date.now(), ttl, meta, hp: T.hp || 0, zone, last: null, lastSpeed: 0, hitCd: 0,
    };
    this.props.set(id, p);
    this.byCollider.set(collider.handle, p);
    return p;
  }

  removeProp(id) {
    const p = this.props.get(id);
    if (!p) return;
    this.byCollider.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.props.delete(id);
  }

  propPose(p) {
    const t = p.body.translation(), r = p.body.rotation();
    return [round(t.x, 2), round(t.y, 2), round(t.z, 2), round(r.x, 3), round(r.y, 3), round(r.z, 3), round(r.w, 3)];
  }

  // ---- queries ----
  /** Ray against static geometry (terrain + buildings + planks), ignoring props. */
  rayStatic(o, d, maxT) {
    const ray = new RAPIER.Ray(o, d);
    const hit = this.world.castRayAndGetNormal(ray, maxT, true, undefined, undefined, undefined, undefined, (c) => !this.byCollider.has(c.handle) && !this.isKinCollider(c));
    if (!hit) return null;
    return { x: o.x + d.x * hit.timeOfImpact, y: o.y + d.y * hit.timeOfImpact, z: o.z + d.z * hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, t: hit.timeOfImpact };
  }
  isKinCollider(c) { for (const k of this.kin.values()) if (k.collider.handle === c.handle) return true; return false; }

  /** Best pick-able prop along an aim ray (forgiving cone test). */
  pickProp(o, d, maxT = 5.2) {
    let best = null, bt = 1e9;
    for (const p of this.props.values()) {
      if (p.held || !p.T.pick) continue;
      const t = p.body.translation();
      const vx = t.x - o.x, vy = t.y - o.y, vz = t.z - o.z;
      const along = vx * d.x + vy * d.y + vz * d.z;
      if (along < 0.1 || along > maxT) continue;
      const px = vx - d.x * along, py = vy - d.y * along, pz = vz - d.z * along;
      const perp = Math.hypot(px, py, pz);
      if (perp > p.r + 0.42) continue;
      if (along < bt) { bt = along; best = p; }
    }
    return best;
  }

  // ---- water ----
  waterLevelAt(x, z) {
    const lk = this.game.world.pub.lake;
    return lakeD(x, z) < 1.25 ? lk.level : -1e9;
  }

  // ---- step ----
  step(dt) {
    const lvlNow = this.game.world.pub.lake.level;
    for (const p of this.props.values()) {
      if (p.held) continue;
      const t = p.body.translation();
      const wl = p.zone === 'under' ? -1e9 : this.waterLevelAt(t.x, t.z);
      const sub = (wl - (t.y - p.r)) / (p.r * 2);
      const inW = t.y - p.r * 0.2 < wl;
      if (sub > 0 && wl > -1e8) {
        const f = Math.min(1, sub);
        const up = (p.mass * G * f) / p.T.rho;
        p.body.applyImpulse({ x: 0, y: up * dt, z: 0 }, true);
        const v = p.body.linvel();
        const k = Math.min(1, 2.4 * dt);
        p.body.setLinvel({ x: v.x * (1 - k * 0.6), y: v.y * (1 - k * 1.4), z: v.z * (1 - k * 0.6) }, true);
        const av = p.body.angvel();
        p.body.setAngvel({ x: av.x * (1 - k), y: av.y * (1 - k), z: av.z * (1 - k) }, true);
        // gentle lake current pushes floating things
        if (p.T.rho < 1) p.body.applyImpulse({ x: (lvlNow * 0 + 0.02) * p.mass * dt, y: 0, z: 0.01 * p.mass * dt }, true);
      }
      if (inW && !p.inWater) { p.inWater = true; this.game.onPropEnterWater?.(p, t); }
      else if (!inW && p.inWater) p.inWater = false;
      // shock detection for volatile props
      const v = p.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (p.hp && Math.abs(sp - p.lastSpeed) > 9 && p.lastSpeed > 6) this.game.damageProp?.(p, (Math.abs(sp - p.lastSpeed) - 8) * 3, p.thrownBy);
      p.lastSpeed = sp;
    }
    this.world.step();
    if (this.terrainDirty) this.rebuildTerrain();
  }

  /** Radial impulse on all dynamic props. */
  blast(x, y, z, radius, power, skipId) {
    for (const p of this.props.values()) {
      if (p.id === skipId) continue;
      const t = p.body.translation();
      const dx = t.x - x, dy = t.y - y + 0.3, dz = t.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const f = (1 - d / radius) ** 1.4;
      const k = (power * f * Math.min(p.mass, 40)) / Math.max(d, 0.4);
      p.body.applyImpulse({ x: (dx / Math.max(d, 0.3)) * k, y: (dy / Math.max(d, 0.3)) * k + power * f * 0.35 * Math.min(p.mass, 40), z: (dz / Math.max(d, 0.3)) * k }, true);
      p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * f * p.mass * 2, y: (Math.random() - 0.5) * f * p.mass * 2, z: (Math.random() - 0.5) * f * p.mass * 2 }, true);
    }
  }
}

function round(v, n) { const m = 10 ** n; return Math.round(v * m) / m; }
