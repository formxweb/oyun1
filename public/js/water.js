// Lake Hollow: depth-aware water with fresnel sky reflection, shore foam, ripples from thrown objects,
// and the server-driven state (level, hue, bioluminescent glow).
import * as THREE from 'three';
import { LAKE } from '/shared/layout.js';

const EXT = 108; // half-size of the water plane

const VERT = /* glsl */`
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
uniform sampler2D uTerrain, uNormals, uNoise;
uniform vec3 uSunDir, uSunCol, uZenith, uHorizon, uFogColor, uDeep, uShallow, uGlowCol;
uniform float uTime, uFogDensity, uLevel, uGlow, uNight, uPulse, uEclipse, uSunAmt;
uniform vec2 uCenter;
uniform vec4 uRip[8];   // x, z, startTime, strength

vec3 skyCol(vec3 r){
  float h = clamp(r.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));
  float sd = max(dot(r, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0)*0.3 + pow(sd, 60.0)*0.5 + pow(sd, 900.0)*6.0) * uSunAmt;
  return c;
}

void main(){
  vec2 tuv = (vWorld.xz - uCenter) / ${(EXT * 2).toFixed(1)} + 0.5;
  float ter = texture2D(uTerrain, tuv).r * 24.0 - 14.0;
  float depth = uLevel - ter;
  if (depth < 0.0) discard;

  vec2 uv = vWorld.xz * 0.045;
  vec3 n1 = texture2D(uNormals, uv + vec2(uTime*0.012, uTime*0.008)).xyz*2.0-1.0;
  vec3 n2 = texture2D(uNormals, uv*2.7 - vec2(uTime*0.02, -uTime*0.014)).xyz*2.0-1.0;
  vec3 n3 = texture2D(uNormals, uv*7.3 + vec2(-uTime*0.03, uTime*0.02)).xyz*2.0-1.0;
  vec2 slope = n1.xy*0.55 + n2.xy*0.35 + n3.xy*0.18;
  // ripples
  float foamRip = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    if (r.w > 0.0) {
      float age = uTime - r.z;
      vec2 dv = vWorld.xz - r.xy; float d = length(dv);
      float front = age * 3.6;
      float w = sin((d - front) * 5.0) * exp(-abs(d - front) * 0.9) * exp(-age * 0.55) * r.w * smoothstep(0.0, 0.4, age);
      slope += normalize(dv + 1e-4) * w * 0.55;
      foamRip += exp(-abs(d - front) * 3.0) * exp(-age*1.2) * r.w * 0.35;
    }
  }
  vec3 N = normalize(vec3(slope.x, 1.6, slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.5);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyCol(R);
  // body colour by depth
  float dd = smoothstep(0.0, 6.5, depth);
  vec3 body = mix(uShallow, uDeep, dd);
  float caust = texture2D(uNoise, vWorld.xz*0.12 + vec2(uTime*0.03, 0.0)).g;
  body += uShallow * 0.25 * (1.0 - dd) * pow(caust, 3.0) * (0.3 + 0.7 * uSunAmt);
  // bioluminescence — the lake has been fed
  float gl = texture2D(uNoise, vWorld.xz*0.05 + uTime*0.01).b;
  body += uGlowCol * uGlow * (0.15 + 0.85*pow(gl, 2.0)) * (0.35 + 0.65*uNight) * (0.4 + 0.6*dd) * 1.8;
  body += uGlowCol * uPulse * 2.5 * (0.5 + 0.5*sin(length(vWorld.xz - uCenter)*0.25 - uTime*4.0));
  float sd = max(dot(reflect(-uSunDir, N), V), 0.0);
  vec3 spec = uSunCol * pow(sd, 260.0) * 6.0 * uSunAmt * (1.0 - uEclipse);
  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0)) + spec;
  // shore foam
  float edge = 0.32 + 0.16 * sin(uTime*0.9 + vWorld.x*0.35 + vWorld.z*0.3);
  float foam = smoothstep(edge, 0.0, depth) * (0.55 + 0.45 * texture2D(uNoise, vWorld.xz*0.3 + uTime*0.02).r);
  foam = max(foam, clamp(foamRip, 0.0, 1.0));
  col = mix(col, vec3(0.86,0.9,0.92) * (0.35 + 0.65*uSunAmt + 0.2), clamp(foam, 0.0, 1.0) * 0.85);
  float alpha = smoothstep(0.0, 0.35, depth) * mix(0.72, 0.96, dd);
  alpha = max(alpha, foam*0.6*step(0.0, depth));
  float dist = length(cameraPosition - vWorld);
  float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(ff, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}`;

export class WaterView {
  constructor(scene, tex, terrain, world) {
    this.scene = scene; this.terrain = terrain; this.world = world;
    this.rip = []; for (let i = 0; i < 8; i++) this.rip.push(new THREE.Vector4(0, 0, -100, 0));
    this.ripIdx = 0;
    const S = 256;
    this.data = new Uint8Array(S * S);
    this.tTex = new THREE.DataTexture(this.data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    this.tTex.magFilter = this.tTex.minFilter = THREE.LinearFilter; this.tTex.needsUpdate = true;
    this.S = S;
    this.refreshDepth();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTerrain: { value: this.tTex }, uNormals: { value: tex.waterN }, uNoise: { value: tex.noise },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() }, uDeep: { value: new THREE.Color(0x0a2a3a) }, uShallow: { value: new THREE.Color(0x2c7f86) }, uGlowCol: { value: new THREE.Color(0x30ffd0) },
        uTime: { value: 0 }, uFogDensity: { value: 0.001 }, uLevel: { value: 0 }, uGlow: { value: 0 }, uNight: { value: 0 }, uPulse: { value: 0 }, uEclipse: { value: 0 }, uSunAmt: { value: 1 },
        uCenter: { value: new THREE.Vector2(LAKE.x, LAKE.z) }, uRip: { value: this.rip },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(EXT * 2, EXT * 2, 1, 1).rotateX(-Math.PI / 2), this.mat);
    this.mesh.position.set(LAKE.x, 0, LAKE.z);
    this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pulse = 0;
  }

  refreshDepth() {
    const S = this.S;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = LAKE.x + (i / (S - 1) - 0.5) * EXT * 2, z = LAKE.z + (j / (S - 1) - 0.5) * EXT * 2;
      const h = this.terrain.height(x, z);
      this.data[j * S + i] = Math.max(0, Math.min(255, Math.round(((h + 14) / 24) * 255)));
    }
    this.tTex.needsUpdate = true;
  }

  splash(x, z, strength = 1) {
    const r = this.rip[this.ripIdx++ % 8];
    r.set(x, z, this.mat.uniforms.uTime.value, Math.min(2.4, strength));
  }

  update(dt, time, env, lake) {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(env.sunDir); u.uSunCol.value.copy(env.sunColor.copy(env.skyMat.uniforms.uSunCol.value));
    u.uZenith.value.copy(env.skyMat.uniforms.uZenith.value); u.uHorizon.value.copy(env.skyMat.uniforms.uHorizon.value);
    u.uFogColor.value.copy(env.scene.fog.color); u.uFogDensity.value = env.scene.fog.density;
    u.uSunAmt.value = env.skyMat.uniforms.uSunAmt.value; u.uEclipse.value = env.eclipse || 0;
    u.uNight.value = env.nightAmt;
    const lv = lake?.level ?? 0;
    u.uLevel.value += (lv - u.uLevel.value) * Math.min(1, dt * 0.6);
    this.mesh.position.y = u.uLevel.value;
    u.uGlow.value += ((lake?.glow ?? 0) - u.uGlow.value) * Math.min(1, dt * 0.5);
    // hue shifts the whole palette of the lake
    const hue = lake?.hue ?? 0;
    u.uDeep.value.setHSL((0.55 + hue) % 1, 0.65, 0.09 + Math.min(0.06, u.uGlow.value * 0.05));
    u.uShallow.value.setHSL((0.5 + hue * 1.1) % 1, 0.5, 0.33);
    u.uGlowCol.value.setHSL((0.46 + hue * 1.3) % 1, 1.0, 0.55);
    this.pulse = Math.max(0, this.pulse - dt * 0.25);
    u.uPulse.value = this.pulse;
  }
}
