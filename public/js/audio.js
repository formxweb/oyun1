// Fully synthesized soundscape: wind, rain, lake, crickets, birds, drones, footsteps, explosions, thunder,
// NPC voice blips, radio static + speech synthesis for the dead. No audio assets.
export class AudioSys {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    this.rev = c.createConvolver(); this.rev.buffer = this.impulse(2.6, 2.8); this.revGain = c.createGain(); this.revGain.gain.value = 0.35; this.rev.connect(this.revGain); this.revGain.connect(this.master);
    this.noise = this.noiseBuf(3);
    this.pink = this.pinkBuf(4);
    this.voiceOn = true; this.muted = false;
    this.startAmbience();
    this.lastStep = 0;
    this.speechLast = 0;
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  setMaster(v) { this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; this.master.gain.value = m ? 0 : 0.8; }

  // ---------------------------------------------------------------- buffers
  noiseBuf(sec) { const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  pinkBuf(sec) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
    return b;
  }
  impulse(sec, decay) { const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); } return b; }

  loop(buf, gain, filt) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    const g = c.createGain(); g.gain.value = gain;
    let last = s;
    const nodes = [];
    for (const f of filt || []) { const n = c.createBiquadFilter(); n.type = f.type; n.frequency.value = f.f; if (f.q) n.Q.value = f.q; last.connect(n); last = n; nodes.push(n); }
    last.connect(g); g.connect(this.amb); s.start(c.currentTime, Math.random() * 2);
    return { src: s, gain: g, filters: nodes };
  }

  startAmbience() {
    const c = this.ctx;
    this.wind = this.loop(this.pink, 0, [{ type: 'lowpass', f: 500, q: 0.7 }]);
    this.wind2 = this.loop(this.noise, 0, [{ type: 'bandpass', f: 900, q: 0.6 }]);
    this.rain = this.loop(this.noise, 0, [{ type: 'highpass', f: 1400 }, { type: 'lowpass', f: 9000 }]);
    this.rainLow = this.loop(this.pink, 0, [{ type: 'lowpass', f: 600 }]);
    this.lake = this.loop(this.pink, 0, [{ type: 'lowpass', f: 380 }]);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.19; const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(this.lake.gain.gain); lfo.start();
    // underground drone
    this.drone = { g: c.createGain(), o: [] }; this.drone.g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(this.drone.g); this.drone.g.connect(this.amb); this.drone.g.connect(this.rev);
    for (const f of [41.2, 61.7, 82.6, 123.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004); const g = c.createGain(); g.gain.value = 0.16; o.connect(g); g.connect(lp); o.start(); this.drone.o.push(o); }
    const dl = c.createOscillator(); dl.frequency.value = 0.07; const dg = c.createGain(); dg.gain.value = 90; dl.connect(dg); dg.connect(lp.frequency); dl.start();
    // tension bed
    this.tension = { g: c.createGain(), o1: c.createOscillator(), o2: c.createOscillator() }; this.tension.g.gain.value = 0;
    this.tension.o1.type = 'sine'; this.tension.o1.frequency.value = 55; this.tension.o2.type = 'triangle'; this.tension.o2.frequency.value = 82.4;
    const tl = c.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 180; this.tension.o1.connect(tl); this.tension.o2.connect(tl); tl.connect(this.tension.g); this.tension.g.connect(this.amb); this.tension.o1.start(); this.tension.o2.start();
    this.nextBird = 0; this.nextCricket = 0;
  }

  /** per-frame ambience mix */
  update(dt, st) {
    const c = this.ctx, t = c.currentTime;
    const under = st.under;
    const surf = under ? 0 : 1;
    const inside = st.inside ? 0.45 : 1;
    const windAmt = (0.12 + st.wind * 0.5 + st.storm * 0.4) * surf * inside;
    this.wind.gain.gain.setTargetAtTime(windAmt * 0.55, t, 0.5); this.wind.filters[0].frequency.setTargetAtTime(280 + st.wind * 500 + Math.sin(t * 0.3) * 60, t, 0.3);
    this.wind2.gain.gain.setTargetAtTime(windAmt * 0.08, t, 0.5); this.wind2.filters[0].frequency.setTargetAtTime(700 + st.wind * 900, t, 0.3);
    this.rain.gain.gain.setTargetAtTime(st.rain * 0.16 * surf * (st.inside ? 0.35 : 1), t, 0.6);
    this.rainLow.gain.gain.setTargetAtTime(st.rain * 0.3 * surf * (st.inside ? 0.7 : 1), t, 0.6);
    this.lake.gain.gain.setTargetAtTime(Math.max(0, 1 - st.lakeDist / 60) * 0.35 * surf * inside, t, 0.5);
    this.drone.g.gain.setTargetAtTime(under ? 0.3 : 0, t, 1.2);
    this.tension.g.gain.setTargetAtTime(Math.min(0.14, st.tension * 0.03) * surf, t, 2);
    // crickets & birds
    if (!under && !st.inside) {
      if (st.night > 0.5 && t > this.nextCricket && st.rain < 0.4) { this.nextCricket = t + 0.15 + Math.random() * 0.25; this.cricket(); }
      if (st.night < 0.3 && st.rain < 0.5 && t > this.nextBird) { this.nextBird = t + 1.5 + Math.random() * 5; this.bird(); }
    }
    // listener
    const L = c.listener;
    if (L.positionX) { L.positionX.value = st.pos.x; L.positionY.value = st.pos.y; L.positionZ.value = st.pos.z; L.forwardX.value = st.fwd.x; L.forwardY.value = st.fwd.y; L.forwardZ.value = st.fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(st.pos.x, st.pos.y, st.pos.z); L.setOrientation(st.fwd.x, st.fwd.y, st.fwd.z, 0, 1, 0); }
    this.revGain.gain.setTargetAtTime(under ? 0.7 : st.inside ? 0.45 : 0.22, t, 0.5);
  }

  // ---------------------------------------------------------------- utility voices
  env(g, t0, a, peak, d, end = 0.0001) { g.gain.cancelScheduledValues(t0); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(end, t0 + a + d); }
  panner(x, y, z, ref = 8) {
    const p = this.ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 600; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    p.connect(this.sfx); return p;
  }
  burst({ dur = 0.3, type = 'lowpass', f0 = 800, f1 = 200, q = 0.7, peak = 0.5, attack = 0.005, at = null, buf = null, wet = 0 }) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = buf || this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); f.Q.value = q;
    const g = c.createGain(); this.env(g, t, attack, peak, dur);
    s.connect(f); f.connect(g);
    const out = at ? this.panner(...at) : this.sfx; g.connect(out);
    if (wet) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.rev); }
    s.start(t, Math.random() * 2); s.stop(t + dur + attack + 0.1);
  }
  tone({ f = 440, f2 = null, dur = 0.2, type = 'sine', peak = 0.3, attack = 0.005, at = null, wet = 0 }) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); this.env(g, t, attack, peak, dur);
    o.connect(g); const out = at ? this.panner(...at) : this.sfx; g.connect(out);
    if (wet) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.rev); }
    o.start(t); o.stop(t + dur + attack + 0.05);
  }

  cricket() { const c = this.ctx, f = 4200 + Math.random() * 500, n = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) setTimeout(() => this.tone({ f, dur: 0.035, type: 'triangle', peak: 0.012 }), i * 55); }
  bird() { const f = 2200 + Math.random() * 1800, n = 1 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) setTimeout(() => this.tone({ f: f * (1 + Math.random() * 0.1), f2: f * (1.2 + Math.random() * 0.5), dur: 0.09 + Math.random() * 0.05, peak: 0.018 }), i * 130); }

  // ---------------------------------------------------------------- sfx
  step(kind = 'grass', run = false) {
    const now = this.ctx.currentTime; if (now - this.lastStep < 0.12) return; this.lastStep = now;
    const p = { grass: [900, 300, 0.12], dirt: [1200, 380, 0.14], wood: [600, 200, 0.22], stone: [2200, 700, 0.18], sand: [700, 240, 0.09], water: [800, 250, 0.18], metal: [2600, 900, 0.16] }[kind] || [900, 300, 0.12];
    this.burst({ dur: 0.09, type: 'lowpass', f0: p[0] * (0.9 + Math.random() * 0.2), f1: p[1], peak: p[2] * (run ? 1.3 : 1) });
    if (kind === 'wood' || kind === 'stone') this.tone({ f: 120 + Math.random() * 30, f2: 60, dur: 0.08, peak: 0.1 });
  }
  jump() { this.burst({ dur: 0.12, type: 'bandpass', f0: 500, f1: 900, peak: 0.08 }); }
  land(v) { this.burst({ dur: 0.18, type: 'lowpass', f0: 500, f1: 120, peak: Math.min(0.5, 0.05 + v * 0.03) }); this.tone({ f: 90, f2: 40, dur: 0.15, peak: Math.min(0.4, v * 0.03) }); }
  splash(x, y, z, s = 1) { this.burst({ dur: 0.5 + s * 0.2, type: 'lowpass', f0: 3000, f1: 300, peak: 0.25 * s, at: [x, y, z, 6], wet: 0.2 }); this.burst({ dur: 0.9, type: 'bandpass', f0: 900, f1: 400, q: 1.2, peak: 0.12 * s, at: [x, y, z, 6] }); }
  boom(x, y, z, power = 1, far = 0) {
    const d = far;
    const lp = Math.max(300, 4200 - d * 12);
    this.burst({ dur: 1.8 + power, type: 'lowpass', f0: lp, f1: 60, q: 0.5, peak: 1.0 * Math.min(1.4, power), at: [x, y, z, 30], wet: 0.7, buf: this.pink });
    this.burst({ dur: 0.35, type: 'highpass', f0: 3000, f1: 900, peak: 0.6 * power, at: [x, y, z, 30] });
    this.tone({ f: 90, f2: 24, dur: 1.5, type: 'sine', peak: 0.9 * power, at: [x, y, z, 30], wet: 0.4 });
    setTimeout(() => this.burst({ dur: 2.5, type: 'lowpass', f0: 600, f1: 70, peak: 0.25, at: [x, y, z, 40], buf: this.pink, wet: 0.9 }), 260 + Math.min(1500, d * 3));
  }
  collapse(x, y, z) { this.burst({ dur: 2.8, type: 'lowpass', f0: 1400, f1: 90, q: 0.6, peak: 0.6, at: [x, y, z, 25], wet: 0.6, buf: this.pink }); for (let i = 0; i < 9; i++) setTimeout(() => this.tone({ f: 200 + Math.random() * 500, f2: 90, dur: 0.12, type: 'square', peak: 0.05, at: [x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6, 12] }), i * 140 + Math.random() * 100); }
  beep(rate = 1) { this.tone({ f: 1760, dur: 0.06, type: 'square', peak: 0.08 }); }
  beepAt(x, y, z, hot) { this.tone({ f: hot ? 2300 : 1600, dur: 0.05, type: 'square', peak: 0.1, at: [x, y, z, 6] }); }
  grab() { this.tone({ f: 260, f2: 380, dur: 0.07, type: 'triangle', peak: 0.15 }); this.burst({ dur: 0.05, type: 'bandpass', f0: 1800, f1: 1200, peak: 0.08 }); }
  throwSfx(p = 0.6) { this.burst({ dur: 0.25, type: 'bandpass', f0: 500, f1: 1800, peak: 0.12 + p * 0.12 }); }
  thud(x, y, z, s = 1) { this.tone({ f: 110, f2: 45, dur: 0.14, peak: 0.35 * s, at: [x, y, z, 5] }); this.burst({ dur: 0.1, type: 'lowpass', f0: 900, f1: 200, peak: 0.25 * s, at: [x, y, z, 5] }); }
  plank() { this.tone({ f: 150, f2: 80, dur: 0.12, type: 'triangle', peak: 0.3 }); this.burst({ dur: 0.08, type: 'bandpass', f0: 1200, f1: 600, peak: 0.2 }); }
  sign() { this.tone({ f: 200, f2: 100, dur: 0.1, type: 'triangle', peak: 0.3 }); setTimeout(() => this.tone({ f: 190, f2: 90, dur: 0.1, type: 'triangle', peak: 0.3 }), 120); }
  ui(kind = 'tick') { const m = { tick: [900, 700, 0.05], open: [500, 900, 0.09], close: [900, 500, 0.09], deny: [200, 140, 0.15], good: [660, 990, 0.14] }[kind]; this.tone({ f: m[0], f2: m[1], dur: m[2], type: 'sine', peak: 0.12 }); }
  thunder(delay = 0, big = 1) { setTimeout(() => { this.burst({ dur: 0.25, type: 'highpass', f0: 4000, f1: 1000, peak: 0.4 * big, wet: 0.3 }); this.burst({ dur: 4.5, type: 'lowpass', f0: 500, f1: 45, q: 0.4, peak: 0.8 * big, wet: 0.8, buf: this.pink, attack: 0.15 }); }, delay); }
  bell(x, y, z) { const c = this.ctx; [1, 2.4, 3.9, 5.4, 6.8].forEach((m, i) => this.tone({ f: 196 * m, dur: 6 - i * 0.7, peak: 0.28 / (i + 1), at: [x, y, z, 30], wet: 0.5, attack: 0.002 })); }
  gust() { this.burst({ dur: 2.2, type: 'bandpass', f0: 300, f1: 900, q: 0.5, peak: 0.5, attack: 0.6, buf: this.pink }); }
  descend() { this.burst({ dur: 2.6, type: 'lowpass', f0: 2400, f1: 80, peak: 0.6, buf: this.pink, wet: 0.7 }); this.tone({ f: 200, f2: 32, dur: 2.4, type: 'sawtooth', peak: 0.25, wet: 0.6 }); }
  ascend() { this.burst({ dur: 1.6, type: 'lowpass', f0: 100, f1: 2600, peak: 0.4, buf: this.pink, wet: 0.5 }); }
  hurt() { this.tone({ f: 180, f2: 70, dur: 0.22, type: 'sawtooth', peak: 0.25 }); this.burst({ dur: 0.15, type: 'lowpass', f0: 1200, f1: 200, peak: 0.3 }); }
  death() { this.tone({ f: 130, f2: 28, dur: 2.2, type: 'sawtooth', peak: 0.35, wet: 0.7 }); this.burst({ dur: 2.5, type: 'lowpass', f0: 900, f1: 60, peak: 0.3, wet: 0.8, buf: this.pink }); }
  meteor(x, y, z) { this.burst({ dur: 2.2, type: 'bandpass', f0: 3000, f1: 200, q: 0.8, peak: 0.35, at: [x, y, z, 60], buf: this.pink }); }
  clip() { this.tone({ f: 1200, f2: 1800, dur: 0.08, type: 'square', peak: 0.06 }); setTimeout(() => this.tone({ f: 1800, dur: 0.1, type: 'square', peak: 0.06 }), 90); }
  legend() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone({ f, dur: 0.6, type: 'triangle', peak: 0.12, wet: 0.5 }), i * 110)); }

  /** THE sound of the server acting: a slow inhuman swell with digital stutter. */
  serverEvent(lead = 0) {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
    const ws = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } ws.curve = curve;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(140, t); lp.frequency.exponentialRampToValueAtTime(1800, t + 2.4); lp.frequency.exponentialRampToValueAtTime(120, t + 6);
    for (const f of [36.7, 55, 73.4, 110.4]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 14; const og = c.createGain(); og.gain.value = 0.22; o.connect(og); og.connect(ws); o.start(t); o.stop(t + 7); }
    ws.connect(lp); lp.connect(g); g.connect(this.sfx); g.connect(this.rev);
    for (let i = 0; i < 14; i++) setTimeout(() => this.tone({ f: 800 + Math.random() * 3200, dur: 0.03, type: 'square', peak: 0.04 }), 400 + i * 90 + Math.random() * 60);
    this.burst({ dur: 0.6, type: 'bandpass', f0: 2000, f1: 5000, peak: 0.3, q: 4 });
  }

  radioStatic(dur = 1.2, peak = 0.22) { this.burst({ dur, type: 'bandpass', f0: 1800, f1: 2400, q: 1.6, peak, attack: 0.05 }); }
  radioBlip() { this.tone({ f: 1000, dur: 0.06, type: 'square', peak: 0.05 }); }

  npcBlip(pitch = 1, x, y, z, mood = 0) {
    const base = 150 * pitch;
    const f = base * (0.9 + Math.random() * 0.5) * (mood === 1 ? 1.15 : mood === 2 ? 0.85 : 1);
    this.tone({ f, f2: f * (0.85 + Math.random() * 0.4), dur: 0.05 + Math.random() * 0.04, type: 'triangle', peak: 0.1, at: [x, y, z, 5] });
    this.burst({ dur: 0.04, type: 'bandpass', f0: 900 + Math.random() * 900, f1: 700, q: 2, peak: 0.03, at: [x, y, z, 5] });
  }

  speak(text, { pitch = 1, rate = 0.95, volume = 0.9, dead = false } = {}) {
    if (!this.voiceOn || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = Math.max(0, Math.min(2, dead ? pitch * 0.55 : pitch)); u.rate = dead ? 0.78 : rate; u.volume = volume;
      const vs = speechSynthesis.getVoices(); const en = vs.filter((v) => /^en/i.test(v.lang)); if (en.length) u.voice = en[Math.floor(Math.random() * en.length)];
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}
