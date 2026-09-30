// The Chronicle: the append-only history of the server. Every entry is timecoded in UTC so that
// streamers, viewers and forum posts can all point at the same second of the same world.
import fs from 'node:fs';
import path from 'node:path';
import { fmtClock } from '../shared/util.js';
import { DATA_DIR } from './state.js';

export class Chronicle {
  constructor(world) {
    this.world = world;
    this.recent = [];
    this.legends = [];
    this.file = path.join(DATA_DIR, 'chronicle.ndjson');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this._load();
  }

  _load() {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      const tail = lines.slice(-800);
      for (const l of tail) { try { const e = JSON.parse(l); if (e.amend) this._amend(e); else this.recent.push(e); } catch { /* skip */ } }
      this.recent = this.recent.slice(-600);
      this.legends = this.recent.filter((e) => e.legend >= 40).sort((a, b) => b.legend - a.legend).slice(0, 60);
    } catch { /* first boot */ }
  }

  _amend(a) {
    const e = this.recent.find((x) => x.id === a.id);
    if (e) e.legend = a.legend;
  }

  add({ kind, title, text, actors = [], pos = null, legend = 0, tags = [], now = Date.now() }) {
    const id = ++this.world.priv.chronCount;
    const e = { id, ts: now, clock: fmtClock(now), kind, title, text, actors, pos, legend, tags };
    this.recent.push(e);
    if (this.recent.length > 800) this.recent.shift();
    this._index(e);
    try { fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); } catch (err) { console.warn('[chronicle] write failed', err.message); }
    this.world.touch();
    return e;
  }

  _index(e) {
    if (e.legend < 40) return;
    const i = this.legends.findIndex((x) => x.id === e.id);
    if (i >= 0) this.legends.splice(i, 1);
    this.legends.push(e);
    this.legends.sort((a, b) => b.legend - a.legend);
    if (this.legends.length > 60) this.legends.length = 60;
  }

  boost(id, delta) {
    const e = this.recent.find((x) => x.id === id);
    if (!e) return null;
    e.legend += delta;
    this._index(e);
    try { fs.appendFileSync(this.file, JSON.stringify({ amend: true, id, legend: e.legend }) + '\n'); } catch { /* ignore */ }
    return e;
  }

  last(n = 60) { return this.recent.slice(-n); }
  top(n = 12) { return this.legends.slice(0, n); }
  find(id) { return this.recent.find((e) => e.id === id); }
}
