// THE LAST SERVER — client orchestration.
import * as THREE from 'three';
import { Net, applyPatch, todNow, clockStr } from './net.js';
import { Terrain, HALF } from '/shared/terrain.js';
import { Collision, buildingWorldBoxes, plankWorldBox, groundAt, insideFootprint } from '/shared/collide.js';
import { BTYPES, UNDER, LAKE, districtAt } from '/shared/layout.js';
import { fmtDuration, clamp, smoothstep } from '/shared/util.js';
import { makeTextures } from './tex.js';
import { Env } from './env.js';
import { TerrainView } from './terrain.js';
import { WaterView } from './water.js';
import { BuildingsView } from './buildings.js';
import { WorldObjects } from './props.js';
import { Entities } from './entities.js';
import { LocalPlayer } from './player.js';
import { FX } from './fx.js';
import { Post } from './post.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Understory, ArchiveScreen } from './under.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const randToken = () => { const a = new Uint8Array(32); (crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)))); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

const G = { started: false, ready: false, net: new Net(), zone: 'surface', quality: 'high' };
window.__game = G; G.setZone = (z) => setZone(z);

// =============================================================================== TITLE
(function title() {
  $('pname').value = store.get('tls_name', '');
  $('pquality').value = store.get('tls_q', matchMedia('(max-width: 900px)').matches ? 'low' : 'high');
  $('pstream').addEventListener('change', (e) => { $('streamtitlewrap').hidden = !e.target.checked; });
  const enable = () => { $('enter').disabled = false; };
  const poll = async () => {
    try {
      const s = await (await fetch('/api/status')).json();
      $('tstatus').innerHTML = `${s.online} connected · ${s.era.name} · server age ${s.age}<br>${s.destroyed} structures destroyed · ${s.npcs} residents alive · ${s.understoryFound ? 'the Understory has been found' : 'something is hidden'}`;
      enable();
    } catch { $('tstatus').textContent = 'The server is not answering. Try again in a moment.'; }
  };
  poll(); setInterval(() => { if (!G.started) poll(); }, 8000);
  const p = new URLSearchParams(location.search);
  if (p.get('name')) $('pname').value = p.get('name');
  $('joinform').addEventListener('submit', (e) => { e.preventDefault(); if (G.started) return; const name = $('pname').value.trim(); if (name.length < 2) { $('terr').textContent = 'Pick a name with at least 2 characters.'; return; } startGame(name); });
})();

// =============================================================================== START
async function startGame(name) {
  G.started = true;
  $('terr').textContent = '';
  const quality = $('pquality').value; G.quality = quality;
  store.set('tls_name', name); store.set('tls_q', quality);
  let token = store.get('tls_token', ''); if (!token) { token = randToken(); store.set('tls_token', token); }
  $('title').hidden = true; $('loading').hidden = false;
  const prog = (p, msg) => { $('loadbar').style.width = p * 100 + '%'; $('loadsub').textContent = msg; };
  try {
    G.audio = new AudioSys(); G.audio.resume();
    prog(0.05, 'contacting the server…');
    const net = G.net;
    const streamer = $('pstream').checked;
    const w = await net.connect({ t: 'hello', name, token, streamer, title: $('pstreamtitle').value, q: quality });
    store.set('tls_token', w.token);
    G.welcome = w; G.world = w.world; G.myId = w.id; G.name = w.name;
    prog(0.15, 'reading history…');
    await nextFrame();
    await buildWorld(w, quality, prog);
    bindNet();
    prog(1, 'ready');
    $('loading').hidden = true; $('hud').hidden = false;
    G.ready = true;
    requestAnimationFrame(frame);
    // first screen: what changed while you were away
    const digest = w.digest || [];
    const first = w.sinceMs < 1000 || w.sinceMs > 3e12;
    setTimeout(() => {
      G.ui.showDigest(digest, w.sinceMs, first, w.world);
    }, 300);
    if (w.stream) G.ui.streamPanel(w.stream);
  } catch (e) {
    console.error(e);
    G.started = false; $('loading').hidden = true; $('title').hidden = false; $('terr').textContent = e.message || 'Could not join.';
  }
}

// =============================================================================== WORLD BUILD
async function buildWorld(w, quality, prog) {
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  const pr = quality === 'high' ? Math.min(devicePixelRatio, 2) : quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : 1;
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  G.renderer = renderer;
  const scene = new THREE.Scene(); G.scene = scene;
  const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.12, 1400); G.camera = camera;
  scene.add(camera);

  prog(0.2, 'painting textures…'); await nextFrame();
  G.tex = makeTextures(quality);
  prog(0.3, 'raising the valley…'); await nextFrame();
  G.terrain = new Terrain(); G.terrain.applyMods(w.world.craters, w.world.erased);
  G.col = new Collision();
  for (const id in w.world.buildings) G.col.set(id, buildingWorldBoxes(w.world.buildings[id]));
  for (const id in w.world.planks) G.col.set(id, [plankWorldBox(w.world.planks[id])]);

  G.underGroup = new THREE.Group(); G.underGroup.visible = false; scene.add(G.underGroup);
  prog(0.4, 'lighting the sky…'); await nextFrame();
  G.env = new Env(scene, renderer, G.tex, quality);
  prog(0.5, 'planting forests…'); await nextFrame();
  G.tv = new TerrainView(scene, G.tex, G.terrain, w.world, w.trees, w.rocks, quality, G.env);
  G.tv.setWear(w.wear);
  prog(0.62, 'filling the lake…'); await nextFrame();
  G.water = new WaterView(scene, G.tex, G.terrain, w.world);
  prog(0.72, 'building Marrow Street…'); await nextFrame();
  G.buildings = new BuildingsView(scene, G.tex, w.world, quality);
  G.buildings.underGroup = G.underGroup;
  for (const id in w.world.buildings) G.buildings.add(w.world.buildings[id]);
  G.buildings.setBoard('bd_wanted', w.world.boards?.bd_wanted);
  G.buildings.refreshWanted();
  prog(0.82, 'waking the residents…'); await nextFrame();
  G.fx = new FX(scene, quality, G.terrain, { shake: (s, x, z, r) => addShake(s, x, z, r) });
  G.objects = new WorldObjects(scene, G.underGroup, G.tex, w.world, G.terrain, {});
  for (const p of w.props) G.objects.addProp(p);
  for (const c of w.charges || []) G.objects.addCharge(c);
  G.objects.syncAll();
  G.entities = new Entities(scene, G.underGroup, w.world, {
    localId: () => G.myId,
    playerPos: (id) => { if (id === G.myId) return { x: G.local.pos.x, y: G.local.pos.y, z: G.local.pos.z }; const e = G.entities.players.get(id); return e ? e.g.position : null; },
  });
  for (const p of w.players) G.entities.addPlayer(p);
  for (const n of w.npcs) { const e = G.entities.ensureNpc(n[0]); if (e) { e.g.position.set(n[1], n[2], n[3]); } }
  G.under = new Understory(G.underGroup, G.tex, w.world);
  G.archive = new ArchiveScreen(G.buildings); G.archive.attach(); G.archive.setEntries(archiveList(w.chronicle.top, w.chronicle.recent));
  prog(0.9, 'finding you a place to stand…'); await nextFrame();

  G.post = new Post(renderer, scene, camera, quality);
  // 8 pooled point lights for windows and lamps
  G.lampPool = []; for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffc98a, 0, 16, 1.6); l.castShadow = false; scene.add(l); G.lampPool.push(l); }

  G.ui = new UI({
    inGame: () => G.ready, world: () => G.world, me: () => ({ x: G.local.pos.x, z: G.local.pos.z, yaw: G.local.yaw, zone: G.local.zone }),
    nearbyPlayers: (r) => [...G.entities.players.values()].filter((e) => Math.hypot(e.g.position.x - G.local.pos.x, e.g.position.z - G.local.pos.z) < r).map((e) => ({ x: e.g.position.x, z: e.g.position.z, under: e.under })),
    sendChat: (t) => G.net.send({ t: 'act', a: 'chat', text: t }), panelClosed: () => relock(), windup: () => (G.local.charging ? clamp(G.local.chargeT / 0.9, 0, 1) : 0),
  });
  G.ui.setChronicle(w.chronicle.recent, w.chronicle.top);
  G.ui.buildMapBase(G.terrain);
  G.ui.showDigest = (entries, sinceMs, first, world) => showStartPanel(entries, sinceMs, first, world);

  G.local = new LocalPlayer({
    camera, scene, terrain: G.terrain, col: G.col, net: G.net, world: w.world, objects: G.objects,
    hooks: {
      uiOpen: () => G.ui.uiOpen() || !G.ready,
      interact: () => interact(), give: () => give(),
      toolChanged: (i) => { G.audio.ui('tick'); updateVitals(); },
      askSign: async (aim) => { const t = await G.ui.ask('Write a sign. It will stand here permanently — everyone who walks by will read it.', 'up to 60 characters'); if (t) { G.net.send({ t: 'act', a: 'sign', o: aim.o, d: aim.d, text: t }); G.audio.sign(); } },
      propGround: (x, z, y) => propGround(x, z, y),
      landed: (v) => { G.audio.land(v); if (v > 8) G.fx.dust(G.local.pos.x, G.local.pos.y + 0.1, G.local.pos.z, 2, 8); },
      mood: () => (performance.now() - (G.scaredAt || -1e9) < 3500 ? 3 : 0),
    },
  });
  G.local.init(w.name, w.pos);
  G.local.zone = w.pos.zone || 'surface';
  G.local.sensitivity = Number(store.get('tls_sens', '100')) / 100;
  setZone(G.local.zone, true);
  G.local.camera.position.set(w.pos.x, w.pos.y + 3, w.pos.z);
  bindDom();
  addEventListener('resize', onResize);
  // let the shaders compile before the first visible frame
  renderer.compile(scene, camera);
}

function archiveList(top = G.ui.top, recent = G.ui.entries) {
  const seen = new Set(), out = [];
  for (const e of top.slice(0, 4).concat(recent.slice(-10).reverse())) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out;
}

function onResize() {
  if (!G.renderer) return;
  G.renderer.setSize(innerWidth, innerHeight); G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
  G.post.resize(innerWidth, innerHeight, G.renderer.getPixelRatio());
}

// =============================================================================== DOM / pointer lock
function bindDom() {
  const canvas = $('c');
  document.addEventListener('pointerlockchange', () => {
    G.local.locked = document.pointerLockElement === canvas;
    if (!G.local.locked && G.ready && !G.ui.uiOpen() && G.started && !G.local.dead && !G.starting) { G.ui.openPause(`${G.name} · ${G.net.rtt | 0} ms`); refreshPause(); }
  });
  canvas.addEventListener('click', () => { if (G.ready && !G.ui.uiOpen() && !G.local.locked && !G.local.dead) lock(); });
  $('resume').addEventListener('click', () => { $('pause').hidden = true; lock(); });
  $('respawn').addEventListener('click', () => { G.net.send({ t: 'act', a: 'respawn' }); });
  $('vol').addEventListener('input', (e) => G.audio.setMaster(e.target.value / 100));
  $('voiceon').addEventListener('change', (e) => { G.audio.voiceOn = e.target.checked; });
  $('sens').addEventListener('input', (e) => { G.local.sensitivity = e.target.value / 100; store.set('tls_sens', e.target.value); });
  $('togglestream').addEventListener('click', () => { const on = !G.streaming; G.net.send({ t: 'act', a: 'stream', on, title: $('pstreamtitle').value }); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyP' && G.ready && !e.repeat && !G.ui.uiOpen()) { G.audio.setMuted(!G.audio.muted); G.ui.toast(G.audio.muted ? 'Muted' : 'Sound on'); } });
}
function lock() { try { const p = $('c').requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* */ } G.starting = false; }
function relock() { if (G.ready && !G.ui.panelOpen() && !G.local.dead && $('chatin').hidden) lock(); }
function refreshPause() {
  $('pause-stream').innerHTML = G.streaming ? `You are live. Viewer code: <b>${G.streamCode}</b>` : 'Not streaming. Going live gives you a viewer code; your audience can vote and nudge the world — and other streamers will feel it.';
  $('togglestream').textContent = G.streaming ? 'Stop streaming' : 'Go live';
}
function showStartPanel(entries, sinceMs, first, world) {
  G.starting = true;
  const el = $('digest');
  const age = fmtDuration(Date.now() + G.net.serverOffset - world.genesis);
  const away = sinceMs > 3e12 || first ? null : fmtDuration(sinceMs);
  const digest = entries.length ? entries.slice(-6).map((e) => G.ui.entryHTML(e)).join('') : '';
  el.innerHTML = `<h2 style="padding:16px 20px 0;color:var(--acc);font-family:var(--mono);letter-spacing:.25em;font-size:14px">${away ? `WHILE YOU WERE AWAY · ${away}` : 'YOU ARE CONNECTED'}</h2>
  <div style="padding:6px 20px 8px;color:#cfc9b8;font-size:14px;line-height:1.55">${away ? '' : `This world has been running for <b>${age}</b>. Nobody is scripting it. Everything you touch will still be here when you leave — and everything anyone else did already is.`}</div>
  <div style="padding:0 20px 10px;overflow:auto;max-height:44vh">${digest}</div>
  <div class="small dim" style="padding:0 20px 8px;line-height:1.8">There is no objective. <b>WASD</b> move · <b>E</b> talk · <b>1–4</b> tools (<b>2</b> charge, <b>3</b> plank, <b>4</b> sign) · <b>LMB</b> grab/throw · <b>Tab</b> Chronicle · <b>M</b> map · <b>F</b> clip · <b>Esc</b> pause</div>
  <div class="center" style="padding:12px"><button class="btn big" id="dg-ok">CLICK TO ENTER</button></div>`;
  el.hidden = false;
  $('dg-ok').onclick = () => { el.hidden = true; G.starting = false; lock(); };
}

// =============================================================================== NETWORK
function bindNet() {
  const net = G.net, W = G.world, ui = G.ui;
  net.on('snap', (m) => { G.entities.onSnap(m); G.objects.onSnapProps(m.pr, m.ts); });
  net.on('patch', (m) => { for (const [p, v] of m.ops) onPatch(p, v); });
  net.on('prop+', (m) => G.objects.addProp(m.p));
  net.on('prop-', (m) => G.objects.removeProp(m.id));
  net.on('held', (m) => {
    if (m.id === G.myId) { G.local.heldId = m.prop; if (m.prop) G.audio.grab(); else { G.local.charging = false; G.audio.throwSfx(0.5); } updateVitals(); }
    const e = G.entities.players.get(m.id); if (e) e.held = m.prop;
  });
  net.on('charge+', (m) => { G.objects.addCharge(m); });
  net.on('charge-', (m) => G.objects.removeCharge(m.id));
  net.on('pjoin', (m) => { G.entities.addPlayer(m.p); ui.chatLine('', `${m.p.name} entered the server`, true); });
  net.on('pleave', (m) => { const e = G.entities.players.get(m.id); if (e) ui.chatLine('', `${e.info.name} left`, true); G.entities.removePlayer(m.id); });
  net.on('plive', (m) => G.entities.setLive(m.id, m.live));
  net.on('chat', (m) => { if (m.id === G.myId) { ui.chatLine(m.name, m.text); return; } G.entities.chat(m.id, m.text); ui.chatLine(m.name + (m.live ? ' ●' : ''), m.text); });
  net.on('chron', (m) => { if (G.streaming && m.e.legend >= 40 && (m.e.tags || []).includes('stream:' + G.name)) ui.toast(`● CLIP THIS — ${m.e.clock} UTC · ${m.e.title}`, 'stream'); ui.addEntry(m.e); const cls = m.e.legend >= 60 ? 'legend' : m.e.kind === 'death' ? 'death' : ''; ui.feed(m.e, cls); G.archive.setEntries(archiveList()); });
  net.on('legend', (m) => { ui.legend(m.title, m.text); G.audio.legend(); });
  net.on('era', (m) => { ui.toast(`A NEW AGE: ${m.era.name}`, 'good'); });
  net.on('toast', (m) => ui.toast(m.text, m.kind));
  net.on('whisper', (m) => { ui.whisper(m.text); G.audio.tone({ f: 90, f2: 60, dur: 2.5, type: 'sine', peak: 0.2, wet: 0.8 }); });
  net.on('title', (m) => ui.toast(`The server has named you: ${m.title}`, 'good'));
  net.on('clip', (m) => { ui.clipMark(m.clock, m.title); G.audio.clip(); });
  net.on('stream', (m) => { G.streaming = !m.off; G.streamCode = m.code; ui.streamPanel(m); refreshPause(); });
  net.on('wear', (m) => G.tv.setWear(m.full || m.cells));
  net.on('you', (m) => { G.hp = m.hp; G.inv = m.inv; updateVitals(); });
  net.on('hurt', (m) => { G.hp = m.hp; G.post.hurt = 1; G.audio.hurt(); G.local.shake = Math.max(G.local.shake, 0.3); updateVitals(); });
  net.on('nameprompt', async (m) => {
    G.audio.ui('good');
    const name = await ui.ask(m.hint, 'name this place (3–28 chars)', 'The Cellar');
    if (name) net.send({ t: 'act', a: 'name', portal: m.portal, name });
  });
  net.on('died', (m) => { G.local.dead = true; G.local.deadT = 0; G.local.heldId = null; document.exitPointerLock?.(); ui.showDeath(m.cause, m.by, m.words); G.audio.death(); G.post.dark = 0.4; });
  net.on('tp', (m) => {
    G.local.teleport(m.x, m.y, m.z, m.zone, m.yaw);
    if (m.zone) setZone(m.zone);
    if (m.fx === 'descend') { G.post.warp = 1; G.audio.descend(); G.post.fade = 1; }
    if (m.fx === 'ascend') { G.post.warp = 0.7; G.audio.ascend(); G.post.fade = 1; }
    if (m.fx === 'respawn') { G.local.dead = false; ui.hideDeath(); G.post.dark = 0; lock(); }
  });
  net.on('shift', (m) => { G.local.pos.x += m.dx; G.local.pos.z += m.dz; });
  net.on('dialog', (m) => { ui.dialog(m.name, m.role, m.text); const e = G.entities.npcs.get(m.npc); G.audio.ui('tick'); if (e) speakBlips(e, m.text, m.mood); });
  net.on('sevent', (m) => onServerEvent(m));
  net.on('radio', (m) => onRadio(m));
  net.on('ev', (m) => onEvent(m));
  net.on('close', (e) => {
    if (!G.ready) return;
    G.ready = false; document.exitPointerLock?.();
    const replaced = e && e.code === 4000;
    $('title').hidden = false; $('enter').disabled = true;
    $('terr').textContent = replaced ? 'You joined from another tab. This session was closed.' : 'Connection lost — rejoining in a moment. The world is still here.';
    if (!replaced) setTimeout(() => location.reload(), 3500);
  });
  setInterval(() => net.ping(), 4000);
}

function onPatch(path, v) {
  const W = G.world;
  const parts = applyPatch(W, path, v);
  const k = parts[0];
  switch (k) {
    case 'buildings': {
      const id = parts[1]; const b = W.buildings[id];
      if (!b) { G.buildings.remove(id); G.col.remove(id); break; }
      G.col.set(id, buildingWorldBoxes(b));
      const had = G.buildings.views.has(id);
      if (!had || parts.length <= 2) G.buildings.patch(b); else if (parts[2] === 'hp') G.buildings.applyDamage(G.buildings.views.get(id));
      G.maskDirty = true;
      if (id === 'u_archive') G.archive.attach();
      break;
    }
    case 'craters': case 'erased': G.terrainDirty = true; break;
    case 'felled': G.tv.hideTree(+parts[1]); break;
    case 'planks': { const id = parts[1]; if (W.planks[id]) G.col.set(id, [plankWorldBox(W.planks[id])]); else G.col.remove(id); G.objects.onPatch(parts, v); break; }
    case 'signs': case 'graves': case 'monuments': case 'ghosts': G.objects.onPatch(parts, v); break;
    case 'portals': G.objects.onPatch(parts, v); if (parts[1] === 'hatch1' && (parts[2] === 'name' || parts.length === 2)) G.under.refreshSign(); break;
    case 'boards': G.buildings.setBoard(parts[1], W.boards[parts[1]]); break;
    case 'npcInfo': if (parts[2] === 'alive' && v === false) G.entities.removeNpc(parts[1]); break;
    case 'era': G.eraChanged = true; break;
    default:
  }
}

function speakBlips(e, text, mood) {
  const n = Math.min(40, Math.ceil(text.length / 2.4)); const p = e.info.voice || 1;
  for (let i = 0; i < n; i++) setTimeout(() => { if (G.audio) G.audio.npcBlip(p, e.g.position.x, e.g.position.y + 1.5, e.g.position.z, mood); }, i * 78);
}

function addShake(s, x, z, r) {
  const d = Math.hypot(G.local.pos.x - x, G.local.pos.z - z);
  const k = clamp(1 - d / r, 0, 1);
  if (k > 0) G.local.shake = Math.max(G.local.shake, s * k);
}

function onServerEvent(m) {
  const ui = G.ui;
  ui.banner(m.clock, m.title, m.text);
  G.audio.serverEvent(m.lead);
  const fx = m.fx || 'glitch';
  G.post.glitch = fx === 'glitch' || fx === 'static' ? 1 : 0.5;
  if (fx === 'shake') { G.local.shake = Math.max(G.local.shake, 0.8); }
  if (fx === 'darken') G.post.dark = 0.35, setTimeout(() => (G.post.dark = 0), 3500);
  if (fx === 'glow') G.bloomBoost = 1.6;
  if (fx === 'static') G.audio.radioStatic(1.5, 0.25);
  G.post.warp = Math.max(G.post.warp, 0.35);
  ui.chatLine('', `SERVER EVENT ${m.clock} — ${m.title}`, true);
  if (m.kind === 'discovery' || m.kind === 'clue') G.audio.legend();
  if (m.kind === 'building_moves') setTimeout(() => G.audio.bell?.(0, 0, 0), 0);
}

function onRadio(m) {
  G.ui.radio(m.from, m.text, m.dead);
  G.audio.radioStatic(m.dead ? 1.4 : 0.7, m.dead ? 0.24 : 0.14);
  setTimeout(() => G.audio.speak(m.text, { pitch: m.pitch || 1, dead: m.dead }), 500);
  if (m.dead) { G.post.glitch = Math.max(G.post.glitch, 0.55); G.local.shake = Math.max(G.local.shake, 0.1); }
}

function onEvent(m) {
  const fx = G.fx, au = G.audio, cam = G.camera;
  const dist = Math.hypot(m.x - G.local.pos.x, m.z - G.local.pos.z);
  switch (m.k) {
    case 'boom': {
      const y = m.y ?? G.terrain.height(m.x, m.z);
      fx.explosion(m.x, y, m.z, m.r, m.p, m.kd); au.boom(m.x, y, m.z, m.p || 1, dist);
      G.scaredAt = performance.now();
      if (dist < 70) G.post.hurt = Math.max(G.post.hurt, 0.0);
      G.terrainDirty = true; G.maskDirty = true; break;
    }
    case 'collapse': { const b = G.world.buildings[m.id]; fx.collapse(m.x, m.y + 0.5, m.z, m.w, m.d, m.h); au.collapse(m.x, m.y + 1, m.z); break; }
    case 'splash': { const y = G.world.lake?.level ?? 0; fx.splash(m.x, y, m.z, m.s); G.water.splash(m.x, m.z, m.s); au.splash(m.x, y, m.z, m.s); break; }
    case 'thud': au.thud(m.x, G.terrain.height(m.x, m.z) + 1, m.z, m.s); break;
    case 'quake': G.local.shake = Math.max(G.local.shake, 0.9 * m.s); au.tone({ f: 46, f2: 30, dur: 2.5, type: 'sawtooth', peak: 0.35, wet: 0.5 }); au.burst({ dur: 3, type: 'lowpass', f0: 300, f1: 40, peak: 0.5, buf: au.pink }); break;
    case 'chat': break;
    case 'emote': G.entities.emote(m.id, m.e); break;
    case 'npc_say': { const e = G.entities.ensureNpc(m.id); G.entities.say(m.id, m.text, m.ms); if (e && dist < 40) speakBlips(e, m.text, m.mood); break; }
    case 'npc_die': { const e = G.entities.npcs.get(m.id); if (e) fx.burst(e.g.position.x, e.g.position.y + 1, e.g.position.z, [0.6, 0.9, 1], 40, 3); G.entities.removeNpc(m.id); G.ui.toast(`${m.name} is gone. Permanently.`, 'warn'); break; }
    case 'shudder': { au.tone({ f: 60, f2: 40, dur: 2, type: 'sawtooth', peak: 0.3, wet: 0.6 }); G.local.shake = Math.max(G.local.shake, dist < 80 ? 0.5 : 0.15); G.post.glitch = Math.max(G.post.glitch, 0.4); break; }
    case 'meteor': { fx.meteor(m.x, m.z); au.meteor(m.x, 60, m.z); break; }
    case 'flare': fx.flare(m.x, m.z, m.color, m.ttl); G.ui.toast(`A ${m.color} flare rises${m.name ? ' near ' + m.name : ''}…`); break;
    case 'lightning': { const bx = m.bx ?? m.x, bz = m.bz ?? m.z; G.env.lightning(bx, bz, G.terrain.height(bx, bz)); au.thunder(Math.hypot(bx - G.local.pos.x, bz - G.local.pos.z) * 2.5, 1); break; }
    case 'gust': au.gust(); G.local.shake = Math.max(G.local.shake, 0.15); break;
    case 'lakepulse': G.water.pulse = 1; au.tone({ f: 220, f2: 330, dur: 3, peak: 0.2, wet: 0.8 }); break;
    case 'bus': au.tone({ f: 90, f2: 70, dur: 2.2, type: 'sawtooth', peak: 0.2, at: [m.x, 2, m.z, 20] }); break;
    case 'died': break;
    default:
  }
}

// =============================================================================== ZONES
function setZone(zone, force) {
  if (!force && G.zone === zone) { G.local.zone = zone; return; }
  G.zone = zone; G.local.zone = zone;
  const under = zone === 'under';
  G.underGroup.visible = under; G.tv.group.visible = !under; G.water.mesh.visible = !under; G.buildings.group.visible = !under; G.objects.group.visible = !under; G.entities.group.visible = true;
  G.env.under = under;
}

// =============================================================================== INTERACTION
function findInteract() {
  const L = G.local, p = L.pos;
  const npc = G.entities.nearestNpc(p, 3.6);
  if (npc) return { kind: 'npc', npc, label: `Talk to ${esc(npc.info.name)}` + (L.heldId ? ' · <b>G</b> give' : '') };
  const W = G.world;
  for (const id in W.portals) {
    const po = W.portals[id];
    if (po.zone !== L.zone) continue;
    const d = Math.hypot(po.x - p.x, po.z - p.z);
    if (po.kind === 'hatch') { if (d < (po.found ? 2.4 : 1.7) && Math.abs((po.y ?? p.y) - p.y) < 2) return { kind: 'portal', id, label: po.found ? `Descend to ${esc(po.name || 'the Understory')}` : 'Examine the rug' }; }
    else if (po.kind === 'sinkhole') { if (d < 3.4 && Math.abs(G.terrain.height(po.x, po.z) - p.y) < 6) return { kind: 'portal', id, label: 'Climb down the sinkhole' }; }
    else if (po.kind === 'ladder') { if (d < 2.6) return { kind: 'portal', id, label: 'Climb up to the surface' }; }
  }
  return null;
}
function interact() {
  const it = findInteract(); if (!it) return;
  if (it.kind === 'npc') G.net.send({ t: 'act', a: 'talk', npc: it.npc.id });
  else if (it.kind === 'portal') G.net.send({ t: 'act', a: 'use', what: 'portal', id: it.id });
}
function give() {
  const npc = G.entities.nearestNpc(G.local.pos, 3.6);
  if (npc && G.local.heldId) G.net.send({ t: 'act', a: 'gift', npc: npc.id }); else if (G.local.heldId) G.ui.toast('Nobody nearby to give it to.', 'warn');
}
function propGround(x, z, y) {
  let best = null;
  const tops = { crate: [0.3, 0.3], bigcrate: [0.5, 0.5], barrel: [0.45, 0.32], fuel: [0.45, 0.32], stone: [0.22, 0.2], tire: [0.14, 0.4], ball: [0.38, 0.3] };
  for (const e of G.objects.props.values()) {
    const t = tops[e.type]; if (!t || e.id === G.local.heldId) continue;
    const m = e.mesh.position;
    if (Math.abs(m.x - x) > t[1] || Math.abs(m.z - z) > t[1]) continue;
    const top = m.y + t[0];
    if (top <= y + 0.55 && (best == null || top > best)) best = top;
  }
  return best;
}
function updateVitals() {
  const held = G.local.heldId && G.objects.props.get(G.local.heldId);
  const inv = G.inv || { charges: 3, planks: 6, signs: 3 };
  G.ui.updateVitals(G.hp ?? 100, inv, G.local.tool, held ? (G.world.npcInfo ? held.meta?.name || held.type : held.type) : '');
}

// =============================================================================== FRAME
let last = performance.now(), hudT = 0, promptT = 0, lampT = 0, stepPhase = 0, mapT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!G.ready) { if (G.renderer) G.post.render(0.016, now / 1000, G.postState || defaultPostState()); return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const time = now / 1000;
  const W = G.world, L = G.local;
  const serverNow = G.net.serverNow();
  const tod = G.forceTod ?? todNow(W, serverNow);
  // menu / start-panel orbit camera
  const menu = G.starting || !L.locked && !G.ui.uiOpen() && false;
  L.frozen = !!G.starting;
  L.update(dt, serverNow, G.env);
  if (G.starting) {
    const a = time * 0.12, c = L.pos;
    G.camera.position.set(c.x + Math.sin(a) * 7, c.y + 3.2, c.z + Math.cos(a) * 7); G.camera.lookAt(c.x, c.y + 1.3, c.z);
  }
  // zone bookkeeping
  const under = L.zone === 'under';
  L.inside = G.buildings.insideBuilding(L.pos.x, L.pos.z, L.zone);
  // deferred terrain rebuild
  if (G.terrainDirty && (G.terrainT = (G.terrainT || 0) - dt) <= 0) { G.terrainDirty = false; G.terrainT = 0.35; G.terrain.applyMods(W.craters, W.erased); G.tv.rebuildMesh(); G.water.refreshDepth(); G.tv.hideErasedTrees(); }
  if (G.maskDirty && (G.maskT = (G.maskT || 0) - dt) <= 0) { G.maskDirty = false; G.maskT = 0.6; G.tv.refreshMask(); }
  // held prop follows the local view immediately
  if (L.heldId) { const e = G.objects.props.get(L.heldId); if (e) { const cp = Math.cos(L.pitch), d = 1.6; const tx = L.pos.x + Math.sin(L.yaw) * cp * d, tz = L.pos.z + Math.cos(L.yaw) * cp * d, ty = L.pos.y + 1.25 + Math.sin(L.pitch) * d * 0.8; e.mesh.position.lerp(new THREE.Vector3(tx, Math.max(ty, G.terrain.height(tx, tz) + 0.3), tz), 0.7); e.mesh.rotation.y = L.yaw; } }
  G.entities.update(dt, serverNow, G.camera, L.zone);
  G.objects.update(dt, time, serverNow, G.camera);
  // environment
  const blackout = W.lights?.blackoutUntil > serverNow;
  let fogLocal = 0;
  for (const id in W.fog || {}) { const f = W.fog[id]; if (f.until > serverNow) fogLocal = Math.max(fogLocal, clamp(1 - Math.hypot(f.x - L.pos.x, f.z - L.pos.z) / f.r, 0, 1)); }
  const underwater = !under && lakeDepth(G.camera.position) > 0.2 && G.camera.position.y < (W.lake?.level || 0) + 0.02;
  const es = G.env.update(dt, G.camera, { tod, weather: W.weather, sky: W.sky, serverNow, inside: !!L.inside, under, fogLocal, underwater });
  G.underwater = underwater;
  G.tv.update(dt, G.camera, time, G.env.wind, G.env, under);
  G.water.update(dt, time, G.env, W.lake);
  G.buildings.update(dt, time, G.env, blackout, L.inside, L.pos);
  G.fx.setSources(G.buildings.smokers);
  G.fx.update(dt, G.camera, time);
  G.under.update(dt, time, under);
  // ambient lamps
  lampT -= dt; if (lampT <= 0) { lampT = 0.15; assignLamps(); }
  // chapel bell rings when the server does something
  // footsteps
  if (L.onGround && L.speedH > 1) {
    const ph = L.bob;
    if (Math.floor(ph / 1.2) !== stepPhase) { stepPhase = Math.floor(ph / 1.2); footstep(); }
  }
  // audio
  const fwd = new THREE.Vector3(); G.camera.getWorldDirection(fwd);
  const dl = Math.hypot(L.pos.x - LAKE.x, L.pos.z - LAKE.z) - LAKE.r * 0.9;
  G.audio.update(dt, { under, inside: !!L.inside, wind: clamp(Math.hypot(W.weather.wx, W.weather.wz) * (0.4 + W.weather.i), 0, 1.5), rain: G.env.rainI, storm: W.weather.type === 'storm' ? 1 : 0, lakeDist: Math.max(0, dl), night: G.env.nightAmt, tension: (G.tension = (G.tension || 0) * 0.995), pos: G.camera.position, fwd });
  // charges beep
  for (const c of G.objects.charges.values()) { const left = (c.at - serverNow) / 1000; const rate = left < 1.2 ? 0.1 : left < 2.5 ? 0.25 : 0.55; if (!c.nb || time > c.nb) { c.nb = time + rate; G.audio.beepAt(c.g.position.x, c.g.position.y, c.g.position.z, left < 1.2); } }
  // prompts
  promptT -= dt; if (promptT <= 0) {
    promptT = 0.12;
    const it = L.dead || !L.locked ? null : findInteract();
    const canGrab = L.tool === 0 && !L.heldId && L.locked && !it && (G.crossProp = pickAimProp());
    G.ui.prompt(it ? `<b>E</b> ${it.label}` : canGrab ? `<b>LMB</b> Pick up ${esc(G.crossProp.meta?.name || G.crossProp.type)}` : L.heldId && L.locked && L.tool === 0 ? '<b>LMB</b> throw (hold to wind up) · <b>RMB</b> drop' : null);
    G.ui.crosshairHot(!!it || !!canGrab);
  }
  // HUD
  if (L.charging) updateVitals();
  hudT -= dt; if (hudT <= 0) {
    hudT = 0.25;
    G.ui.updateTop({ serverNow, tod, era: W.era, weather: W.weather.type, online: G.entities.players.size + 1, age: fmtDuration(serverNow - W.genesis), rtt: G.net.rtt, zoneLabel: under ? (W.portals.hatch1.name || 'The Understory') : districtAt(L.pos.x, L.pos.z, W.places) });
    updateVitals();
    if (!$('mapp').hidden) G.ui.drawMap();
  }
  // post
  const nightK = G.env.nightAmt;
  G.bloomBoost = Math.max(1, (G.bloomBoost || 1) - dt * 0.6);
  G.post.dark = Math.max(G.post.dark - (G.post.dark > 0 && !L.dead ? dt * 0.05 : 0), L.dead ? 0.45 : 0);
  G.post.fade = Math.max(0, G.post.fade - dt * 0.8);
  const sat = under ? 0.85 : 1.05 - G.env.cloudDark * 0.2 + (W.sky?.redUntil > serverNow ? 0.15 : 0);
  const tint = G.underwater ? [0.7, 1.0, 1.05] : W.sky?.redUntil > serverNow ? [1.1, 0.9, 0.85] : under ? [0.92, 1.02, 1.05] : [1, 1, 1];
  G.renderer.toneMappingExposure = 0.9 + nightK * 0.5 * (1 - G.env.eclipse) + G.env.twilight * 0.35;
  G.post.render(dt, time, { night: nightK, sat, tint, vignette: 0.4 + G.env.dim * 0.2 + (under ? 0.15 : 0), bloom: (0.38 + nightK * 0.25 + G.env.eclipse * 0.3) * G.bloomBoost });
}
function defaultPostState() { return { night: 0, sat: 1, tint: [1, 1, 1], vignette: 0.4, bloom: 0.4 }; }

function pickAimProp() {
  const cam = G.camera; const d = new THREE.Vector3(); cam.getWorldDirection(d);
  const eye = new THREE.Vector3(G.local.pos.x, G.local.pos.y + 1.6, G.local.pos.z);
  let best = null, bt = 5.2;
  for (const e of G.objects.props.values()) {
    if (e.id === G.local.heldId) continue;
    const v = e.mesh.position.clone().sub(eye); const along = v.dot(d); if (along < 0.2 || along > bt) continue;
    const perp = v.addScaledVector(d, -along).length(); if (perp < 0.75) { best = e; bt = along; }
  }
  return best;
}

function footstep() {
  const L = G.local, p = L.pos;
  let kind = 'grass';
  if (L.zone === 'under') kind = 'stone';
  else if (L.swim || (G.world.lake && lakeDepth(p) > 0.4)) { kind = 'water'; G.fx.splash(p.x, (G.world.lake?.level || 0), p.z, 0.25); }
  else if (L.inside || G.terrain.height(p.x, p.z) < p.y - 0.14) kind = 'wood';
  else if (p.y < 1.1) kind = 'sand';
  else { const i = Math.floor((p.x + HALF) / 4), j = Math.floor((p.z + HALF) / 4); const w = G.tv.wear[j * 160 + i] || 0; kind = w > 60 ? 'dirt' : 'grass'; }
  G.audio.step(kind, L.speedH > 6);
}
function lakeDepth(p) { const dl = Math.hypot(p.x - LAKE.x, p.z - LAKE.z); if (dl > LAKE.r * 1.1) return 0; return Math.max(0, (G.world.lake?.level || 0) - G.terrain.height(p.x, p.z)); }

function assignLamps() {
  const cam = G.camera.position, zone = G.local.zone;
  const cands = [];
  for (const l of G.buildings.lamps) if (l.on && l.zone === zone) { const d = l.world.distanceTo(cam); if (d < 45) cands.push([d, l]); }
  // candles in the chapel etc. handled by emissive only
  cands.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < G.lampPool.length; i++) {
    const L = G.lampPool[i], c = cands[i];
    if (c) { L.position.copy(c[1].world); L.color.set(c[1].color); L.intensity = c[1].intensity * (zone === 'under' ? 9 : 5); L.distance = c[1].dist + 4; }
    else L.intensity = 0;
  }
}
