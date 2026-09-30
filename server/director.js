// THE DIRECTOR. It never speaks in its own voice; it only ever stamps a timecode.
// It watches every signal the players emit, keeps a slowly-decaying model of the server's "mood",
// queues delayed consequences for individual actions, and picks events that *answer* what people did.
import { fmtClock, fmtDuration, clamp, mulberry32 } from '../shared/util.js';
import { BTYPES, SPAWN, LAKE, UNDER, ROADS } from '../shared/layout.js';
import { lakeD } from '../shared/terrain.js';
import { roadDist } from '../shared/scatter.js';
import { VOICES } from './npcdata.js';
import { pick, shuffle, listNames, ordinal } from './text.js';
import { CFG } from './config.js';

const SIG_TAU = 900; // seconds — decay time-constant for the mood model
const FAST = CFG.fast;
const MIN = FAST ? 1 : 60;          // "one minute" of director time
const LAKE_DELAY = FAST ? [25000, 50000] : [35 * 60000, 150 * 60000];

const ERAS = [
  { key: 'violence', names: ['The Age of Ash', 'The Breaking', 'The Red Weeks', 'The Reckoning'], desc: 'Explosions have become the server’s native language.' },
  { key: 'destruction', names: ['The Unbuilding', 'The Age of Rubble', 'The Long Demolition'], desc: 'Marrow Street is being edited out, one wall at a time.' },
  { key: 'offerings', names: ['The Drowned Age', 'The Lake Years', 'The Age of Offerings'], desc: 'Everything ends up in the water. The water has begun to answer.' },
  { key: 'discovery', names: ['The Descent', 'The Digging Days', 'The Age of Doors'], desc: 'Players have learned there is a below.' },
  { key: 'exploration', names: ['The Walking Years', 'The Age of Paths'], desc: 'The ground is learning where people want to go.' },
  { key: 'cooperation', names: ['The Building Days', 'The Kind Season', 'The Age of Planks'], desc: 'People are laying planks, writing signs, feeding strangers.' },
  { key: 'quiet', names: ['The Quiet Age', 'The Long Afternoon'], desc: 'Nothing much is happening. The server finds this suspicious.' },
];

export class Director {
  constructor(game) {
    this.g = game;
    const saved = game.world.priv.director;
    this.st = saved || {
      sig: { violence: 0, destruction: 0, offerings: 0, exploration: 0, chatter: 0, discovery: 0, cooperation: 0, danger: 0 },
      ledger: [], last: {}, nextAt: 0, deaths: [], bursts: [], milestones: {}, eraAt: 0, timeRestoreAt: 0, sinks: 0, statues: [], wantedAt: {}, gatherAt: 0, gatherSince: 0, pathCount: 0, djAt: 0, weatherAt: 0, quakeAt: 0, counts: { offerings: 0, explosions: 0 },
    };
    this.st.bursts ||= []; this.st.deaths ||= []; this.st.statues ||= [];
    this.rnd = mulberry32(Date.now() & 0xffff);
    this.pending = new Set();
    if (!this.st.nextAt) this.st.nextAt = Date.now() + (FAST ? 20000 : 6 * MIN * 1000);
    if (!this.st.weatherAt) this.st.weatherAt = Date.now() + 4 * MIN * 1000;
    this.events = this.buildEvents();
  }

  serialize() { return this.st; }
  get pub() { return this.g.world.pub; }
  get sig() { return this.st.sig; }

  // ------------------------------------------------------------------ telemetry
  note(kind, c = {}) {
    const S = this.sig, g = this.g;
    switch (kind) {
      case 'explosion':
        S.violence += 1.2 * c.power; S.danger += 0.6;
        if (c.by && c.kind === 'charge') this.st.bursts.push(Date.now());
        this.st.counts.explosions++;
        this.first('explode', c.by, { title: 'FIRST BLAST', text: `${c.by?.name} set off the first explosion in server history.`, legend: 55, ptitle: 'Firestarter' });
        this.recordSite(c.x, c.z, c.power);
        break;
      case 'destroy':
        S.destruction += c.value; S.violence += 2;
        this.first('demolish', c.by, { title: 'FIRST BUILDING LOST', text: `${c.by?.name} destroyed ${c.b.name} — the first building ever lost in Hollowmere.`, legend: 70, ptitle: 'Breaker' });
        this.checkWanted(c.by);
        this.milestone('destroyed', this.pub.stats.destroyed, [1, 5, 10, 25, 50], (n) => `${n} structures have fallen in Hollowmere.`, c.b);
        break;
      case 'npc_death': {
        S.violence += 4; S.danger += 3;
        this.first('npc_kill', c.by, { title: 'FIRST LIFE TAKEN', text: `${c.by?.name} took the first life in Hollowmere: ${c.npc.def.name}.`, legend: 90, ptitle: 'Reaper' });
        const arch = VOICES[c.npc.def.arch] || VOICES.wren;
        this.st.deaths.push({ name: c.npc.def.name, text: pick(arch.idle), npc: true, pitch: c.npc.def.voice, at: Date.now(), aired: false });
        break;
      }
      case 'death':
        S.danger += 2;
        this.first('death', c.s, { title: 'FIRST PLAYER DEATH', text: `${c.s.name} was the first player to die here.`, legend: 40, ptitle: 'First Ghost' });
        if (c.words) this.st.deaths.push({ name: c.s.name, text: c.words, npc: false, pitch: 0.9 + Math.random() * 0.5, at: Date.now(), aired: false });
        if (this.st.deaths.length > 40) this.st.deaths.shift();
        break;
      case 'plank':
        S.cooperation += 0.6;
        this.first('plank', c.s, { title: 'FIRST PATH', text: `${c.s.name} laid the first plank. Others will follow the path.`, legend: 40, ptitle: 'Pathmaker' });
        break;
      case 'sign':
        S.cooperation += 0.5;
        this.first('sign', c.s, { title: 'FIRST WORDS', text: `${c.s.name} left the first written message: "${c.sign.text}"`, legend: 35, ptitle: 'Scribe' });
        this.g.npcs.witness('sign', { place: this.g.district(c.sign.x, c.sign.z), text: c.sign.text }, c.sign.x, c.sign.z, 40);
        break;
      case 'gift':
        S.cooperation += 1.5;
        this.first('gift', c.s, { title: 'FIRST KINDNESS', text: `${c.s.name} gave ${c.npc.def.name} a gift — the first act of kindness recorded.`, legend: 45, ptitle: 'Kindly' });
        break;
      case 'discover': {
        S.discovery += 5;
        this.first('discover', c.s, { title: 'THE WAY DOWN', text: `${c.s.name} lifted the chapel rug and found a stairway into the dark.`, legend: 100, ptitle: 'Delver' });
        this.announce({ kind: 'discovery', title: 'THE FLOOR OPENS', text: `${c.s.name} found the way beneath Saint Anselm's.`, at: { x: c.portal.x, z: c.portal.z }, legend: 60, actors: [c.s.name], stream: this.g.streamOf(c.s) });
        this.g.npcs.broadcastKnowledge('discovery', { actor: c.s.name });
        break;
      }
      case 'descend': S.exploration += 1; break;
      case 'chat': S.chatter += 0.3; break;
      case 'throw': S.chatter += 0.05; break;
      case 'clip': S.cooperation += 0.2; break;
      default:
    }
    // per-player mood model: notoriety etc. drive personalised events
  }

  first(key, actor, { title, text, legend, ptitle }) {
    if (!actor || this.pub.firsts[key]) return false;
    this.g.patch(`firsts.${key}`, { by: actor.name, at: Date.now() });
    const rec = actor.pid ? this.g.world.priv.players[actor.pid] : null;
    if (rec && !rec.title && ptitle) { rec.title = ptitle; const s = this.g.playerByPid(actor.pid); if (s) this.g.send(s, { t: 'title', title: ptitle }); }
    const e = this.g.chron.add({ kind: 'first', title, text, actors: [actor.name], legend, tags: ['first', ...(actor.stream ? ['stream:' + actor.stream.name] : [])] });
    this.g.broadcastPlayers({ t: 'chron', e });
    this.g.broadcastPlayers({ t: 'legend', title, text, clock: e.clock, id: e.id });
    return true;
  }

  milestone(key, n, marks, textFn, at) {
    const done = (this.st.milestones[key] ||= []);
    for (const m of marks) {
      if (n >= m && !done.includes(m)) {
        done.push(m);
        if (m === 1) continue;
        const e = this.g.chron.add({ kind: 'milestone', title: key === 'destroyed' ? `${m} STRUCTURES LOST` : key === 'offerings' ? `${m} OFFERINGS TO THE LAKE` : `MILESTONE: ${m} ${key.toUpperCase()}`, text: textFn(m), pos: at ? { x: at.x, z: at.z } : null, legend: 30 + Math.min(40, m) });
        this.g.broadcastPlayers({ t: 'chron', e });
      }
    }
  }

  recordSite(x, z, power) {
    const sites = (this.st.sites ||= []);
    sites.push({ x, z, p: power, at: Date.now() });
    if (sites.length > 40) sites.shift();
  }

  // ------------------------------------------------------------------ the lake
  offering(by, prop, pos) {
    const g = this.g;
    const now = Date.now();
    const delay = LAKE_DELAY[0] + Math.random() * (LAKE_DELAY[1] - LAKE_DELAY[0]);
    const label = prop.type === 'gnome' ? 'the Gnome' : `a ${prop.T.label.toLowerCase()}`;
    this.st.ledger.push({ id: 'o' + now, pid: by.pid, name: by.name, type: prop.type, propId: prop.id, label, ts: now, x: pos.x, z: pos.z, due: now + delay, paid: false, stream: by.stream || null });
    if (this.st.ledger.length > 80) this.st.ledger.shift();
    this.sig.offerings += prop.type === 'gnome' ? 6 : 1;
    this.st.counts.offerings++;
    this.pub.stats.offerings++;
    g.patch('lake.offerings', this.pub.lake.offerings + 1);
    const rec = g.world.priv.players[by.pid];
    if (rec) rec.stats.offerings++;
    this.first('lake_offering', by, { title: 'THE LAKE ACCEPTS', text: `${by.name} gave ${label} to Lake Hollow — the first offering. The lake noticed.`, legend: 60, ptitle: 'Lakefeeder' });
    this.milestone('offerings', this.st.counts.offerings, [1, 10, 25, 100, 500], (n) => `The lake has been fed ${n} times.`, pos);
    if (prop.type === 'gnome') {
      const e = g.chron.add({ kind: 'gnome', title: 'THE GNOME IS DROWNED', text: `${by.name} threw the Gnome into Lake Hollow. It sank. The lake is listening.`, actors: [by.name], pos: { x: pos.x, z: pos.z }, legend: 75, tags: ['gnome', ...(by.stream ? ['stream:' + by.stream.name] : [])] });
      g.broadcastPlayers({ t: 'chron', e }); g.broadcastPlayers({ t: 'legend', title: e.title, text: e.text, clock: e.clock, id: e.id });
    }
    g.npcs.witness('offering', { actor: by.name, item: label }, pos.x, pos.z, 80);
  }

  // ------------------------------------------------------------------ joins
  onJoin(s, since, digest) {
    const g = this.g;
    // the billboard names newcomers *before* they arrive
    const ev = this.pub.boards.bb_main;
    const bb = this.pub.buildings.b_billboard;
    if (bb && !bb.ruined && s.rec.visits <= 1 && Math.random() < (FAST ? 1 : 0.45) && !this.st.prophecyLock) {
      const ago = (12 + Math.random() * 70) * 60000;
      const at = Date.now() - ago;
      g.patch('boards.bb_main', { id: 'bb_main', bid: 'b_billboard', text: s.name.toUpperCase(), sub: `EXPECTED · POSTED ${fmtClock(at)}`, by: null, at, kind: 'prophecy', pid: s.pid });
      const e = g.chron.add({ kind: 'prophecy', title: 'THE BILLBOARD KNEW', text: `The billboard on Eastgate Road bore the name ${s.name} ${fmtDuration(ago)} before ${s.name} connected. Nobody wrote it.`, actors: [s.name], pos: { x: bb.x, z: bb.z }, legend: 48, tags: ['prophecy', ...(s.stream ? ['stream:' + s.name] : [])] });
      g.broadcastPlayers({ t: 'chron', e });
      g.npcs.broadcastKnowledge('prophecy', { actor: s.name });
      this.st.prophecyLock = true; setTimeout(() => { this.st.prophecyLock = false; }, 4 * MIN * 1000);
    }
    this.sig.exploration += 0.5;
  }

  // ------------------------------------------------------------------ the loop
  tick(now, dt, players) {
    const S = this.sig;
    const k = Math.exp(-dt / SIG_TAU);
    for (const key in S) S[key] *= k;
    this.st.bursts = this.st.bursts.filter((t) => now - t < 90000);
    if (this.st.timeRestoreAt && now > this.st.timeRestoreAt) this.restoreTime();
    // weather
    this.updateWeather(now, players);
    // lake consequence queue: due offerings pay out, regardless of the event schedule
    this.serveLedger(now, players);
    if (players.length === 0) return;
    // reactive rules
    this.reactive(now, players);
    // the radio never stops
    if (now > (this.st.djAt || 0)) { this.st.djAt = now + (FAST ? 40000 : (2.5 + Math.random() * 3) * MIN * 1000); this.djBroadcast(players); }
    // eras
    if (now > this.st.eraAt) { this.st.eraAt = now + (FAST ? 40000 : 5 * MIN * 1000); this.updateEra(now); }
    // scheduled event
    if (now >= this.st.nextAt) {
      const activity = clamp(0.4 + S.violence * 0.06 + S.chatter * 0.05 + S.exploration * 0.04 + players.length * 0.18, 0.3, 3);
      const base = (FAST ? 45 : 9 * MIN) * (1 / activity);
      this.st.nextAt = now + base * 1000 * (0.7 + Math.random() * 0.7);
      this.pickEvent(now, players);
    }
    // desire paths: notice when the ground learns a route
    if (Math.random() < 0.02) this.notePaths();
  }

  serveLedger(now, players) {
    if (!players.length) return;
    const due = this.st.ledger.find((o) => !o.paid && o.due <= now);
    if (due && now - (this.st.last.lake_returns || 0) > (FAST ? 15000 : 4 * MIN * 1000)) {
      due.paid = true;
      this.runEvent(this.events.find((e) => e.kind === 'lake_returns'), { players, now, due });
    }
  }

  pickEvent(now, players) {
    const ctx = this.context(now, players);
    const scored = [];
    for (const ev of this.events) {
      if (ev.kind === 'lake_returns') continue;
      const cd = ev.cooldown ?? 10 * MIN * 1000;
      if (now - (this.st.last[ev.kind] || 0) < cd) continue;
      let w = 0;
      try { w = ev.weight(ctx); } catch (e) { console.warn('[director] weight', ev.kind, e.message); }
      if (w > 0) scored.push([ev, w * (0.75 + Math.random() * 0.5)]);
    }
    if (!scored.length) return;
    scored.sort((a, b) => b[1] - a[1]);
    // weighted random among the top few — the Director is opinionated but not predictable
    const top = scored.slice(0, 4);
    const total = top.reduce((a, b) => a + b[1], 0);
    let r = Math.random() * total, chosen = top[0][0];
    for (const [ev, w] of top) { r -= w; if (r <= 0) { chosen = ev; break; } }
    this.runEvent(chosen, ctx);
  }

  runEvent(ev, ctx) {
    if (!ev) return false;
    let ok = false;
    try { ok = ev.run(ctx) !== false; } catch (e) { console.error('[director] event failed', ev.kind, e); }
    if (ok) { this.st.last[ev.kind] = Date.now(); this.pub.stats.events++; this.g.world.touch(); }
    return ok;
  }

  context(now, players) {
    const g = this.g;
    const b = this.pub.buildings;
    const intact = Object.values(b).filter((x) => x.zone === 'surface' && !x.ruined);
    return {
      now, players, S: this.sig, tod: g.tod(), intact,
      hollow: intact.filter((x) => !BTYPES[x.type].slab && !BTYPES[x.type].billboard && !BTYPES[x.type].watertower && x.id !== 'b_chapel'),
      npcs: g.npcs.list.size, found: this.pub.portals.hatch1.found, ledgerDue: this.st.ledger.filter((o) => !o.paid).length,
      deaths: this.st.deaths.filter((d) => !d.aired), live: players.filter((p) => !p.dead),
    };
  }

  // ------------------------------------------------------------------ announcement
  announce({ kind, title, text, at = null, lead = 0, legend = 20, actors = [], fx = 'glitch', tags = [], stream = null }) {
    const g = this.g;
    const e = g.chron.add({ kind: 'event:' + kind, title, text, actors, pos: at, legend, tags: ['server-event', ...tags, ...(stream ? ['stream:' + stream.name] : [])] });
    g.broadcastPlayers({ t: 'sevent', id: e.id, clock: e.clock, title, text, lead, at, fx, kind });
    g.npcs.broadcastKnowledge('event', { title });
    return e;
  }

  later(ms, fn) { const t = setTimeout(() => { this.pending.delete(t); try { fn(); } catch (e) { console.error('[director] later', e); } }, ms); this.pending.add(t); }

  // ------------------------------------------------------------------ reactive rules
  reactive(now, players) {
    const g = this.g;
    // 1. blast spam → the server closes its hand
    if (this.st.bursts.length >= 6 && now - (this.st.last.disapprove || 0) > 6 * MIN * 1000) {
      this.st.last.disapprove = now;
      g.chargesLockUntil = now + (FAST ? 25000 : 80000);
      this.announce({ kind: 'disapprove', title: 'THE SERVER CLOSES ITS HAND', text: 'Too much fire, too fast. Charges are dead for a while. The ground will remember what you did.', legend: 35, fx: 'shake' });
      g.broadcastPlayers({ t: 'ev', k: 'quake', s: 0.6 });
      this.st.bursts = [];
    }
    // 2. crowds get noticed
    const live = players.filter((p) => !p.dead && p.zone === 'surface');
    if (live.length >= 3 && now - (this.st.last.gathering || 0) > 12 * MIN * 1000) {
      let cx = 0, cz = 0; for (const p of live) { cx += p.x; cz += p.z; } cx /= live.length; cz /= live.length;
      const inside = live.filter((p) => Math.hypot(p.x - cx, p.z - cz) < 22);
      if (inside.length >= 3) {
        this.st.gatherSince ||= now;
        if (now - this.st.gatherSince > (FAST ? 12000 : 50000)) {
          this.st.last.gathering = now; this.st.gatherSince = 0;
          const names = inside.map((p) => p.name);
          const y = g.terrain.height(cx, cz);
          for (let i = 0; i < 5; i++) g.spawnProp(i === 4 ? 'lantern' : 'crate', cx + (Math.random() - 0.5) * 6, y + 9 + i, cz + (Math.random() - 0.5) * 6, {}, { persist: true });
          g.spawnProp('relic', cx, y + 12, cz, { origin: 'A gift for a crowd', kind: 'gathering' });
          this.announce({ kind: 'gathering', title: 'THE SERVER NOTICES YOU ALL', text: `${listNames(names)} stood together long enough to be seen. Something fell from the sky for them.`, at: { x: cx, z: cz }, legend: 38, actors: names, fx: 'glow' });
        }
      } else this.st.gatherSince = 0;
    } else this.st.gatherSince = 0;
  }

  checkWanted(by) {
    if (!by?.pid) return;
    const g = this.g;
    const rec = g.world.priv.players[by.pid];
    if (!rec) return;
    const now = Date.now();
    const last = this.st.wantedAt[by.pid] || 0;
    if (rec.stats.destroyed >= 3 && now - last > 10 * MIN * 1000 && this.pub.buildings.b_constab && !this.pub.buildings.b_constab.ruined) {
      this.st.wantedAt[by.pid] = now;
      g.patch('boards.bd_wanted', { id: 'bd_wanted', bid: 'b_constab', text: `WANTED: ${by.name.toUpperCase()}`, sub: `${rec.stats.destroyed} STRUCTURES · LAST SEEN NEAR ${g.district(g.playerByPid(by.pid)?.x ?? 0, g.playerByPid(by.pid)?.z ?? 55).toUpperCase()}`, by: 'Sheriff Reyes', at: now, kind: 'wanted', pid: by.pid });
      rec.title = rec.title === 'Breaker' || !rec.title ? 'Menace of Marrow Street' : rec.title;
      const s = g.playerByPid(by.pid); if (s) g.send(s, { t: 'title', title: rec.title });
      const e = g.chron.add({ kind: 'wanted', title: 'A WANTED POSTER GOES UP', text: `Sheriff Reyes has posted a notice: ${by.name} is wanted for the destruction of ${rec.stats.destroyed} buildings.`, actors: [by.name], legend: 28, tags: ['wanted', ...(by.stream ? ['stream:' + by.stream.name] : [])] });
      g.broadcastPlayers({ t: 'chron', e });
    }
  }

  // ------------------------------------------------------------------ weather / time
  updateWeather(now, players) {
    const w = this.pub.weather, g = this.g;
    if (w.type === 'storm' && players.length && Math.random() < 0.16) {
      const p = pick(players), a = Math.random() * 6.28, r = 40 + Math.random() * 210;
      g.emitNear('lightning', { bx: p.x + Math.cos(a) * r, bz: p.z + Math.sin(a) * r }, p.x, p.z, 900, p.zone);
    }
    if (w.until && now > w.until) { w.until = 0; this.setWeather(pick(['clear', 'cloudy', 'clear', 'fog']), 0.25 + Math.random() * 0.3, 0); }
    if (now < this.st.weatherAt) return;
    this.st.weatherAt = now + (FAST ? 90000 : (5 + Math.random() * 7) * MIN * 1000);
    if (w.until && now < w.until) return;
    const table = { clear: [['clear', 0.3], ['cloudy', 0.5], ['fog', 0.1], ['rain', 0.1]], cloudy: [['clear', 0.3], ['cloudy', 0.2], ['rain', 0.35], ['fog', 0.15]], fog: [['clear', 0.4], ['cloudy', 0.4], ['rain', 0.2]], rain: [['cloudy', 0.4], ['storm', 0.2], ['clear', 0.25], ['rain', 0.15]], storm: [['rain', 0.55], ['cloudy', 0.45]] };
    const opts = table[w.type] || table.clear;
    let r = Math.random(), next = opts[0][0];
    for (const [t, p] of opts) { r -= p; if (r <= 0) { next = t; break; } }
    const i = next === 'clear' ? 0.1 + Math.random() * 0.2 : next === 'cloudy' ? 0.4 + Math.random() * 0.3 : next === 'fog' ? 0.5 + Math.random() * 0.4 : next === 'rain' ? 0.4 + Math.random() * 0.4 : 0.85;
    this.setWeather(next, i, 0);
  }

  setWeather(type, i, untilMs) {
    const w = this.pub.weather;
    const a = Math.random() * 6.28;
    this.g.patch('weather', { type, i: Math.round(i * 100) / 100, wx: Math.round(Math.cos(a) * 100) / 100, wz: Math.round(Math.sin(a) * 100) / 100, until: untilMs ? Date.now() + untilMs : 0 });
  }

  restoreTime() {
    this.st.timeRestoreAt = 0;
    const g = this.g;
    g.world.setClock(g.tod(), 24 / (Number(process.env.DAY_MINUTES || 32) * 60));
  }

  // ------------------------------------------------------------------ era
  updateEra(now) {
    const S = this.sig, pub = this.pub, g = this.g;
    const scores = { violence: S.violence / 6, destruction: S.destruction / 6, offerings: S.offerings / 5, discovery: S.discovery / 3, exploration: S.exploration / 6, cooperation: S.cooperation / 6, quiet: 0.35 };
    if (pub.portals.hatch1.found) scores.discovery += 0.25;
    let best = 'quiet', bv = 0;
    for (const k in scores) if (scores[k] > bv) { bv = scores[k]; best = k; }
    const era = ERAS.find((e) => e.key === best) || ERAS[ERAS.length - 1];
    if (pub.era.key === best || now - pub.era.since < (FAST ? 60000 : 25 * MIN * 1000)) return;
    const name = pick(era.names);
    if (name === pub.era.name) return;
    g.patch('era', { name, key: best, desc: era.desc, since: now });
    const e = g.chron.add({ kind: 'era', title: `A NEW AGE: ${name.toUpperCase()}`, text: era.desc, legend: 45 });
    g.broadcastPlayers({ t: 'chron', e });
    g.broadcastPlayers({ t: 'era', era: pub.era, clock: e.clock });
  }

  notePaths() {
    const w = this.g.world.wear;
    let n = 0, mx = 0, mi = -1;
    for (let i = 0; i < w.length; i++) if (w[i] > 70) { n++; if (w[i] > mx) { mx = w[i]; mi = i; } }
    if (n >= this.st.pathCount + 40) {
      this.st.pathCount = n;
      const x = (mi % 160) * 4 - 320 + 2, z = Math.floor(mi / 160) * 4 - 320 + 2;
      const e = this.g.chron.add({ kind: 'path', title: 'THE GROUND IS LEARNING', text: `Footsteps have worn a route into the earth near ${this.g.district(x, z)}. The world is beginning to remember where people go.`, pos: { x, z }, legend: 12 });
      this.g.broadcastPlayers({ t: 'chron', e });
    }
  }

  // ------------------------------------------------------------------ radio
  djBroadcast(players) {
    const g = this.g;
    const dj = g.npcs.list.get('n_nova');
    const st = this.pub.buildings.b_radio;
    const recent = g.chron.recent.filter((e) => Date.now() - e.ts < 40 * MIN * 1000 && e.legend >= 15 && e.kind !== 'reboot').slice(-4);
    if (!st || st.ruined) {
      if (Math.random() < 0.3) g.radio({ from: '— — —', text: 'static… static… the tower is down… somebody is still transmitting…', dead: false, pitch: 0.7, static: true });
      return;
    }
    const from = dj ? 'KRNX 1370 · Nova Kell' : 'KRNX 1370 · automated';
    let text;
    if (recent.length) {
      const e = pick(recent);
      text = dj ? `${pick(['Listeners,', 'Signal check —', 'Overnight news —'])} ${e.title.toLowerCase()}. ${e.text}` : `Automated bulletin: ${e.title}. ${e.text}`;
    } else text = dj ? pick(VOICES.nova.idle) : 'This is a recording. There is nobody at the station.';
    g.radio({ from, text, dead: false, pitch: dj ? 1.2 : 0.7 });
  }

  // ------------------------------------------------------------------ helpers for events
  findSpot(pred, tries = 60) {
    const g = this.g;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 200;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (pred(x, z, g.terrain.height(x, z))) return { x, z };
    }
    return null;
  }
  farFromBuildings(x, z, d) { for (const b of Object.values(this.pub.buildings)) if (b.zone === 'surface' && Math.hypot(b.x - x, b.z - z) < d) return false; return true; }
  farFromPlayers(x, z, d) { return this.g.players().every((p) => p.zone !== 'surface' || Math.hypot(p.x - x, p.z - z) > d); }

  // ------------------------------------------------------------------ THE EVENT LIBRARY
  buildEvents() {
    const D = this, g = this.g, M = MIN * 1000;
    const nameOf = (s) => (s ? s.name : 'someone');
    return [
      {
        kind: 'building_moves', cooldown: 14 * M,
        weight: (c) => (c.hollow.length > 4 ? 1.0 + c.S.exploration * 0.1 + c.S.destruction * 0.06 : 0),
        run(c) {
          const b = pick(c.hollow.filter((h) => !g.moving?.has(h.id)));
          if (!b) return false;
          const T = BTYPES[b.type];
          const mode = pick(['street', 'shore', 'wood', 'street', 'hilltop']);
          const spot = D.findSpot((x, z, h) => {
            if (h < 1.5 || lakeD(x, z) < 1.35 || g.terrain.slope(x, z) > 0.28) return false;
            if (!D.farFromBuildings(x, z, 15) || !D.farFromPlayers(x, z, 14)) return false;
            if (Math.hypot(x - b.x, z - b.z) < 40) return false;
            const rd = roadDist(x, z);
            if (mode === 'street') return Math.abs(z - 55) < 14 && x > -95 && x < 105 && !(rd.d < 6);
            if (mode === 'shore') return lakeD(x, z) < 1.6 && z > -140;
            if (mode === 'hilltop') return h > 14 && h < 40;
            return Math.hypot(x, z) > 90 && Math.hypot(x, z) < 200 && rd.d > 12;
          }, 200);
          if (!spot) return false;
          const where = g.district(spot.x, spot.z), from = g.district(b.x, b.z);
          const dist = Math.round(Math.hypot(spot.x - b.x, spot.z - b.z));
          const e = D.announce({ kind: 'building_moves', title: 'A BUILDING MOVES', text: `${b.name} is leaving ${from}. In a few seconds it will stand ${dist} metres away, in ${where === from ? 'another corner of ' + where : where}.`, at: { x: b.x, z: b.z }, lead: 7000, legend: 55, fx: 'glitch' });
          D.later(7000, () => { g.moveBuildingTo(b.id, spot.x, spot.z, 14000); g.npcs.broadcastKnowledge('moved', { building: b.name }); });
          return true;
        },
      },
      {
        kind: 'sky_change', cooldown: 12 * M,
        weight: (c) => 0.8 + (c.tod > 19 || c.tod < 5 ? 0.6 : 0),
        run(c) {
          const sky = D.pub.sky;
          const opts = [];
          if ((sky.moons || 1) < 3) opts.push('moon');
          opts.push('aurora', 'eclipse', 'red', 'constellation');
          const top = g.players().length ? [...Object.entries(g.world.priv.players)].sort((a, b) => (b[1].notoriety + b[1].stats.offerings * 2) - (a[1].notoriety + a[1].stats.offerings * 2))[0] : null;
          const pv = pick(opts);
          if (pv === 'moon') { g.patch('sky.moons', (sky.moons || 1) + 1); D.announce({ kind: 'sky', title: 'THE SKY GAINS A MOON', text: `Count them tonight. There are now ${(sky.moons || 1) + 1}.`, legend: 50, fx: 'glitch' }); }
          else if (pv === 'aurora') { g.patch('sky.aurora', Date.now() + 25 * M); D.announce({ kind: 'sky', title: 'THE SKY BLEEDS COLOUR', text: 'Green fire over the valley. It will not last. Nothing here does.', legend: 30, fx: 'glow' }); }
          else if (pv === 'eclipse') { g.patch('sky.eclipseUntil', Date.now() + 4 * M); D.announce({ kind: 'sky', title: 'THE SUN IS SWITCHED OFF', text: 'Four minutes. Nobody has confirmed it will come back on.', lead: 4000, legend: 45, fx: 'darken' }); }
          else if (pv === 'red') { g.patch('sky.redUntil', Date.now() + 7 * M); D.announce({ kind: 'sky', title: 'THE SKY TURNS RED', text: 'Whatever colour it was, it is not that any more.', legend: 35, fx: 'glitch' }); }
          else {
            const nm = (top ? top[1].name : 'HOLLOWMERE').toUpperCase();
            g.patch('sky.constellation', { text: nm, until: Date.now() + 40 * M });
            D.announce({ kind: 'sky', title: 'THE STARS SPELL A NAME', text: `Look up after dark. The constellation reads: ${nm}.`, legend: 55, actors: top ? [top[1].name] : [], fx: 'glow' });
          }
          return true;
        },
      },
      {
        kind: 'area_vanish', cooldown: 25 * M,
        weight: (c) => (c.players.length ? 0.35 + c.S.exploration * 0.05 + c.S.violence * 0.04 : 0) * (Object.keys(D.pub.erased).length < 6 ? 1 : 0),
        run(c) {
          const r = 16 + Math.random() * 14;
          const spot = D.findSpot((x, z, h) => h > 2 && lakeD(x, z) > 1.7 && D.farFromBuildings(x, z, r + 30) && D.farFromPlayers(x, z, r + 30) && roadDist(x, z).d > r + 6 && Math.hypot(x, z) < 230 && Object.values(D.pub.erased).every((e) => Math.hypot(e.x - x, e.z - z) > e.r + r + 20), 250);
          if (!spot) return false;
          const where = g.district(spot.x, spot.z);
          const n = Object.keys(D.pub.erased).length + 1;
          D.announce({ kind: 'vanish', title: 'AN AREA DISAPPEARS', text: `${Math.round(r * 2)} metres of ${where} are being un-made. Do not be standing there.`, at: spot, lead: 9000, legend: 65, fx: 'glitch' });
          D.later(9000, () => {
            g.eraseArea(spot.x, spot.z, r);
            const id = 'pl_null' + n;
            g.patch(`places.${id}`, { x: spot.x, z: spot.z, name: `The Null ${['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1] || n}`, by: 'the server', at: Date.now() });
            g.npcs.broadcastKnowledge('vanish', { place: where });
            g.broadcastPlayers({ t: 'ev', k: 'quake', s: 0.5 });
          });
          return true;
        },
      },
      {
        kind: 'prophecy', cooldown: 18 * M,
        weight: (c) => (c.live.length && D.pub.buildings.b_billboard && !D.pub.buildings.b_billboard.ruined ? 0.7 : 0),
        run(c) {
          const bb = D.pub.buildings.b_billboard;
          const far = c.live.filter((p) => p.zone === 'surface' && Math.hypot(p.x - bb.x, p.z - bb.z) > 70);
          const p = pick(far.length ? far : c.live);
          const dist = Math.hypot(p.x - bb.x, p.z - bb.z);
          const eta = Date.now() + (dist / 4.6) * 1000 + 12000;
          g.patch('boards.bb_main', { id: 'bb_main', bid: 'b_billboard', text: p.name.toUpperCase(), sub: `ARRIVING ${fmtClock(eta)}`, by: null, at: Date.now(), kind: 'prophecy', pid: p.pid, eta });
          D.st.prophecy = { pid: p.pid, name: p.name, eta, fulfilled: false, stream: g.streamOf(p) };
          D.announce({ kind: 'prophecy', title: 'THE BILLBOARD CHANGES', text: `A name appeared on the Eastgate billboard: ${p.name}. Arrival time: ${fmtClock(eta)}.`, at: { x: bb.x, z: bb.z }, legend: 44, actors: [p.name], stream: g.streamOf(p) });
          return true;
        },
      },
      {
        kind: 'dead_radio', cooldown: 10 * M,
        weight: (c) => (c.deaths.length ? 1.4 + c.deaths.length * 0.2 : 0),
        run(c) {
          const d = pick(c.deaths);
          d.aired = true;
          D.announce({ kind: 'dead_radio', title: 'A DEAD VOICE ON THE RADIO', text: `${d.name}${d.npc ? '' : ' (deceased)'} is transmitting: "${d.text}"`, legend: 58, actors: [d.name], fx: 'static', lead: 2000 });
          D.later(2500, () => g.radio({ from: `${d.name} ✝`, text: d.text, dead: true, pitch: d.pitch || 1 }));
          return true;
        },
      },
      {
        kind: 'lake_returns', cooldown: 0, weight: () => 0,
        run(c) {
          const o = c.due;
          const now = Date.now();
          const lake = D.pub.lake;
          const ago = fmtDuration(now - o.ts);
          const sx = LAKE.x + Math.cos(Math.atan2(o.z - LAKE.z, o.x - LAKE.x)) * LAKE.r * 1.02, sz = LAKE.z + Math.sin(Math.atan2(o.z - LAKE.z, o.x - LAKE.x)) * LAKE.r * 1.02;
          const hue = (lake.hue + 0.12 + Math.random() * 0.1) % 1;
          const glow = clamp(lake.glow + 0.14, 0, 1);
          const lvl = clamp(lake.level + (Math.random() < 0.5 ? 0.25 : -0.2) * (0.5 + Math.random()), -1.2, 1.5);
          const gnome = o.type === 'gnome' ? [...g.phys.props.values()].find((p) => p.type === 'gnome') : null;
          const title = gnome ? 'THE LAKE RETURNS THE GNOME' : 'THE LAKE REMEMBERS';
          const text = gnome ? `${o.name} drowned Sir Gnomeo ${ago} ago. The lake has spat him back, gilded, and changed its colour in payment.` : `${o.name} gave ${o.label} to the lake ${ago} ago. The water has changed because of it — and returned something.`;
          D.announce({ kind: 'lake', title, text, at: { x: o.x, z: o.z }, legend: gnome ? 90 : 70, actors: [o.name], fx: 'glow', stream: o.stream, lead: 3000 });
          D.later(3000, () => {
            g.patch('lake', { ...D.pub.lake, hue: Math.round(hue * 100) / 100, glow: Math.round(glow * 100) / 100, level: Math.round(lvl * 100) / 100, returns: (lake.returns || 0) + 1 });
            const y = g.terrain.height(sx, sz) + 1.2;
            if (gnome) { gnome.meta = { ...gnome.meta, gilded: true, lastBy: o.name }; g.phys.props.get(gnome.id).body.setTranslation({ x: sx, y: y + 1, z: sz }, true); g.broadcastPlayers({ t: 'prop-', id: gnome.id }); g.broadcastPlayers({ t: 'prop+', p: g.propMsg(gnome) }); }
            else g.spawnProp('relic', sx, y, sz, { origin: `${o.label} from ${o.name}`, by: o.name, at: now, kind: 'lake' });
            g.broadcastPlayers({ t: 'ev', k: 'lakepulse', x: sx, z: sz });
            g.npcs.broadcastKnowledge('event', { title });
          });
          return true;
        },
      },
      {
        kind: 'blackout', cooldown: 16 * M,
        weight: (c) => (c.tod > 17 || c.tod < 6 ? 0.9 : 0.25) + c.S.danger * 0.05,
        run(c) {
          const dur = (FAST ? 40 : 100 + Math.random() * 140) * 1000;
          D.announce({ kind: 'blackout', title: 'THE LIGHTS GO OUT', text: 'Every window on Marrow Street is dark. Nobody threw a switch.', legend: 32, fx: 'darken', lead: 2000 });
          D.later(2000, () => { g.patch('lights.blackoutUntil', Date.now() + dur); g.npcs.frighten(0, 55, 120, 0.3, null); });
          return true;
        },
      },
      {
        kind: 'weather_anomaly', cooldown: 15 * M,
        weight: (c) => 0.7 + c.S.violence * 0.05,
        run() {
          const kind = pick(['storm', 'fog', 'storm']);
          const dur = (kind === 'storm' ? 6 : 8) * MIN * 1000;
          if (kind === 'storm') { D.setWeather('storm', 0.95, dur); D.announce({ kind: 'weather', title: 'A STORM WITHOUT A FRONT', text: 'The barometer did not move. The sky did.', legend: 28, fx: 'darken', lead: 1500 }); }
          else { D.setWeather('fog', 0.98, dur); D.announce({ kind: 'weather', title: 'THE FOG COMES IN', text: 'Visibility: nine metres. Everything past that is a rumour.', legend: 26, fx: 'glow', lead: 1500 }); }
          return true;
        },
      },
      {
        kind: 'meteors', cooldown: 30 * M,
        weight: (c) => (c.players.length ? 0.55 + c.S.discovery * 0.05 : 0),
        run(c) {
          const anchor = pick(c.live.length ? c.live : c.players);
          const n = 5 + Math.floor(Math.random() * 4);
          D.announce({ kind: 'meteors', title: 'THE SKY FALLS', text: `${n} objects are coming down over ${g.district(anchor.x, anchor.z)}. They are not on any chart.`, at: { x: anchor.x, z: anchor.z }, lead: 10000, legend: 60, fx: 'shake' });
          for (let i = 0; i < n; i++) {
            D.later(10000 + i * (2000 + Math.random() * 2500), () => {
              const spot = D.findSpot((x, z, h) => h > 1.6 && lakeD(x, z) > 1.3 && D.farFromBuildings(x, z, 18) && D.farFromPlayers(x, z, 28) && Math.hypot(x - anchor.x, z - anchor.z) < 150 && Math.hypot(x - anchor.x, z - anchor.z) > 30, 100);
              if (!spot) return;
              g.emitNear('meteor', { id: i }, spot.x, spot.z, 500);
              g.explode({ x: spot.x, y: g.terrain.height(spot.x, spot.z), z: spot.z, radius: 12, power: 0.5, by: null, kind: 'meteor' });
              g.addCrater(spot.x, spot.z, 5 + Math.random() * 3, 2 + Math.random() * 1.5, null);
              if (Math.random() < 0.55) g.spawnProp('relic', spot.x, g.terrain.height(spot.x, spot.z) + 1, spot.z, { origin: 'Fell from the sky', kind: 'meteorite' });
            });
          }
          return true;
        },
      },
      {
        kind: 'earthquake', cooldown: 20 * M,
        weight: (c) => 0.35 + c.S.destruction * 0.12 + c.S.violence * 0.05,
        run(c) {
          D.announce({ kind: 'quake', title: 'THE GROUND SHIVERS', text: 'Weak walls fall first. The server is checking which ones are weak.', legend: 42, fx: 'shake', lead: 3000 });
          D.later(3000, () => {
            g.broadcastPlayers({ t: 'ev', k: 'quake', s: 1 });
            for (const b of Object.values(D.pub.buildings)) {
              if (b.zone !== 'surface' || b.ruined || BTYPES[b.type].slab || b.type === 'billboard') continue;
              const T = BTYPES[b.type];
              g.damageBuilding(b, T.hp * (0.08 + Math.random() * (b.hp < T.hp * 0.7 ? 0.5 : 0.18)), null, 'quake');
            }
            for (const p of g.phys.props.values()) p.body.applyImpulse({ x: (Math.random() - 0.5) * p.mass * 2, y: p.mass * (2 + Math.random() * 3), z: (Math.random() - 0.5) * p.mass * 2 }, true);
          });
          return true;
        },
      },
      {
        kind: 'sinkhole', cooldown: 25 * M,
        weight: (c) => ((D.st.sinks || 0) < 3 ? 0.2 + c.S.destruction * 0.1 + (c.found ? 0.4 : 0) : 0),
        run(c) {
          const sites = (D.st.sites || []).filter((s) => Date.now() - s.at < 60 * M);
          let at = sites.length ? sites.sort((a, b) => b.p - a.p)[0] : null;
          if (!at || lakeD(at.x, at.z) < 1.3 || !D.farFromBuildings(at.x, at.z, 10)) at = D.findSpot((x, z, h) => h > 1.6 && lakeD(x, z) > 1.4 && D.farFromBuildings(x, z, 18) && roadDist(x, z).d > 8 && Math.abs(x) < 120 && z > -20, 200);
          if (!at) return false;
          const id = 'sink' + (++D.st.sinks);
          D.announce({ kind: 'sinkhole', title: 'THE GROUND OPENS', text: `A second way down has opened near ${g.district(at.x, at.z)}. Where things are destroyed, the server digs.`, at, lead: 6000, legend: 62, fx: 'shake' });
          D.later(6000, () => {
            g.addCrater(at.x, at.z, 6, 4.5, null);
            g.patch(`portals.${id}`, { id, x: Math.round(at.x * 10) / 10, z: Math.round(at.z * 10) / 10, zone: 'surface', kind: 'sinkhole', found: false, to: 'ladder1' });
            g.broadcastPlayers({ t: 'ev', k: 'quake', s: 0.7 });
          });
          return true;
        },
      },
      {
        kind: 'time_shift', cooldown: 30 * M,
        weight: (c) => 0.55,
        run(c) {
          const mode = pick(['dusk', 'noon', 'ffwd']);
          const baseRate = 24 / (Number(process.env.DAY_MINUTES || 32) * 60);
          if (mode === 'dusk') { D.announce({ kind: 'time', title: 'THE SUN STOPS', text: 'It is 19:12. It will remain 19:12 for a while. Enjoy the light.', legend: 40, fx: 'glow', lead: 2000 }); D.later(2000, () => { g.world.setClock(19.2, 0); D.st.timeRestoreAt = Date.now() + (FAST ? 40000 : 5 * M); }); }
          else if (mode === 'noon') { D.announce({ kind: 'time', title: 'NOON, AT MIDNIGHT', text: 'The server lost its place in the day and picked a new one.', legend: 40, fx: 'glitch', lead: 2500 }); D.later(2500, () => g.world.setClock(c.tod > 6 && c.tod < 18 ? 0.5 : 12.2, baseRate)); }
          else { D.announce({ kind: 'time', title: 'THE SUN LOSES PATIENCE', text: 'Hours will pass in seconds. Try not to age.', legend: 34, fx: 'glitch', lead: 2000 }); D.later(2000, () => { g.world.setClock(g.tod(), baseRate * 22); D.st.timeRestoreAt = Date.now() + 20000; }); }
          return true;
        },
      },
      {
        kind: 'gravity', cooldown: 25 * M,
        weight: (c) => (c.players.length > 1 ? 0.5 : 0.2),
        run() {
          D.announce({ kind: 'gravity', title: 'GRAVITY HICCUPS', text: 'Everything that is not bolted down is briefly optional. 22 seconds.', legend: 46, fx: 'glitch', lead: 2500 });
          D.later(2500, () => {
            g.phys.world.gravity = { x: 0, y: -1.6, z: 0 };
            for (const p of g.phys.props.values()) { p.body.wakeUp(); p.body.applyImpulse({ x: 0, y: p.mass * 1.6, z: 0 }, true); }
            g.patch('physics', { g: 0.18, until: Date.now() + 22000 });
            D.later(22000, () => { g.phys.world.gravity = { x: 0, y: -9.81, z: 0 }; for (const p of g.phys.props.values()) p.body.wakeUp(); g.patch('physics', { g: 1, until: 0 }); });
          });
          return true;
        },
      },
      {
        kind: 'whisper', cooldown: 6 * M,
        weight: (c) => (c.live.length ? 1.1 : 0),
        run(c) {
          const p = pick(c.live);
          const s = p.rec.stats;
          const lines = [];
          if (s.offerings) lines.push(`You gave the lake something. I have not forgotten. Neither has it.`);
          if (s.destroyed) lines.push(`I saw what you did. ${s.destroyed} of them. I have not decided how I feel.`);
          if (s.steps > 300) lines.push(`You have walked ${(s.steps / 1000).toFixed(1)} kilometres inside me. I felt every one.`);
          if (s.kills) lines.push('Do you remember their names? I do.');
          if (s.deaths) lines.push(`You have died ${s.deaths} time${s.deaths > 1 ? 's' : ''} here. I kept the tape.`);
          if (p.rec.visits > 1) lines.push(`Welcome back, ${p.name}. Things changed while you were gone. Not all of it was players.`);
          lines.push(`I know your name, ${p.name}. I always did.`, 'Look behind you. No. Look *down*.', 'Somebody else is looking at your screen right now.');
          g.send(p, { t: 'whisper', text: pick(lines), clock: fmtClock(Date.now()) });
          return true;
        },
      },
      {
        kind: 'clue_beacon', cooldown: 30 * M,
        weight: (c) => (!c.found && c.players.length ? 0.9 + c.S.exploration * 0.1 : 0),
        run() {
          const ch = D.pub.buildings.b_chapel;
          if (!ch || ch.ruined) return false;
          D.announce({ kind: 'clue', title: 'SOMETHING BENEATH SAINT ANSELM\'S IS AWAKE', text: 'A light is rising from the chapel on the hill. The floor there has been lying about what it is.', at: { x: ch.x, z: ch.z }, legend: 45, fx: 'glow', lead: 2500 });
          D.later(2500, () => { g.patch('monuments.beacon1', { id: 'beacon1', kind: 'beacon', x: ch.x, z: ch.z, until: Date.now() + 4 * M, title: 'Beacon' }); D.later(4 * M, () => g.patch('monuments.beacon1', null)); });
          return true;
        },
      },
      {
        kind: 'arrival', cooldown: 8 * M,
        weight: (c) => (c.npcs <= 7 ? 1.4 + (7 - c.npcs) * 0.3 : c.npcs < 10 ? 0.2 : 0),
        run(c) {
          const def = g.npcs.randomArrivalDef();
          D.announce({ kind: 'arrival', title: 'A STRANGER ARRIVES', text: `The 17:15 bus is late but not empty. ${def.name}, a ${def.role.toLowerCase()}, has stepped off. Hollowmere has ${c.npcs} residents; it has room for one more.`, at: { x: SPAWN.x, z: SPAWN.z }, legend: 26, fx: 'glow', lead: 2000 });
          D.later(2000, () => { const n = g.npcs.spawnArrival(def); n.x = SPAWN.x + 4; n.z = SPAWN.z - 2; n.homeId = g.npcs.findShelter(n); g.emitNear('bus', {}, SPAWN.x, SPAWN.z, 300); });
          return true;
        },
      },
      {
        kind: 'statue', cooldown: 20 * M,
        weight: (c) => {
          const cand = D.statueCandidate();
          return cand ? 0.8 : 0;
        },
        run() {
          const cand = D.statueCandidate();
          if (!cand) return false;
          const n = D.st.statues.length;
          const x = -22 + (n % 8) * 7, z = 21 + Math.floor(n / 8) * 6;
          const id = 'st' + (n + 1);
          D.st.statues.push(cand.pid);
          D.announce({ kind: 'statue', title: 'THE SERVER ERECTS A STATUE', text: `A stone figure of ${cand.name} now stands on the promenade. ${cand.reason}`, at: { x, z }, legend: 52, actors: [cand.name], fx: 'glow', lead: 3000 });
          D.later(3000, () => g.patch(`monuments.${id}`, { id, kind: 'statue', name: cand.name, x, z, yaw: Math.PI, title: cand.title || cand.reason, at: Date.now() }));
          return true;
        },
      },
    ];
  }

  statueCandidate() {
    const priv = this.g.world.priv.players;
    let best = null, bs = 0;
    for (const pid in priv) {
      if (this.st.statues.includes(pid)) continue;
      const r = priv[pid], st = r.stats;
      const score = r.notoriety * 1.2 + st.offerings * 3 + st.discoveries * 25 + st.planks * 0.8 + st.gifts * 4 + st.clips * 2;
      if (score > bs && score >= (FAST ? 4 : 40)) { bs = score; best = { pid, name: r.name, reason: st.discoveries ? 'They found the way down.' : st.destroyed > 2 ? 'They are remembered for what they broke.' : st.offerings > 3 ? 'The lake speaks their name.' : 'The server keeps its favourites.', title: r.title }; }
    }
    return best;
  }
}

export { SIG_TAU };
