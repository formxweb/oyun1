// Simulate the town for a while at different hours and verify NPCs actually reach where their routine says.
process.env.DATA_DIR = '.scratch/npc-data';
import fs from 'node:fs';
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const { Game } = await import('../server/game.js');
const { BTYPES } = await import('../shared/layout.js');
const { insideFootprint } = await import('../shared/collide.js');
const g = await Game.create();
const wsF = { readyState: 1, send() {}, close() {} };
let simNow = Date.now();
const report = (label) => {
  console.log(`\n== ${label} (tod ${g.tod().toFixed(1)}) ==`);
  for (const n of g.npcs.list.values()) {
    const a = g.npcs.activity(n, g.tod());
    const b = g.npcs.buildingAt(n.x, n.z);
    let want = a.bid ? g.pub.buildings[a.bid] : null;
    let ok = '';
    if (want) { const tgt = g.npcs.localToWorld(want, a.at[0], a.at[1]); const d = Math.hypot(tgt.x - n.x, tgt.z - n.z); ok = d < 2.5 ? 'OK ' : `far ${d.toFixed(0)}m`; }
    else if (a.x != null) { const d = Math.hypot(a.x - n.x, a.z - n.z); ok = d < 4 ? 'OK ' : `far ${d.toFixed(0)}m`; }
    else ok = '~ wander';
    console.log(`  ${n.def.name.padEnd(20)} ${String(a.kind).padEnd(7)} in:${(b ? b.name : '-').padEnd(24)} at (${n.x.toFixed(0)},${n.z.toFixed(0)}) act=${n.act} ${ok}` + (ok.startsWith('far') ? ` | state=${n.state} path=${n.path.map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)})`).join('')} stuck=${n.stuck.toFixed(1)} replans=${n.replans || 0} tgt=${n.target && n.target.x.toFixed(0) + ',' + n.target.z.toFixed(0)}` : ''));
  }
};
for (const [tod, label] of [[7, 'early'], [10, 'morning work'], [12.4, 'lunch'], [15, 'afternoon'], [19.5, 'evening social'], [23, 'late'], [3, 'deep night'], [6.8, 'dawn']]) {
  g.world.setClock(tod, 0);
  for (const n of g.npcs.list.values()) { n.nextThink = 0; n.target = null; n.path = []; n.social = null; }
  for (let i = 0; i < 4500; i++) { simNow += 100; g.npcs.update(0.1, simNow, []); }
  report(label);
}
g.shutdown(); process.exit(0);
