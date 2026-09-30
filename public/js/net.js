// WebSocket client + replicated-world helpers.
export class Net {
  constructor() { this.handlers = {}; this.ws = null; this.serverOffset = 0; this.rtt = 60; this.open = false; }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); return this; }
  emit(t, m) { for (const f of this.handlers[t] || []) { try { f(m); } catch (e) { console.error('[net handler]', t, e); } } }
  connect(hello, { viewer = false } = {}) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws${viewer ? '?role=viewer' : ''}`);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => { this.open = true; ws.send(JSON.stringify(hello)); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome' || m.t === 'vwelcome') { if (m.serverNow) this.serverOffset = m.serverNow - Date.now(); if (!settled) { settled = true; resolve(m); } }
        if (m.t === 'reject') { if (!settled) { settled = true; reject(new Error(m.reason)); } }
        if (m.t === 'snap' && m.ts) this.serverOffset += ((m.ts - Date.now()) - this.serverOffset) * 0.05;
        if (m.t === 'pong') { this.rtt = Date.now() - m.c; }
        this.emit(m.t, m);
      };
      ws.onclose = (e) => { this.open = false; if (!settled) { settled = true; reject(new Error('Could not reach the server.')); } this.emit('close', e); };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Connection failed.')); } };
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  serverNow() { return Date.now() + this.serverOffset; }
  ping() { this.send({ t: 'ping', c: Date.now() }); }
}

/** Apply a dotted-path patch to the replicated world. null deletes. Returns [parent, key]. */
export function applyPatch(world, path, v) {
  const parts = path.split('.');
  let o = world;
  for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
  const k = parts[parts.length - 1];
  if (v === null) delete o[k]; else o[k] = v;
  return parts;
}

export function todNow(world, serverNow) {
  const c = world.clock;
  const h = c.anchorTod + ((serverNow - c.anchorReal) / 1000) * c.rate;
  return ((h % 24) + 24) % 24;
}

export function clockStr(ms) {
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function todStr(tod) { const h = Math.floor(tod), m = Math.floor((tod - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
