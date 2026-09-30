// Viewer console: join a streamer by code, vote in polls, spend influence, clip moments, read the live Chronicle.
import { Net, clockStr } from './net.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const net = new Net();
let fxList = [], state = null, entries = [], top = [], tab = 'live';

async function loadLive() {
  try {
    const s = await (await fetch('/api/streams')).json();
    $('live').innerHTML = s.streams.length ? s.streams.map((x) => `<div><b>${esc(x.name)}</b> — ${esc(x.title)} <span class="dim">(${x.viewers} watching)</span></div>`).join('') + '<div class="dim" style="margin-top:6px">Ask the streamer for their code.</div>' : 'Nobody is streaming right now.';
    const c = await (await fetch('/api/chronicle?limit=60')).json(); entries = c.entries.reverse();
    const l = await (await fetch('/api/chronicle?legends=1&limit=25')).json(); top = l.entries;
    renderHist();
  } catch { $('live').textContent = 'The server is not answering.'; }
}
loadLive(); setInterval(() => { if (!net.open) loadLive(); }, 10000);

const p = new URLSearchParams(location.search);
if (p.get('code')) $('code').value = p.get('code');
$('jf').addEventListener('submit', async (e) => {
  e.preventDefault(); $('err').textContent = '';
  try {
    const w = await net.connect({ t: 'hello', code: $('code').value.trim(), name: $('vname').value.trim() }, { viewer: true });
    fxList = w.fx; entries = w.recent.slice().reverse(); top = w.top;
    $('join').hidden = true; $('console').hidden = false; $('conn').textContent = 'connected'; $('conn').classList.add('on');
    $('sname').textContent = w.streamer; $('stitle').textContent = w.title;
    renderFx(); renderHist();
  } catch (err) { $('err').textContent = err.message; }
});
net.on('vstate', (m) => { state = m; $('points').textContent = m.points; $('where').textContent = m.where; $('hp').textContent = m.hp; $('vw').textContent = m.viewers; renderPoll(m); renderFx(); });
net.on('vtoast', (m) => { $('toast').textContent = m.text; });
net.on('vclip', (m) => { $('toast').textContent = `Clipped ${m.clock} — ${m.title}`; });
net.on('vend', () => { $('toast').textContent = 'The stream ended.'; $('conn').textContent = 'stream ended'; $('conn').classList.remove('on'); });
net.on('chron', (m) => { entries.unshift(m.e); if (entries.length > 80) entries.pop(); if (m.e.legend >= 40) { top.push(m.e); top.sort((a, b) => b.legend - a.legend); } renderHist(); });
net.on('sevent', (m) => { $('toast').textContent = `SERVER EVENT ${m.clock} — ${m.title}`; });
net.on('close', () => { $('conn').textContent = 'offline'; $('conn').classList.remove('on'); });

function renderPoll(m) {
  const el = $('poll');
  if (!m.poll) { el.hidden = true; return; }
  const tot = m.poll.votes.reduce((a, b) => a + b, 0) || 1;
  el.hidden = false;
  el.innerHTML = `<h4>CHAT DECIDES · ends in ${Math.max(0, Math.round((m.poll.endsAt - net.serverNow()) / 1000))}s</h4>` + m.poll.opts.map((o, i) => `<button class="popt ${m.poll.mine === i ? 'mine' : ''}" data-i="${i}"><i style="width:${(m.poll.votes[i] / tot) * 100}%"></i><span>${esc(o)} — ${m.poll.votes[i]}</span></button>`).join('');
  for (const b of el.querySelectorAll('.popt')) b.onclick = () => net.send({ t: 'vote', opt: +b.dataset.i });
}
function renderFx() {
  const el = $('fx');
  el.innerHTML = fxList.map((f) => { const cd = state?.cd?.[f.k] || 0; const dis = !state || state.points < f.cost || cd > 0; return `<button class="fxb" data-k="${f.k}" ${dis ? 'disabled' : ''}><b>${esc(f.label)}<span class="cost">${f.cost}</span></b><small>${cd > 0 ? `cooling down ${Math.ceil(cd)}s` : esc(f.desc)}</small></button>`; }).join('');
  for (const b of el.querySelectorAll('.fxb')) b.onclick = () => net.send({ t: 'fx', k: b.dataset.k, text: $('whisper').value });
}
$('clip').onclick = () => net.send({ t: 'clip' });
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => { tab = b.dataset.t; for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b); renderHist(); };
function renderHist() {
  const list = tab === 'live' ? entries : top;
  $('hist').innerHTML = list.slice(0, 60).map((e) => {
    const streams = (e.tags || []).filter((t) => t.startsWith('stream:')).map((t) => t.slice(7));
    const cls = e.legend >= 60 ? 'legend' : (e.kind || '').startsWith('event:') ? 'ev' : '';
    return `<div class="entry ${cls}"><div class="ck">${esc(e.clock)}</div><div><div class="tt">${esc(e.title)}${e.legend >= 40 ? ' ★' : ''}</div><div class="tx">${esc(e.text)}</div>${streams.length ? `<div class="stream">● seen on ${streams.map(esc).join(', ')}'s stream — jump to ${esc(e.clock)} UTC</div>` : ''}</div></div>`;
  }).join('') || '<div class="dim">Nothing yet.</div>';
}
setInterval(() => { if (state?.poll) renderPoll(state); }, 1000);
