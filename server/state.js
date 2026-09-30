// The persistent world: one JSON-serialisable object that *is* the server's history.
// `pub` is mirrored to every client through path patches; `priv` never leaves the server.
import fs from 'node:fs';
import path from 'node:path';
import { SEED, INITIAL_BUILDINGS, BTYPES, ROADS } from '../shared/layout.js';
import { initialFloorY } from '../shared/terrain.js';

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('data');
export const WEAR_N = 160; // 4 m cells over 640 m
export const DAY_MINUTES = Number(process.env.DAY_MINUTES || 32);

export function defaultPub(now) {
  const buildings = {};
  for (const b of INITIAL_BUILDINGS) {
    const T = BTYPES[b.type];
    buildings[b.id] = { id: b.id, type: b.type, name: b.name, x: b.x, z: b.z, yaw: b.yaw, floorY: initialFloorY(b), hp: T.hp, zone: 'surface', tint: (Math.abs(hashStr(b.id)) % 1000) / 1000 };
  }
  return {
    v: 1, seed: SEED, genesis: now,
    clock: { anchorReal: now, anchorTod: 17.4, rate: 24 / (DAY_MINUTES * 60) },
    weather: { type: 'clear', i: 0.15, wx: 0.6, wz: 0.3 },
    lake: { level: 0, hue: 0, glow: 0, offerings: 0, returns: 0 },
    sky: { moons: 1, aurora: 0, tint: 0, eclipseUntil: 0, redUntil: 0, stars: 1 },
    lights: { blackoutUntil: 0 },
    fog: {}, // localized fog banks (viewer influence): id -> {x,z,r,until}
    buildings, erased: {}, craters: {}, felled: {}, signs: {}, planks: {}, graves: {}, monuments: {}, boards: {
      bb_main: { id: 'bb_main', bid: 'b_billboard', text: 'WELCOME TO HOLLOWMERE', sub: 'POPULATION: ????', by: null, at: now, kind: 'default' },
    },
    portals: {
      hatch1: { id: 'hatch1', x: 0, z: 0, zone: 'surface', kind: 'hatch', found: false, by: null, at: 0, name: null }, // positioned on boot from the chapel
      ladder1: { id: 'ladder1', x: 0, z: 6, zone: 'under', kind: 'ladder', found: true, to: 'hatch1' },
    },
    places: {}, ghosts: {}, under: { n: 0, opened: 0 },
    era: { name: 'The Quiet Age', desc: 'Nothing has happened yet.', since: now },
    stats: { players: 0, events: 0, destroyed: 0, npcDeaths: 0, playerDeaths: 0, offerings: 0, explosions: 0 },
    firsts: {},
    npcInfo: {}, // id -> {name, role, look, alive}
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export function defaultPriv() {
  return { players: {}, npcs: {}, props: [], director: null, chronCount: 0, saves: 0 };
}

export class World {
  constructor() {
    this.pub = defaultPub(Date.now());
    this.priv = defaultPriv();
    this.wear = new Uint8Array(WEAR_N * WEAR_N);
    this.ops = [];
    this.dirty = false;
    this.loaded = false;
    this.file = path.join(DATA_DIR, 'world.json');
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const j = JSON.parse(raw);
      const fresh = defaultPub(Date.now());
      // shallow-merge to survive schema growth
      this.pub = { ...fresh, ...j.pub };
      for (const k of ['weather', 'lake', 'sky', 'lights', 'clock', 'era', 'stats', 'under']) this.pub[k] = { ...fresh[k], ...(j.pub[k] || {}) };
      this.priv = { ...defaultPriv(), ...j.priv };
      if (j.wear) this.wear = Uint8Array.from(Buffer.from(j.wear, 'base64'));
      if (this.wear.length !== WEAR_N * WEAR_N) this.wear = new Uint8Array(WEAR_N * WEAR_N);
      this.loaded = true;
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[world] could not load save, starting fresh:', e.message);
      return false;
    }
  }

  save(force = false) {
    if (!this.dirty && !force) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = this.file + '.tmp';
    const body = JSON.stringify({ pub: this.pub, priv: this.priv, wear: Buffer.from(this.wear).toString('base64'), savedAt: Date.now() });
    fs.writeFileSync(tmp, body);
    this.priv.saves++;
    if (this.priv.saves % 30 === 1 && fs.existsSync(this.file)) { try { fs.copyFileSync(this.file, this.file + '.bak'); } catch { /* ignore */ } }
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** Set a value by dotted path in `pub`; null deletes. Queued for broadcast. */
  set(p, v) {
    const parts = p.split('.');
    let o = this.pub;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (v === null || v === undefined) delete o[last]; else o[last] = v;
    this.ops.push([p, v === undefined ? null : v]);
    this.dirty = true;
  }

  get(p) {
    let o = this.pub;
    for (const k of p.split('.')) { if (o == null) return undefined; o = o[k]; }
    return o;
  }

  drainOps() { const o = this.ops; this.ops = []; return o; }
  touch() { this.dirty = true; }

  todNow(now = Date.now()) {
    const c = this.pub.clock;
    const h = c.anchorTod + ((now - c.anchorReal) / 1000) * c.rate;
    return ((h % 24) + 24) % 24;
  }

  /** Re-anchor the clock, optionally changing the rate (Director manipulates time). */
  setClock(tod, rate, now = Date.now()) {
    this.set('clock', { anchorReal: now, anchorTod: tod, rate: rate ?? this.pub.clock.rate });
  }

  publicSnapshot() {
    return this.pub;
  }
}
