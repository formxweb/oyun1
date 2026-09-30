// End-to-end check of the persistent-world loop: join → act → consequences → restart → still there.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Bot, sleep } from './bot.js';

const PORT = 8200 + Math.floor(Math.random() * 500);
const DATA = path.resolve('.scratch/selftest-data');
fs.rmSync(DATA, { recursive: true, force: true });
const url = `ws://localhost:${PORT}/ws`;
let proc;
const start = () => new Promise((res, rej) => {
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: DATA, PACE: 'fast' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { if (process.env.VERBOSE) process.stdout.write(d); if (d.toString().includes('is up')) res(); });
  proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  proc.on('exit', (c) => { if (c) rej(new Error('server exited ' + c)); });
});
const stop = () => new Promise((res) => { proc.once('exit', res); proc.kill('SIGTERM'); });
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

try {
  console.log('\nTHE LAST SERVER — self test');
  await start();
  const A = new Bot(url, 'Alpha');
  const w = await A.connect();
  assert.ok(Object.keys(w.world.buildings).length >= 17, 'buildings present'); ok('welcome carries the persistent world (buildings, npcs, props)');
  assert.ok(w.npcs.length === 11 && w.props.length > 20 && w.trees.length > 1000);
  assert.equal(w.world.buildings.b_diner.ruined, undefined);

  // --- grab & throw a crate near spawn
  const crate = [...A.props.values()].find((p) => p.ty === 'crate' && Math.hypot(p.pose[0] - A.pos.x, p.pose[2] - A.pos.z) < 20);
  await A.walkTo(crate.pose[0] + 1.5, crate.pose[2], 6);
  let aim = A.aimAt(...crate.pose.slice(0, 3));
  A.act('grab', aim);
  const held = await A.waitFor('held', (m) => m.id === A.id && m.prop);
  assert.ok(held.prop); ok('player can grab a physics prop');
  aim = A.aimAt(A.pos.x - 10, A.pos.y + 4, A.pos.z);
  A.act('throw', { ...aim, power: 0.8 });
  await A.waitFor('held', (m) => m.id === A.id && !m.prop);
  ok('player can throw it');

  // --- destroy the garage with charges (walk there, 3 charges)
  const garage = w.world.buildings.b_garage;
  await A.walkTo(garage.x + 1, garage.z + 12, 8);
  for (let i = 0; i < 3; i++) {
    aim = A.aimAt(garage.x + 1, garage.floorY + 1, garage.z + 3);
    A.act('charge', aim);
    await sleep(120);
  }
  await A.walkTo(garage.x + 40, garage.z + 20, 9);
  await A.waitFor('patch', (m) => m.ops.some(([p, v]) => p === `buildings.${garage.id}` && v && v.ruined), 15000);
  ok('three charges bring down Dutch’s Garage — permanently');
  const chron = await A.waitFor('chron', (m) => m.e.kind === 'destroyed');
  assert.match(chron.e.text, /Alpha/); ok('the Chronicle records who did it');
  assert.ok(Object.values(A.world.buildings).some((b) => b.id.startsWith('u_b_garage')), 'relocated under');
  ok('the destroyed garage is reborn in the Understory');
  assert.ok(Object.keys(A.world.craters).length > 0); ok('the explosion scarred the terrain (craters)');
  const firsts = A.world.firsts; assert.ok(firsts.demolish && firsts.explode); ok('“firsts” are written into history');

  // --- streamer + viewer
  const B = new Bot(url, 'Bravo', { streamer: true });
  const wb = await B.connect();
  const streamMsg = await B.waitFor('stream');
  assert.ok(streamMsg.code && streamMsg.code.length === 6); ok('streamer receives a viewer code');
  const V = new Bot(url, 'Viewer1', { role: 'viewer', code: streamMsg.code });
  const vw = await V.connect();
  assert.ok(vw.fx.length >= 6); ok('viewer joins the stream and sees the influence menu');
  await sleep(4500); // points regen fast in PACE=fast
  V.send({ t: 'fx', k: 'gust' });
  const ch = await A.waitFor('chron', (m) => m.e.kind === 'viewers', 6000);
  assert.match(ch.e.text, /Bravo/); ok('a viewer’s influence lands in the shared world and Chronicle');

  // --- the Director speaks
  const ev = await A.waitFor('sevent', () => true, 90000);
  assert.match(ev.clock, /^\d\d:\d\d:\d\d$/); ok(`SERVER EVENT ${ev.clock} — “${ev.title}”`);

  // --- persistence
  const before = Object.keys(A.world.craters).length;
  const chronCountBefore = (await (await fetch(`http://localhost:${PORT}/api/chronicle?limit=300`)).json()).entries.length;
  A.close(); B.close(); V.close();
  await sleep(300);
  await stop();
  await start();
  const A2 = new Bot(url, 'Alpha', { token: A.token });
  const w2 = await A2.connect();
  assert.equal(w2.world.buildings.b_garage.ruined, true); ok('after a full server restart the garage is STILL destroyed');
  assert.ok(Object.keys(w2.world.craters).length >= before); ok('craters persisted');
  const all = w2.chronicle.recent;
  const deaths = all.filter((e) => e.kind === 'npc_death').length, arrivals = all.filter((e) => e.kind === 'event:arrival').length;
  assert.equal(w2.npcs.length, 11 - deaths + arrivals); ok(`NPC population is remembered (${deaths} dead stay dead, ${arrivals} arrived)`);
  assert.ok(w2.chronicle.recent.length >= chronCountBefore - 5); ok('the Chronicle survived the restart');
  assert.ok(Array.isArray(w2.digest) && w2.sinceMs >= 0); ok('returning players are told how long they were away and what changed');
  A2.close();
  await sleep(200);
  await stop();
  console.log(`\n${passed} checks passed.\n`);
  process.exit(0);
} catch (e) {
  console.error('\nFAILED:', e);
  try { proc.kill('SIGKILL'); } catch { /* */ }
  process.exit(1);
}
