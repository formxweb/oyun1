// Remote players and NPCs: interpolated, animated, with name plates and speech bubbles.
import * as THREE from 'three';
import { Humanoid, nameSprite, speechSprite, hashColor, ACT } from './characters.js';
import { pushSample, sample, INTERP_MS } from './interp.js';

const HAIR = ['#2a1f1a', '#4b2f1a', '#7a3b2a', '#141414', '#c9a24a', '#8a8a8a', '#a34a2a'];
const SKIN = ['#f0cfb5', '#e2b799', '#c99a7c', '#b98a68', '#8a5b3c', '#6b4630'];
const STYLES = ['short', 'long', 'bun', 'wild', 'short'];

export function lookForName(name) {
  let h = 5381; for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0; h = Math.abs(h);
  const c = hashColor(name, 0.5, 0.42);
  const p = hashColor(name + 'x', 0.25, 0.22);
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 3) % HAIR.length], style: STYLES[(h >> 5) % STYLES.length], shirt: '#' + c.getHexString(), pants: '#' + p.getHexString(), hat: (h >> 7) % 4 === 0 ? 'cap' : 'none', glasses: (h >> 9) % 5 === 0, scale: 0.97 + ((h >> 11) % 8) / 100, build: 0.95 + ((h >> 13) % 10) / 100 };
}

export class Entities {
  constructor(scene, underGroup, world, hooks) {
    this.scene = scene; this.under = underGroup; this.world = world; this.hooks = hooks;
    this.players = new Map(); this.npcs = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
  }

  // ---------------------------------------------------------------- players
  addPlayer(info) {
    if (this.players.has(info.id)) this.removePlayer(info.id);
    const h = new Humanoid(lookForName(info.name));
    const g = new THREE.Group(); g.add(h.root);
    const tag = this.makeTag(info);
    g.add(tag);
    this.group.add(g);
    const e = { id: info.id, info, g, h, tag, held: null, lastPos: new THREE.Vector3(info.x, info.y, info.z), speed: 0, dead: false, under: false, emote: -1, emoteT: 0, bubble: null, bubbleT: 0, yaw: info.yaw || 0, buf: [] };
    g.position.set(info.x, info.y, info.z);
    this.players.set(info.id, e);
    return e;
  }
  makeTag(info) {
    const t = nameSprite(info.name, { color: info.live ? '#ffd3d8' : '#ffffff', title: info.title || '', live: info.live });
    t.position.y = 2.15; return t;
  }
  setLive(id, live) { const e = this.players.get(id); if (!e) return; e.info.live = live; e.g.remove(e.tag); e.tag = this.makeTag(e.info); e.g.add(e.tag); }
  removePlayer(id) { const e = this.players.get(id); if (!e) return; this.group.remove(e.g); this.players.delete(id); }

  chat(id, text) {
    const e = this.players.get(id);
    if (!e) return;
    if (e.bubble) e.g.remove(e.bubble);
    e.bubble = speechSprite(text); e.bubble.position.y = 2.75; e.g.add(e.bubble); e.bubbleT = Math.min(9, 3 + text.length * 0.07);
  }
  emote(id, e2) { const e = this.players.get(id); if (e) { e.emote = e2; e.emoteT = 2.8; } }

  // ---------------------------------------------------------------- npcs
  ensureNpc(id) {
    let e = this.npcs.get(id);
    if (e) return e;
    const info = this.world.npcInfo?.[id];
    if (!info) return null;
    const h = new Humanoid(info.look || {});
    const g = new THREE.Group(); g.add(h.root);
    const tag = nameSprite(info.name, { color: '#ffe9c0', sub: info.role }); tag.position.y = 2.1 * (info.look?.scale || 1) + 0.1; g.add(tag);
    this.group.add(g);
    e = { id, info, g, h, tag, buf: [], speech: null, speechT: 0, mood: 0, act: 0, speaking: false, gaze: 0, panic: false, speed: 0, last: new THREE.Vector3(), pitch: info.voice || 1 };
    this.npcs.set(id, e);
    return e;
  }
  removeNpc(id) { const e = this.npcs.get(id); if (!e) return; this.group.remove(e.g); this.npcs.delete(id); }
  say(id, text, ms) {
    const e = this.ensureNpc(id); if (!e) return;
    if (e.speech) e.g.remove(e.speech);
    e.speech = speechSprite(text); e.speech.position.y = 2.7 * (e.info.look?.scale || 1); e.g.add(e.speech); e.speechT = ms / 1000; e.talkT = ms / 1000;
  }

  onSnap(m) {
    const ts = m.ts;
    const seen = new Set();
    for (const p of m.p) {
      if (p[0] === this.hooks.localId()) continue;
      seen.add(p[0]);
      const e = this.players.get(p[0]);
      if (!e) continue;
      pushSample(e, ts, [p[1], p[2], p[3], p[4], p[5], p[6], p[8], p[9], p[10]]);
      e.held = p[7] || null;
    }
    for (const n of m.n) {
      const e = this.ensureNpc(n[0]); if (!e) continue;
      pushSample(e, ts, [n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8], n[9]]);
    }
    // NPCs that vanished from snapshots are dead
    const ids = new Set(m.n.map((n) => n[0]));
    for (const id of [...this.npcs.keys()]) if (!ids.has(id) && this.world.npcInfo?.[id]?.alive === false) this.removeNpc(id);
  }

  update(dt, serverNow, cam, localZone) {
    const rt = serverNow - INTERP_MS;
    const cp = cam.position;
    for (const e of this.players.values()) {
      const a = sample(e, rt, [3]);
      if (!a) continue;
      e.g.position.set(a[0], a[1], a[2]);
      const d = Math.hypot(a[0] - e.lastPos.x, a[2] - e.lastPos.z);
      e.lastPos.set(a[0], a[1], a[2]);
      e.speed += ((d / Math.max(dt, 0.001)) - e.speed) * Math.min(1, dt * 8);
      e.h.root.rotation.y = a[3];
      e.under = a[8] === 1;
      e.g.visible = (e.under ? 'under' : 'surface') === localZone && Math.hypot(a[0] - cp.x, a[2] - cp.z) < 180;
      if (!e.g.visible) continue;
      if (e.emoteT > 0) e.emoteT -= dt; else e.emote = -1;
      const an = a[5];
      e.h.update(dt, { speed: e.speed > 12 ? 0 : e.speed, act: 0, mood: e.dead ? 0 : 0, gaze: { yaw: 0, pitch: a[4] * 0.8 }, swim: an === 3, air: an === 4, carry: !!e.held, emote: e.emote, dead: a[7] === 1 });
      const dist = Math.hypot(a[0] - cp.x, a[2] - cp.z);
      e.tag.visible = dist < 45 && a[7] !== 1;
      e.tag.material.opacity = Math.max(0, Math.min(1, (45 - dist) / 15));
      if (e.bubble) { e.bubbleT -= dt; if (e.bubbleT <= 0) { e.g.remove(e.bubble); e.bubble = null; } }
    }
    for (const e of this.npcs.values()) {
      const a = sample(e, rt, [3]);
      if (!a) continue;
      e.g.position.set(a[0], a[1], a[2]);
      const d = Math.hypot(a[0] - e.last.x, a[2] - e.last.z);
      e.last.set(a[0], a[1], a[2]);
      e.speed += ((d / Math.max(dt, 0.001)) - e.speed) * Math.min(1, dt * 6);
      e.h.root.rotation.y = a[3];
      const dist = Math.hypot(a[0] - cp.x, a[2] - cp.z);
      e.g.visible = localZone === 'surface' && dist < 200;
      if (!e.g.visible) continue;
      e.mood = a[5]; e.act = a[4]; const gid = a[6]; e.panic = a[8] === 1;
      let gaze = null;
      if (gid) { const pos = this.hooks.playerPos(gid); if (pos) { const dx = pos.x - a[0], dz = pos.z - a[2]; let yaw = Math.atan2(dx, dz) - a[3]; while (yaw > Math.PI) yaw -= 6.283; while (yaw < -Math.PI) yaw += 6.283; gaze = { yaw, pitch: Math.atan2(pos.y + 1.5 - (a[1] + 1.6), Math.hypot(dx, dz)) }; } }
      if (e.talkT > 0) e.talkT -= dt;
      e.h.update(dt, { speed: e.speed, act: e.panic && e.speed > 2 ? 2 : e.act, mood: e.mood, gaze, speaking: e.talkT > 0 || a[7] === 1, dead: false });
      e.tag.visible = dist < 16; e.tag.material.opacity = Math.max(0, Math.min(1, (16 - dist) / 6));
      if (e.speech) { e.speechT -= dt; if (e.speechT <= 0) { e.g.remove(e.speech); e.speech = null; } }
    }
  }

  nearestNpc(pos, maxD = 4) {
    let best = null, bd = maxD;
    for (const e of this.npcs.values()) { const d = Math.hypot(e.g.position.x - pos.x, e.g.position.z - pos.z); if (d < bd && Math.abs(e.g.position.y - pos.y) < 3) { bd = d; best = e; } }
    return best;
  }
}
