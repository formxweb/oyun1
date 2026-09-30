// THE LAST SERVER — the authoritative game hub: sessions, simulation loops, and every action that
// permanently changes the world.
import crypto from 'node:crypto';
import { World, WEAR_N } from './state.js';
import { Chronicle } from './chronicle.js';
import { Phys, PROP_TYPES } from './physics.js';
import { Npcs, ACT } from './npcs.js';
import { Director } from './director.js';
import { Streams } from './stream.js';
import { cleanName, cleanChat, cleanSign, pick, listNames } from './text.js';
import { Terrain, VOID_DEPTH, HALF, lakeD } from '../shared/terrain.js';
import { genTrees, genRocks } from '../shared/scatter.js';
import { Collision, buildingWorldBoxes, plankWorldBox, resolveXZ, groundAt, insideFootprint, PLAYER_H } from '../shared/collide.js';
import { BTYPES, SPAWN, UNDER, WATER_LEVEL, districtAt, LAKE } from '../shared/layout.js';
import { fmtClock, fmtDuration, clamp, TAU } from '../shared/util.js';

import { CFG } from './config.js';
export { CFG };

const UNDER_PLOTS = [];
for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 8; k++) UNDER_PLOTS.push({ ang: ((k + ring * 0.35) / 8) * TAU + 0.25, r: [58, 78, 94][ring] });

const UNDER_ANCIENT = [
  { id: 'u_archive', type: 'hall', name: 'The Archive', x: 0, z: -34, yaw: 0 },
  { id: 'u_market', type: 'store', name: 'Old Provisions', x: -50, z: -12, yaw: Math.atan2(50, 12) },
  { id: 'u_chapel', type: 'chapel', name: 'The First Chapel', x: 52, z: -14, yaw: Math.atan2(-52, 14) },
  { id: 'u_house', type: 'house', name: "Nobody's House", x: 20, z: 52, yaw: Math.atan2(-20, -52) },
];

export class Game {
  static async create() {
    const g = new Game();
    await g.boot();
    return g;
  }

  constructor() {
    this.sessions = new Map();
    this.nextSid = 1;
    this.charges = new Map();
    this.tick = 0;
    this.lastPhys = Date.now();
    this.stats = { boots: 0 };
  }

  async boot() {
    const t0 = Date.now();
    this.world = new World();
    const had = this.world.load();
    this.chron = new Chronicle(this.world);
    this.terrain = new Terrain();
    const pub = this.world.pub;
    this.terrain.applyMods(pub.craters, pub.erased);
    this.col = new Collision();
    this.phys = await Phys.create(this);
    this.phys.rebuildTerrain();
    this.trees = genTrees(this.terrain);
    this.rocks = genRocks(this.terrain);
    this._ensureUnder();
    for (const id in pub.buildings) this._registerBuilding(pub.buildings[id]);
    for (const id in pub.planks) this._registerPlank(pub.planks[id]);
    this._syncHatch();
    this.phys.onPropEnterWater = (p, t) => this.onPropEnterWater(p, t);
    this._loadProps(had);
    this.npcs = new Npcs(this);
    this.npcs.boot();
    this.director = new Director(this);
    this.streams = new Streams(this);
    if (!had) {
      this.chron.add({ kind: 'genesis', title: 'THE SERVER BEGINS', text: 'Hollowmere wakes. Nobody knows who started it.', legend: 60 });
    } else {
      this.chron.add({ kind: 'reboot', title: 'THE SERVER RETURNS', text: `The world resumes after ${fmtDuration(Date.now() - (pub.lastSeen || Date.now()))} of silence.`, legend: 12 });
    }
    console.log(`[game] booted in ${Date.now() - t0}ms — ${Object.keys(pub.buildings).length} buildings, ${this.npcs.list.size} NPCs, ${this.phys.props.size} props, ${this.trees.length} trees`);
  }

  // ---------------------------------------------------------------- helpers
  get pub() { return this.world.pub; }
  now() { return Date.now(); }
  tod() { return this.world.todNow(); }
  players(zone) { const a = []; for (const s of this.sessions.values()) if (s.role === 'player' && s.ready && (!zone || s.zone === zone)) a.push(s); return a; }
  livePlayers() { return this.players().filter((s) => !s.dead); }
  sessionById(id) { return this.sessions.get(id); }
  playerByPid(pid) { for (const s of this.sessions.values()) if (s.pid === pid && s.role === 'player') return s; return null; }
  patch(p, v) { this.world.set(p, v); }
  send(s, msg) { if (s.ws.readyState === 1) { try { s.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* closed */ } } }
  broadcast(msg) { const m = JSON.stringify(msg); for (const s of this.sessions.values()) if (s.ready) this.send(s, m); }
  broadcastPlayers(msg) {
    const m = JSON.stringify(msg);
    const toViewers = msg.t === 'chron' || msg.t === 'sevent' || msg.t === 'legend' || msg.t === 'radio';
    for (const s of this.sessions.values()) if (s.ready && (s.role === 'player' || (toViewers && s.role === 'viewer'))) this.send(s, m);
  }
  /** Discrete effect delivered to players within `r` metres (same zone as the point). */
  emitNear(k, data, x, z, r = 150, zone = 'surface') {
    const m = JSON.stringify({ t: 'ev', k, ...data, x, z });
    for (const s of this.sessions.values()) if (s.ready && s.role === 'player' && s.zone === zone && Math.hypot(s.x - x, s.z - z) < r) this.send(s, m);
  }
  toast(s, text, kind = 'info') { this.send(s, { t: 'toast', text, kind }); }
  district(x, z) { return districtAt(x, z, this.pub.places); }
  streamOf(s) { return s && s.stream ? { name: s.name, code: s.stream.code } : null; }

  // ---------------------------------------------------------------- world setup
  _registerBuilding(b) {
    this.col.set(b.id, buildingWorldBoxes(b));
    if (b.zone === 'surface' || b.zone === 'under') this.phys.setBuilding(b);
  }
  _registerPlank(p) { this.col.set(p.id, [plankWorldBox(p)]); this.phys.setPlank(p); }

  _ensureUnder() {
    const pub = this.pub;
    for (const u of UNDER_ANCIENT) {
      if (pub.buildings[u.id]) continue;
      const T = BTYPES[u.type];
      pub.buildings[u.id] = { id: u.id, type: u.type, name: u.name, x: u.x, z: u.z, yaw: u.yaw, floorY: UNDER.y + 0.15, hp: T.hp * 3, zone: 'under', tint: 0.5, ancient: true };
    }
    this.world.touch();
  }

  _syncHatch() {
    const ch = this.pub.buildings.b_chapel;
    if (!ch) return;
    const T = BTYPES.chapel;
    const p = this.npcsLocal(ch, T.hatchAt[0], T.hatchAt[1]);
    const h = this.pub.portals.hatch1;
    if (Math.hypot(h.x - p.x, h.z - p.z) > 0.05) { h.x = p.x; h.z = p.z; h.y = ch.floorY; this.world.touch(); }
    h.y = ch.floorY;
  }
  npcsLocal(b, lx, lz) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c }; }

  _loadProps(had) {
    const saved = this.world.priv.props;
    if (had && saved && saved.length) {
      for (const p of saved) this.phys.addProp({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, q: p.q, meta: p.meta || {}, zone: p.zone || 'surface' });
      // a persistent world must never lose its Gnome
      if (![...this.phys.props.values()].some((p) => p.type === 'gnome')) this.phys.addProp({ type: 'gnome', x: 11, y: this.terrain.height(11, 61) + 0.4, z: 61, meta: { name: 'Sir Gnomeo' } });
      return;
    }
    const t = this.terrain;
    const add = (type, x, z, dy = 0.5, meta) => this.phys.addProp({ type, x, y: t.height(x, z) + dy, z, meta: meta || {} });
    for (let i = 0; i < 6; i++) add('crate', -40 + (i % 3) * 1.4, 48.6 + Math.floor(i / 3) * 1.4, 0.4);
    add('bigcrate', -31, 48.5, 0.6);
    add('fuel', 56, 47.6); add('fuel', 57.2, 47.8); add('fuel', 55.8, 48.9);
    add('tire', 60, 48); add('tire', 61.2, 48.4); add('tire', 46, 47.7);
    add('barrel', 3, 47.5); add('barrel', 4.2, 47.6);
    for (const z of [-3, -13, -23]) this.phys.addProp({ type: 'lantern', x: 8.9, y: 1.4, z, meta: {} });
    let placed = 0, guard = 0;
    while (placed < 14 && guard++ < 400) {
      const x = -10 + Math.random() * 70, z = 2 + Math.random() * 10;
      const h = t.height(x, z);
      if (h < 0.6 || h > 2.6) continue;
      add('stone', x, z, 0.4); placed++;
    }
    add('ball', -60, 60.5, 0.6); add('ball', -58.5, 61, 0.6);
    for (let i = 0; i < 4; i++) add('crate', 108 + (i % 2) * 1.5, 50 + Math.floor(i / 2) * 1.5, 0.4);
    this.phys.addProp({ type: 'gnome', x: 11, y: t.height(11, 61) + 0.4, z: 61, meta: { name: 'Sir Gnomeo' } });
  }

  // ---------------------------------------------------------------- sessions
  addSession(ws, role) {
    const s = { id: this.nextSid++, ws, role, ready: false, ip: '', tokens: 30, lastTok: Date.now(), msgs: 0 };
    this.sessions.set(s.id, s);
    return s;
  }

  hello(s, m) {
    if (s.role === 'viewer') return this.streams.viewerHello(s, m);
    const name = cleanName(m.name);
    if (!name) { this.send(s, { t: 'reject', reason: 'Pick a name (2-16 letters/numbers).' }); return s.ws.close(); }
    if (this.players().length >= CFG.maxPlayers) { this.send(s, { t: 'reject', reason: 'The server is full. Somebody will leave eventually — they always do.' }); return s.ws.close(); }
    const token = typeof m.token === 'string' && m.token.length >= 16 && m.token.length <= 80 ? m.token : crypto.randomUUID() + crypto.randomUUID();
    const pid = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
    // one connection per identity: a re-join replaces the old ghost session
    for (const o of this.players()) if (o.pid === pid) { this.dropSession(o, 'replaced'); try { o.ws.close(4000, 'replaced'); } catch { /* */ } }
    const now = Date.now();
    const rec = this.world.priv.players[pid] || (this.world.priv.players[pid] = { name, first: now, last: now, visits: 0, playtime: 0, notoriety: 0, title: null, stats: { throws: 0, offerings: 0, kills: 0, deaths: 0, destroyed: 0, planks: 0, signs: 0, discoveries: 0, gifts: 0, clips: 0, steps: 0 }, lastWords: null });
    const since = rec.last || now;
    rec.name = name; rec.visits++; rec.lastJoin = now;
    if (rec.visits === 1) this.pub.stats.players++;
    Object.assign(s, {
      pid, name, rec, ready: false, zone: 'surface', hp: 100, dead: false, held: null, tool: 0, an: 0, em: 0,
      x: SPAWN.x + (Math.random() - 0.5) * 4, z: SPAWN.z + (Math.random() - 0.5) * 6, y: 0, yaw: SPAWN.yaw, pitch: 0,
      inv: { charges: 3, planks: 6, signs: 3, tc: now, tp: now, ts: now }, lastState: now, lastChat: null, lastChatAt: 0, idleSince: now, joinAt: now,
      quality: m.q || 'high', wearAcc: 0, lastSent: 0, stream: null,
    });
    // return where they were if they were on the surface and it is not the void
    if (rec.lastPos && Math.hypot(rec.lastPos.x, rec.lastPos.z) < 285 && !this.terrain.isVoid(rec.lastPos.x, rec.lastPos.z) && lakeD(rec.lastPos.x, rec.lastPos.z) > 1.05 && now - (rec.last || 0) < 12 * 3600000 && rec.lastPos.zone !== 'under') { s.x = rec.lastPos.x; s.z = rec.lastPos.z; }
    s.y = groundAt(this.col, this.terrain, s.x, s.z, 200, 'surface');
    if (m.streamer) this.streams.startStream(s, cleanSign(m.title) || `${name} is live`);
    this.phys.kinMove('p:' + s.id, s.x, s.y, s.z);
    s.ready = true;
    s.token = token;
    const digest = this.chron.recent.filter((e) => e.ts > since && e.legend >= 8 && e.kind !== 'reboot').slice(-12);
    this.send(s, {
      t: 'welcome', id: s.id, pid, token, name, serverNow: now, cfg: { fast: CFG.fast },
      world: this.pub, trees: this.trees, rocks: this.rocks,
      props: [...this.phys.props.values()].map((p) => this.propMsg(p)),
      npcs: [...this.npcs.list.values()].map((n) => this.npcs.snapshot(n)),
      players: this.players().filter((o) => o.id !== s.id).map((o) => this.playerInfo(o)),
      chronicle: { recent: this.chron.last(80), top: this.chron.top(12) },
      wear: Buffer.from(this.world.wear).toString('base64'), pos: { x: s.x, y: s.y, z: s.z, yaw: s.yaw, zone: s.zone },
      me: this.meMsg(s), digest, sinceMs: now - since, title: rec.title, stream: s.stream ? this.streams.info(s) : null,
      charges: [...this.charges.values()].map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, at: c.fuseAt })),
    });
    this.broadcastPlayers({ t: 'pjoin', p: this.playerInfo(s) });
    this.director.onJoin(s, since, digest);
    console.log(`[join] ${name} (${pid}) — ${this.players().length} online`);
  }

  playerInfo(s) { return { id: s.id, name: s.name, title: s.rec?.title || null, live: !!s.stream, x: round(s.x), y: round(s.y), z: round(s.z), yaw: round(s.yaw) }; }
  meMsg(s) { return { hp: Math.round(s.hp), inv: { charges: s.inv.charges, planks: s.inv.planks, signs: s.inv.signs }, tool: s.tool }; }

  propMsg(p) {
    return { id: p.id, ty: p.type, pose: this.phys.propPose(p), meta: p.meta && Object.keys(p.meta).length ? p.meta : undefined, held: p.held || undefined };
  }

  dropSession(s, why) {
    if (!this.sessions.has(s.id)) return;
    this.sessions.delete(s.id);
    if (s.role === 'viewer') return this.streams.viewerLeft(s);
    if (!s.ready) return;
    if (s.held) this.dropHeld(s);
    this.phys.kinRemove('p:' + s.id);
    if (s.rec) { s.rec.last = Date.now(); s.rec.playtime += Date.now() - s.joinAt; s.rec.lastPos = { x: round(s.x), z: round(s.z), zone: s.zone }; }
    this.streams.stopStream(s);
    this.broadcastPlayers({ t: 'pleave', id: s.id });
    this.world.touch();
    console.log(`[leave] ${s.name} (${why || 'closed'}) — ${this.players().length} online`);
  }

  // ---------------------------------------------------------------- inbound
  handle(s, m) {
    if (!m || typeof m.t !== 'string') return;
    // token-bucket rate limit (30 msgs burst, 60/s sustained). state packets are cheap and exempt from the count.
    const now = Date.now();
    s.tokens = Math.min(90, s.tokens + ((now - s.lastTok) / 1000) * 60); s.lastTok = now;
    if (m.t !== 'st') { if (s.tokens < 1) return; s.tokens -= 1; }
    if (m.t === 'hello') return s.ready || s.helloed ? undefined : ((s.helloed = true), this.hello(s, m));
    if (s.role === 'viewer') return this.streams.viewerMsg(s, m);
    if (!s.ready) return;
    switch (m.t) {
      case 'st': return this.onState(s, m);
      case 'act': return this.onAct(s, m);
      case 'ping': return this.send(s, { t: 'pong', c: m.c, s: now });
      default:
    }
  }

  onState(s, m) {
    if (s.dead) return;
    const now = Date.now();
    const dt = Math.max(0.02, Math.min(1, (now - s.lastState) / 1000));
    s.lastState = now;
    const x = +m.x, y = +m.y, z = +m.z;
    if (!Number.isFinite(x + y + z)) return;
    const dh = Math.hypot(x - s.x, z - s.z);
    const maxH = 12.5 * dt + 2.5;
    if (!CFG.dev && (dh > maxH || Math.abs(y - s.y) > 30 * dt + 4)) {
      s.violations = (s.violations || 0) + 1;
      this.send(s, { t: 'tp', x: s.x, y: s.y, z: s.z, zone: s.zone, yaw: s.yaw });
      return;
    }
    const moved = dh / dt;
    s.x = clamp(x, -HALF + 4, HALF - 4); s.y = clamp(y, -200, 400); s.z = clamp(z, -HALF + 4, HALF - 4);
    s.yaw = +m.yaw || 0; s.pitch = clamp(+m.pitch || 0, -1.5, 1.5);
    s.an = m.an | 0; s.em = m.em | 0; s.tool = m.tool | 0;
    if (moved > 0.6) s.idleSince = now;
    if (s.zone === 'under') {
      const r = Math.hypot(s.x, s.z);
      if (r > UNDER.r - 1) { s.x *= (UNDER.r - 1) / r; s.z *= (UNDER.r - 1) / r; }
    } else if (s.y < VOID_DEPTH * 0.55 || (this.terrain.height(s.x, s.z) < VOID_DEPTH * 0.6 && s.y < -10)) {
      this.killPlayer(s, 'void', null);
    } else {
      // desire paths: feet on the ground, actually walking
      if (moved > 1.2 && moved < 10 && !(s.an === 3) && s.y - this.terrain.height(s.x, s.z) < 1.2 && lakeD(s.x, s.z) > 1.05) this.trample(s.x, s.z, dt);
    }
    this.phys.kinMove('p:' + s.id, s.x, s.y, s.z);
    s.rec.stats.steps += dh > 0.01 ? dh : 0;
  }

  trample(x, z, dt) {
    const i = Math.floor((x + HALF) / 4), j = Math.floor((z + HALF) / 4);
    if (i < 0 || j < 0 || i >= WEAR_N || j >= WEAR_N) return;
    const k = j * WEAR_N + i;
    const add = dt * 6;
    const v = this.world.wear[k];
    const nv = Math.min(255, v + add + (Math.random() < add % 1 ? 1 : 0));
    if (Math.floor(nv) !== v) { this.world.wear[k] = Math.floor(nv); (this.wearDirty ||= new Set()).add(k); this.world.dirty = true; }
  }

  onAct(s, m) {
    if (s.dead && m.a !== 'respawn') return;
    const A = m.a;
    try {
      switch (A) {
        case 'grab': return this.actGrab(s, m);
        case 'throw': return this.actThrow(s, m);
        case 'drop': return this.dropHeld(s);
        case 'charge': return this.actCharge(s, m);
        case 'plank': return this.actPlank(s, m);
        case 'sign': return this.actSign(s, m);
        case 'talk': return this.actTalk(s, m);
        case 'gift': return this.actGift(s, m);
        case 'use': return this.actUse(s, m);
        case 'name': return this.actName(s, m);
        case 'chat': return this.actChat(s, m);
        case 'emote': return this.emitNear('emote', { id: s.id, e: (m.e | 0) % 8 }, s.x, s.z, 90, s.zone);
        case 'clip': return this.actClip(s);
        case 'landed': return this.actLanded(s, m);
        case 'respawn': return this.respawn(s);
        case 'stream': return m.on ? this.streams.startStream(s, cleanSign(m.title) || `${s.name} is live`) : this.streams.stopStream(s);
        default:
      }
    } catch (e) { console.warn('[act]', A, e); }
  }

  aim(m) {
    const o = m.o, d = m.d;
    if (!Array.isArray(o) || !Array.isArray(d) || o.length !== 3 || d.length !== 3) return null;
    const oo = { x: +o[0], y: +o[1], z: +o[2] }, dd = { x: +d[0], y: +d[1], z: +d[2] };
    const l = Math.hypot(dd.x, dd.y, dd.z);
    if (!Number.isFinite(l + oo.x + oo.y + oo.z) || l < 0.001) return null;
    dd.x /= l; dd.y /= l; dd.z /= l;
    return { o: oo, d: dd };
  }
  regen(s) {
    const now = Date.now(), i = s.inv;
    const tick = (key, tk, ms, max) => { if (i[key] >= max) { i[tk] = now; return; } if (now - i[tk] >= ms) { const n = Math.floor((now - i[tk]) / ms); i[key] = Math.min(max, i[key] + n); i[tk] += n * ms; } };
    tick('charges', 'tc', CFG.fast ? 8000 : CFG.chargeRegenMs, 3);
    tick('planks', 'tp', CFG.plankRegenMs, 6);
    tick('signs', 'ts', CFG.signRegenMs, 3);
  }

  // ---- props: grab / throw
  actGrab(s, m) {
    if (s.held) return this.dropHeld(s);
    const a = this.aim(m); if (!a) return;
    const p = this.phys.pickProp(a.o, a.d);
    if (!p) return;
    if (Math.hypot(p.body.translation().x - s.x, p.body.translation().z - s.z) > 6) return;
    p.held = s.id; s.held = p.id;
    p.thrownBy = null;
    p.body.setBodyType(2, true); // kinematic position-based
    this.broadcastPlayers({ t: 'held', id: s.id, prop: p.id });
  }

  updateHeld(s) {
    const p = this.phys.props.get(s.held);
    if (!p) { s.held = null; return; }
    const fx = Math.sin(s.yaw) * Math.cos(s.pitch), fz = Math.cos(s.yaw) * Math.cos(s.pitch);
    const dist = 1.5 + p.r * 0.6;
    let tx = s.x + fx * dist, tz = s.z + fz * dist;
    let ty = s.y + 1.25 + Math.sin(s.pitch) * dist * 0.8;
    const g = groundAt(this.col, this.terrain, tx, tz, s.y + 1, s.zone);
    ty = Math.max(ty, g + p.r + 0.05);
    const cur = p.body.translation();
    const k = 0.5;
    p.body.setNextKinematicTranslation({ x: cur.x + (tx - cur.x) * k, y: cur.y + (ty - cur.y) * k, z: cur.z + (tz - cur.z) * k });
    p.body.setNextKinematicRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) });
  }

  dropHeld(s, vel) {
    const p = s.held && this.phys.props.get(s.held);
    s.held = null;
    if (!p) return;
    p.held = null;
    p.body.setBodyType(0, true);
    p.body.setLinvel({ x: vel?.[0] || 0, y: vel?.[1] || 0, z: vel?.[2] || 0 }, true);
    p.body.wakeUp();
    this.broadcastPlayers({ t: 'held', id: s.id, prop: null });
    return p;
  }

  actThrow(s, m) {
    const p = s.held && this.phys.props.get(s.held);
    if (!p) return;
    const a = this.aim(m); if (!a) return;
    const power = clamp(+m.power || 0.6, 0.15, 1);
    const speed = 5 + power * 15 / Math.max(1, Math.sqrt(p.mass / 6));
    const v = [a.d.x * speed, a.d.y * speed + 1.5, a.d.z * speed];
    this.dropHeld(s, v);
    p.thrownBy = { pid: s.pid, name: s.name, at: Date.now(), sid: s.id, stream: this.streamOf(s) };
    p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * p.mass, y: (Math.random() - 0.5) * p.mass, z: (Math.random() - 0.5) * p.mass }, true);
    s.rec.stats.throws++;
    this.director.note('throw', { s, prop: p });
  }

  // ---- charges
  actCharge(s, m) {
    this.regen(s);
    if (s.inv.charges < 1) return this.toast(s, 'Out of charges — they regrow slowly.', 'warn');
    if (Date.now() < (this.chargesLockUntil || 0)) return this.toast(s, 'THE SERVER HAS CLOSED ITS HAND. Charges are dead for now.', 'warn');
    const a = this.aim(m); if (!a) return;
    let hit = this.phys.rayStatic(a.o, a.d, 9);
    const at = hit || { x: a.o.x + a.d.x * 3, y: Math.max(a.o.y + a.d.y * 3, this.terrain.height(a.o.x + a.d.x * 3, a.o.z + a.d.z * 3)), z: a.o.z + a.d.z * 3 };
    if (Math.hypot(at.x - s.x, at.z - s.z) > 12) return;
    s.inv.charges--; this.send(s, { t: 'you', ...this.meMsg(s) });
    const id = 'c' + (this.nextCh = (this.nextCh || 0) + 1);
    const ch = { id, x: at.x, y: at.y + 0.08, z: at.z, by: { pid: s.pid, name: s.name, sid: s.id, stream: this.streamOf(s) }, fuseAt: Date.now() + CFG.fuseMs, zone: s.zone };
    this.charges.set(id, ch);
    this.broadcastPlayers({ t: 'charge+', id, x: ch.x, y: ch.y, z: ch.z, at: ch.fuseAt });
    this.director.note('charge_placed', { s });
  }

  updateCharges(now) {
    for (const ch of this.charges.values()) {
      if (now < ch.fuseAt) continue;
      this.charges.delete(ch.id);
      this.broadcastPlayers({ t: 'charge-', id: ch.id });
      this.explode({ x: ch.x, y: ch.y, z: ch.z, radius: 16, power: 1, by: ch.by, kind: 'charge', zone: ch.zone });
    }
  }

  // ---- planks
  actPlank(s, m) {
    this.regen(s);
    if (s.inv.planks < 1) return this.toast(s, 'No planks left — they regrow over time.', 'warn');
    if (s.zone !== 'surface') return this.toast(s, 'Nothing to build on down here.', 'warn');
    const a = this.aim(m); if (!a) return;
    const hit = this.phys.rayStatic(a.o, a.d, 11);
    if (!hit) return;
    if (Math.hypot(hit.x - s.x, hit.z - s.z) > 13) return;
    let x = hit.x, z = hit.z, yaw = +m.yaw || 0, y = Math.max(hit.y, WATER_LEVEL + 0.02 + (lakeD(hit.x, hit.z) < 1.15 ? this.pub.lake.level : 0)) + 0.1;
    // snap onto the end of a nearby plank so bridges chain naturally
    let best = null, bd = 2.2;
    for (const id in this.pub.planks) {
      const p = this.pub.planks[id];
      for (const sg of [-1, 1]) {
        const ex = p.x + Math.sin(p.yaw) * 1.6 * sg, ez = p.z + Math.cos(p.yaw) * 1.6 * sg;
        const d = Math.hypot(ex - x, ez - z);
        if (d < bd) { bd = d; best = { p, ex, ez, sg }; }
      }
    }
    if (best) { yaw = best.p.yaw; x = best.ex + Math.sin(yaw) * 1.6 * best.sg; z = best.ez + Math.cos(yaw) * 1.6 * best.sg; y = best.p.y; }
    const list = Object.values(this.pub.planks);
    const mine = list.filter((p) => p.pid === s.pid).sort((a2, b2) => a2.at - b2.at);
    if (mine.length >= 24) this.removePlank(mine[0].id);
    if (list.length >= 160) this.removePlank(list.sort((a2, b2) => a2.at - b2.at)[0].id);
    s.inv.planks--; this.send(s, { t: 'you', ...this.meMsg(s) });
    const id = 'pl' + (this.world.priv.nextPlank = (this.world.priv.nextPlank || 0) + 1);
    const plank = { id, x: round(x), y: round(y), z: round(z), yaw: round(yaw), by: s.name, pid: s.pid, at: Date.now() };
    this.patch(`planks.${id}`, plank);
    this._registerPlank(plank);
    s.rec.stats.planks++;
    this.director.note('plank', { s, plank });
  }
  removePlank(id) { this.col.remove(id); this.phys.removePlank(id); this.patch(`planks.${id}`, null); }

  // ---- signs
  actSign(s, m) {
    this.regen(s);
    const text = cleanSign(m.text);
    if (!text) return this.toast(s, 'Nothing to write (or the server does not allow that word).', 'warn');
    if (s.inv.signs < 1) return this.toast(s, 'No sign posts left.', 'warn');
    const a = this.aim(m); if (!a) return;
    const hit = this.phys.rayStatic(a.o, a.d, 9);
    if (!hit) return;
    const list = Object.values(this.pub.signs);
    const mine = list.filter((p) => p.pid === s.pid).sort((a2, b2) => a2.at - b2.at);
    if (mine.length >= 4) this.patch(`signs.${mine[0].id}`, null);
    if (list.length >= 90) this.patch(`signs.${list.sort((a2, b2) => a2.at - b2.at)[0].id}`, null);
    s.inv.signs--; this.send(s, { t: 'you', ...this.meMsg(s) });
    const id = 'sg' + (this.world.priv.nextSign = (this.world.priv.nextSign || 0) + 1);
    const sign = { id, x: round(hit.x), y: round(hit.y), z: round(hit.z), yaw: round(s.yaw + Math.PI), text, by: s.name, pid: s.pid, at: Date.now(), zone: s.zone };
    this.patch(`signs.${id}`, sign);
    s.rec.stats.signs++;
    this.director.note('sign', { s, sign });
  }

  // ---- talk / gift / use / name
  actTalk(s, m) {
    const n = this.npcs.list.get(String(m.npc));
    if (!n || Math.hypot(n.x - s.x, n.z - s.z) > 5) return;
    const r = this.npcs.talk(n, s);
    this.npcs.say(n, r.text, 5200);
    this.send(s, { t: 'dialog', npc: n.id, name: n.def.name, role: n.def.role, text: r.text, mood: r.mood });
  }
  actGift(s, m) {
    const n = this.npcs.list.get(String(m.npc));
    if (!n || Math.hypot(n.x - s.x, n.z - s.z) > 5 || !s.held) return;
    const p = this.phys.props.get(s.held);
    if (!p) return;
    if (p.T.unique || p.type === 'relic') { const arch = 'They eye it nervously and decline.'; return this.send(s, { t: 'dialog', npc: n.id, name: n.def.name, role: n.def.role, text: arch, mood: 5 }); }
    this.dropHeld(s);
    this.phys.removeProp(p.id);
    this.broadcastPlayers({ t: 'prop-', id: p.id });
    const r = this.npcs.gift(n, s, p.type);
    this.npcs.say(n, r.text, 5200);
    this.send(s, { t: 'dialog', npc: n.id, name: n.def.name, role: n.def.role, text: r.text, mood: r.mood });
    s.rec.stats.gifts++;
    this.director.note('gift', { s, npc: n, prop: p });
  }

  actUse(s, m) {
    const w = m.what;
    if (w === 'portal') {
      const po = this.pub.portals[m.id];
      if (!po || po.zone !== s.zone) return;
      if (Math.hypot(po.x - s.x, po.z - s.z) > 3.4) return;
      if (po.kind === 'hatch') {
        if (!po.found) { this.discoverHatch(s, po); }
        return this.descend(s);
      }
      if (po.kind === 'sinkhole') { if (!po.found) { po.found = true; this.patch(`portals.${po.id}.found`, true); } return this.descend(s, po.id); }
      if (po.kind === 'ladder') return this.ascend(s);
    }
  }

  discoverHatch(s, po) {
    po.found = true; po.by = s.name; po.pid = s.pid; po.at = Date.now();
    this.patch(`portals.${po.id}`, { ...po });
    s.rec.stats.discoveries++;
    this.send(s, { t: 'nameprompt', portal: po.id, hint: 'You found a way down. Name this place — the world will remember what you call it.' });
    this.director.note('discover', { s, portal: po });
  }

  descend(s, viaSink) {
    if (s.held) this.dropHeld(s);
    const l = this.pub.portals.ladder1;
    s.zone = 'under'; s.x = l.x + (Math.random() - 0.5) * 2; s.z = l.z + 3; s.y = UNDER.y + 0.2;
    this.send(s, { t: 'tp', x: s.x, y: s.y, z: s.z, zone: 'under', yaw: Math.PI, fx: 'descend' });
    this.director.note('descend', { s });
  }
  ascend(s) {
    if (s.held) this.dropHeld(s);
    const h = this.pub.portals.hatch1;
    s.zone = 'surface'; s.x = h.x + 1.8; s.z = h.z + 1.2; s.y = h.y || 30;
    s.y = groundAt(this.col, this.terrain, s.x, s.z, s.y + 2, 'surface');
    this.send(s, { t: 'tp', x: s.x, y: s.y, z: s.z, zone: 'surface', yaw: 0, fx: 'ascend' });
  }

  actName(s, m) {
    const po = this.pub.portals[m.portal];
    if (!po || po.pid !== s.pid || po.name) return;
    const name = cleanSign(m.name).slice(0, 28);
    if (!name || name.length < 3) return;
    this.patch(`portals.${po.id}.name`, name);
    const id = 'pl_' + po.id;
    this.patch(`places.${id}`, { x: po.x, z: po.z, name, by: s.name, at: Date.now() });
    const e = this.chron.add({ kind: 'naming', title: `${name.toUpperCase()}`, text: `${s.name} named the place beneath Saint Anselm's "${name}". The name is now permanent.`, actors: [s.name], pos: { x: po.x, z: po.z }, legend: 50, tags: ['naming'], });
    this.broadcastPlayers({ t: 'chron', e });
    this.npcs.broadcastKnowledge('discovery', { actor: s.name, place: name });
  }

  actChat(s, m) {
    const text = cleanChat(m.text);
    if (!text) return;
    if (Date.now() - s.lastChatAt < 700) return;
    s.lastChat = text; s.lastChatAt = Date.now();
    this.emitNear('chat', { id: s.id, name: s.name, text, live: !!s.stream }, s.x, s.z, 90, s.zone);
    this.director.note('chat', { s, text });
  }

  actClip(s) {
    const now = Date.now();
    if (now - (s.lastClip || 0) < 2500) return;
    s.lastClip = now;
    s.rec.stats.clips++;
    const recent = this.chron.recent.filter((e) => now - e.ts < 150000 && (!e.pos || Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 260)).sort((a, b) => b.legend - a.legend)[0];
    if (recent) this.chron.boost(recent.id, 5);
    this.send(s, { t: 'clip', clock: fmtClock(now), title: recent ? recent.title : 'MOMENT', id: recent?.id || 0 });
    this.director.note('clip', { s, entry: recent });
  }

  actLanded(s, m) {
    const v = +m.v;
    if (!Number.isFinite(v) || v < 13 || s.dead) return;
    if (Date.now() - (s.lastLand || 0) < 400) return;
    s.lastLand = Date.now();
    const dmg = clamp((v - 12) * 9, 0, 130);
    if (dmg > 0) this.damagePlayer(s, dmg, 'fall', null);
  }

  // ---------------------------------------------------------------- damage & death
  damagePlayer(s, amt, cause, by) {
    if (s.dead || amt <= 0) return;
    s.hp -= amt;
    s.lastHurt = { cause, by, at: Date.now() };
    this.send(s, { t: 'hurt', hp: Math.max(0, Math.round(s.hp)), amt: Math.round(amt), cause });
    if (s.hp <= 0) this.killPlayer(s, cause, by);
  }

  killPlayer(s, cause, by) {
    if (s.dead) return;
    s.dead = true; s.hp = 0;
    if (s.held) this.dropHeld(s);
    s.rec.stats.deaths++;
    this.pub.stats.playerDeaths++;
    const self = by && by.pid === s.pid;
    const words = s.lastChat && Date.now() - s.lastChatAt < 120000 ? s.lastChat : null;
    if (words) s.rec.lastWords = { text: words, at: Date.now() };
    const causeText = {
      blast: self ? 'blew themselves up with their own charge' : `was caught in ${by ? by.name + "'s" : 'a'} blast`,
      fall: 'fell from a great height', void: 'stepped into the Null', prop: by ? `was struck by a flying object thrown by ${by.name}` : 'was struck by a flying object',
      collapse: 'was inside when the building came down', server: 'was deleted by the server',
    }[cause] || 'died';
    const youText = {
      blast: self ? 'blew yourself up with your own charge' : `were caught in ${by ? by.name + "'s" : 'a'} blast`,
      fall: 'fell from a great height', void: 'stepped into the Null', prop: by ? `were struck by a flying object thrown by ${by.name}` : 'were struck by a flying object',
      collapse: 'were inside when the building came down', server: 'were deleted by the server',
    }[cause] || 'died';
    const e = this.chron.add({ kind: 'death', title: self ? 'OWN GOAL' : 'A PLAYER DIES', text: `${s.name} ${causeText}.${words ? ` Last words: "${words}"` : ''}`, actors: [s.name, ...(by && !self ? [by.name] : [])], pos: { x: s.x, z: s.z }, legend: self ? 30 : 10, tags: ['death', cause, ...(s.stream ? ['stream:' + s.name] : [])] });
    this.broadcastPlayers({ t: 'chron', e });
    this.addGrave({ kind: 'player', name: s.name, x: s.x, z: s.z, cause: causeText, words, by: by?.name });
    this.director.note('death', { s, cause, by, causeText, words, entry: e });
    this.send(s, { t: 'died', cause: youText, by: by?.name || null, words });
    this.emitNear('died', { id: s.id }, s.x, s.z, 120, s.zone);
  }

  respawn(s) {
    if (!s.dead) return;
    s.dead = false; s.hp = 100; s.zone = 'surface';
    s.x = SPAWN.x + (Math.random() - 0.5) * 4; s.z = SPAWN.z + (Math.random() - 0.5) * 6; s.yaw = SPAWN.yaw;
    s.y = groundAt(this.col, this.terrain, s.x, s.z, 200, 'surface');
    s.inv.charges = Math.max(s.inv.charges, 1);
    this.send(s, { t: 'tp', x: s.x, y: s.y, z: s.z, zone: 'surface', yaw: s.yaw, fx: 'respawn' });
    this.send(s, { t: 'you', ...this.meMsg(s) });
  }

  addGrave({ kind, name, x, z, cause, words, by }) {
    const graves = this.pub.graves;
    const ids = Object.keys(graves);
    if (ids.length >= 70) { ids.sort((a, b) => graves[a].at - graves[b].at); this.patch(`graves.${ids[0]}`, null); }
    const id = 'g' + (this.world.priv.nextGrave = (this.world.priv.nextGrave || 0) + 1);
    const y = this.terrain.height(x, z);
    this.patch(`graves.${id}`, { id, kind, name, x: round(x), z: round(z), y: round(y), cause: cause || '', words: words || null, by: by || null, at: Date.now() });
    // ghosts of the departed gather beneath the town
    if (kind === 'player' || kind === 'npc') this.addGhost({ name, kind, by, cause, words });
  }

  addGhost({ name, kind, by, cause, words }) {
    const u = this.pub.under;
    const n = (u.ghostN = (u.ghostN || 0)) % 36;
    u.ghostN++;
    const arch = this.pub.buildings.u_archive;
    const lx = -11.5 + (n % 12) * 2.1, lz = 4.3 + Math.floor(n / 12) * 1.9;
    const p = this.npcsLocal(arch, lx, lz);
    this.patch(`ghosts.gh${n}`, { id: `gh${n}`, name, kind, x: round(p.x), z: round(p.z), yaw: arch.yaw, by: by || null, cause: cause || '', words: words || null, at: Date.now() });
    this.patch('under.ghostN', u.ghostN);
  }

  killNpc(n, cause, by) {
    if (!n.alive) return;
    const info = this.pub.npcInfo[n.id];
    const words = cause === 'blast' ? 'Not again—' : 'Tell them I…';
    this.npcs.remove(n);
    this.pub.stats.npcDeaths++;
    const who = by ? by.name : 'the world';
    const causeText = cause === 'blast' ? 'in an explosion' : cause === 'collapse' ? 'when a building collapsed' : cause === 'prop' ? 'from a blow' : 'in an accident';
    if (by?.pid) { const rec = this.world.priv.players[by.pid]; if (rec) { rec.stats.kills++; rec.notoriety += 10; } }
    const e = this.chron.add({ kind: 'npc_death', title: `${n.def.name.toUpperCase()} IS GONE`, text: `${n.def.name}, ${n.def.role}, died ${causeText}${by ? ` — ${by.name} was responsible` : ''}. They will not return.`, actors: by ? [by.name] : [], pos: { x: n.x, z: n.z }, legend: 45 + (n.def.role === 'Night DJ' ? 10 : 0), tags: ['npc_death', ...(by?.stream ? ['stream:' + by.stream.name] : [])] });
    this.broadcastPlayers({ t: 'chron', e });
    this.addGrave({ kind: 'npc', name: n.def.name, x: n.x, z: n.z, cause: causeText, words, by: by?.name });
    this.emitNear('npc_die', { id: n.id, name: n.def.name }, n.x, n.z, 150);
    this.npcs.witness('killed', { victim: n.def.name, actor: who }, n.x, n.z, 70);
    this.npcs.grieve(n.x, n.z, 90, 0.6);
    this.director.note('npc_death', { npc: n, by, entry: e, info });
  }

  // ---------------------------------------------------------------- props
  damageProp(p, dmg, by) {
    if (!p.hp || p.dead) return;
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.dead = true;
      const t = p.body.translation();
      const who = by ? { pid: by.pid, name: by.name, sid: by.sid, stream: by.stream } : (p.thrownBy || null);
      this.phys.removeProp(p.id);
      this.broadcastPlayers({ t: 'prop-', id: p.id });
      setTimeout(() => this.explode({ x: t.x, y: t.y, z: t.z, radius: 9, power: 0.75, by: who, kind: 'fuel' }), 120);
    }
  }

  spawnProp(type, x, y, z, meta, opts = {}) {
    const p = this.phys.addProp({ type, x, y, z, meta, persist: opts.persist !== false, ttl: opts.ttl || 0, vel: opts.vel, zone: opts.zone || 'surface' });
    if (p) this.broadcastPlayers({ t: 'prop+', p: this.propMsg(p) });
    return p;
  }

  onPropEnterWater(p, t) {
    if (p.zone !== 'surface') return;
    if (lakeD(t.x, t.z) > 1.02) return;
    const sp = Math.hypot(p.body.linvel().x, p.body.linvel().y, p.body.linvel().z);
    this.emitNear('splash', { s: clamp(p.mass / 10 + sp / 12, 0.4, 2.5) }, t.x, t.z, 120);
    if (p.thrownBy && Date.now() - p.thrownBy.at < 25000 && !p.thrownBy.offered && !p.T.debris) {
      p.thrownBy.offered = true;
      this.director.offering(p.thrownBy, p, t);
    }
  }

  // ---------------------------------------------------------------- explosions & destruction
  explode({ x, y, z, radius = 16, power = 1, by = null, kind = 'charge', zone = 'surface', silent = false }) {
    const pub = this.pub;
    pub.stats.explosions++;
    this.emitNear('boom', { y, r: radius, p: power, kd: kind }, x, z, 380, zone);
    // buildings
    if (zone === 'surface') {
      for (const id in pub.buildings) {
        const b = pub.buildings[id];
        if (b.zone !== 'surface' || b.ruined) continue;
        const T = BTYPES[b.type];
        const d = Math.max(0, Math.hypot(b.x - x, b.z - z) - Math.hypot(T.w, T.d) * 0.32);
        if (d < radius) this.damageBuilding(b, 100 * power * (1 - d / radius) ** 1.15, by, 'blast');
      }
      // trees
      const felled = pub.felled;
      const fr = 4.6 * Math.sqrt(power) + 2.2;
      let cnt = 0;
      for (let i = 0; i < this.trees.length && cnt < 40; i++) {
        if (felled[i]) continue;
        const t = this.trees[i];
        if (Math.abs(t[0] - x) < fr && Math.abs(t[1] - z) < fr && Math.hypot(t[0] - x, t[1] - z) < fr) { this.patch(`felled.${i}`, 1); cnt++; }
      }
      // craters
      if (y - this.terrain.height(x, z) < 3.5 && lakeD(x, z) > 1.0) this.addCrater(x, z, 2.4 + 1.5 * power, 0.7 + 0.55 * power, by);
    }
    // living things
    const victims = [...this.players(zone), ...(zone === 'surface' ? [...this.npcs.list.values()] : [])];
    for (const v of victims) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - x, v.z - z, (v.y + 1) - y);
      if (d > radius * 0.85) continue;
      const dmg = 125 * power * (1 - d / (radius * 0.85)) ** 1.4 + (d < 3 ? 60 : 0);
      if (v.role === 'player') {
        const pid = by?.pid;
        this.damagePlayer(v, dmg, 'blast', by);
        if (pid && v.pid !== pid) v.rec.notoriety += 0;
      } else this.npcs.damage(v, dmg, 'blast', by);
    }
    // physics
    this.phys.blast(x, y, z, radius * 1.1, 10 * power);
    for (const p of this.phys.props.values()) {
      if (by && Math.hypot(p.body.translation().x - x, p.body.translation().z - z) < radius) p.thrownBy = { pid: by.pid, name: by.name, at: Date.now(), sid: by.sid, stream: by.stream };
      if (p.hp) { const t = p.body.translation(); const d = Math.hypot(t.x - x, t.y - y, t.z - z); if (d < radius) this.damageProp(p, 40 * (1 - d / radius) + 4, by); }
    }
    this.npcs.frighten(x, z, 90, 0.9, by);
    this.director.note('explosion', { x, z, by, power, kind, radius });
    if (by?.pid) { const rec = this.world.priv.players[by.pid]; if (rec && kind === 'charge') rec.stats.explosions = (rec.stats.explosions || 0) + 1; }
  }

  addCrater(x, z, r, d, by) {
    const craters = this.pub.craters;
    const ids = Object.keys(craters);
    for (const id of ids) { const c = craters[id]; if (Math.hypot(c.x - x, c.z - z) < c.r * 0.6) return; }
    if (ids.length >= 220) { this.patch(`craters.${ids[0]}`, null); this.terrain.applyMods(this.pub.craters, this.pub.erased); }
    const id = 'cr' + (this.world.priv.nextCrater = (this.world.priv.nextCrater || 0) + 1);
    const c = { id, x: round(x), z: round(z), r: round(r), d: round(d), by: by?.name || null, at: Date.now() };
    this.patch(`craters.${id}`, c);
    this.terrain._crater(c); this.terrain.version++;
    this.phys.terrainDirty = true;
  }

  eraseArea(x, z, r, note) {
    const id = 'er' + (this.world.priv.nextErase = (this.world.priv.nextErase || 0) + 1);
    const e = { id, x: round(x), z: round(z), r: round(r), at: Date.now() };
    this.patch(`erased.${id}`, e);
    this.terrain._erase(e); this.terrain.version++;
    this.phys.terrainDirty = true;
    // props inside fall into the null
    for (const p of [...this.phys.props.values()]) { const t = p.body.translation(); if (Math.hypot(t.x - x, t.z - z) < r + 1) { this.phys.removeProp(p.id); this.broadcastPlayers({ t: 'prop-', id: p.id }); } }
    return e;
  }

  damageBuilding(b, dmg, by, cause) {
    if (b.ruined || dmg <= 0.5) return;
    b.hp -= dmg;
    if (by) b.lastHit = { pid: by.pid, name: by.name, stream: by.stream };
    if (b.hp <= 0) return this.destroyBuilding(b, by || b.lastHit, cause);
    this.patch(`buildings.${b.id}.hp`, Math.round(b.hp));
  }

  destroyBuilding(b, by, cause = 'blast') {
    if (b.ruined) return;
    const T = BTYPES[b.type];
    b.hp = 0; b.ruined = true;
    this.patch(`buildings.${b.id}`, { ...b, hp: 0, ruined: true, ruinedBy: by?.name || null, ruinedAt: Date.now() });
    this.col.set(b.id, buildingWorldBoxes(b));
    this.phys.setBuilding(b);
    this.pub.stats.destroyed++;
    // debris
    const nD = Math.min(26, Math.round(8 + Math.hypot(T.w, T.d) * 1.2));
    for (let i = 0; i < nD; i++) {
      const lx = (Math.random() - 0.5) * T.w * 0.8, lz = (Math.random() - 0.5) * T.d * 0.8;
      const w = this.npcsLocal(b, lx, lz);
      const type = i % 3 === 0 ? 'plank_d' : i % 3 === 1 ? 'brick_d' : 'shingle_d';
      this.spawnProp(type, w.x, b.floorY + 1 + Math.random() * (T.h || 3), w.z, {}, { persist: false, ttl: 90000, vel: [(Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6] });
    }
    this.emitNear('collapse', { id: b.id, type: b.type, w: T.w, d: T.d, h: T.h, yaw: b.yaw, y: b.floorY }, b.x, b.z, 400);
    // anyone inside
    if (!T.slab && !T.watertower && !T.billboard) {
      for (const n of [...this.npcs.list.values()]) if (insideFootprint(b, n.x, n.z, 0)) this.npcs.damage(n, 90, 'collapse', by);
      for (const p of this.players('surface')) if (insideFootprint(b, p.x, p.z, 0)) this.damagePlayer(p, 65, 'collapse', by);
    }
    if (b.type === 'tower') this.phys.blast(b.x, b.floorY, b.z, 30, 6);
    const value = T.value || 3;
    const byp = by?.pid ? this.world.priv.players[by.pid] : null;
    if (byp) { byp.stats.destroyed++; byp.notoriety += 4 + value; }
    const residents = [...this.npcs.list.values()].filter((n) => n.homeId === b.id || n.workId === b.id).map((n) => n.def.name);
    const e = this.chron.add({
      kind: 'destroyed', title: `${b.name.toUpperCase()} DESTROYED`,
      text: `${b.name} was brought down${by ? ` by ${by.name}` : ''}. ${residents.length ? `${listNames(residents)} lost ${residents.length > 1 ? 'their homes' : 'their livelihood'}.` : ''} It is not coming back.`.trim(),
      actors: by ? [by.name] : [], pos: { x: b.x, z: b.z }, legend: 22 + value * 7, tags: ['destroyed', b.type, ...(by?.stream ? ['stream:' + by.stream.name] : [])],
    });
    this.broadcastPlayers({ t: 'chron', e });
    this.addGrave({ kind: 'ruin', name: b.name, x: b.x + Math.sin(b.yaw) * (T.d / 2 + 1.5), z: b.z + Math.cos(b.yaw) * (T.d / 2 + 1.5), cause: by ? `Brought down by ${by.name}` : 'Fell', by: by?.name });
    this.npcs.witness('destroyed', { building: b.name, actor: by?.name || 'nobody' }, b.x, b.z, 80);
    this.npcs.grieve(b.x, b.z, 100, 0.5 + value * 0.05);
    for (const n of this.npcs.list.values()) if (Math.hypot(n.x - b.x, n.z - b.z) < 60 && by?.pid) { this.npcs.blame(n, by, -14 - value); const o = n.opinion[by.pid]; if (o) o.why = `destroyed ${b.name}`; }
    this.relocateToUnder(b, by);
    this.director.note('destroy', { b, by, entry: e, residents, value });
  }

  /** Everything players destroy is reborn beneath the town. */
  relocateToUnder(b, by) {
    const u = this.pub.under;
    if (b.ancient || BTYPES[b.type].slab || b.type === 'billboard' || b.type === 'tower') return;
    if (u.n >= UNDER_PLOTS.length) return;
    const plot = UNDER_PLOTS[u.n];
    const x = Math.cos(plot.ang) * plot.r, z = Math.sin(plot.ang) * plot.r;
    const T = BTYPES[b.type];
    const id = `u_${b.id}`;
    const nb = { id, type: b.type, name: b.name, x: round(x), z: round(z), yaw: Math.atan2(-x, -z), floorY: UNDER.y + 0.15, hp: T.hp * 2, zone: 'under', tint: b.tint, relocated: { from: b.id, by: by?.name || null, at: Date.now() } };
    this.patch(`buildings.${id}`, nb);
    this._registerBuilding(nb);
    this.patch('under.n', ++u.n);
    this.world.touch();
  }

  // ---------------------------------------------------------------- building moves (Director)
  moveBuildingTo(id, tx, tz, durMs = 12000) {
    const b = this.pub.buildings[id];
    if (!b || b.ruined || this.moving?.has(id)) return false;
    (this.moving ||= new Map()).set(id, { id, sx: b.x, sz: b.z, sy: b.floorY, tx, tz, ty: this.terrain.height(tx, tz) + 0.15, t0: Date.now(), dur: durMs, lx: b.x, lz: b.z });
    this.emitNear('shudder', { id }, b.x, b.z, 300);
    return true;
  }

  updateMoving(now) {
    if (!this.moving) return;
    for (const m of [...this.moving.values()]) {
      const b = this.pub.buildings[m.id];
      if (!b || b.ruined) { this.moving.delete(m.id); continue; }
      const t = clamp((now - m.t0) / m.dur, 0, 1);
      const e = t * t * (3 - 2 * t);
      const x = m.sx + (m.tx - m.sx) * e, z = m.sz + (m.tz - m.sz) * e, y = m.sy + (m.ty - m.sy) * e;
      const dx = x - b.x, dz = z - b.z;
      // carry anyone standing inside
      for (const n of this.npcs.list.values()) if (insideFootprint(b, n.x, n.z, 0.3)) { n.x += dx; n.z += dz; }
      for (const p of this.players(b.zone)) if (insideFootprint(b, p.x, p.z, 0.3)) { p.x += dx; p.z += dz; this.send(p, { t: 'shift', dx, dz }); }
      b.x = x; b.z = z; b.floorY = y;
      if (t >= 1 || now - (m.lastPatch || 0) > 220) {
        m.lastPatch = now;
        this.patch(`buildings.${b.id}.x`, round(x)); this.patch(`buildings.${b.id}.z`, round(z)); this.patch(`buildings.${b.id}.floorY`, round(y));
        this.col.set(b.id, buildingWorldBoxes(b));
        this.phys.moveBuilding(b);
      }
      if (t >= 1) { this.moving.delete(m.id); if (b.id === 'b_chapel') this._syncHatch(); this.director.onMoved?.(b); }
    }
  }

  // ---------------------------------------------------------------- radio & sky helpers used by the Director
  radio(msg) { this.broadcastPlayers({ t: 'radio', ...msg, clock: fmtClock(Date.now()) }); }

  // ---------------------------------------------------------------- main loops
  startLoops() {
    const step = 1000 / 30;
    let last = Date.now();
    this.loop = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try { this.frame(dt, now); } catch (e) { console.error('[frame]', e); }
    }, step);
    this.saver = setInterval(() => this.save(), 20000);
  }

  frame(dt, now) {
    this.tick++;
    const players = this.players();
    // held props follow their owners before physics steps
    for (const s of players) if (s.held) this.updateHeld(s);
    // shove props with moving players: kinematic capsules do the work inside Rapier
    this.phys.step(dt);
    this.updateCharges(now);
    this.updateMoving(now);
    // prop lifecycle
    if (this.tick % 15 === 0) this.propHousekeeping(now);
    // impact damage from thrown props
    if (this.tick % 3 === 0) this.impactDamage(now, players);
    // NPCs at 10 Hz
    this.npcAcc = (this.npcAcc || 0) + dt;
    if (this.npcAcc >= 0.1) { this.npcs.update(this.npcAcc, now, players); this.npcAcc = 0; }
    // player regen + hp regen
    if (this.tick % 30 === 0) {
      for (const s of players) { this.regen(s); if (!s.dead && s.hp < 100 && now - (s.lastHurt?.at || 0) > 8000) { s.hp = Math.min(100, s.hp + 4); } if (this.tick % 90 === 0 || s.invDirty) this.send(s, { t: 'you', ...this.meMsg(s) }); }
      this.director.tick(now, 1, players);
      this.streams.tick(now);
    }
    // snapshots @15 Hz
    if (this.tick % 2 === 0) this.snapshot(now, players);
    if (this.tick % 300 === 0) this.flushWear();
    // ops
    const ops = this.world.drainOps();
    if (ops.length) this.broadcastPlayers({ t: 'patch', ops });
  }

  propHousekeeping(now) {
    for (const p of [...this.phys.props.values()]) {
      const t = p.body.translation();
      const floor = p.zone === 'under' ? UNDER.y - 30 : -60;
      if (t.y < floor || Math.abs(t.x) > 330 || Math.abs(t.z) > 330) {
        // things that fall out of the world come back at the spawn (never lose unique items)
        if (p.T.unique || p.type === 'relic') { p.body.setTranslation({ x: SPAWN.x - 3, y: 6, z: SPAWN.z + 3 }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        else { this.phys.removeProp(p.id); this.broadcastPlayers({ t: 'prop-', id: p.id }); }
        continue;
      }
      if (p.ttl && now - p.born > p.ttl && !p.held) { this.phys.removeProp(p.id); this.broadcastPlayers({ t: 'prop-', id: p.id }); }
    }
    // cap debris
    let n = 0; for (const p of this.phys.props.values()) if (p.T.debris) n++;
    if (n > 160) { for (const p of this.phys.props.values()) if (p.T.debris && !p.held && n-- > 140) { this.phys.removeProp(p.id); this.broadcastPlayers({ t: 'prop-', id: p.id }); } }
  }

  impactDamage(now, players) {
    for (const p of this.phys.props.values()) {
      if (!p.thrownBy || p.held || now - p.thrownBy.at > 6000 || p.hitCd > now) continue;
      const v = p.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 6.5) continue;
      const t = p.body.translation();
      const dmg = clamp((sp - 5) * (1 + p.mass / 9), 0, 60);
      let hit = false;
      for (const s of players) {
        if (s.dead || s.zone !== p.zone || s.pid === p.thrownBy.pid && now - p.thrownBy.at < 700) continue;
        if (Math.hypot(s.x - t.x, s.z - t.z) < p.r + 0.45 && t.y > s.y - 0.3 && t.y < s.y + 2) { this.damagePlayer(s, dmg, 'prop', { pid: p.thrownBy.pid, name: p.thrownBy.name }); hit = true; }
      }
      if (p.zone === 'surface') for (const n of this.npcs.list.values()) {
        if (Math.hypot(n.x - t.x, n.z - t.z) < p.r + 0.45 && t.y > n.y - 0.3 && t.y < n.y + 2) { this.npcs.damage(n, dmg, 'prop', { pid: p.thrownBy.pid, name: p.thrownBy.name, stream: p.thrownBy.stream }); hit = true; }
      }
      if (hit) { p.hitCd = now + 600; p.body.setLinvel({ x: -v.x * 0.3, y: Math.abs(v.y) * 0.4 + 1, z: -v.z * 0.3 }, true); this.emitNear('thud', { s: dmg / 40 }, t.x, t.z, 60, p.zone); }
    }
  }

  snapshot(now, players) {
    const ps = players.map((s) => [s.id, round(s.x), round(s.y), round(s.z), round2(s.yaw), round2(s.pitch), s.an, s.held || '', s.em, s.dead ? 1 : 0, s.zone === 'under' ? 1 : 0]);
    const ns = [...this.npcs.list.values()].map((n) => this.npcs.snapshot(n));
    const pr = [];
    for (const p of this.phys.props.values()) {
      if (p.held || !p.body.isSleeping()) { p.sleepSent = false; pr.push([p.id, ...this.phys.propPose(p)]); }
      else if (!p.sleepSent) { p.sleepSent = true; pr.push([p.id, ...this.phys.propPose(p)]); }
    }
    const msg = JSON.stringify({ t: 'snap', ts: now, p: ps, n: ns, pr });
    for (const s of players) this.send(s, msg);
  }

  flushWear() {
    if (!this.wearDirty || !this.wearDirty.size) return;
    const cells = [];
    for (const k of this.wearDirty) cells.push([k, this.world.wear[k]]);
    this.wearDirty.clear();
    if (cells.length > 2500) this.broadcastPlayers({ t: 'wear', full: Buffer.from(this.world.wear).toString('base64') });
    else this.broadcastPlayers({ t: 'wear', cells });
  }

  save() {
    try {
      this.npcs.persist();
      this.world.priv.props = [...this.phys.props.values()].filter((p) => p.persist && !p.T.debris).map((p) => { const t = p.body.translation(), r = p.body.rotation(); return { id: p.id, type: p.type, x: round(t.x), y: round(t.y), z: round(t.z), q: [round2(r.x), round2(r.y), round2(r.z), round2(r.w)], meta: p.meta, zone: p.zone }; });
      this.world.priv.director = this.director.serialize();
      this.pub.lastSeen = Date.now();
      this.world.dirty = true;
      this.world.save();
    } catch (e) { console.error('[save] failed', e); }
  }

  shutdown() {
    clearInterval(this.loop); clearInterval(this.saver);
    this.save();
    for (const s of this.sessions.values()) { try { s.ws.close(1001, 'server restarting'); } catch { /* */ } }
  }
}

function round(v) { return Math.round(v * 100) / 100; }
function round2(v) { return Math.round(v * 100) / 100; }
