// NPC simulation: daily routines, navigation, fear/grief, memory & gossip, and generated dialogue.
// NPCs are mortal. A dead NPC is never restored — the world adapts around the absence.
import { ROSTER, VOICES, NEWS, BARKS, NEW_ROLES, LOOKS } from './npcdata.js';
import { BTYPES, WATER_LEVEL } from '../shared/layout.js';
import { resolveXZ, groundAt, insideFootprint, PLAYER_H } from '../shared/collide.js';
import { angleDiff, clamp, mulberry32 } from '../shared/util.js';
import { FIRST_NAMES, LAST_NAMES, pick } from './text.js';
import { VOID_DEPTH } from '../shared/terrain.js';

export const ACT = { idle: 0, walk: 1, run: 2, work: 3, cower: 4, wave: 5, point: 6, talk: 7, sit: 8, sleep: 9, mourn: 10, dead: 11, fish: 12, write: 13, hammer: 14, pray: 15, cook: 16, dj: 17, patrol: 18 };
export const MOOD = { neutral: 0, happy: 1, sad: 2, scared: 3, angry: 4, surprised: 5, sleepy: 6, suspicious: 7 };
const ROLE_WORK_ACT = { 'Night DJ': ACT.dj, Cook: ACT.cook, Mechanic: ACT.hammer, Shopkeeper: ACT.write, Sheriff: ACT.point, Priest: ACT.pray, Innkeeper: ACT.write };

function fill(t, p) { return t.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '…'); }

export class Npcs {
  constructor(game) {
    this.game = game;
    this.list = new Map();
    this.rnd = mulberry32(4242);
    this.gossipT = 0;
  }

  get b() { return this.game.world.pub.buildings; }

  // ---------- lifecycle ----------
  boot() {
    const saved = this.game.world.priv.npcs;
    const info = this.game.world.pub.npcInfo;
    for (const def of ROSTER) {
      const s = saved[def.id];
      if (s && s.alive === false) continue; // permanently gone
      this._make(def, s);
    }
    // arrivals persisted
    for (const id in saved) {
      const s = saved[id];
      if (this.list.has(id) || s.alive === false || !s.def) continue;
      this._make(s.def, s);
    }
    // ensure info for the dead remains (so ghosts/graves can resolve names)
    for (const id in saved) if (saved[id].alive === false && !info[id]) info[id] = { name: saved[id].def?.name || id, role: saved[id].def?.role || '', alive: false };
  }

  _make(def, s) {
    const home = this.b[def.home];
    let x, z;
    if (s && s.x != null) { x = s.x; z = s.z; }
    else if (home && !home.ruined) { const p = this.localToWorld(home, ...(def.homeAt || [0, 1])); x = p.x; z = p.z; }
    else if (def.spot) { x = def.spot.x; z = def.spot.z; }
    else { x = 100 + this.rnd() * 6; z = 60 + this.rnd() * 4; }
    const n = {
      id: def.id, def, x, z, y: 0, yaw: this.rnd() * 6.28, hp: s?.hp ?? 60, alive: true, state: 'idle', act: ACT.idle, mood: 0,
      target: null, path: [], stuck: 0, speechUntil: 0, speech: null, gaze: null, panicUntil: 0, panicFrom: null, grief: s?.grief || 0,
      fear: 0, anger: 0, knowledge: s?.knowledge || [], opinion: s?.opinion || {}, lineIdx: {}, told: {}, talks: s?.talks || {},
      homeId: s?.homeId !== undefined ? s.homeId : def.home, workId: s?.workId !== undefined ? s.workId : def.work,
      socialId: null, socialUntil: 0, nextThink: 0, lastBark: 0, mournUntil: 0, hitAt: 0, talkUntil: 0, sitting: false,
    };
    n.y = this.groundY(n);
    this.list.set(n.id, n);
    this.game.world.pub.npcInfo[n.id] = { name: def.name, role: def.role, look: def.look, voice: def.voice, alive: true, kid: !!def.kid };
    return n;
  }

  persist() {
    const out = this.game.world.priv.npcs;
    for (const n of this.list.values()) {
      out[n.id] = { alive: true, x: round(n.x), z: round(n.z), hp: n.hp, grief: n.grief, knowledge: n.knowledge.slice(-14), opinion: n.opinion, talks: n.talks, homeId: n.homeId, workId: n.workId, def: n.def._arrival ? n.def : undefined };
    }
  }

  spawnArrival(def) {
    def._arrival = true;
    const n = this._make(def, null);
    this.game.world.priv.npcs[n.id] = { alive: true, def };
    return n;
  }

  randomArrivalDef() {
    const id = 'n_' + Math.floor(Math.random() * 1e6).toString(36);
    const name = pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES);
    const female = Math.random() < 0.5;
    return {
      id, name, role: pick(NEW_ROLES), home: null, work: null, workAt: null, homeAt: null, arch: pick(['nova', 'bet', 'dutch', 'ada', 'wren', 'doc', 'piet', 'marg']), voice: 0.8 + Math.random() * 0.8,
      look: { skin: pick(LOOKS.skins), hair: pick(LOOKS.hairs), style: pick(LOOKS.styles), shirt: pick(LOOKS.shirts), pants: pick(LOOKS.pants), hat: pick(LOOKS.hats), glasses: Math.random() < 0.3, scale: 0.9 + Math.random() * 0.18, build: 0.9 + Math.random() * 0.3, female },
    };
  }

  aliveCount() { return this.list.size; }

  // ---------- geometry helpers ----------
  localToWorld(b, lx, lz) {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
  }
  door(b, out) {
    const T = BTYPES[b.type];
    const off = out ? T.d / 2 + 1.7 : T.d / 2 - 1.5;
    return this.localToWorld(b, 0, off);
  }
  groundY(n) { return groundAt(this.game.col, this.game.terrain, n.x, n.z, n.y ?? 0, 'surface'); }
  buildingAt(x, z) {
    for (const id in this.b) { const b = this.b[id]; if (b.zone === 'surface' && !b.ruined && BTYPES[b.type].furn && !BTYPES[b.type].slab && insideFootprint(b, x, z, -0.1)) return b; }
    return null;
  }
  usable(id) { const b = this.b[id]; return b && !b.ruined && b.zone === 'surface' ? b : null; }

  // ---------- scheduling ----------
  activity(n, tod) {
    const def = n.def;
    const work = n.workId && this.usable(n.workId);
    const home = n.homeId && this.usable(n.homeId);
    const asleep = def.arch === 'nova' ? (tod >= 5 && tod < 14) : def.kid ? (tod >= 20.5 || tod < 6.5) : (tod >= 22 || tod < 6);
    if (asleep) {
      if (home) return { kind: 'sleep', bid: home.id, at: def.homeAt || [0, 0.8] };
      const sp = def.spot || { x: 8, z: 22 };
      return { kind: 'sleep', x: sp.x, z: sp.z };
    }
    const isWorkTime = def.arch === 'nova' ? (tod >= 18 || tod < 5) : (tod >= 8 && tod < 12) || (tod >= 13 && tod < 18);
    if (work && isWorkTime && def.workAt) return { kind: 'work', bid: work.id, at: def.workAt };
    if (def.arch === 'piet' && tod >= 6 && tod < 18) return { kind: 'fish', x: def.spot.x, z: def.spot.z };
    if (def.arch === 'reyes' && !work) return { kind: 'wander' };
    if (tod >= 18 && tod < 22 || (tod >= 12 && tod < 13)) return this.socialSpot(n);
    return { kind: 'wander' };
  }

  socialSpot(n) {
    const now = Date.now();
    if (!n.social || now > n.socialUntil) {
      const opts = [];
      const diner = this.usable('b_diner'), inn = this.usable('b_inn');
      if (diner) opts.push({ kind: 'social', bid: diner.id, at: [(Math.random() - 0.5) * 6, 1.4] });
      if (inn) opts.push({ kind: 'social', bid: inn.id, at: [-3 - Math.random() * 3, 1.2] });
      opts.push({ kind: 'social', x: 10 + (Math.random() - 0.5) * 6, z: 18 + Math.random() * 3 }); // promenade
      opts.push({ kind: 'social', x: -14 + (Math.random() - 0.5) * 8, z: 58 + Math.random() * 3 }); // street corner
      n.social = pick(opts, Math.random);
      n.socialUntil = now + (4 + Math.random() * 8) * 60000;
    }
    const s = n.social;
    if (s.bid && !this.usable(s.bid)) { n.social = null; return { kind: 'wander' }; }
    return s;
  }

  // ---------- update ----------
  update(dt, now, players) {
    const tod = this.game.tod();
    const gm = this.game;
    for (const n of this.list.values()) {
      if (!n.alive) continue;
      const bldg = n.homeId && this.b[n.homeId];
      if (n.homeId && (!bldg || bldg.ruined)) { n.homeId = this.findShelter(n); }
      if (n.workId && !this.usable(n.workId)) n.workId = null;
      n.fear = Math.max(0, n.fear - dt * 0.05);
      n.anger = Math.max(0, n.anger - dt * 0.02);
      n.grief = Math.max(0, n.grief - dt * 0.004);

      // gaze at the closest visible player
      let gz = null, gd = 14;
      for (const p of players) {
        if (p.zone !== 'surface' || p.dead) continue;
        const d = Math.hypot(p.x - n.x, p.z - n.z);
        if (d < gd) { gd = d; gz = p; }
      }
      n.gaze = gz ? gz.id : null;

      // panic overrides everything
      if (now < n.panicUntil) this.doPanic(n, dt, now);
      else if (now < n.mournUntil) { n.act = ACT.mourn; n.state = 'mourn'; n.target = null; n.mood = MOOD.sad; }
      else if (now < n.talkUntil && gz) { n.act = ACT.talk; n.state = 'talk'; this.faceToward(n, gz.x, gz.z, dt); }
      else this.doRoutine(n, dt, now, tod);

      // mood
      if (n.fear > 0.45) n.mood = MOOD.scared;
      else if (n.anger > 0.5) n.mood = MOOD.angry;
      else if (n.grief > 0.25) n.mood = MOOD.sad;
      else if (n.act === ACT.sleep) n.mood = MOOD.sleepy;
      else if (n.state === 'talk') n.mood = n.mood === MOOD.angry ? n.mood : MOOD.happy;
      else if (tod > 22.5 || tod < 4) n.mood = MOOD.suspicious;
      else n.mood = MOOD.neutral;

      if (n.speech && now > n.speechUntil) n.speech = null;
      gm.phys.kinMove('n:' + n.id, n.x, n.y, n.z);
    }
    // gossip
    this.gossipT -= dt;
    if (this.gossipT <= 0) { this.gossipT = 22 + Math.random() * 20; this.gossip(players, now); }
  }

  findShelter(n) {
    let best = null, bd = 1e9;
    for (const id in this.b) {
      const b = this.b[id];
      if (b.ruined || b.zone !== 'surface' || !['house', 'cottage', 'inn'].includes(b.type)) continue;
      const d = Math.hypot(b.x - n.x, b.z - n.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? best.id : null;
  }

  doRoutine(n, dt, now, tod) {
    if (now > n.nextThink || !n.target) {
      n.nextThink = now + 4000 + Math.random() * 4000;
      const a = this.activity(n, tod);
      n.plan = a;
      n.target = this.targetFor(n, a);
      if (n.target) n.path = this.plan(n, n.target);
    }
    const a = n.plan || { kind: 'wander' };
    if (n.path.length) {
      const wp = n.path[0];
      const speed = a.kind === 'wander' ? 1.2 : 1.6;
      const arrived = this.moveToward(n, wp.x, wp.z, speed, dt);
      n.act = ACT.walk; n.state = 'walk';
      if (arrived) n.path.shift();
    } else {
      // at destination
      n.state = a.kind;
      const dwell = a.kind;
      if (dwell === 'sleep') n.act = ACT.sleep;
      else if (dwell === 'work') n.act = ROLE_WORK_ACT[n.def.role] ?? ACT.work;
      else if (dwell === 'fish') n.act = ACT.fish;
      else if (dwell === 'social') n.act = Math.random() < 0.002 ? ACT.wave : (n.act === ACT.wave ? ACT.wave : ACT.talk);
      else n.act = ACT.idle;
      if (dwell === 'wander' && now > n.nextThink - 2500) n.target = null; // pick a new wander point soon
      if (n.gaze && dwell !== 'sleep') { const p = this.game.sessionById(n.gaze); if (p) this.faceToward(n, p.x, p.z, dt); }
    }
    n.y = this.groundY(n);
  }

  targetFor(n, a) {
    if (a.bid) { const b = this.usable(a.bid); if (!b) return null; const p = this.localToWorld(b, a.at[0], a.at[1]); return { x: p.x, z: p.z, bid: b.id }; }
    if (a.kind === 'wander') {
      const b = n.homeId && this.usable(n.homeId);
      const cx = b ? b.x : 0, cz = b ? b.z + (BTYPES[b.type].d / 2 + 6) * Math.cos(b.yaw) * 1 : 56;
      const ang = Math.random() * 6.28, r = 6 + Math.random() * 22;
      let tx = clamp(cx + Math.cos(ang) * r * 1.6, -100, 118), tz = clamp(cz + Math.sin(ang) * r * 0.6, 20, 80);
      if (n.def.arch === 'reyes') { tx = -60 + Math.random() * 130; tz = 50 + Math.random() * 10; }
      if (n.def.arch === 'wren') { tx = -100 + Math.random() * 210; tz = 20 + Math.random() * 45; }
      return { x: tx, z: tz };
    }
    return { x: a.x, z: a.z };
  }

  /** Build a waypoint list that routes through doors. */
  plan(n, t) {
    const path = [];
    const here = this.buildingAt(n.x, n.z);
    const dest = t.bid ? this.b[t.bid] : null;
    if (here && (!dest || here.id !== dest.id)) { path.push(this.door(here, false)); path.push(this.door(here, true)); }
    if (dest && (!here || here.id !== dest.id)) { path.push(this.door(dest, true)); path.push(this.door(dest, false)); }
    path.push({ x: t.x, z: t.z });
    return path;
  }

  moveToward(n, tx, tz, speed, dt) {
    const dx = tx - n.x, dz = tz - n.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.55) return true;
    const want = Math.atan2(dx, dz);
    let chosen = null;
    for (const off of [0, 0.4, -0.4, 0.85, -0.85, 1.3, -1.3]) {
      const a = want + off;
      const px = n.x + Math.sin(a) * 0.9, pz = n.z + Math.cos(a) * 0.9;
      if (this.passable(n, px, pz)) { chosen = a; break; }
    }
    if (chosen == null) { n.stuck += dt; if (n.stuck > 2.5) { n.stuck = 0; n.path = []; n.target = null; n.nextThink = 0; } return false; }
    n.stuck = Math.max(0, n.stuck - dt);
    const dy = angleDiff(n.yaw, chosen);
    n.yaw += clamp(dy, -6 * dt, 6 * dt);
    const step = Math.min(d, speed * dt);
    const pos = { x: n.x + Math.sin(chosen) * step, z: n.z + Math.cos(chosen) * step };
    resolveXZ(this.game.col, pos, 0.36, n.y, n.y + PLAYER_H, 'surface');
    n.x = pos.x; n.z = pos.z;
    n.y = groundAt(this.game.col, this.game.terrain, n.x, n.z, n.y, 'surface');
    return false;
  }

  passable(n, x, z) {
    const t = this.game.terrain;
    const h = t.height(x, z);
    if (h < WATER_LEVEL - 0.55 || h < VOID_DEPTH * 0.4) return false;
    const gy = groundAt(this.game.col, t, x, z, n.y, 'surface');
    if (gy - n.y > 0.55) return false;
    const p = { x, z };
    const moved = resolveXZ(this.game.col, p, 0.36, n.y, n.y + PLAYER_H, 'surface');
    if (moved && Math.hypot(p.x - x, p.z - z) > 0.22) return false;
    return true;
  }

  faceToward(n, x, z, dt) {
    const want = Math.atan2(x - n.x, z - n.z);
    n.yaw += clamp(angleDiff(n.yaw, want), -4 * dt, 4 * dt);
  }

  // ---------- fear / danger ----------
  frighten(x, z, radius, strength, culprit) {
    const now = Date.now();
    for (const n of this.list.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > radius) continue;
      n.fear = clamp(n.fear + strength * (1 - d / radius) + 0.4, 0, 1);
      n.panicFrom = { x, z };
      n.panicUntil = now + 9000 + Math.random() * 7000;
      n.path = []; n.target = null;
      if (culprit) this.blame(n, culprit, -6 * strength);
      this.bark(n, 'scared');
    }
  }

  doPanic(n, dt, now) {
    n.state = 'panic'; n.mood = MOOD.scared;
    let tgt = null;
    if (!n.shelter || now > n.shelterUntil) {
      let best = null, bd = 26;
      for (const id in this.b) {
        const b = this.b[id];
        if (b.ruined || b.zone !== 'surface' || BTYPES[b.type].slab || !BTYPES[b.type].furn.length) continue;
        const d = Math.hypot(b.x - n.x, b.z - n.z);
        const away = n.panicFrom ? Math.hypot(b.x - n.panicFrom.x, b.z - n.panicFrom.z) : 100;
        if (d < bd && away > 12) { bd = d; best = b; }
      }
      n.shelter = best ? best.id : null; n.shelterUntil = now + 6000;
    }
    const here = this.buildingAt(n.x, n.z);
    if (n.shelter && this.usable(n.shelter)) {
      const b = this.b[n.shelter];
      if (here && here.id === b.id) { n.act = ACT.cower; return; }
      const dr = this.door(b, true);
      if (Math.hypot(dr.x - n.x, dr.z - n.z) > 1) tgt = dr; else tgt = this.door(b, false);
    } else if (n.panicFrom) {
      const dx = n.x - n.panicFrom.x, dz = n.z - n.panicFrom.z, d = Math.hypot(dx, dz) || 1;
      tgt = { x: n.x + (dx / d) * 12, z: n.z + (dz / d) * 12 };
    }
    if (tgt) { this.moveToward(n, tgt.x, tgt.z, 4.6, dt); n.act = ACT.run; } else n.act = ACT.cower;
    if (Math.hypot(n.x - (n.panicFrom?.x ?? 0), n.z - (n.panicFrom?.z ?? 0)) > 55 && !n.shelter) n.act = ACT.cower;
  }

  /** Something terrible happened here: mourn / gather. */
  grieve(x, z, radius, amount) {
    for (const n of this.list.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d > radius) continue;
      n.grief = clamp(n.grief + amount * (1 - d / radius * 0.5), 0, 1);
    }
  }

  mournAt(n, ms) { n.mournUntil = Date.now() + ms; }

  blame(n, who, delta) {
    if (!who || !who.pid) return;
    const o = n.opinion[who.pid] || (n.opinion[who.pid] = { v: 0, name: who.name, why: null });
    o.v = clamp(o.v + delta, -100, 100);
    o.name = who.name;
  }

  // ---------- speech ----------
  say(n, text, ms = 4200, gesture) {
    if (!text) return;
    n.speech = text;
    n.speechUntil = Date.now() + ms;
    this.game.emitNear('npc_say', { id: n.id, text, ms, mood: n.mood, name: n.def.name }, n.x, n.z, 70);
  }

  bark(n, kind) {
    const now = Date.now();
    if (now - n.lastBark < 3500) return;
    n.lastBark = now;
    this.say(n, pick(BARKS[kind] || BARKS.scared), 2600);
  }

  // ---------- knowledge ----------
  witness(kind, params, x, z, radius = 60) {
    const k = { id: `${kind}:${Date.now()}:${Math.floor(Math.random() * 999)}`, kind, params, ts: Date.now(), first: true };
    for (const n of this.list.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= radius) this.learn(n, { ...k });
    }
    return k;
  }

  broadcastKnowledge(kind, params) { // radio / word-of-mouth reaches the whole town
    const k = { id: `${kind}:${Date.now()}:${Math.floor(Math.random() * 999)}`, kind, params, ts: Date.now(), first: false };
    for (const n of this.list.values()) this.learn(n, { ...k });
  }

  learn(n, k) {
    if (n.knowledge.some((e) => e.id === k.id)) return false;
    n.knowledge.push(k);
    if (n.knowledge.length > 16) n.knowledge.shift();
    return true;
  }

  gossip(players, now) {
    const arr = [...this.list.values()];
    for (const a of arr) {
      if (now < a.panicUntil || a.act === ACT.sleep) continue;
      const near = arr.find((b) => b !== a && b.act !== ACT.sleep && Math.hypot(a.x - b.x, a.z - b.z) < 7);
      if (!near) continue;
      const item = a.knowledge.slice().reverse().find((k) => !near.knowledge.some((e) => e.id === k.id) && now - k.ts < 3600000 * 6);
      if (!item) continue;
      const pl = players.find((p) => p.zone === 'surface' && Math.hypot(p.x - a.x, p.z - a.z) < 28);
      this.learn(near, { ...item, first: false });
      if (pl && Math.random() < 0.8) this.say(a, this.newsLine(a, item), 6000);
    }
  }

  newsLine(n, k) {
    const arch = VOICES[n.def.arch] || VOICES.wren;
    const tpl = NEWS[k.kind];
    if (!tpl) return pick(arch.idle);
    const line = fill(pick(tpl), k.params || {});
    return `${pick(arch.openers)} ${line}`;
  }

  // ---------- talking ----------
  talk(n, session) {
    const arch = VOICES[n.def.arch] || VOICES.wren;
    const pid = session.pid;
    const op = n.opinion[pid] || (n.opinion[pid] = { v: 0, name: session.name });
    const c = (n.talks[pid] = (n.talks[pid] || 0) + 1);
    op.v = clamp(op.v + (op.v < 30 ? 2 : 0), -100, 100);
    n.talkUntil = Date.now() + 6500;
    const world = this.game.world.pub;
    let text, mood = MOOD.neutral;
    const told = (n.told[pid] = n.told[pid] || new Set());
    if (n.fear > 0.6) { text = pick(arch.fear); mood = MOOD.scared; }
    else if (op.v <= -25) { text = pick(arch.angry) + (op.why ? ` (${op.why})` : ''); mood = MOOD.angry; n.anger = 0.8; }
    else {
      const fresh = n.knowledge.slice().reverse().find((k) => !told.has(k.id) && Date.now() - k.ts < 3600000 * 12);
      const sequence = [];
      if (c === 1) sequence.push(() => pick(arch.greet));
      if (fresh) { told.add(fresh.id); sequence.push(() => this.newsLine(n, fresh)); }
      if (c >= 3 && op.v >= 4 && !world.portals.hatch1.found && Math.random() < 0.6) sequence.push(() => pick(arch.hint));
      if (world.portals.hatch1.found && Math.random() < 0.3) sequence.push(() => `${pick(arch.openers)} they say there's a city under us, found by ${world.portals.hatch1.by}. I always suspected.`);
      const tod = this.game.tod();
      if (world.weather.type === 'storm' && Math.random() < 0.4) sequence.push(() => pick(BARKS.storm));
      if ((tod > 22.5 || tod < 4) && Math.random() < 0.3) sequence.push(() => pick(BARKS.night));
      sequence.push(() => pick(arch.idle));
      text = sequence[0]();
      if (op.v > 20) mood = MOOD.happy;
    }
    return { text, mood };
  }

  /** A player hands the NPC something. */
  gift(n, session, propType) {
    const arch = VOICES[n.def.arch] || VOICES.wren;
    const op = n.opinion[session.pid] || (n.opinion[session.pid] = { v: 0, name: session.name });
    op.v = clamp(op.v + 12, -100, 100);
    n.talkUntil = Date.now() + 5000;
    n.fear = 0;
    return { text: pick(arch.thanks), mood: MOOD.happy };
  }

  // ---------- damage & death ----------
  damage(n, amt, cause, by) {
    if (!n.alive) return;
    n.hp -= amt;
    n.hitAt = Date.now();
    n.fear = 1; n.panicUntil = Date.now() + 8000;
    if (by) this.blame(n, by, -10);
    if (n.hp <= 0) this.game.killNpc(n, cause, by);
    else this.bark(n, 'hurt');
  }

  remove(n) {
    n.alive = false;
    this.list.delete(n.id);
    this.game.phys.kinRemove('n:' + n.id);
    const info = this.game.world.pub.npcInfo[n.id];
    if (info) { info.alive = false; this.game.world.set(`npcInfo.${n.id}.alive`, false); }
    this.game.world.priv.npcs[n.id] = { alive: false, def: n.def };
  }

  // ---------- snapshot ----------
  snapshot(n) {
    return [n.id, round(n.x), round(n.y), round(n.z), Math.round(n.yaw * 100) / 100, n.act, n.mood, n.gaze || 0, n.speech ? 1 : 0, n.state === 'panic' ? 1 : 0];
  }
}

function round(v) { return Math.round(v * 100) / 100; }
