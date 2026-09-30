// Populates a running dev server with wandering, throwing, building, occasionally destructive bots.
//   node tools/bots.js [count=4] [seconds=120] [url=ws://localhost:8080/ws]
import { Bot, sleep } from './bot.js';

const N = Number(process.argv[2] || 4), SECS = Number(process.argv[3] || 120), URL = process.argv[4] || 'ws://localhost:8080/ws';
const NAMES = ['Rook', 'Vex', 'Marlo', 'Ingrid', 'Tam', 'Juno', 'Kestrel', 'Odd', 'Pip', 'Nyx'];
const PHRASES = ['anyone seen the gnome?', 'the lake is glowing', 'what was that noise', 'i think the diner moved', 'hello?', 'do not throw the barrels', 'follow me', 'who is running this place', 'lol', 'the sky is wrong'];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function run(i) {
  const bot = new Bot(URL, NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''), { streamer: i === 0 });
  await bot.connect();
  const end = Date.now() + SECS * 1000;
  bot.on('sevent', (m) => console.log(`[${bot.name}] SERVER EVENT ${m.clock} — ${m.title}`));
  bot.on('toast', (m) => { if (process.env.VERBOSE) console.log(`[${bot.name}] toast: ${m.text}`); });
  bot.on('died', (m) => { setTimeout(() => bot.act('respawn'), 1500); });
  while (Date.now() < end) {
    try {
      if (bot.zone !== 'surface' && Math.random() < 0.1) bot.send({ t: 'act', a: 'use', what: 'portal', id: 'ladder1' });
      const r = Math.random();
      const b = bot.world.buildings;
      if (r < 0.32) { // stroll around town
        await bot.walkTo(rand(-80, 100), rand(46, 62), 7, 25000);
      } else if (r < 0.52) { // feed the lake
        const props = [...bot.props.values()].filter((p) => ['stone', 'crate', 'barrel', 'ball', 'lantern', 'gnome'].includes(p.ty));
        const p = pick(props);
        if (p) {
          await bot.walkTo(p.pose[0] + 1.2, p.pose[2], 8, 25000);
          bot.act('grab', bot.aimAt(p.pose[0], p.pose[1], p.pose[2])); await sleep(500);
          if (bot.held) {
            await bot.walkTo(rand(0, 30), rand(6, 9), 8, 25000);
            bot.act('throw', { ...bot.aimAt(30, 0.5, -30), power: 0.9 }); await sleep(800);
          }
        }
      } else if (r < 0.60) { // demolition
        const list = Object.values(b).filter((x) => x.zone === 'surface' && !x.ruined && ['house', 'cottage', 'garage', 'store'].includes(x.type));
        const t = pick(list);
        if (t) { await bot.walkTo(t.x + 2, t.z + 11, 8, 25000); for (let k = 0; k < 3; k++) { bot.act('charge', bot.aimAt(t.x, t.floorY + 1, t.z + 3)); await sleep(200); } await bot.walkTo(t.x + 40, t.z + 25, 9, 20000); await sleep(3000); }
      } else if (r < 0.72) { bot.send({ t: 'act', a: 'chat', text: pick(PHRASES) }); await sleep(rand(400, 1500)); }
      else if (r < 0.82) { await bot.walkTo(rand(10, 60), rand(48, 58), 7, 20000); bot.act('plank', { ...bot.aimAt(bot.pos.x + Math.sin(bot.yaw) * 4, bot.pos.y, bot.pos.z + Math.cos(bot.yaw) * 4), yaw: bot.yaw }); await sleep(500); }
      else if (r < 0.88) { bot.act('sign', { ...bot.aimAt(bot.pos.x + Math.sin(bot.yaw) * 3, bot.pos.y, bot.pos.z + Math.cos(bot.yaw) * 3), text: pick(['THE LAKE IS WATCHING', 'DO NOT TRUST THE BILLBOARD', 'PIET WAS HERE', 'NOTHING TO SEE']) }); await sleep(600); }
      else if (r < 0.93) { // find the way down
        const po = bot.world.portals.hatch1;
        await bot.walkTo(po.x + 0.3, po.z + 0.3, 8, 90000);
        bot.send({ t: 'act', a: 'use', what: 'portal', id: 'hatch1' }); await sleep(1500);
        bot.send({ t: 'act', a: 'name', portal: 'hatch1', name: 'The Cellar of Regrets' }); await sleep(3000);
      } else {
        const npcs = bot.lastNpcs || [];
        await sleep(rand(500, 2000));
      }
    } catch (e) { console.log(`[${bot.name}] ${e.message}`); await sleep(500); }
  }
  bot.close();
}

console.log(`starting ${N} bots for ${SECS}s against ${URL}`);
await Promise.all(Array.from({ length: N }, (_, i) => sleep(i * 700).then(() => run(i))));
console.log('bots finished');
process.exit(0);
