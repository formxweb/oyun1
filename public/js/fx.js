// Particles, explosions, splashes, smoke, flares, shockwaves. CPU-simulated pooled points.
import * as THREE from 'three';

function softTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'smoke') { g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  if (kind === 'smoke') { for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.beginPath(); c.arc(10 + Math.random() * 44, 10 + Math.random() * 44, 2 + Math.random() * 7, 0, 7); c.fill(); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const VS = `
attribute float aSize; attribute vec4 aColor; varying vec4 vColor;
uniform float uScale;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}`;
const FS = `
uniform sampler2D uMap; varying vec4 vColor;
uniform vec3 uFog; uniform float uFogD;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * (0.6 + 0.4*t.r), a);
}`;

class Pool {
  constructor(scene, n, additive, tex, scaleRef) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uMap: { value: tex }, uScale: scaleRef, uFog: { value: new THREE.Color() }, uFogD: { value: 0 } } });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 8;
    scene.add(this.pts);
    this.g = g;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    const i = this.i++ % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    for (let k = 0; k < 4; k++) { this.c0[i * 4 + k] = c0[k]; this.c1[i * 4 + k] = c1[k]; }
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.aColor.needsUpdate = true; this.g.attributes.aSize.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, quality, terrain, hooks) {
    this.scene = scene; this.terrain = terrain; this.hooks = hooks;
    this.scale = { value: 600 };
    const mult = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    this.smoke = new Pool(scene, Math.floor(2600 * mult), false, softTexture('smoke'), this.scale);
    this.glow = new Pool(scene, Math.floor(3200 * mult), true, softTexture('glow'), this.scale);
    this.lights = []; this.rings = []; this.sources = new Map(); this.time = 0; this.beams = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffa050, 0, 60, 1.6); l.userData.t = 0; scene.add(l); this.lights.push(l); }
    this.lightIdx = 0;
  }

  light(x, y, z, color, intensity, dur, dist = 50) {
    const l = this.lights[this.lightIdx++ % this.lights.length];
    l.position.set(x, y, z); l.color.set(color); l.userData.i = intensity; l.userData.t = dur; l.userData.d = dur; l.distance = dist;
  }

  ring(x, y, z, r, color = 0xffd9a0, dur = 0.8, flat = true) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.3, z); m.userData = { t: dur, d: dur, r };
    this.scene.add(m); this.rings.push(m);
  }

  explosion(x, y, z, r, power, kind = 'charge') {
    const s = 0.7 + power * 0.7 + r * 0.02;
    const P = this.glow, S = this.smoke;
    const rnd = Math.random;
    const big = kind !== 'meteor';
    for (let i = 0; i < 46 * s; i++) { const a = rnd() * 6.28, e = (rnd() - 0.2) * 1.2, sp = (4 + rnd() * 11) * s; P.emit(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp * 0.9 + 2, Math.sin(a) * Math.cos(e) * sp, 0.35 + rnd() * 0.5, 2.6 * s, 0.4, [1, 0.75, 0.25, 0.9], [1, 0.25, 0.02, 0], 3, 1.6); }
    for (let i = 0; i < 40 * s; i++) { const a = rnd() * 6.28, sp = (7 + rnd() * 16) * s; P.emit(x, y + 0.6, z, Math.cos(a) * sp, 4 + rnd() * 10, Math.sin(a) * sp, 0.7 + rnd() * 0.9, 0.35, 0.1, [1, 0.85, 0.5, 1], [1, 0.3, 0.05, 0], 22, 0.4); }
    for (let i = 0; i < 30 * s; i++) { const a = rnd() * 6.28, sp = (1 + rnd() * 4) * s; S.emit(x + (rnd() - 0.5) * 2, y + 0.5, z + (rnd() - 0.5) * 2, Math.cos(a) * sp, 3 + rnd() * 6 * s, Math.sin(a) * sp, 3 + rnd() * 3.5, 2.5 * s, 9 * s, [0.22, 0.2, 0.19, 0.8], [0.5, 0.5, 0.5, 0], -0.5, 0.5); }
    for (let i = 0; i < 24 * s; i++) { const a = rnd() * 6.28, sp = (6 + rnd() * 9) * s; S.emit(x, y + 0.3, z, Math.cos(a) * sp, 0.6 + rnd() * 1.5, Math.sin(a) * sp, 1.3 + rnd(), 1.6 * s, 6 * s, [0.55, 0.47, 0.36, 0.55], [0.55, 0.5, 0.42, 0], 0, 2.5); }
    this.ring(x, y, z, r * 1.1, 0xffd9a0, 0.7); this.ring(x, y, z, r * 0.6, 0xff8040, 0.5);
    this.light(x, y + 3, z, 0xffa050, 900 * s, 0.9, r * 3.5);
    if (big) this.hooks.shake?.(Math.min(1.4, power * 1.1), x, z, r * 4);
  }

  splash(x, y, z, s = 1) {
    const P = this.smoke;
    for (let i = 0; i < 26 * s; i++) { const a = Math.random() * 6.28, sp = (1 + Math.random() * 3.5) * s; P.emit(x, y + 0.1, z, Math.cos(a) * sp * 0.6, 3 + Math.random() * 5 * s, Math.sin(a) * sp * 0.6, 0.9 + Math.random() * 0.6, 0.35 * s, 0.1, [0.9, 0.95, 1, 0.75], [0.9, 0.95, 1, 0], 14, 0.3); }
    this.ring(x, y - 0.25, z, 1.8 * s, 0xcfe8ff, 1.0);
  }

  dust(x, y, z, r = 4, n = 40) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = (0.5 + Math.random() * 2.5) * r * 0.5; this.smoke.emit(x + (Math.random() - 0.5) * r, y + Math.random() * 1.5, z + (Math.random() - 0.5) * r, Math.cos(a) * sp, 0.8 + Math.random() * 2, Math.sin(a) * sp, 2.5 + Math.random() * 3, 1.5, 6 + r * 0.6, [0.6, 0.55, 0.47, 0.55], [0.6, 0.55, 0.5, 0], 0, 1.2); }
  }

  collapse(x, y, z, w, d, h) {
    this.dust(x, y + 0.5, z, Math.max(w, d) * 0.9, 90);
    for (let i = 0; i < 30; i++) this.smoke.emit(x + (Math.random() - 0.5) * w, y + Math.random() * h, z + (Math.random() - 0.5) * d, (Math.random() - 0.5) * 3, 1 + Math.random() * 4, (Math.random() - 0.5) * 3, 4 + Math.random() * 4, 3, 10, [0.35, 0.32, 0.3, 0.75], [0.5, 0.48, 0.45, 0], -0.3, 0.4);
    this.ring(x, y, z, Math.max(w, d) * 1.3, 0xb8a888, 1.1);
    this.hooks.shake?.(0.9, x, z, 90);
  }

  burst(x, y, z, color, n = 30, speed = 4) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, e = Math.random() * 3.14 - 1.57, sp = speed * (0.4 + Math.random()); this.glow.emit(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.6 + Math.random() * 0.6, 0.5, 0.05, [...color, 1], [...color, 0], 3, 1.5); }
  }

  /** persistent smoke / fire emitters keyed by id */
  setSources(list) {
    this.sourceList = list;
  }

  flare(x, z, color, ttl) {
    const y = this.terrain.height(x, z);
    this.beams.push({ x, y, z, color: color === 'green' ? [0.3, 1, 0.5] : [1, 0.25, 0.15], t: ttl / 1000, d: ttl / 1000 });
    this.light(x, y + 6, z, color === 'green' ? 0x30ff80 : 0xff4020, 80, 6, 60);
  }

  meteor(x, z) {
    const y = this.terrain.height(x, z);
    for (let i = 0; i < 40; i++) { const t = i / 40; this.glow.emit(x - 80 * (1 - t), y + 200 * (1 - t) ** 1.4, z - 40 * (1 - t), 0, 0, 0, 1.2 + t * 0.6, 4 - t * 2, 0.5, [1, 0.8, 0.4, 0.9], [1, 0.3, 0.05, 0], 0, 0); }
  }

  update(dt, cam, time) {
    this.time = time;
    this.scale.value = (window.innerHeight * (window.devicePixelRatio || 1)) / (2 * Math.tan((cam.fov * Math.PI / 180) / 2));
    // ongoing sources (damaged buildings, ruins, beacons)
    for (const s of this.sourceList || []) {
      const burnRuin = s.kind === 'ruin' && Date.now() - s.ruinedAt < 12 * 60000;
      const dmg = s.kind === 'dmg';
      if (Math.hypot(s.world.x - cam.position.x, s.world.z - cam.position.z) > 130) continue;
      const rate = dmg ? 6 * (1 - s.level * 1.6) : burnRuin ? 12 : 1.2;
      if (Math.random() < rate * dt) {
        const w = s.world;
        this.smoke.emit(w.x + (Math.random() - 0.5) * 4, w.y + (dmg ? 0 : 0.2), w.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 0.6 + 0.6, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.6 + 0.3, 5 + Math.random() * 4, 1.5, 6, [0.12, 0.11, 0.1, 0.55], [0.35, 0.35, 0.35, 0], -0.2, 0.2);
        if ((dmg && s.level < 0.3) || burnRuin) if (Math.random() < 0.6) this.glow.emit(w.x + (Math.random() - 0.5) * 3, w.y - 0.5 + Math.random(), w.z + (Math.random() - 0.5) * 3, 0, 1.5 + Math.random() * 2, 0, 0.6 + Math.random() * 0.5, 1.1, 0.2, [1, 0.6, 0.15, 0.7], [1, 0.2, 0, 0], -1, 0.6);
      }
    }
    for (const b of this.beams) {
      b.t -= dt;
      if (Math.random() < 30 * dt) this.glow.emit(b.x + (Math.random() - 0.5) * 0.6, b.y + 1, b.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 14 + Math.random() * 6, (Math.random() - 0.5) * 0.4, 5 + Math.random() * 2, 1.4, 4.5, [...b.color, 0.55], [...b.color, 0], 0, 0.1);
      if (Math.random() < 6 * dt) this.smoke.emit(b.x, b.y + 1, b.z, (Math.random() - 0.5), 8 + Math.random() * 4, (Math.random() - 0.5), 8, 1.5, 9, [...b.color.map((c) => c * 0.7), 0.4], [0.6, 0.6, 0.6, 0], 0, 0.15);
    }
    this.beams = this.beams.filter((b) => b.t > 0);
    this.smoke.update(dt); this.glow.update(dt);
    for (const l of this.lights) { if (l.userData.t > 0) { l.userData.t -= dt; const k = Math.max(0, l.userData.t / l.userData.d); l.intensity = l.userData.i * k * k; } else l.intensity = 0; }
    for (const r of this.rings) {
      r.userData.t -= dt; const k = 1 - r.userData.t / r.userData.d;
      r.scale.setScalar(Math.max(0.01, k * r.userData.r)); r.material.opacity = Math.max(0, (1 - k) * 0.55);
    }
    this.rings = this.rings.filter((r) => { if (r.userData.t <= 0) { this.scene.remove(r); r.geometry.dispose(); r.material.dispose(); return false; } return true; });
  }
}
