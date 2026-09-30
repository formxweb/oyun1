// HTTP + WebSocket front door for THE LAST SERVER.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { CFG } from './config.js';
import { fmtDuration } from '../shared/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const gzCache = new Map();

function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

function resolveFile(url) {
  let p = decodeURIComponent(url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/viewer') p = '/viewer.html';
  if (p.startsWith('/vendor/three/')) {
    const rel = p.slice('/vendor/three/'.length);
    if (!/^(build|examples\/jsm)\//.test(rel)) return null;
    return safeJoin(path.join(ROOT, 'node_modules', 'three'), rel);
  }
  if (p.startsWith('/shared/')) return safeJoin(path.join(ROOT, 'shared'), p.slice('/shared/'.length));
  return safeJoin(path.join(ROOT, 'public'), p.slice(1));
}

function serveStatic(req, res) {
  const file = resolveFile(req.url);
  if (!file) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': req.url.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache' };
    const accept = req.headers['accept-encoding'] || '';
    const compressible = /\.(js|mjs|html|css|json|svg)$/.test(ext);
    if (compressible && /\bgzip\b/.test(accept)) {
      const c = gzCache.get(file);
      if (c && c.mtime === st.mtimeMs) { res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': c.buf.length }); return res.end(c.buf); }
      fs.readFile(file, (e, data) => {
        if (e) { res.writeHead(500); return res.end(); }
        const buf = zlib.gzipSync(data, { level: 6 });
        gzCache.set(file, { mtime: st.mtimeMs, buf });
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length });
        res.end(buf);
      });
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

async function main() {
  const game = await Game.create();
  game.startLoops();

  const server = http.createServer((req, res) => {
    const u = req.url || '/';
    if (u.startsWith('/api/')) return api(game, u, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });
  const perIp = new Map();
  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const n = (perIp.get(ip) || 0) + 1;
    if (n > 12) { ws.close(1008, 'too many connections'); return; }
    perIp.set(ip, n);
    const role = /[?&]role=viewer/.test(req.url || '') ? 'viewer' : 'player';
    const s = game.addSession(ws, role);
    s.ip = ip;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      try { game.handle(s, m); } catch (e) { console.warn('[ws] handler error', e); }
    });
    const done = (why) => { perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1)); game.dropSession(s, why); };
    ws.on('close', () => done('closed'));
    ws.on('error', () => done('error'));
    // never hold a socket that does not say hello
    setTimeout(() => { if (!s.ready && ws.readyState === 1) ws.close(1008, 'no hello'); }, 15000);
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch { /* */ } } }, 30000);

  server.listen(CFG.port, () => {
    console.log(`\n  THE LAST SERVER is up → http://localhost:${CFG.port}   (pace: ${CFG.fast ? 'FAST demo' : 'normal'})\n`);
  });

  const stop = () => { console.log('\n[shutdown] saving the world…'); game.shutdown(); setTimeout(() => process.exit(0), 300); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function api(game, url, res) {
  const j = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  const u = new URL(url, 'http://x');
  const pub = game.pub;
  if (u.pathname === '/api/status') {
    const b = Object.values(pub.buildings).filter((x) => x.zone === 'surface');
    return j({
      name: 'THE LAST SERVER', online: game.players().length, era: pub.era, age: fmtDuration(Date.now() - pub.genesis), genesis: pub.genesis,
      events: pub.stats.events, destroyed: pub.stats.destroyed, npcs: game.npcs.list.size, buildingsStanding: b.filter((x) => !x.ruined).length, buildingsTotal: b.length,
      understoryFound: pub.portals.hatch1.found, lake: pub.lake, tod: Math.round(game.tod() * 100) / 100, weather: pub.weather.type,
    });
  }
  if (u.pathname === '/api/chronicle') {
    const limit = Math.min(300, Number(u.searchParams.get('limit') || 80));
    const list = u.searchParams.get('legends') ? game.chron.top(limit) : game.chron.last(limit).reverse();
    return j({ entries: list });
  }
  if (u.pathname === '/api/streams') {
    return j({ streams: [...game.streams.byCode.values()].map((s) => ({ name: s.name, title: s.stream.title, viewers: s.stream.viewers.size })) });
  }
  j({ error: 'unknown endpoint' }, 404);
}

main().catch((e) => { console.error(e); process.exit(1); });
