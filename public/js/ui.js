// DOM HUD & panels: SERVER EVENT banner, Chronicle, map, chat, dialogue, radio, stream panel, modals.
import { HALF, CELL, N, VERTS } from '/shared/terrain.js';
import { BTYPES, LAKE, ROADS, UNDER } from '/shared/layout.js';
import { clockStr, todStr } from './net.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(hooks) {
    this.h = hooks;
    this.toolsEl = $('tools');
    this.chTab = 'recent';
    this.bannerT = 0; this.dialogT = 0; this.radioT = 0;
    this.entries = []; this.top = [];
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.closePanels());
    for (const b of document.querySelectorAll('#chtabs button')) b.addEventListener('click', () => { this.chTab = b.dataset.t; for (const x of document.querySelectorAll('#chtabs button')) x.classList.toggle('on', x === b); this.renderChronicle(); });
    addEventListener('keydown', (e) => this.onKey(e));
    $('chatin').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); e.target.value = ''; this.closeChat(); if (v) this.h.sendChat(v); e.preventDefault(); }
      else if (e.key === 'Escape') { e.target.value = ''; this.closeChat(); }
      e.stopPropagation();
    });
  }

  // ---------------------------------------------------------------- state
  uiOpen() {
    return !$('chronicle').hidden || !$('mapp').hidden || !$('pause').hidden || !$('death').hidden || !$('digest').hidden || !$('modal').hidden || !$('chatin').hidden;
  }
  panelOpen() { return !$('chronicle').hidden || !$('mapp').hidden || !$('pause').hidden || !$('digest').hidden || !$('modal').hidden || !$('death').hidden; }
  closePanels() { for (const id of ['chronicle', 'mapp', 'pause', 'digest']) $(id).hidden = true; this.h.panelClosed?.(); }

  onKey(e) {
    if (!this.h.inGame()) return;
    if (!$('modal').hidden) return;
    if (!$('chatin').hidden) return;
    if (e.code === 'Tab') { e.preventDefault(); if (!$('chronicle').hidden) this.closePanels(); else this.openChronicle(); }
    else if (e.code === 'KeyM' && !e.repeat) { if (!$('mapp').hidden) this.closePanels(); else this.openMap(); }
    else if ((e.code === 'KeyT' || e.code === 'Enter') && !e.repeat && !this.panelOpen()) { e.preventDefault(); this.openChat(); }
    else if (e.code === 'KeyH' && !e.repeat && !this.panelOpen()) document.body.classList.toggle('nohud');
    else if (e.code === 'Escape' && this.panelOpen() && $('pause').hidden && $('death').hidden) this.closePanels();
  }

  // ---------------------------------------------------------------- HUD bits
  banner(clock, title, text, ms = 9000) {
    $('b-head').textContent = `SERVER EVENT: ${clock}`; $('b-title').textContent = title; $('b-text').textContent = text || '';
    const el = $('banner'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    document.body.classList.add('cine');
    const g = $('glitchflash'); g.classList.remove('on'); void g.offsetWidth; g.classList.add('on');
    clearTimeout(this._bt); this._bt = setTimeout(() => { el.classList.remove('on'); document.body.classList.remove('cine'); }, ms);
  }
  legend(title, text) {
    $('lg-title').textContent = title; $('lg-text').textContent = text;
    const el = $('legendtoast'); el.classList.add('on'); clearTimeout(this._lt); this._lt = setTimeout(() => el.classList.remove('on'), 8000);
  }
  feed(e, cls = '') {
    const d = document.createElement('div'); d.className = 'f ' + cls;
    d.innerHTML = `<b>${esc(e.clock)}</b>${esc(e.title)}`;
    const box = $('feed'); box.appendChild(d); while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 12500);
  }
  toast(text, kind = 'info') {
    const d = document.createElement('div'); d.className = 't ' + kind; d.textContent = text; $('toasts').appendChild(d); setTimeout(() => d.remove(), 5200);
    while ($('toasts').children.length > 4) $('toasts').removeChild($('toasts').firstChild);
  }
  prompt(html) { const p = $('prompt'); if (html) { p.innerHTML = html; p.hidden = false; } else p.hidden = true; }
  crosshairHot(on) { $('cross').classList.toggle('hot', !!on); }
  dialog(name, role, text, ms = 7000) {
    $('d-name').innerHTML = `${esc(name)} <span>· ${esc(role || '')}</span>`; $('d-text').textContent = text; $('dialog').hidden = false;
    clearTimeout(this._dt); this._dt = setTimeout(() => { $('dialog').hidden = true; }, ms);
  }
  radio(from, text, dead, ms = 9000) {
    const r = $('radio'); r.className = dead ? 'dead' : ''; $('r-from').textContent = '📻 ' + from; $('r-text').textContent = text; r.hidden = false;
    clearTimeout(this._rt); this._rt = setTimeout(() => { r.hidden = true; }, ms);
  }
  whisper(text) { const w = $('whisper'); w.textContent = text; w.hidden = false; w.style.animation = 'none'; void w.offsetWidth; w.style.animation = ''; clearTimeout(this._wt); this._wt = setTimeout(() => { w.hidden = true; }, 6600); }
  chatLine(name, text, sys) {
    const d = document.createElement('div'); d.className = 'c' + (sys ? ' sys' : '');
    d.innerHTML = sys ? esc(text) : `<b>${esc(name)}</b> ${esc(text)}`;
    const box = $('chatlog'); box.appendChild(d); while (box.children.length > 8) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 13500);
  }
  clipMark(clock, title) { const c = $('clipmark'); c.textContent = `● CLIP ${clock} — ${title}`; c.hidden = false; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; clearTimeout(this._ct); this._ct = setTimeout(() => { c.hidden = true; }, 3800); }

  updateTop(o) {
    $('clock').textContent = `${clockStr(o.serverNow)} UTC`;
    $('worldtime').textContent = `${todStr(o.tod)} in Hollowmere · ${o.weather}${o.zoneLabel ? ' · ' + o.zoneLabel : ''}`;
    $('era').textContent = o.era ? `${o.era.name}` : '';
    $('online').textContent = `${o.online} connected · server age ${o.age}`;
    $('ping').textContent = o.rtt ? `${Math.round(o.rtt)} ms` : '';
  }
  updateVitals(hp, inv, tool, held) {
    $('hpbar').style.width = Math.max(0, hp) + '%'; $('hptxt').textContent = Math.round(hp);
    const names = [['HANDS', ''], ['CHARGE', inv.charges], ['PLANK', inv.planks], ['SIGN', inv.signs]];
    this.toolsEl.innerHTML = names.map((n, i) => `<div class="tool ${i === tool ? 'on' : ''} ${n[1] === 0 ? 'empty' : ''}"><b>${i + 1}${n[1] !== '' ? ' · ' + n[1] : ''}</b>${n[0]}</div>`).join('');
    $('hold').textContent = held ? `holding: ${held}${this.h.windup && this.h.windup() > 0 ? ' · wind-up ' + '▮'.repeat(Math.ceil(this.h.windup() * 6)) : ''}` : '';
  }
  streamPanel(s) {
    const el = $('stream');
    if (!s || s.off) { el.hidden = true; return; }
    el.hidden = false; $('st-code').textContent = s.code; $('st-viewers').textContent = s.viewers;
    const poll = $('st-poll');
    if (s.poll) {
      const tot = s.poll.votes.reduce((a, b) => a + b, 0) || 1;
      poll.hidden = false; poll.innerHTML = '<b>CHAT DECIDES</b>' + s.poll.opts.map((o, i) => `<div class="opt"><span>${esc(o)}</span><span>${s.poll.votes[i]}</span></div><div class="bar2" style="width:${(s.poll.votes[i] / tot) * 100}%"></div>`).join('');
    } else poll.hidden = true;
    $('st-log').innerHTML = (s.log || []).slice(-3).map((l) => esc(l.text)).join('<br>');
  }

  // ---------------------------------------------------------------- chat
  openChat() { const c = $('chatin'); c.hidden = false; c.focus(); document.exitPointerLock?.(); }
  closeChat() { $('chatin').hidden = true; $('chatin').blur(); this.h.panelClosed?.(); }

  // ---------------------------------------------------------------- modal
  ask(title, placeholder = '', initial = '') {
    return new Promise((res) => {
      const m = $('modal'), inp = $('modal-in');
      $('modal-title').textContent = title; inp.placeholder = placeholder; inp.value = initial; m.hidden = false; document.exitPointerLock?.(); setTimeout(() => inp.focus(), 30);
      const done = (v) => { m.hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; inp.onkeydown = null; this.h.panelClosed?.(); res(v); };
      $('modal-ok').onclick = () => done(inp.value.trim()); $('modal-cancel').onclick = () => done(null);
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value.trim()); else if (e.key === 'Escape') done(null); };
    });
  }

  // ---------------------------------------------------------------- pause / death / digest
  openPause(info) { $('pause').hidden = false; $('pause-info').textContent = info || ''; }
  showDeath(cause, by, words) {
    $('death').hidden = false; $('death-cause').textContent = `You ${cause}${by ? '' : ''}.`; $('death-words').textContent = words ? `Your last words: “${words}”` : '';
    $('respawn').disabled = true; setTimeout(() => { $('respawn').disabled = false; }, 2500);
  }
  hideDeath() { $('death').hidden = true; }
  showDigest(entries, sinceMs) {
    const el = $('digest');
    const mins = Math.round(sinceMs / 60000);
    const ago = mins < 90 ? `${mins} minutes` : mins < 2880 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
    el.innerHTML = `<h2 style="padding:14px 18px 0;color:var(--acc);font-family:var(--mono);letter-spacing:.25em;font-size:14px">WHILE YOU WERE AWAY · ${ago}</h2><div style="padding:0 18px 10px;overflow:auto;max-height:52vh">${entries.map((e) => this.entryHTML(e)).join('')}</div><div class="center" style="padding:10px"><button class="btn" id="dg-ok">WALK BACK IN</button></div>`;
    el.hidden = false; document.exitPointerLock?.();
    $('dg-ok').onclick = () => { el.hidden = true; this.h.panelClosed?.(); };
  }

  // ---------------------------------------------------------------- chronicle
  setChronicle(recent, top) { this.entries = recent.slice(); this.top = top || []; }
  addEntry(e) { this.entries.push(e); if (this.entries.length > 400) this.entries.shift(); if (e.legend >= 40 && !this.top.some((x) => x.id === e.id)) { this.top.push(e); this.top.sort((a, b) => b.legend - a.legend); this.top.length = Math.min(this.top.length, 40); } if (!$('chronicle').hidden) this.renderChronicle(); }
  entryHTML(e) {
    const streams = (e.tags || []).filter((t) => t.startsWith('stream:')).map((t) => t.slice(7));
    const cls = e.legend >= 60 ? 'legend' : e.kind && e.kind.startsWith('event:') ? 'ev' : '';
    return `<div class="entry ${cls}"><div class="ck">${esc(e.clock)}</div><div><div class="tt">${esc(e.title)}${e.legend >= 40 ? ' ★' : ''}</div><div class="tx">${esc(e.text)}</div>${streams.length ? `<div class="meta stream">● seen on ${streams.map(esc).join(', ')}'s stream — jump to ${esc(e.clock)}</div>` : ''}</div></div>`;
  }
  openChronicle() { $('chronicle').hidden = false; document.exitPointerLock?.(); this.renderChronicle(); }
  renderChronicle() {
    const body = $('chbody');
    if (this.chTab === 'recent') body.innerHTML = this.entries.slice().reverse().slice(0, 120).map((e) => this.entryHTML(e)).join('') || '<p class="dim">Nothing has happened yet.</p>';
    else if (this.chTab === 'legends') body.innerHTML = this.top.map((e) => this.entryHTML(e)).join('') || '<p class="dim">No legends yet. Somebody will do something stupid soon.</p>';
    else {
      const w = this.h.world();
      const places = Object.values(w.places || {}).map((p) => `<div class="entry"><div class="ck">place</div><div><div class="tt">${esc(p.name)}</div><div class="tx">named by ${esc(p.by)}</div></div></div>`).join('');
      const firsts = Object.entries(w.firsts || {}).map(([k, f]) => `<div class="entry legend"><div class="ck">${esc(clockStr(f.at))}</div><div><div class="tt">FIRST: ${esc(k.replace('_', ' ').toUpperCase())}</div><div class="tx">${esc(f.by)}</div></div></div>`).join('');
      const stat = w.stats || {};
      body.innerHTML = `<div class="entry"><div class="ck">stats</div><div><div class="tt">${esc(w.era?.name || '')}</div><div class="tx">${stat.destroyed || 0} structures destroyed · ${stat.npcDeaths || 0} residents killed · ${stat.playerDeaths || 0} player deaths · ${stat.offerings || 0} offerings to the lake · ${stat.events || 0} server events</div></div></div>` + places + firsts;
    }
  }

  // ---------------------------------------------------------------- map
  buildMapBase(terrain) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 320; const c = cv.getContext('2d'); const img = c.createImageData(320, 320);
    for (let j = 0; j < 320; j++) for (let i = 0; i < 320; i++) {
      const h = terrain.h[j * VERTS + i]; const hx = terrain.h[j * VERTS + i + 1] - terrain.h[j * VERTS + Math.max(0, i - 1)], hz = terrain.h[Math.min(320, j + 1) * VERTS + i] - terrain.h[Math.max(0, j - 1) * VERTS + i];
      const sh = Math.max(0.3, Math.min(1.3, 0.8 + (hx * 0.6 + hz * 0.9) * -0.06));
      let r, g, b;
      if (h < -20) { r = 5; g = 8; b = 10; } else if (h < 0) { const d = Math.min(1, -h / 9); r = 30 - d * 15; g = 88 - d * 30; b = 120 - d * 30; }
      else if (h < 1.1) { r = 200; g = 185; b = 140; } else { const t = Math.min(1, h / 90); r = (60 + t * 130) * sh; g = (104 + t * 70) * sh; b = (56 + t * 100) * sh; }
      const o = (j * 320 + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    this.mapBase = cv; this.terrain = terrain;
  }
  openMap() { $('mapp').hidden = false; document.exitPointerLock?.(); $('mapc').onclick = () => { this.mapZoom = (this.mapZoom || 1) > 1 ? 1 : 3.2; this.drawMap(); }; this.drawMap(); }
  drawMap() {
    const cv = $('mapc'), c = cv.getContext('2d'); const S = cv.width; const k = S / 640;
    const w = this.h.world(); const me = this.h.me();
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0a0e10'; c.fillRect(0, 0, S, S);
    c.imageSmoothingEnabled = true;
    const zoom = this.mapZoom || 1;
    const meP = me.zone === 'under' ? [S / 2 + (me.x / UNDER.r) * (S / 2 - 10), S / 2 + (me.z / UNDER.r) * (S / 2 - 10)] : [(me.x + HALF) * k, (me.z + HALF) * k];
    if (zoom > 1) c.setTransform(zoom, 0, 0, zoom, S / 2 - zoom * meP[0], S / 2 - zoom * meP[1]);
    if (me.zone === 'under') {
      c.fillStyle = '#04090c'; c.fillRect(0, 0, S, S); c.strokeStyle = '#20ffe0'; c.beginPath(); c.arc(S / 2, S / 2, (UNDER.r / 320) * (S / 2), 0, 7); c.stroke();
    } else this.mapBase && c.drawImage(this.mapBase, 0, 0, S, S);
    const X = (x) => (x + HALF) * k, Z = (z) => (z + HALF) * k;
    const under = me.zone === 'under';
    const UX = (x) => S / 2 + (x / UNDER.r) * (S / 2 - 10), UZ = (z) => S / 2 + (z / UNDER.r) * (S / 2 - 10);
    const px = under ? UX : X, pz = under ? UZ : Z;
    if (!under) {
      c.strokeStyle = 'rgba(70,72,78,.95)'; c.lineWidth = 3;
      for (const r of ROADS) { c.beginPath(); r.pts.forEach((p, i) => { if (Math.hypot(p[0], p[1]) > 270) return; i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1])); }); c.stroke(); }
      for (const cr of Object.values(w.craters || {})) { c.fillStyle = 'rgba(20,14,10,.6)'; c.beginPath(); c.arc(X(cr.x), Z(cr.z), Math.max(1.5, cr.r * k), 0, 7); c.fill(); }
      for (const e of Object.values(w.erased || {})) { c.fillStyle = '#000'; c.beginPath(); c.arc(X(e.x), Z(e.z), e.r * k, 0, 7); c.fill(); c.strokeStyle = '#20ffe0'; c.lineWidth = 1; c.stroke(); }
      for (const p of Object.values(w.planks || {})) { c.fillStyle = '#c99a5a'; c.fillRect(X(p.x) - 1, Z(p.z) - 1, 3, 3); }
    }
    for (const b of Object.values(w.buildings || {})) {
      if ((b.zone || 'surface') !== (under ? 'under' : 'surface')) continue;
      const T = BTYPES[b.type]; const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      c.save(); c.translate(px(b.x), pz(b.z)); c.rotate(-b.yaw); const sc = under ? (S / 2 - 10) / UNDER.r : k;
      c.fillStyle = b.ruined ? 'rgba(30,20,16,.9)' : b.ancient || under ? '#3fb8ae' : '#d8613f'; c.fillRect(-T.w * sc / 2, -T.d * sc / 2, T.w * sc, T.d * sc);
      c.restore();
      const landmark = ['b_chapel', 'b_pier', 'b_tower', 'b_billboard', 'u_archive'].includes(b.id);
      if (!b.ruined && (zoom > 1.6 || landmark)) { c.fillStyle = '#fff'; c.font = `${10 / zoom}px sans-serif`; c.textAlign = 'center'; c.fillText(b.name.replace(/KRNX.*/, 'Radio').slice(0, 18), px(b.x), pz(b.z) - (T.d * (under ? (S / 2 - 10) / UNDER.r : k)) / 2 - 3 / zoom); }
    }
    for (const pl of Object.values(w.places || {})) { if (under) continue; c.fillStyle = '#ffe08a'; c.font = `bold ${11 / zoom}px sans-serif`; c.textAlign = 'center'; c.fillText('◆ ' + pl.name, X(pl.x), Z(pl.z) - 6 / zoom); }
    for (const po of Object.values(w.portals || {})) { if (po.zone !== (under ? 'under' : 'surface')) continue; if (po.kind === 'hatch' && !po.found) continue; c.fillStyle = '#20ffe0'; c.beginPath(); c.arc(px(po.x), pz(po.z), 4, 0, 7); c.fill(); }
    // chronicle pins
    if (!under) for (const e of this.entries.slice(-60)) { if (!e.pos || e.legend < 30) continue; c.fillStyle = e.legend >= 60 ? '#ffd27a' : '#ff8a7a'; c.beginPath(); c.arc(X(e.pos.x), Z(e.pos.z), 3.5, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke(); }
    // nearby players only (streamers stay un-sniped)
    for (const p of this.h.nearbyPlayers(70)) { if ((p.under ? 'under' : 'surface') !== me.zone) continue; c.fillStyle = '#fff'; c.beginPath(); c.arc(px(p.x), pz(p.z), 3, 0, 7); c.fill(); }
    // me
    c.save(); c.translate(px(me.x), pz(me.z)); c.scale(1 / zoom, 1 / zoom); c.rotate(-me.yaw + Math.PI); c.fillStyle = '#7ff3e2'; c.strokeStyle = '#000'; c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 7); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke(); c.restore();
  }
}
