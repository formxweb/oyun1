// Terrain mesh with a PBR splat shader, worn-path overlay, roads, instanced forest, rocks and wind-blown grass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { N, VERTS, CELL, HALF } from '/shared/terrain.js';
import { ROADS, BTYPES } from '/shared/layout.js';
import { roadDist } from '/shared/scatter.js';
import { smoothstep, mulberry32 } from '/shared/util.js';
import { textTexture } from './tex.js';

const WEAR_N = 160;

export class TerrainView {
  constructor(scene, tex, terrain, world, trees, rocks, quality, envRef) {
    this.scene = scene; this.tex = tex; this.terrain = terrain; this.world = world; this.trees = trees; this.rocks = rocks;
    this.quality = quality; this.env = envRef;
    this.group = new THREE.Group(); scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.5, 0.3) } };
    this.buildTextures();
    this.buildMesh();
    this.buildRoads();
    this.buildTrees();
    this.buildRocks();
    this.buildGrass();
    this.refreshMask();
    this.hideErasedTrees();
    this.applyFelled();
  }

  // -------------------------------------------------------------- textures
  buildTextures() {
    this.wear = new Uint8Array(WEAR_N * WEAR_N);
    this.wearTex = new THREE.DataTexture(this.wear, WEAR_N, WEAR_N, THREE.RedFormat, THREE.UnsignedByteType);
    this.wearTex.magFilter = this.wearTex.minFilter = THREE.LinearFilter; this.wearTex.needsUpdate = true;
    this.maskData = new Uint8Array(320 * 320 * 4);
    this.maskTex = new THREE.DataTexture(this.maskData, 320, 320, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter; this.maskTex.needsUpdate = true;
    this.heightData = new Float32Array(VERTS * VERTS);
    this.heightTex = new THREE.DataTexture(this.heightData, VERTS, VERTS, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.NearestFilter; this.heightTex.needsUpdate = true;
  }

  setWear(base64OrCells) {
    if (typeof base64OrCells === 'string') {
      const bin = atob(base64OrCells);
      for (let i = 0; i < bin.length && i < this.wear.length; i++) this.wear[i] = bin.charCodeAt(i);
    } else for (const [k, v] of base64OrCells) this.wear[k] = v;
    this.wearTex.needsUpdate = true;
  }

  refreshMask() {
    const w = this.world, d = this.maskData;
    d.fill(0);
    const crat = Object.values(w.craters || {}), erased = Object.values(w.erased || {});
    const blds = Object.values(w.buildings || {}).filter((b) => b.zone === 'surface');
    for (let j = 0; j < 320; j++) for (let i = 0; i < 320; i++) {
      const x = i * 2 - HALF + 1, z = j * 2 - HALF + 1;
      let ng = 0, sc = 0, vd = 0;
      const rd = roadDist(x, z);
      if (rd.d < rd.hw + 2.6) ng = Math.max(ng, 1 - smoothstep(rd.hw, rd.hw + 2.6, rd.d));
      const o = (j * 320 + i) * 4;
      d[o] = ng * 255;
      d[o + 1] = sc; d[o + 2] = vd;
    }
    const put = (cx, cz, rad, ch, val) => {
      const i0 = Math.max(0, Math.floor((cx - rad + HALF) / 2)), i1 = Math.min(319, Math.ceil((cx + rad + HALF) / 2));
      const j0 = Math.max(0, Math.floor((cz - rad + HALF) / 2)), j1 = Math.min(319, Math.ceil((cz + rad + HALF) / 2));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dd = Math.hypot(i * 2 - HALF + 1 - cx, j * 2 - HALF + 1 - cz);
        if (dd > rad) continue;
        const f = (1 - dd / rad) ** 0.6 * val;
        const o = (j * 320 + i) * 4 + ch;
        d[o] = Math.max(d[o], f * 255);
      }
    };
    for (const c of crat) { put(c.x, c.z, c.r * 1.9, 1, 0.9); put(c.x, c.z, c.r * 1.9, 0, 1); }
    for (const e of erased) put(e.x, e.z, e.r + 3, 2, 1.4);
    for (const e of erased) put(e.x, e.z, e.r + 3, 0, 1);
    for (const b of blds) {
      const T = BTYPES[b.type];
      if (T.slab) continue;
      put(b.x, b.z, Math.hypot(T.w, T.d) / 2 + 1.5, 0, 1);
      if (b.ruined) put(b.x, b.z, Math.hypot(T.w, T.d) / 2 + 2, 1, 0.55);
    }
    this.maskTex.needsUpdate = true;
  }

  // -------------------------------------------------------------- terrain mesh
  buildMesh() {
    const T = this.terrain;
    const pos = new Float32Array(VERTS * VERTS * 3);
    for (let j = 0; j < VERTS; j++) for (let i = 0; i < VERTS; i++) {
      const k = (j * VERTS + i) * 3;
      pos[k] = i * CELL - HALF; pos[k + 1] = T.h[j * VERTS + i]; pos[k + 2] = j * CELL - HALF;
    }
    const idx = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * VERTS + i, b = a + 1, c = a + VERTS, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.geo = g;
    const t = this.tex, u = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGrass = { value: t.grass }; sh.uniforms.uDirt = { value: t.dirt }; sh.uniforms.uRock = { value: t.rock }; sh.uniforms.uSand = { value: t.sand };
      sh.uniforms.uMask = { value: this.maskTex }; sh.uniforms.uWear = { value: this.wearTex }; sh.uniforms.uNoise = { value: t.noise }; sh.uniforms.uTime = u.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position; vWNrm = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D uGrass, uDirt, uRock, uSand, uMask, uWear, uNoise; uniform float uTime;`)
        .replace('#include <map_fragment>', `
vec2 wp = vWPos.xz;
vec3 nrm = normalize(vWNrm);
float slope = 1.0 - nrm.y;
float macro = texture2D(uNoise, wp*0.0021).r;
float macro2 = texture2D(uNoise, wp*0.0113+0.3).g;
vec3 grass = mix(texture2D(uGrass, wp*0.16).rgb, texture2D(uGrass, wp*0.031+0.37).rgb, 0.42);
grass *= mix(vec3(0.82,0.94,0.68), vec3(1.16,1.06,0.78), macro);
vec3 dirt = mix(texture2D(uDirt, wp*0.14).rgb, texture2D(uDirt, wp*0.037+0.2).rgb, 0.4);
vec3 sand = texture2D(uSand, wp*0.2).rgb;
vec3 bl = pow(abs(nrm), vec3(4.0)); bl /= (bl.x+bl.y+bl.z);
vec3 rock = texture2D(uRock, vWPos.zy*0.09).rgb*bl.x + texture2D(uRock, wp*0.09).rgb*bl.y + texture2D(uRock, vWPos.xy*0.09).rgb*bl.z;
float wear = texture2D(uWear, (wp+320.0)/640.0).r;
vec4 mk = texture2D(uMask, (wp+320.0)/640.0);
float h = vWPos.y;
vec3 col = grass;
col = mix(col, dirt, smoothstep(0.55, 1.0, macro2*0.6 + (1.0-macro)*0.25) * 0.32);
col = mix(col, dirt*0.92, smoothstep(0.06, 0.55, wear));
float beach = 1.0 - smoothstep(0.1, 1.2, h + (macro-0.5)*0.7);
col = mix(col, sand, beach);
col = mix(col, sand*0.5, smoothstep(0.0, -1.6, h));
float rockM = smoothstep(0.30, 0.55, slope + (macro2-0.5)*0.16);
rockM = max(rockM, smoothstep(85.0, 125.0, h)*0.8);
col = mix(col, rock, rockM);
col *= 1.0 - mk.g*0.82;
col = mix(col, vec3(0.03,0.024,0.02), mk.g*0.55);
float voidM = smoothstep(-5.0, -18.0, h);
col = mix(col, vec3(0.004,0.009,0.013), voidM);
diffuseColor.rgb = col;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ vec2 gr = abs(fract(vWPos.xz*0.2)-0.5); float line = smoothstep(0.47,0.5,max(gr.x,gr.y));
  float pulse = 0.6+0.4*sin(uTime*1.3 + vWPos.y*0.4);
  totalEmissiveRadiance += vec3(0.02,0.35,0.45) * line * voidM * pulse * step(vWPos.y,-8.0); }`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.syncHeightTex();
  }

  syncHeightTex() { this.heightData.set(this.terrain.h); this.heightTex.needsUpdate = true; }

  rebuildMesh() {
    const T = this.terrain, pos = this.geo.attributes.position.array;
    for (let i = 0; i < VERTS * VERTS; i++) pos[i * 3 + 1] = T.h[i];
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.syncHeightTex();
    this.refreshMask();
    for (const i in this.trees) { /* trees keep their y; fresh craters sink them slightly — hide those in craters */ }
    this.applyFelled();
    this.hideErasedTrees();
  }

  // -------------------------------------------------------------- roads
  buildRoads() {
    const T = this.terrain;
    const geos = [];
    for (const r of ROADS) {
      const pts = [];
      // resample polyline, clip to the playable valley
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 2.5));
        for (let k = 0; k < n; k++) { const t = k / n; pts.push([ax + (bx - ax) * t, az + (bz - az) * t]); }
      }
      pts.push(r.pts[r.pts.length - 1]);
      const clipped = pts.filter((p) => Math.hypot(p[0], p[1]) < 238);
      if (clipped.length < 2) continue;
      if (r.id === 'main') { const a = clipped[clipped.length - 2], b = clipped[clipped.length - 1]; this.buildBarricade(b[0], b[1], b[0] - a[0], b[1] - a[1]); }
      const pos = [], uv = [], idx = [];
      let dist = 0;
      const hw = r.width / 2;
      for (let i = 0; i < clipped.length; i++) {
        const [x, z] = clipped[i];
        const [px, pz] = clipped[Math.max(0, i - 1)], [nx, nz] = clipped[Math.min(clipped.length - 1, i + 1)];
        let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (i > 0) dist += Math.hypot(x - clipped[i - 1][0], z - clipped[i - 1][1]);
        const lx = x - dz * hw, lz = z + dx * hw, rx = x + dz * hw, rz = z - dx * hw;
        const hm = Math.max(T.height(x, z), T.height(lx, lz), T.height(rx, rz));
        pos.push(lx, Math.max(T.height(lx, lz), hm - 0.25) + 0.13, lz, x, hm + 0.13, z, rx, Math.max(T.height(rx, rz), hm - 0.25) + 0.13, rz);
        uv.push(0, dist / 8, 0.5, dist / 8, 1, dist / 8);
        if (i < clipped.length - 1) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      geos.push({ g, id: r.id });
    }
    const asphalt = new THREE.MeshStandardMaterial({ map: this.tex.asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const dirt = new THREE.MeshStandardMaterial({ map: this.tex.dirtRoad, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const { g, id } of geos) {
      const m = new THREE.Mesh(g, id === 'main' ? asphalt : dirt);
      m.receiveShadow = true; this.group.add(m);
    }
  }

  buildBarricade(x, z, dx, dz) {
    const T = this.terrain, g = new THREE.Group();
    const y = T.height(x, z);
    g.position.set(x, y, z); g.rotation.y = Math.atan2(dx, dz);
    const conc = new THREE.MeshStandardMaterial({ map: this.tex.concrete, roughness: 1 });
    const stripe = document.createElement('canvas'); stripe.width = 128; stripe.height = 32; const c = stripe.getContext('2d');
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2f2ee' : '#e8621c'; c.beginPath(); c.moveTo(i * 16, 32); c.lineTo(i * 16 + 16, 0); c.lineTo(i * 16 + 32, 0); c.lineTo(i * 16 + 16, 32); c.fill(); }
    const st = new THREE.CanvasTexture(stripe); st.colorSpace = THREE.SRGBColorSpace; st.wrapS = THREE.RepeatWrapping;
    const board = new THREE.MeshStandardMaterial({ map: st, roughness: 0.6 });
    for (let i = -2; i <= 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.7), conc); b.position.set(i * 2.6, 0.42, 0); b.rotation.y = (i % 2) * 0.05; b.castShadow = true; b.receiveShadow = true; g.add(b); }
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), conc); p.position.set(sx * 5.4, 0.8, -0.2); g.add(p); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.3, 0.06), board); rail.position.set(0, 1.35, -0.2); g.add(rail);
    const signTex = textTexture('', { w: 512, h: 256, lines: ['ROAD CLOSED', 'THE SERVER', 'ENDS HERE'], font: 'bold 76px "Arial Black", Arial', color: '#111', bg: '#f0c020', pad: 14 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.08), [conc, conc, conc, conc, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 }), conc]); sign.position.set(0, 2.6, -0.2); sign.castShadow = true; g.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), conc); post.position.set(0, 1.4, -0.25); g.add(post);
    this.barLamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff8a00, emissiveIntensity: 2 })); this.barLamp.position.set(0, 3.5, -0.2); g.add(this.barLamp);
    this.group.add(g);
  }

  // -------------------------------------------------------------- trees
  buildTrees() {
    const mk = (parts) => { const gs = parts.map(({ geo, color, jitter = 0.08 }) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      const n = g.attributes.position.count, cols = new Float32Array(n * 3);
      const c = new THREE.Color(color);
      const rnd = mulberry32(n);
      for (let i = 0; i < n; i += 3) { const j = 1 + (rnd() - 0.5) * jitter * 2; for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = c.r * j; cols[(i + k) * 3 + 1] = c.g * j; cols[(i + k) * 3 + 2] = c.b * j; } }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      return g;
    }); return mergeGeometries(gs); };
    const cone = (r, h, y, seg = 8) => { const g = new THREE.ConeGeometry(r, h, seg, 1); g.translate(0, y + h / 2, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const wob = 1 + Math.sin(a * 5 + y * 3) * 0.08; p.setX(i, p.getX(i) * wob); p.setZ(i, p.getZ(i) * wob); } return g; };
    const trunk = (r, h) => { const g = new THREE.CylinderGeometry(r * 0.7, r, h, 6, 1); g.translate(0, h / 2, 0); return g; };
    const blob = (r, x, y, z, sx = 1, sy = 0.85) => { const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 4.1 + p.getY(i) * 3.3) * Math.cos(p.getZ(i) * 3.7)) * 0.16; p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sx); } g.translate(x, y, z); return g; };
    this.geoms = [
      mk([{ geo: trunk(0.22, 2.4), color: 0x4a3524 }, { geo: cone(2.1, 3.0, 1.6), color: 0x1f4a2a }, { geo: cone(1.65, 2.8, 3.2), color: 0x235330 }, { geo: cone(1.2, 2.6, 4.9), color: 0x275c36 }, { geo: cone(0.7, 2.2, 6.7), color: 0x2c6640 }]),
      mk([{ geo: trunk(0.3, 3.0), color: 0x4d3a28 }, { geo: blob(2.0, 0, 4.4, 0), color: 0x3d6b2a, jitter: 0.14 }, { geo: blob(1.5, 1.3, 3.8, 0.5), color: 0x467a30, jitter: 0.14 }, { geo: blob(1.4, -1.2, 3.9, -0.6), color: 0x376226, jitter: 0.14 }, { geo: blob(1.2, 0.2, 5.6, 0.3), color: 0x4e8536, jitter: 0.14 }]),
      mk([{ geo: trunk(0.14, 4.4), color: 0xd9d6c8 }, { geo: blob(1.15, 0, 5.3, 0, 1, 1.15), color: 0x7ea23a, jitter: 0.16 }, { geo: blob(0.85, 0.7, 4.4, 0.3, 1, 1), color: 0x8bb043, jitter: 0.16 }, { geo: blob(0.8, -0.6, 4.2, -0.4, 1, 1), color: 0x6f9435, jitter: 0.16 }]),
    ];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
    const uni = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uni.uTime; sh.uniforms.uWind = uni.uWind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x*0.21 + instanceMatrix[3].z*0.17;
  float hgt = max(position.y, 0.0);
  float sway = (sin(uTime*1.4 + ph) * 0.6 + sin(uTime*2.7 + ph*1.9) * 0.25) * (0.02 + length(uWind)*0.05);
  transformed.x += sway * hgt * hgt * 0.06 * (0.5 + uWind.x);
  transformed.z += sway * hgt * hgt * 0.06 * (0.5 + uWind.y);
#endif`);
    };
    this.treeMat = mat;
    const CH = 80;
    const buckets = new Map();
    this.trees.forEach((t, idx) => {
      const key = `${Math.floor((t[0] + HALF) / CH)}_${Math.floor((t[1] + HALF) / CH)}_${t[3]}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(idx);
    });
    this.treeChunks = [];
    this.treeSlot = new Array(this.trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, list] of buckets) {
      const kind = Number(key.split('_')[2]);
      const mesh = new THREE.InstancedMesh(this.geoms[kind], mat, list.length);
      const rnd = mulberry32(list[0]);
      list.forEach((idx, i) => {
        const t = this.trees[idx];
        const y = this.terrain.height(t[0], t[1]) - 0.2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[4]);
        const s = t[2] * (kind === 0 ? 1.15 : 1);
        sc.set(s * (0.9 + rnd() * 0.2), s, s * (0.9 + rnd() * 0.2)); ps.set(t[0], y, t[1]);
        m4.compose(ps, q, sc);
        mesh.setMatrixAt(i, m4);
        col.setHSL(0.27 + (rnd() - 0.5) * 0.06, 0.15 + rnd() * 0.15, 0.85 + rnd() * 0.3);
        mesh.setColorAt(i, col);
        this.treeSlot[idx] = { mesh, i, m: m4.clone() };
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      const cx = list.reduce((a, i) => a + this.trees[i][0], 0) / list.length, cz = list.reduce((a, i) => a + this.trees[i][1], 0) / list.length;
      mesh.userData.c = [cx, cz];
      this.group.add(mesh);
      this.treeChunks.push(mesh);
    }
    this.zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  hideTree(idx) {
    const s = this.treeSlot[idx];
    if (!s || s.hidden) return;
    s.hidden = true;
    s.mesh.setMatrixAt(s.i, this.zeroM); s.mesh.instanceMatrix.needsUpdate = true;
  }
  applyFelled() { for (const k in this.world.felled || {}) this.hideTree(+k); }
  hideErasedTrees() {
    const er = Object.values(this.world.erased || {});
    if (!er.length) return;
    this.trees.forEach((t, idx) => { for (const e of er) if (Math.hypot(t[0] - e.x, t[1] - e.z) < e.r + 1) { this.hideTree(idx); break; } });
  }

  // -------------------------------------------------------------- rocks
  buildRocks() {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.78 + 0.35 * Math.abs(Math.sin(x * 3.1 + z * 2.3) * Math.cos(y * 4.3 + x * 1.7)); p.setXYZ(i, x * k, y * k * 0.78, z * k); }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.rock, roughness: 0.95, color: 0xbbb6ab });
    const mesh = new THREE.InstancedMesh(g, mat, this.rocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    this.rocks.forEach((r, i) => {
      const y = this.terrain.height(r[0], r[1]);
      q.setFromEuler(new THREE.Euler((Math.sin(i) * 0.2), r[3], Math.cos(i * 1.7) * 0.2));
      sc.set(r[2] * 1.2, r[2] * 0.9, r[2] * 1.05); ps.set(r[0], y + r[2] * 0.15, r[1]);
      m4.compose(ps, q, sc); mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  // -------------------------------------------------------------- grass
  buildGrass() {
    const count = { low: 12000, medium: 42000, high: 90000 }[this.quality] || 42000;
    const R = 42;
    const base = new THREE.BufferGeometry();
    const w = 0.032;
    const v = [-w, 0, 0, w, 0, 0, -w * 0.8, 0.34, 0, w * 0.8, 0.34, 0, -w * 0.5, 0.68, 0, w * 0.5, 0.68, 0, 0, 1, 0];
    base.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    base.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position;
    const off = new Float32Array(count * 2), rot = new Float32Array(count), sc = new Float32Array(count), tint = new Float32Array(count);
    const rnd = mulberry32(99);
    for (let i = 0; i < count; i++) { off[i * 2] = rnd() * 2 * R; off[i * 2 + 1] = rnd() * 2 * R; rot[i] = rnd() * 6.283; sc[i] = 0.5 + rnd() * 0.75; tint[i] = rnd(); }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2)); g.setAttribute('aRot', new THREE.InstancedBufferAttribute(rot, 1));
    g.setAttribute('aScale', new THREE.InstancedBufferAttribute(sc, 1)); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    g.instanceCount = count;
    this.grassMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uCenter: { value: new THREE.Vector2() }, uR: { value: R }, uTime: this.uniforms.uTime, uWind: this.uniforms.uWind, uHeight: { value: this.heightTex }, uMask: { value: this.maskTex }, uWear: { value: this.wearTex },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uGrid: { value: VERTS }, uWaterLvl: { value: 0 },
      }]),
      vertexShader: `
attribute vec2 aOff; attribute float aRot, aScale, aTint;
uniform vec2 uCenter; uniform float uR, uTime, uGrid, uWaterLvl; uniform vec2 uWind;
uniform sampler2D uHeight, uMask, uWear;
varying vec3 vCol; varying float vFade;
#include <fog_pars_vertex>
float hAt(vec2 p){
  vec2 g = clamp((p + 320.0) / 2.0, vec2(0.0), vec2(uGrid - 1.001));
  ivec2 i0 = ivec2(floor(g)); vec2 f = g - vec2(i0);
  float a = texelFetch(uHeight, i0, 0).r, b = texelFetch(uHeight, i0 + ivec2(1,0), 0).r;
  float c = texelFetch(uHeight, i0 + ivec2(0,1), 0).r, d = texelFetch(uHeight, i0 + ivec2(1,1), 0).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
void main(){
  vec2 rel = mod(aOff - uCenter + uR, 2.0*uR) - uR;
  vec2 wp = uCenter + rel;
  float dist = length(rel);
  float h = hAt(wp);
  vec4 mk = texture2D(uMask, (wp + 320.0) / 640.0);
  float wear = texture2D(uWear, (wp + 320.0) / 640.0).r;
  float ok = (1.0 - smoothstep(0.0, 0.3, mk.r)) * (1.0 - smoothstep(0.03, 0.4, wear)) * (1.0 - smoothstep(0.1, 0.6, mk.g)) * (1.0 - step(0.2, mk.b));
  ok *= smoothstep(uWaterLvl + 0.35, uWaterLvl + 0.9, h) * (1.0 - smoothstep(55.0, 75.0, h));
  float scale = aScale * ok * (1.0 - smoothstep(uR*0.68, uR, dist));
  float y = position.y;
  vec3 p = vec3(position.x, 0.0, 0.0);
  float ca = cos(aRot), sa = sin(aRot);
  p = vec3(ca * p.x, 0.0, -sa * p.x);
  float bend = pow(y, 2.0);
  float gust = sin(uTime*1.6 + wp.x*0.35 + wp.y*0.27) * 0.5 + sin(uTime*3.1 + wp.x*0.9) * 0.2;
  p.x += (uWind.x * 0.25 + 0.05) * gust * bend * 0.55 + uWind.x * 0.1 * bend;
  p.z += (uWind.y * 0.25 + 0.05) * gust * bend * 0.55 + uWind.y * 0.1 * bend;
  p.y = y * 0.5 * scale;
  vec3 wpos = vec3(wp.x, h - 0.02, wp.y) + p * vec3(1.0, 1.0, 1.0) * (0.4 + 0.6*scale);
  vec3 dark = vec3(0.05, 0.12, 0.03), light = vec3(0.27, 0.40, 0.10);
  vec3 tintc = mix(vec3(0.9,1.0,0.7), vec3(1.25,1.1,0.7), aTint);
  vCol = mix(dark, light, y) * tintc * (0.7 + 0.5 * texture2D(uWear, vec2(0.0)).r * 0.0 + 0.3*aTint);
  vFade = 1.0;
  vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: `
uniform vec3 uSunCol, uAmb; uniform vec3 uSunDir;
varying vec3 vCol; varying float vFade;
#include <fog_pars_fragment>
void main(){
  vec3 c = vCol * (uAmb + uSunCol * 0.55);
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}`,
    });
    this.grass = new THREE.Mesh(g, this.grassMat);
    this.grass.frustumCulled = false; this.grass.renderOrder = 1;
    this.group.add(this.grass);
  }

  // -------------------------------------------------------------- per-frame
  update(dt, cam, time, wind, env, inUnder) {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value.set(wind.x, wind.y);
    this.grassMat.uniforms.uCenter.value.set(cam.position.x, cam.position.z);
    const sun = env.sunDir, gu = this.grassMat.uniforms;
    gu.uSunDir.value.copy(sun);
    gu.uSunCol.value.copy(env.sun.color).multiplyScalar(Math.min(1.2, env.sun.intensity * 0.28));
    gu.uAmb.value.copy(env.hemi.color).multiplyScalar(env.hemi.intensity * 0.55).add(new THREE.Color(0.02, 0.03, 0.05));
    gu.uWaterLvl.value = this.world.lake?.level ?? 0;
    this.group.visible = !inUnder;
    if (this.barLamp) this.barLamp.material.emissiveIntensity = Math.sin(time * 5) > 0 ? 3.2 : 0.15;
    // shadow-cast only nearby tree chunks
    this._st = (this._st || 0) - dt;
    if (this._st <= 0) {
      this._st = 0.8;
      for (const m of this.treeChunks) { const d = Math.hypot(m.userData.c[0] - cam.position.x, m.userData.c[1] - cam.position.z); m.castShadow = d < env.shadowRange + 45; }
    }
  }
}
