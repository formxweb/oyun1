// Headless-browser screenshot harness for visual verification: node tools/shot.mjs '<json shots>' [quality]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const shots = JSON.parse(process.argv[2] || '[{"name":"default"}]');
const quality = process.argv[3] || 'medium';
const PORT = 8600 + Math.floor(Math.random() * 300);
const DATA = path.resolve('.scratch/shot-data');
if (!process.env.KEEP) fs.rmSync(DATA, { recursive: true, force: true });
const OUT = path.resolve('.scratch/shots'); fs.mkdirSync(OUT, { recursive: true });
const proc = spawn('node', ['server/index.js'], { env: { ...process.env, DEV: '1', PORT, DATA_DIR: DATA, PACE: process.env.PACE || 'normal' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => proc.stdout.on('data', (d) => { if (d.toString().includes('is up')) res(); }));
proc.stderr.on('data', (d) => console.log('[server err]', d.toString().trim()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { logs.push(`[${m.type()}] ${t}`); } });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto(`http://localhost:${PORT}/?name=Shooter`);
await page.selectOption('#pquality', quality);
page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) logs.push('[http ' + r.status() + '] ' + r.url()); });
try { await page.waitForFunction(() => !document.getElementById('enter').disabled, null, { timeout: 15000 }); } catch (e) { console.log('TITLE FAILED'); console.log(logs.join('\n')); await browser.close(); proc.kill(); process.exit(1); }
await page.click('#enter');
try { await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 }); }
catch (e) { console.log('LOAD FAILED', e.message); console.log(logs.join('\n')); await page.screenshot({ path: OUT + '/fail.png' }); await browser.close(); proc.kill(); process.exit(1); }
await page.waitForTimeout(1500);
for (const s of shots) {
  await page.evaluate((s) => {
    const G = window.__game;
    if (s.click) document.getElementById('dg-ok')?.click();
    if (s.lock) { G.local.locked = true; G.starting = false; }
    if (s.hideUI) { document.getElementById('digest').hidden = true; G.starting = false; }
    if (s.tod != null) G.forceTod = s.tod;
    if (s.weather) Object.assign(G.world.weather, s.weather);
    if (s.pos) { G.local.teleport(s.pos[0], s.pos[3] ?? G.terrain.height(s.pos[0], s.pos[1]) + (s.pos[2] || 0), s.pos[1], s.zone || 'surface', s.yaw ?? 0); if (s.zone) { G.setZone?.(s.zone); } }
    if (s.yaw != null) G.local.yaw = s.yaw;
    if (s.pitch != null) G.local.pitch = s.pitch;
    if (s.fp != null) G.local.firstPerson = s.fp;
    if (s.eval) eval(s.eval);
  }, s);
  await page.waitForTimeout(s.wait ?? 1500);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('shot', s.name);
}
console.log(logs.length ? 'LOGS:\n' + [...new Set(logs)].slice(0, 30).join('\n') : 'no console errors');
await browser.close(); proc.kill();
process.exit(0);
