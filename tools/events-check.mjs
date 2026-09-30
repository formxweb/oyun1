// In-process smoke test: run every Director event once against a fake player and let the delayed effects fire.
process.env.DATA_DIR = process.env.DATA_DIR || '.scratch/events-data';
process.env.PACE = 'fast';
import fs from 'node:fs';
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const { Game } = await import('../server/game.js');
const g = await Game.create();
const sent = [];
const ws = { readyState: 1, send: (m) => sent.push(JSON.parse(m)), close() {} };
const s = g.addSession(ws, 'player');
g.hello(s, { name: 'Tester', token: 'x'.repeat(40), streamer: false });
s.rec.stats.offerings = 3; s.rec.stats.destroyed = 4; s.rec.stats.discoveries = 1; s.rec.notoriety = 80; s.rec.lastWords = { text: 'hello', at: 1 };
g.director.st.deaths.push({ name: 'Ghost', text: 'was I ever here?', npc: false, pitch: 1, at: Date.now(), aired: false });
g.director.st.ledger.push({ id: 'o1', pid: s.pid, name: 'Tester', type: 'stone', label: 'a stone', ts: Date.now() - 5000, x: 20, z: -30, due: 0, paid: false });
const players = g.players();
let failed = 0;
for (const ev of g.director.events) {
  const ctx = g.director.context(Date.now(), players);
  if (ev.kind === 'lake_returns') ctx.due = g.director.st.ledger[0];
  try { const r = ev.run(ctx); console.log(r === false ? '  - skipped ' : '  ✓ ran     ', ev.kind); }
  catch (e) { failed++; console.log('  ✗ FAILED  ', ev.kind, e); }
}
// let leads elapse & step the world
for (let i = 0; i < 90; i++) { g.frame(1 / 30, Date.now()); await new Promise((r) => setTimeout(r, 200)); }
const kinds = new Set(sent.map((m) => m.t));
console.log('message kinds delivered:', [...kinds].join(', '));
console.log('sevents:', sent.filter((m) => m.t === 'sevent').map((m) => m.title).join(' | '));
g.shutdown();
console.log(failed ? `${failed} FAILED` : 'all events ran without throwing');
process.exit(failed ? 1 : 0);
