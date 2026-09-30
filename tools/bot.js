// Headless protocol client used by the self-test and by `npm run bots` to populate a dev server.
import { WebSocket } from 'ws';
import { Terrain } from '../shared/terrain.js';
import { Collision, buildingWorldBoxes, plankWorldBox, groundAt, resolveXZ } from '../shared/collide.js';

let sharedTerrain = null;
export class Bot {
  constructor(url, name, { token, streamer, role = 'player', code } = {}) {
    this.url = url; this.name = name; this.token = token; this.streamer = streamer; this.role = role; this.code = code;
    this.handlers = {}; this.msgs = []; this.world = null; this.pos = { x: 0, y: 0, z: 0 }; this.yaw = 0; this.pitch = 0; this.zone = 'surface'; this.an = 0;
    this.held = null; this.props = new Map();
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); return this; }
  waitFor(t, pred = () => true, ms = 8000) {
    return new Promise((res, rej) => {
      const found = this.msgs.find((m) => m.t === t && pred(m));
      if (found) return res(found);
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${t} (${this.name})`)), ms);
      const fn = (m) => { if (pred(m)) { clearTimeout(to); this.handlers[t] = this.handlers[t].filter((f) => f !== fn); res(m); } };
      this.on(t, fn);
    });
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url + (this.role === 'viewer' ? '?role=viewer' : ''));
      this.ws.on('open', () => {
        this.send(this.role === 'viewer' ? { t: 'hello', code: this.code, name: this.name } : { t: 'hello', name: this.name, token: this.token, streamer: this.streamer, title: 'bot stream' });
      });
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === 'welcome') this._welcome(m);
        else if (m.t === 'patch') this._patch(m.ops);
        else if (m.t === 'tp') { this.pos = { x: m.x, y: m.y, z: m.z }; this.zone = m.zone || this.zone; }
        else if (m.t === 'held') { if (m.id === this.id) this.held = m.prop; }
        if (m.t !== 'snap') this.msgs.push(m);
        if (this.msgs.length > 600) this.msgs.shift();
        for (const f of this.handlers[m.t] || []) f(m);
        if (m.t === 'welcome' || m.t === 'vwelcome') resolve(m);
        if (m.t === 'reject') reject(new Error(m.reason));
      });
      this.ws.on('error', reject);
    });
  }
  _welcome(m) {
    this.id = m.id; this.world = m.world; this.token = m.token; this.pos = { x: m.pos.x, y: m.pos.y, z: m.pos.z }; this.yaw = m.pos.yaw;
    this.terrain = sharedTerrain ||= new Terrain();
    this.terrain.applyMods(this.world.craters, this.world.erased);
    this.col = new Collision();
    for (const id in this.world.buildings) this.col.set(id, buildingWorldBoxes(this.world.buildings[id]));
    for (const id in this.world.planks) this.col.set(id, [plankWorldBox(this.world.planks[id])]);
    for (const p of m.props) this.props.set(p.id, p);
    this.loop = setInterval(() => this.sendState(), 66);
  }
  _patch(ops) {
    if (!this.world) return;
    for (const [p, v] of ops) {
      const parts = p.split('.'); let o = this.world;
      for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
      const k = parts[parts.length - 1];
      if (v === null) delete o[k]; else o[k] = v;
      if (parts[0] === 'buildings' && parts.length <= 2) { const b = this.world.buildings[parts[1]]; if (b) this.col.set(b.id, buildingWorldBoxes(b)); }
      if (parts[0] === 'buildings' && parts.length === 3) { const b = this.world.buildings[parts[1]]; if (b) this.col.set(b.id, buildingWorldBoxes(b)); }
    }
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  act(a, extra = {}) { this.send({ t: 'act', a, ...extra }); }
  sendState() { this.send({ t: 'st', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch, an: this.an, em: 0, tool: 0 }); }
  /** Walk in a straight line (with wall sliding) at speed m/s. Resolves when within 0.7m or after timeout. */
  walkTo(x, z, speed = 7, timeoutMs = 60000) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let last = Date.now();
      const iv = setInterval(() => {
        const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
        const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.7 || now - t0 > timeoutMs) { clearInterval(iv); this.an = 0; return resolve(d < 0.7); }
        this.yaw = Math.atan2(dx, dz);
        const step = Math.min(d, speed * dt);
        const p = { x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step };
        resolveXZ(this.col, p, 0.38, this.pos.y, this.pos.y + 1.8, this.zone);
        this.pos.x = p.x; this.pos.z = p.z;
        this.pos.y = groundAt(this.col, this.terrain, p.x, p.z, this.pos.y, this.zone);
        this.an = 2;
      }, 50);
    });
  }
  aimAt(x, y, z) {
    const o = [this.pos.x, this.pos.y + 1.6, this.pos.z];
    const d = [x - o[0], y - o[1], z - o[2]];
    this.yaw = Math.atan2(d[0], d[2]); this.pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    return { o, d };
  }
  close() { clearInterval(this.loop); try { this.ws.close(); } catch { /* */ } }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
