// Sky, sun/moons, lighting, fog, clouds, rain, lightning — all driven by the replicated world clock & weather.
import * as THREE from 'three';
import { smoothstep, clamp, lerp } from '/shared/util.js';
import { textTexture } from './tex.js';

const C = (h) => new THREE.Color(h);
// keys by sun elevation: [e, zenith, horizon, sunCol, hemiSky, hemiGround]
const KEYS = [
  [-0.40, 0x040815, 0x0c1530, 0x8aa0ff, 0x2a3a80, 0x141c30],
  [-0.14, 0x0a1230, 0x1e2650, 0x8aa0ff, 0x3a4a92, 0x1c2238],
  [-0.03, 0x1e2f68, 0xb84c3a, 0xff7a3a, 0x6a6ca8, 0x3a2a2c],
  [0.05, 0x2f4f94, 0xf29a5c, 0xffa060, 0x93a0d0, 0x5a463a],
  [0.20, 0x3a70c0, 0xdcb694, 0xffcf96, 0x86a6d6, 0x54503a],
  [0.55, 0x2a67c8, 0xaec9e8, 0xfff0d8, 0x9dbbe6, 0x5a5a44],
  [1.00, 0x1f5fc4, 0xa6c8ee, 0xfff6e8, 0xa6c4ee, 0x5f5f4a],
];
const _c = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
function samplePalette(e) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((e - a[0]) / (b[0] - a[0]), 0, 1);
  const out = [];
  for (let k = 1; k <= 5; k++) out.push(_c[k - 1].set(a[k]).lerp(C(b[k]), t).clone());
  return out;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSun, uMoon, uMoon2, uMoon3;
uniform vec3 uZenith, uHorizon, uGround, uSunCol, uCloudCol, uCloudShade;
uniform float uStars, uCloud, uCloudDark, uTime, uAurora, uEclipse, uSunAmt, uMoonAmt, uMoons, uRed, uFlash, uUnder;
uniform vec2 uWind;
uniform sampler2D uNoise, uConst;
uniform float uConstAmt;

float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }

float fbmTex(vec2 uv){
  float a = texture2D(uNoise, uv).r*0.5;
  a += texture2D(uNoise, uv*2.1+vec2(.31,.17)).g*0.28;
  a += texture2D(uNoise, uv*4.3+vec2(.7,.2)).b*0.16;
  a += texture2D(uNoise, uv*8.7+vec2(.1,.9)).a*0.08;
  return a;
}

vec3 moonDisc(vec3 d, vec3 m, float r, vec3 col){
  float c = dot(d, m);
  float disc = smoothstep(cos(r*1.06), cos(r*0.96), c);
  float glow = pow(max(c,0.), 220.) * 0.5;
  // a little surface texture
  float tex = texture2D(uNoise, d.xz*3.0 + m.xz*5.).r;
  return col * (disc * (0.7+0.5*tex) + glow) ;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(hh, 0.42));
  // haze band hugging the horizon
  col = mix(col, uHorizon*1.05, exp(-max(h,0.0)*9.0)*0.5);
  vec3 below = mix(uHorizon*0.85, uGround, smoothstep(0.0,-0.35,h));
  col = mix(col, below, smoothstep(0.005,-0.02,h));

  float sd = max(dot(d, uSun), 0.0);
  float sunDisc = smoothstep(0.9995, 0.99985, dot(d,uSun));
  vec3 sunCol = uSunCol;
  float glow = pow(sd, 6.0)*0.35 + pow(sd, 48.0)*0.55 + pow(sd, 700.0)*3.0;
  float eclipse = uEclipse;
  col += sunCol * glow * uSunAmt * (1.0-eclipse*0.9);
  col += sunCol * sunDisc * 40.0 * uSunAmt * (1.0-eclipse);
  // eclipse: black disc + corona ring
  float ecDisc = smoothstep(0.99993, 0.99985, dot(d,uSun));
  float corona = pow(sd, 260.0)*2.6 + pow(sd, 40.0)*0.25;
  col = mix(col, vec3(0.0), ecDisc*eclipse);
  col += vec3(1.0,0.82,0.6)*corona*eclipse*uSunAmt;

  // moons
  if (uMoonAmt > 0.001) {
    col += moonDisc(d, uMoon, 0.045, vec3(0.85,0.9,1.0)) * uMoonAmt * 1.3;
    if (uMoons > 1.5) col += moonDisc(d, uMoon2, 0.028, vec3(1.0,0.7,0.45)) * uMoonAmt * 1.1;
    if (uMoons > 2.5) col += moonDisc(d, uMoon3, 0.018, vec3(0.5,1.0,0.7)) * uMoonAmt * 1.0;
  }

  // stars
  if (uStars > 0.01 && h > -0.02) {
    vec3 p = d * 210.0;
    vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float hs = hash13(ip);
    if (hs > 0.972) {
      vec3 off = (hash33(ip) - 0.5) * 0.6;
      float m = smoothstep(0.16, 0.0, length(fp - off));
      float tw = 0.65 + 0.35*sin(uTime*(2.0+hs*6.0) + hs*100.0);
      col += vec3(0.9,0.95,1.0) * m * (hs-0.972)*45.0 * tw * uStars;
    }
    // faint milky band
    float band = texture2D(uNoise, d.xz*1.4 + d.y*0.7).g;
    float mw = smoothstep(0.35, 0.0, abs(d.y*0.8 + d.x*0.35 - 0.1 + (band-0.5)*0.3));
    col += vec3(0.16,0.19,0.32) * mw * band * uStars * 0.6;
  }

  // constellation spelled by the server
  if (uConstAmt > 0.01) {
    float az = atan(d.x, d.z);
    float el = asin(clamp(d.y,-1.,1.));
    vec2 cuv = vec2((az - 1.15) / 1.3 + 0.5, (el - 0.38) / 0.325);
    if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) {
      float t = texture2D(uConst, vec2(1.0 - cuv.x, 1.0-cuv.y)).r;
      col += vec3(1.0,0.95,0.8) * t * uConstAmt * (0.7+0.3*sin(uTime*2.+cuv.x*40.));
    }
  }

  // aurora curtains
  if (uAurora > 0.01 && h > 0.05) {
    float az = atan(d.x, d.z);
    float band = sin(az*5.0 + uTime*0.25 + sin(az*11.0+uTime*0.4)*0.9) * 0.5 + 0.5;
    float ht = smoothstep(0.08, 0.35, h) * smoothstep(0.85, 0.35, h);
    float streak = texture2D(uNoise, vec2(az*1.6, h*0.9 - uTime*0.02)).r;
    float a = band * ht * (0.35 + streak) * uAurora;
    vec3 ac = mix(vec3(0.15,1.0,0.5), vec3(0.6,0.25,1.0), smoothstep(0.25, 0.7, h + streak*0.2));
    col += ac * a * 0.75;
  }

  // clouds (planar projection)
  if (h > 0.0) {
    vec2 uv = d.xz / (h*0.85 + 0.22) * 0.32 + uWind * uTime;
    float f = fbmTex(uv);
    float dens = smoothstep(1.0 - uCloud - 0.05, 1.0 - uCloud + 0.2, f);
    float fade = smoothstep(0.0, 0.18, h);
    float sunSide = pow(max(dot(normalize(vec3(d.x,0.0,d.z)), normalize(vec3(uSun.x,0.0,uSun.z))), 0.0), 3.0);
    float lit = 0.55 + 0.45 * smoothstep(0.0, 0.5, uSun.y+0.15) * (0.6 + 0.4*sunSide);
    vec3 cc = mix(uCloudCol * lit, uCloudShade, uCloudDark*0.85 + (1.0-f)*0.25*(1.0-uCloudDark));
    // silver lining at edges toward the sun
    cc += sunCol * 0.35 * pow(1.0-dens, 2.0) * sunSide * uSunAmt * dens;
    col = mix(col, cc, dens * fade * (1.0 - uUnder));
  }

  // dusk/red-sky tint & flash
  col = mix(col, col * vec3(1.5, 0.35, 0.28) + vec3(0.12,0.0,0.0), uRed);
  col += vec3(0.7,0.75,1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN_VERT = /* glsl */`
attribute float aSeed;
uniform float uTime, uIntensity, uInside;
uniform vec3 uCam; uniform vec2 uWind;
varying float vA;
void main(){
  vec3 p = position;
  float speed = 22.0 + aSeed*8.0;
  float y = mod(p.y - uTime*speed - aSeed*40.0, 32.0);
  vec3 wp = vec3(p.x + uWind.x*y*0.25, y - 6.0, p.z + uWind.y*y*0.25);
  // wrap box around camera
  wp.x = mod(wp.x - uCam.x + 22.0, 44.0) - 22.0 + uCam.x;
  wp.z = mod(wp.z - uCam.z + 22.0, 44.0) - 22.0 + uCam.z;
  wp.y += uCam.y - 4.0;
  // tail vertex
  if (position.y < 0.0) {}
  vec3 tail = vec3(-uWind.x*0.08, 0.55, -uWind.y*0.08) * step(0.5, aSeed*0.0 + float(gl_VertexID % 2));
  wp += tail;
  vA = step(aSeed, uIntensity) * (1.0 - uInside) * (0.35 + 0.35*fract(aSeed*7.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
precision highp float; varying float vA; uniform vec3 uColor;
void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA); }`;

export class Env {
  constructor(scene, renderer, tex, quality) {
    this.scene = scene; this.renderer = renderer; this.quality = quality;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.zenith = new THREE.Color(); this.horizon = new THREE.Color(); this.fogColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.nightAmt = 0; this.dayAmt = 1; this.dim = 0; this.elev = 0.5;
    this.flash = 0; this.flashT = 0; this.under = false;
    this.wind = new THREE.Vector2(0.6, 0.3);
    this.rainI = 0; this.cloud = 0.3; this.cloudDark = 0; this.fogBoost = 0;
    this.smoothWeather = { i: 0.2, type: 'clear' };
    this.time = 0;

    // ---- sky dome
    this.constTex = textTexture('', { w: 4, h: 4 });
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uMoon2: { value: new THREE.Vector3() }, uMoon3: { value: new THREE.Vector3() },
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color(0x10141a) }, uSunCol: { value: new THREE.Color() },
        uCloudCol: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.25, 0.27, 0.32) },
        uStars: { value: 0 }, uCloud: { value: 0.3 }, uCloudDark: { value: 0 }, uTime: { value: 0 }, uAurora: { value: 0 }, uEclipse: { value: 0 },
        uSunAmt: { value: 1 }, uMoonAmt: { value: 0 }, uMoons: { value: 1 }, uRed: { value: 0 }, uFlash: { value: 0 }, uUnder: { value: 0 },
        uWind: { value: new THREE.Vector2(0.002, 0.001) }, uNoise: { value: tex.noise }, uConst: { value: this.constTex }, uConstAmt: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -100; this.sky.scale.setScalar(800);
    scene.add(this.sky);

    // ---- lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sz = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096;
    this.sun.shadow.mapSize.set(sz, sz);
    const sc = this.sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 500;
    this.shadowRange = 80;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xa0c0ff, 0x404030, 0.8);
    scene.add(this.hemi);
    this.fill = new THREE.AmbientLight(0x202840, 0.0);
    scene.add(this.fill);
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0012);

    // ---- rain
    const N = quality === 'low' ? 2500 : 7000;
    const pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 44, y = Math.random() * 32, z = Math.random() * 44, s = Math.random();
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); seed[i * 2 + k] = s; }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.rainMat = new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uInside: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0xaab8d0) } } });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 5;
    scene.add(this.rain);

    // ---- lightning bolts
    this.bolts = [];
    this.constText = '';
  }

  setConstellation(text) {
    if (text === this.constText) return;
    this.constText = text;
    if (!text) { this.skyMat.uniforms.uConstAmt.value = 0; return; }
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 150; ctx.font = `900 ${size}px Arial`;
    while (ctx.measureText(text).width > 960 && size > 30) { size -= 6; ctx.font = `900 ${size}px Arial`; }
    ctx.fillText(text, 512, 128);
    // stipple: keep only random dots inside the letters
    const src = ctx.getImageData(0, 0, 1024, 256);
    const out = ctx.createImageData(1024, 256);
    const dots = [];
    for (let y = 2; y < 254; y += 3) for (let x = 2; x < 1022; x += 3) if (src.data[(y * 1024 + x) * 4] > 128 && Math.random() < 0.6) dots.push([x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.0]);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 256);
    for (const [x, y, r] of dots) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4); g.addColorStop(0, '#fff'); g.addColorStop(1, '#000'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, 7); ctx.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    this.skyMat.uniforms.uConst.value = t;
  }

  lightning(x, z, y0 = 0, big = true) {
    // jagged bolt from cloud to ground
    const pts = [];
    let cx = x + (Math.random() - 0.5) * 30, cz = z + (Math.random() - 0.5) * 30;
    const top = 220;
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(lerp(cx, x, t) + (i && i < n ? (Math.random() - 0.5) * 22 * (1 - t) : 0), lerp(top, y0, t), lerp(cz, z, t) + (i && i < n ? (Math.random() - 0.5) * 22 * (1 - t) : 0)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 1, fog: false }));
    line.frustumCulled = false; line.renderOrder = 6;
    this.scene.add(line);
    this.bolts.push({ line, life: 0.28 });
    this.flash = Math.max(this.flash, big ? 1 : 0.5);
  }

  /** state: {tod, weather, sky, serverNow, cam, inside, under, fogBanks} */
  update(dt, cam, st) {
    this.time += dt;
    const { tod } = st;
    const th = ((tod - 6) / 24) * Math.PI * 2;
    const e = Math.sin(th);
    this.elev = e;
    this.sunDir.set(Math.cos(th), e, 0.28).normalize();
    this.moonDir.set(-Math.cos(th + 0.25), -Math.sin(th + 0.25), -0.2).normalize();
    const [zen, hor, sunC, hemiS, hemiG] = samplePalette(e);

    const w = st.weather || { type: 'clear', i: 0.2, wx: 0.5, wz: 0.3 };
    const sm = this.smoothWeather;
    sm.i += (w.i - sm.i) * Math.min(1, dt * 0.35);
    sm.type = w.type;
    const wi = sm.i;
    const target = { clear: 0.22, cloudy: 0.55, fog: 0.5, rain: 0.78, storm: 0.92 }[w.type] ?? 0.3;
    const cov = w.type === 'clear' ? 0.16 + wi * 0.3 : target * (0.7 + 0.3 * wi);
    this.cloud += (cov - this.cloud) * Math.min(1, dt * 0.25);
    const darkT = { clear: 0, cloudy: 0.25, fog: 0.3, rain: 0.6, storm: 0.9 }[w.type] ?? 0;
    this.cloudDark += (darkT - this.cloudDark) * Math.min(1, dt * 0.25);
    const rainT = w.type === 'rain' ? 0.35 + wi * 0.6 : w.type === 'storm' ? 1 : 0;
    this.rainI += (rainT - this.rainI) * Math.min(1, dt * 0.3);
    const fogT = w.type === 'fog' ? 0.0075 * (0.5 + wi) : w.type === 'rain' ? 0.0022 : w.type === 'storm' ? 0.0028 : 0;
    this.fogBoost += (fogT - this.fogBoost) * Math.min(1, dt * 0.2);
    this.wind.set(w.wx * (0.4 + wi * 1.6), w.wz * (0.4 + wi * 1.6));

    const skyS = st.sky || {};
    const now = st.serverNow;
    const eclipse = skyS.eclipseUntil > now ? Math.min(1, (skyS.eclipseUntil - now) / 3000, 1) : 0;
    this.eclipse = this.eclipse === undefined ? eclipse : this.eclipse + (eclipse - this.eclipse) * Math.min(1, dt * 1.5);
    const red = skyS.redUntil > now ? 1 : 0;
    this.red = this.red === undefined ? red : this.red + (red - this.red) * Math.min(1, dt * 0.5);
    const aur = skyS.aurora > now ? 1 : 0;
    this.aur = (this.aur || 0) + (aur - (this.aur || 0)) * Math.min(1, dt * 0.4);

    this.dayAmt = smoothstep(-0.06, 0.28, e);
    this.twilight = Math.exp(-Math.pow(e / 0.13, 2));
    this.nightAmt = 1 - smoothstep(-0.22, 0.02, e);
    const dark = this.cloudDark * 0.6 + this.eclipse * 0.9;
    this.dim = dark;

    const under = st.under;
    this.under = under;
    const U = this.skyMat.uniforms;
    U.uSun.value.copy(this.sunDir); U.uMoon.value.copy(this.moonDir);
    U.uMoon2.value.set(-Math.cos(th + 0.9), Math.abs(Math.sin(th + 0.9)) * 0.7 + 0.15, 0.55).normalize();
    U.uMoon3.value.set(Math.cos(th * 0.5 + 2), 0.55, -0.5).normalize();
    U.uMoons.value = skyS.moons || 1;
    this.zenith.copy(zen); this.horizon.copy(hor);
    U.uZenith.value.copy(zen).multiplyScalar(1 - this.cloudDark * 0.35 - this.eclipse * 0.8);
    U.uHorizon.value.copy(hor).multiplyScalar(1 - this.cloudDark * 0.25 - this.eclipse * 0.7);
    U.uSunCol.value.copy(sunC);
    U.uGround.value.copy(hor).multiplyScalar(0.25);
    const cloudLit = new THREE.Color(1, 1, 1).lerp(sunC, 0.35 * (1 - this.dayAmt * 0.6)).multiplyScalar(0.35 + 0.65 * this.dayAmt);
    U.uCloudCol.value.copy(cloudLit).lerp(new THREE.Color(0.12, 0.14, 0.2), this.nightAmt * 0.85);
    U.uCloudShade.value.set(0.22, 0.24, 0.3).multiplyScalar(0.3 + this.dayAmt * 0.9);
    U.uStars.value = clamp(this.nightAmt * (skyS.stars || 1) * (1 - this.cloud * 0.7) + this.eclipse * 0.6, 0, 1.4);
    U.uCloud.value = this.cloud; U.uCloudDark.value = this.cloudDark;
    U.uTime.value = this.time;
    U.uAurora.value = this.aur * clamp(this.nightAmt + this.eclipse, 0, 1);
    U.uEclipse.value = this.eclipse;
    U.uSunAmt.value = smoothstep(-0.12, 0.05, e) * (1 - this.cloudDark * 0.6);
    U.uMoonAmt.value = this.nightAmt * (1 - this.cloud * 0.6) + this.eclipse * 0.4;
    U.uRed.value = this.red * 0.75;
    U.uWind.value.set(this.wind.x * 0.0009, this.wind.y * 0.0009);
    U.uUnder.value = under ? 1 : 0;
    const cst = skyS.constellation && skyS.constellation.until > now ? skyS.constellation.text : '';
    this.setConstellation(cst);
    U.uConstAmt.value = cst ? clamp(this.nightAmt * 1.4, 0, 1) : 0;

    // lightning flash decay
    this.flash = Math.max(0, this.flash - dt * 3.2);
    U.uFlash.value = this.flash * 0.6;
    for (const b of this.bolts) { b.life -= dt; b.line.material.opacity = Math.max(0, b.life / 0.28) * (Math.random() < 0.7 ? 1 : 0.3); }
    this.bolts = this.bolts.filter((b) => { if (b.life <= 0) { this.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); return false; } return true; });

    // ---- lights
    const tw = Math.exp(-Math.pow(e / 0.13, 2)) * (1 - this.eclipse);
    const sunVis = this.dayAmt * (1 - this.dim) * (1 - this.cloudDark * 0.5);
    const moonVis = this.nightAmt * (1 - this.cloud * 0.55) * (0.5 + 0.5 * ((skyS.moons || 1) > 1 ? 1.5 : 1)) + this.eclipse * 0.25;
    const sunTotal = sunVis + tw * 0.55 * (1 - this.cloudDark * 0.5);
    const useSun = sunTotal > moonVis * 0.5;
    const ldir = (useSun ? this.sunDir.clone() : this.moonDir.clone());
    ldir.y = Math.max(ldir.y, useSun ? 0.09 : 0.28); ldir.normalize();
    this.sun.color.copy(useSun ? sunC : new THREE.Color(0x8aa6ff)).lerp(new THREE.Color(1.0, 0.25, 0.2), this.red * 0.6);
    this.sun.intensity = under ? 0 : useSun ? 4.2 * sunVis + 2.6 * tw * (1 - this.dim) + 0.2 : 1.5 * moonVis;
    this.sun.position.copy(cam.position).addScaledVector(ldir, 200);
    // snap the shadow-box centre to texel grid to kill shimmer
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(cam.position.x / texel) * texel, tz = Math.round(cam.position.z / texel) * texel;
    this.sun.target.position.set(tx, cam.position.y - 2, tz);
    this.sun.position.set(tx + ldir.x * 200, cam.position.y - 2 + ldir.y * 200, tz + ldir.z * 200);
    this.sun.target.updateMatrixWorld();
    const hemiInt = under ? 0.85 : (0.42 + 0.85 * this.dayAmt + 0.95 * tw) * (1 - this.dim * 0.55) + this.flash * 1.2 + this.nightAmt * 0.2;
    this.hemi.intensity = hemiInt;
    this.hemi.color.copy(under ? new THREE.Color(0x4a8a90) : hemiS).lerp(new THREE.Color(0.6, 0.15, 0.12), this.red * 0.5);
    this.hemi.groundColor.copy(hemiG);
    this.fill.intensity = under ? 0.9 : 0.16 + this.nightAmt * 0.3;
    this.fill.color.set(under ? 0x5a4a7a : 0x2a3c6a);

    // ---- fog
    const fc = this.fogColor.copy(hor).multiplyScalar(1 - this.cloudDark * 0.28 - this.eclipse * 0.7);
    if (this.rainI > 0) fc.lerp(new THREE.Color(0.32, 0.35, 0.4).multiplyScalar(0.3 + this.dayAmt * 0.9), this.rainI * 0.4);
    fc.lerp(new THREE.Color(0.45, 0.06, 0.05), this.red * 0.35);
    let dens = 0.0011 + this.fogBoost + this.nightAmt * 0.0005;
    if (st.fogLocal) dens += st.fogLocal * 0.011;
    if (under) { fc.set(0x0a1114); dens = 0.0085; }
    if (st.underwater) { fc.set(0x0c4a58).multiplyScalar(0.35 + 0.65 * this.dayAmt); dens = 0.075; }
    this.scene.fog.color.copy(fc); this.scene.fog.density = dens;
    this.scene.background = under ? this.scene.fog.color : null;
    this.sky.visible = !under;
    this.sky.position.copy(cam.position);

    // ---- rain
    const ru = this.rainMat.uniforms;
    ru.uTime.value = this.time; ru.uIntensity.value = under ? 0 : this.rainI;
    ru.uCam.value.copy(cam.position); ru.uWind.value.copy(this.wind).multiplyScalar(0.7);
    ru.uInside.value += ((st.inside ? 1 : 0) - ru.uInside.value) * Math.min(1, dt * 4);
    ru.uColor.value.copy(fc).multiplyScalar(1.6).addScalar(0.15);
    this.rain.visible = this.rainI > 0.02 && !under;
    return { sunVis, moonVis };
  }
}
