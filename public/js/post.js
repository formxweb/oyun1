// Cinematic post stack: MSAA HDR render → bloom → grade (vignette, grain, chroma, glitch, mood) → ACES output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.42 }, uGrain: { value: 0.05 }, uCA: { value: 0.0004 }, uGlitch: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 1.05 }, uHurt: { value: 0 }, uDark: { value: 0 }, uWarp: { value: 0 }, uFade: { value: 0 },
    uNight: { value: 0 }, uUnder: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; varying vec2 vUv;
uniform float uTime, uVignette, uGrain, uCA, uGlitch, uSat, uContrast, uHurt, uDark, uWarp, uFade, uNight, uUnder;
uniform vec3 uTint;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  // warp (descend / event pulse)
  uv += c * uWarp * 0.12 * sin(length(c)*18.0 - uTime*9.0);
  // glitch: horizontal tears + block offsets
  float g = uGlitch;
  if (g > 0.001) {
    float band = floor(uv.y * 38.0 + floor(uTime*12.0)*7.0);
    float r = hash(vec2(band, floor(uTime*14.0)));
    float tear = step(0.86 - g*0.25, r) * (r-0.5) * 0.14 * g;
    uv.x += tear;
    uv.y += (hash(vec2(floor(uTime*20.0), 1.0)) - 0.5) * 0.006 * g;
  }
  float ca = uCA + g * 0.012 + uHurt * 0.004;
  vec2 dir = normalize(c + 1e-5) * ca * (0.6 + length(c)*2.0);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir).b;
  // scan/noise flashes during glitch
  if (g > 0.001) { col += vec3(0.05,0.12,0.14) * g * step(0.985, hash(vec2(floor(uv.y*180.0), floor(uTime*30.0)))); col = mix(col, col.gbr, step(0.995 - g*0.02, hash(vec2(floor(uv.y*20.0), floor(uTime*9.0))))*g); }
  // grade
  float l = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(l), col, uSat * (1.0 - uHurt*0.35));
  col *= uTint;
  col = (col - 0.5) * uContrast + 0.5;
  col = max(col, 0.0);
  // night: cool shadows / warm highlights (teal & orange)
  vec3 shadowTint = vec3(0.86,0.98,1.12), hiTint = vec3(1.08,1.0,0.9);
  col = mix(col * mix(vec3(1.0), shadowTint, 0.5*uNight), col, 1.0);
  col = mix(col, col*hiTint, smoothstep(0.4, 1.4, l) * 0.35);
  // vignette
  float v = smoothstep(0.85, 0.2, length(c) * (1.0 + uVignette));
  col *= mix(1.0 - uVignette, 1.0, v);
  // hurt red edge
  col += vec3(0.7,0.02,0.02) * uHurt * smoothstep(0.25, 0.75, length(c));
  col *= 1.0 - uDark;
  // grain
  float n = hash(uv * vec2(1920.0,1080.0) + uTime);
  col += (n - 0.5) * uGrain * (0.12 + dot(col, vec3(0.33)) * 1.6);
  col = mix(col, vec3(0.0), uFade);
  gl_FragColor = vec4(col, 1.0);
}`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = quality === 'low' ? 0 : quality === 'medium' ? 2 : 4;
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, this.rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), quality === 'low' ? 0.0 : 0.42, 0.65, 0.92);
    this.bloom.enabled = quality !== 'low';
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.u = this.grade.uniforms;
    this.glitch = 0; this.hurt = 0; this.warp = 0; this.dark = 0; this.fade = 0;
  }
  resize(w, h, pr) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  render(dt, time, s) {
    this.glitch = Math.max(0, this.glitch - dt * 0.9); this.hurt = Math.max(0, this.hurt - dt * 1.4); this.warp = Math.max(0, this.warp - dt * 0.8);
    const u = this.u;
    u.uTime.value = time; u.uGlitch.value = this.glitch; u.uHurt.value = this.hurt; u.uWarp.value = this.warp;
    u.uNight.value = s.night; u.uSat.value = s.sat; u.uDark.value = this.dark; u.uFade.value = this.fade;
    u.uTint.value.set(...s.tint);
    u.uVignette.value = s.vignette;
    this.bloom.strength = s.bloom;
    this.composer.render(dt);
  }
}
