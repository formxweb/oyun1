// Streamer & viewer systems. A streamer gets a code; viewers join it from /viewer.html and can vote in
// polls or spend a little "influence" on *limited* world events. The effects are real, global and permanent
// in the Chronicle — so one streamer's audience can change another streamer's evening.
import crypto from 'node:crypto';
import { CFG } from './config.js';
import { cleanName, cleanSign, pick, shuffle } from './text.js';
import { fmtClock } from '../shared/util.js';
import { LAKE } from '../shared/layout.js';

const FAST = CFG.fast;
const S = 1000;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// cost in influence points, per-stream cooldown, world-wide cooldown (all streams share it)
export const EFFECTS = {
  fog:       { label: 'FOG BANK', desc: 'A dense fog rolls in around the streamer for 2½ minutes. Everyone inside it is blind together.', cost: 4, cd: 90, wcd: 45 },
  gust:      { label: 'GUST', desc: 'A violent wind shoves every loose object near the streamer.', cost: 3, cd: 60, wcd: 30 },
  lightning: { label: 'LIGHTNING', desc: 'Three bolts strike the ground around the streamer. Nothing is hurt. Everyone flinches.', cost: 4, cd: 90, wcd: 45 },
  flare:     { label: 'SIGNAL FLARE', desc: 'A green flare rises from the streamer’s position — visible from across the valley.', cost: 5, cd: 120, wcd: 60 },
  supply:    { label: 'SUPPLY DROP', desc: 'Crates and a lantern fall near the streamer. Anyone can take them — including other streams.', cost: 8, cd: 180, wcd: 90 },
  whisper:   { label: 'RADIO WHISPER', desc: 'Your message (50 chars) crackles over every radio in the server as an unidentified voice.', cost: 6, cd: 120, wcd: 60, text: true },
  blackout:  { label: 'BLACKOUT', desc: 'Marrow Street’s lights die for a minute.', cost: 10, cd: 240, wcd: 120 },
};

export class Streams {
  constructor(game) {
    this.g = game;
    this.byCode = new Map();
    this.wcd = {};
    this.n = 0;
  }

  makeCode() {
    for (let k = 0; k < 20; k++) {
      let c = '';
      const b = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) c += ALPHA[b[i] % ALPHA.length];
      if (!this.byCode.has(c)) return c;
    }
    return 'X' + Date.now().toString(36).slice(-5).toUpperCase();
  }

  startStream(s, title) {
    if (s.stream) { s.stream.title = title; return this.pushStreamer(s); }
    const now = Date.now();
    const code = this.makeCode();
    s.stream = { code, title, viewers: new Set(), poll: null, nextPoll: now + (FAST ? 25 * S : 4 * 60 * S), fxAt: {}, log: [], since: now };
    this.byCode.set(code, s);
    this.g.broadcastPlayers({ t: 'plive', id: s.id, live: true });
    this.pushStreamer(s);
    this.g.toast(s, `You are LIVE. Viewer code: ${code} → open /viewer.html`, 'good');
  }

  stopStream(s) {
    if (!s.stream) return;
    for (const v of s.stream.viewers) { this.g.send(v, { t: 'vend' }); }
    this.byCode.delete(s.stream.code);
    s.stream = null;
    this.g.broadcastPlayers({ t: 'plive', id: s.id, live: false });
    this.g.send(s, { t: 'stream', off: true });
  }

  info(s) {
    const st = s.stream;
    return { code: st.code, title: st.title, viewers: st.viewers.size, poll: st.poll ? this.pollView(st.poll) : null, log: st.log.slice(-6) };
  }
  pushStreamer(s) { if (s.stream) this.g.send(s, { t: 'stream', ...this.info(s) }); }
  pollView(p) { return { id: p.id, opts: p.opts.map((o) => EFFECTS[o].label), votes: p.votes, endsAt: p.endsAt, kinds: p.opts }; }

  // ------------------------------------------------------------------ viewers
  viewerHello(v, m) {
    const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const s = this.byCode.get(code);
    if (!s) { this.g.send(v, { t: 'reject', reason: 'No live stream with that code.' }); return v.ws.close(); }
    if (s.stream.viewers.size >= 5000) { this.g.send(v, { t: 'reject', reason: 'Stream is full.' }); return v.ws.close(); }
    v.ready = true; v.code = code; v.streamer = s; v.vname = cleanName(m.name) || 'viewer' + v.id;
    v.points = 3; v.lastPt = Date.now(); v.voted = 0;
    s.stream.viewers.add(v);
    this.g.send(v, { t: 'vwelcome', id: v.id, streamer: s.name, title: s.stream.title, fx: Object.entries(EFFECTS).map(([k, e]) => ({ k, ...e })), top: this.g.chron.top(8), recent: this.g.chron.last(25) });
    this.viewerState(v);
  }
  viewerLeft(v) { if (v.streamer?.stream) v.streamer.stream.viewers.delete(v); }

  viewerMsg(v, m) {
    const s = v.streamer;
    if (!s || !s.stream || !this.g.sessions.has(s.id)) return this.g.send(v, { t: 'vend' });
    const st = s.stream;
    if (m.t === 'vote') {
      const p = st.poll;
      if (!p || Date.now() > p.endsAt) return;
      const i = m.opt | 0;
      if (i < 0 || i >= p.opts.length) return;
      if (v.votedPoll === p.id) p.votes[v.voteOpt]--;
      v.votedPoll = p.id; v.voteOpt = i; p.votes[i]++;
      this.viewerState(v);
    } else if (m.t === 'fx') {
      this.tryEffect(s, v, String(m.k), m.text);
    } else if (m.t === 'clip') {
      const now = Date.now();
      if (now - (v.lastClip || 0) < 3000) return;
      v.lastClip = now;
      const e = this.g.chron.recent.filter((x) => now - x.ts < 180000 && (!x.pos || Math.hypot(x.pos.x - s.x, x.pos.z - s.z) < 300)).sort((a, b) => b.legend - a.legend)[0];
      if (e) this.g.chron.boost(e.id, 3);
      this.g.send(v, { t: 'vclip', clock: fmtClock(now), title: e ? e.title : 'MOMENT' });
      this.g.send(s, { t: 'toast', text: `${v.vname} clipped this moment · ${fmtClock(now)}`, kind: 'info' });
    }
  }

  tryEffect(s, v, kind, text) {
    const g = this.g, e = EFFECTS[kind], st = s.stream, now = Date.now();
    if (!e) return;
    const err = (t) => g.send(v, { t: 'vtoast', text: t, kind: 'warn' });
    if (v.points < e.cost) return err(`Need ${e.cost} influence (you have ${Math.floor(v.points)}).`);
    if (now < (st.fxAt[kind] || 0)) return err(`${e.label} is cooling down on this stream.`);
    if (now < (this.wcd[kind] || 0)) return err(`${e.label} was just used somewhere in the world. Try again shortly.`);
    if (s.dead) return err('The streamer is dead. Give them a moment.');
    let msg = null;
    if (e.text) { msg = cleanSign(text).slice(0, 50); if (!msg) return err('Type a short message first.'); }
    v.points -= e.cost;
    st.fxAt[kind] = now + e.cd * S * (FAST ? 0.2 : 1);
    this.wcd[kind] = now + e.wcd * S * (FAST ? 0.2 : 1);
    this.applyEffect(s, kind, v.vname, msg);
    this.viewerState(v);
  }

  applyEffect(s, kind, by, text) {
    const g = this.g, now = Date.now(), pub = g.pub;
    const where = g.district(s.x, s.z);
    let title = EFFECTS[kind].label, body = '';
    const id = 'fx' + (++this.n);
    switch (kind) {
      case 'fog': g.patch(`fog.${id}`, { x: Math.round(s.x), z: Math.round(s.z), r: 75, until: now + 150 * S }); setTimeout(() => g.patch(`fog.${id}`, null), 150 * S); body = `A fog bank settled over ${where}.`; break;
      case 'gust': {
        const a = Math.random() * 6.28, fx = Math.cos(a), fz = Math.sin(a);
        for (const p of g.phys.props.values()) { const t = p.body.translation(); if (Math.hypot(t.x - s.x, t.z - s.z) < 90) { p.body.wakeUp(); p.body.applyImpulse({ x: fx * p.mass * 5, y: p.mass * 1.5, z: fz * p.mass * 5 }, true); } }
        g.emitNear('gust', { dx: fx, dz: fz }, s.x, s.z, 200);
        body = `A gust tore across ${where}.`; break;
      }
      case 'lightning':
        for (let i = 0; i < 3; i++) setTimeout(() => { const a = Math.random() * 6.28, r = 40 + Math.random() * 50; g.emitNear('lightning', { bx: s.x + Math.cos(a) * r, bz: s.z + Math.sin(a) * r }, s.x, s.z, 600); }, i * 900);
        body = `Lightning walked around ${where}.`; break;
      case 'flare': g.emitNear('flare', { color: 'green', ttl: 90000, name: s.name }, s.x, s.z, 700); body = `A green flare went up from ${where}.`; break;
      case 'supply': {
        const y = g.terrain.height(s.x + 6, s.z) + 16;
        const types = ['crate', 'crate', 'lantern', Math.random() < 0.3 ? 'fuel' : 'barrel'];
        types.forEach((ty, i) => g.spawnProp(ty, s.x + 6 + (i - 1.5) * 1.2, y + i * 1.4, s.z + (Math.random() - 0.5) * 3, {}, { persist: true }));
        g.emitNear('flare', { color: 'red', ttl: 60000, name: s.name }, s.x + 6, s.z, 700);
        body = `A supply drop landed near ${where}. Anyone may take it.`; break;
      }
      case 'whisper': g.radio({ from: `UNIDENTIFIED · ${s.name}'s viewers`, text, dead: false, pitch: 0.75, viewer: true }); body = `A voice crackled over every radio: "${text}"`; break;
      case 'blackout': g.patch('lights.blackoutUntil', Math.max(pub.lights.blackoutUntil || 0, now + (FAST ? 30 : 60) * S)); body = "Marrow Street's lights died."; break;
      default: return;
    }
    const e = g.chron.add({ kind: 'viewers', title: `${title} — CHAT DECIDES`, text: `${by} (watching ${s.name}) triggered ${title.toLowerCase()}. ${body}`, actors: [s.name], pos: { x: s.x, z: s.z }, legend: 16, tags: ['viewers', 'stream:' + s.name] });
    g.broadcastPlayers({ t: 'chron', e });
    g.broadcastPlayers({ t: 'toast', kind: 'stream', text: `${s.name}'s viewers: ${title}` });
    s.stream.log.push({ at: now, text: `${by}: ${title}` });
    this.pushStreamer(s);
    g.director.sig.chatter += 1;
  }

  // ------------------------------------------------------------------ polls & regen
  startPoll(s) {
    const st = s.stream;
    const opts = shuffle(['fog', 'gust', 'lightning', 'flare', 'supply', 'blackout']).slice(0, 3);
    st.poll = { id: ++this.n, opts, votes: [0, 0, 0], endsAt: Date.now() + (FAST ? 15 : 35) * S };
    for (const v of st.viewers) { v.votedPoll = 0; this.viewerState(v); }
    this.pushStreamer(s);
  }

  endPoll(s) {
    const st = s.stream, p = st.poll;
    st.poll = null;
    st.nextPoll = Date.now() + (FAST ? 40 : 4 * 60) * S;
    if (!p) return;
    const total = p.votes.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const w = p.votes.indexOf(Math.max(...p.votes));
      const kind = p.opts[w];
      this.applyEffect(s, kind, `${total} viewer${total > 1 ? 's' : ''}`, kind === 'whisper' ? 'the chat has spoken' : null);
    }
    this.pushStreamer(s);
    for (const v of st.viewers) this.viewerState(v);
  }

  tick(now) {
    for (const s of this.byCode.values()) {
      const st = s.stream;
      if (!st) continue;
      for (const v of st.viewers) { const gain = (now - v.lastPt) / (FAST ? 4000 : 15000); if (gain >= 1) { v.points = Math.min(12, v.points + Math.floor(gain)); v.lastPt += Math.floor(gain) * (FAST ? 4000 : 15000); } }
      if (st.poll && now > st.poll.endsAt) this.endPoll(s);
      else if (!st.poll && st.viewers.size > 0 && now > st.nextPoll) this.startPoll(s);
      if ((this.g.tick % 90) === 0) { this.pushStreamer(s); for (const v of st.viewers) this.viewerState(v); }
    }
  }

  viewerState(v) {
    const s = v.streamer;
    if (!s || !s.stream) return;
    const st = s.stream, now = Date.now();
    this.g.send(v, {
      t: 'vstate', points: Math.floor(v.points), viewers: st.viewers.size, where: this.g.district(s.x, s.z), hp: Math.round(s.hp), tod: Math.round(this.g.tod() * 10) / 10,
      weather: this.g.pub.weather.type, poll: st.poll ? { ...this.pollView(st.poll), mine: v.votedPoll === st.poll.id ? v.voteOpt : -1 } : null,
      cd: Object.fromEntries(Object.keys(EFFECTS).map((k) => [k, Math.max(0, Math.ceil(Math.max((st.fxAt[k] || 0), (this.wcd[k] || 0)) - now) / 1000)])), log: st.log.slice(-6),
    });
  }
}
