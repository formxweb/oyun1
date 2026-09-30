// Renders the pristine world (terrain, lake, roads, buildings, trees) to a PNG for layout tuning.
import zlib from 'node:zlib';
import fs from 'node:fs';
import { Terrain, HALF, CELL } from '../shared/terrain.js';
import { genTrees, genRocks, roadDist } from '../shared/scatter.js';
import { INITIAL_BUILDINGS, BTYPES, WATER_LEVEL, SPAWN } from '../shared/layout.js';

const t0 = Date.now();
const terrain = new Terrain();
console.log('terrain built in', Date.now() - t0, 'ms');
const trees = genTrees(terrain), rocks = genRocks(terrain);
console.log('trees', trees.length, 'rocks', rocks.length);
const S = 640, sc = 1;
const px = Buffer.alloc(S * S * 3);
const put = (x, z, r, g, b) => { const i = Math.floor(x + HALF), j = Math.floor(z + HALF); if (i < 0 || j < 0 || i >= S || j >= S) return; const o = (j * S + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; };
const L = [-0.5, -0.7, -0.5];
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const x = i - HALF + 0.5, z = j - HALF + 0.5;
  const h = terrain.height(x, z);
  const hx = terrain.height(x + 2, z) - terrain.height(x - 2, z), hz = terrain.height(x, z + 2) - terrain.height(x, z - 2);
  const shade = Math.max(0.25, Math.min(1.3, 0.75 - (hx * L[0] + hz * L[2]) * 0.35));
  let r, g, b;
  if (h < WATER_LEVEL) { const d = Math.min(1, -h / 9); r = 30 - d * 18; g = 80 - d * 30; b = 120 - d * 30; }
  else if (h < 1.0) { r = 190; g = 175; b = 130; }
  else { const t = Math.min(1, h / 80); r = (70 + t * 120) * shade; g = (110 + t * 60) * shade; b = (60 + t * 90) * shade; }
  const o = (j * S + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b;
  const rd = roadDist(x, z); if (rd.d < rd.hw && h > 0) { px[o] = 70; px[o + 1] = 70; px[o + 2] = 74; }
}
for (const t of trees) put(t[0], t[1], 20, 70, 30);
for (const r of rocks) put(r[0], r[1], 130, 130, 130);
for (const b of INITIAL_BUILDINGS) {
  const T = BTYPES[b.type]; const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  for (let a = -T.w / 2; a <= T.w / 2; a += 0.5) for (let d = -T.d / 2; d <= T.d / 2; d += 0.5) put(b.x + a * c + d * s, b.z - a * s + d * c, 220, 60, 50);
}
put(SPAWN.x, SPAWN.z, 255, 255, 0);
// PNG encode
const raw = Buffer.alloc((S * 3 + 1) * S);
for (let j = 0; j < S; j++) { raw[j * (S * 3 + 1)] = 0; px.copy(raw, j * (S * 3 + 1) + 1, j * S * 3, (j + 1) * S * 3); }
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync('.scratch', { recursive: true });
fs.writeFileSync(process.argv[2] || '.scratch/map.png', png);
// spot checks
for (const b of INITIAL_BUILDINGS) console.log(b.id.padEnd(14), 'terrain', terrain.height(b.x, b.z).toFixed(2));
for (const z of [-40, -20, -10, 0, 4, 8, 12, 16, 24]) console.log('pier col x=10 z=', z, terrain.height(10, z).toFixed(2));
