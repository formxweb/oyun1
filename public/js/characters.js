// Expressive procedural humanoids used for players, NPCs, statues and the ghosts of the Understory.
// Faces blink, look at people, form moods and talk; bodies walk, run, swim, cower, pray, fish, hammer, mourn.
import * as THREE from 'three';

export const ACT = { idle: 0, walk: 1, run: 2, work: 3, cower: 4, wave: 5, point: 6, talk: 7, sit: 8, sleep: 9, mourn: 10, dead: 11, fish: 12, write: 13, hammer: 14, pray: 15, cook: 16, dj: 17, patrol: 18 };
export const MOOD = { neutral: 0, happy: 1, sad: 2, scared: 3, angry: 4, surprised: 5, sleepy: 6, suspicious: 7 };
// player animation codes (from state packets)
export const PAN = { idle: 0, walk: 1, run: 2, swim: 3, air: 4 };
export const EMOTES = ['wave', 'point', 'cheer', 'cower', 'dance', 'sit', 'salute', 'shrug'];

const matCache = new Map();
function mat(color, rough = 0.8, extra = {}) {
  const k = color + '|' + rough + '|' + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));
  return matCache.get(k);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function hashColor(name, s = 0.55, l = 0.5) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, s, l);
}

/** look: {skin, hair, style, shirt, pants, hat, glasses, scale, build, female} */
export class Humanoid {
  constructor(look = {}, opts = {}) {
    this.look = look; this.opts = opts;
    const sc = look.scale ?? 1, bd = look.build ?? 1;
    this.scale = sc;
    const skinC = look.skin || '#e2b799', shirtC = look.shirt || '#4a6a8a', pantsC = look.pants || '#2a2a33', hairC = look.hair || '#2a1f1a';
    const ghost = opts.ghost, stone = opts.stone;
    const M = (c, r = 0.8) => ghost ? mat(0x9fe8ff, 0.3, { transparent: true, opacity: 0.32, emissive: 0x2ac8d8, emissiveIntensity: 0.9, depthWrite: false }) : stone ? mat(0x8a8a86, 0.95) : mat(c, r);
    this.M = M;
    const skin = ghost ? M() : stone ? M() : mat(skinC, 0.55), shirt = M(shirtC), pants = M(pantsC), hair = M(hairC, 0.9);

    const root = new THREE.Group();
    this.root = root;
    const body = new THREE.Group(); root.add(body); this.body = body; body.scale.setScalar(sc);
    const hips = new THREE.Group(); hips.position.y = 0.9; body.add(hips); this.hips = hips;
    const chest = new THREE.Group(); hips.add(chest); this.chest = chest;
    // torso
    const torso = new THREE.Mesh(geo('torso', () => new THREE.CapsuleGeometry(0.17, 0.36, 6, 14)), shirt);
    torso.scale.set(1.12 * bd, 1, 0.78 * bd); torso.position.y = 0.3; torso.castShadow = true; chest.add(torso);
    const belly = new THREE.Mesh(geo('belly', () => new THREE.SphereGeometry(0.17, 12, 10)), shirt); belly.scale.set(1.05 * bd, 0.9, 0.85 * bd); belly.position.set(0, 0.06, 0.02); belly.castShadow = true; chest.add(belly);
    const pelvis = new THREE.Mesh(geo('pelvis', () => new THREE.SphereGeometry(0.16, 12, 10)), pants); pelvis.scale.set(1.15 * bd, 0.7, 0.85 * bd); pelvis.position.y = -0.03; hips.add(pelvis);
    // neck + head
    const neck = new THREE.Mesh(geo('neck', () => new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8)), skin); neck.position.y = 0.6; chest.add(neck);
    const head = new THREE.Group(); head.position.y = 0.74; chest.add(head); this.head = head;
    const skull = new THREE.Mesh(geo('skull', () => new THREE.SphereGeometry(0.128, 20, 16)), skin); skull.scale.set(0.95, 1.08, 1.02); skull.castShadow = true; head.add(skull);
    const jaw = new THREE.Mesh(geo('jaw', () => new THREE.SphereGeometry(0.095, 14, 10)), skin); jaw.scale.set(1.0, 0.8, 0.95); jaw.position.set(0, -0.075, 0.02); head.add(jaw);
    const nose = new THREE.Mesh(geo('nose', () => new THREE.SphereGeometry(0.02, 8, 6)), skin); nose.position.set(0, -0.015, 0.13); nose.scale.set(0.9, 1.1, 1.3); head.add(nose);
    for (const sx of [-1, 1]) { const ear = new THREE.Mesh(geo('ear', () => new THREE.SphereGeometry(0.03, 8, 6)), skin); ear.scale.set(0.5, 1, 0.8); ear.position.set(sx * 0.122, -0.01, 0); head.add(ear); }
    // eyes
    this.eyes = [];
    const eyeWhite = mat(0xf2f2ee, 0.3), pupilM = ghost ? mat(0xffffff, 0.2, { emissive: 0xaaffff, emissiveIntensity: 2 }) : mat(look.eye || 0x1a1a1a, 0.2), lidM = ghost ? skin : mat(skinC, 0.55);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * 0.046, 0.022, 0.108); head.add(g);
      if (!ghost) { const w = new THREE.Mesh(geo('eyew', () => new THREE.SphereGeometry(0.024, 12, 10)), eyeWhite); g.add(w); }
      const p = new THREE.Mesh(geo('pupil', () => new THREE.SphereGeometry(ghost ? 0.02 : 0.0135, 8, 8)), pupilM); p.position.set(0, 0, 0.016); g.add(p);
      const lid = new THREE.Mesh(geo('lid', () => new THREE.SphereGeometry(0.0265, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), lidM); lid.rotation.x = -0.15; g.add(lid);
      const brow = new THREE.Mesh(geo('brow', () => new THREE.BoxGeometry(0.052, 0.009, 0.012)), M(hairC, 0.9)); brow.position.set(sx * 0.046, 0.062, 0.117); head.add(brow);
      this.eyes.push({ g, p, lid, brow, side: sx });
    }
    // mouth
    const mouthG = new THREE.Group(); mouthG.position.set(0, -0.064, 0.115); head.add(mouthG); this.mouthG = mouthG;
    const lipM = ghost ? mat(0x104048, 0.5) : mat('#7a3b3b', 0.5);
    const inner = new THREE.Mesh(geo('minner', () => new THREE.BoxGeometry(0.045, 0.012, 0.008)), mat(0x220808, 0.8)); mouthG.add(inner); this.mouthInner = inner;
    const lip = new THREE.Mesh(geo('lip', () => new THREE.BoxGeometry(0.052, 0.009, 0.01)), lipM); lip.position.z = 0.004; mouthG.add(lip); this.lip = lip;
    this.mouthCorners = [];
    for (const sx of [-1, 1]) { const c = new THREE.Mesh(geo('mc', () => new THREE.BoxGeometry(0.018, 0.008, 0.01)), lipM); c.position.set(sx * 0.03, 0, 0.004); mouthG.add(c); this.mouthCorners.push(c); }
    // hair
    this.addHair(head, look.style || 'short', hair, look);
    this.addHat(head, look.hat || 'none', look);
    if (look.glasses) {
      const gm = mat(0x111111, 0.4, { metalness: 0.6 });
      for (const sx of [-1, 1]) { const r = new THREE.Mesh(geo('gl', () => new THREE.TorusGeometry(0.03, 0.004, 6, 16)), gm); r.position.set(sx * 0.046, 0.022, 0.126); head.add(r); }
      const br = new THREE.Mesh(geo('glb', () => new THREE.BoxGeometry(0.03, 0.004, 0.004)), gm); br.position.set(0, 0.026, 0.128); head.add(br);
    }
    // arms
    this.arms = [];
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.235 * bd, 0.55, 0); chest.add(sh);
      const upper = new THREE.Mesh(geo('upper', () => new THREE.CapsuleGeometry(0.052, 0.22, 4, 10)), shirt); upper.position.y = -0.15; upper.castShadow = true; sh.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
      const fore = new THREE.Mesh(geo('fore', () => new THREE.CapsuleGeometry(0.045, 0.2, 4, 10)), shirt.clone ? shirt : shirt); fore.position.y = -0.13; fore.castShadow = true; elbow.add(fore);
      const hand = new THREE.Mesh(geo('hand', () => new THREE.SphereGeometry(0.046, 10, 8)), skin); hand.position.y = -0.29; hand.scale.set(0.9, 1.1, 0.75); elbow.add(hand);
      const hold = new THREE.Group(); hold.position.y = -0.31; elbow.add(hold);
      this.arms.push({ sh, elbow, hand, hold, side: sx });
    }
    // legs
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hp = new THREE.Group(); hp.position.set(sx * 0.095 * bd, -0.04, 0); hips.add(hp);
      const thigh = new THREE.Mesh(geo('thigh', () => new THREE.CapsuleGeometry(0.075, 0.3, 4, 10)), pants); thigh.position.y = -0.21; thigh.castShadow = true; hp.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.42; hp.add(knee);
      const shin = new THREE.Mesh(geo('shin', () => new THREE.CapsuleGeometry(0.06, 0.3, 4, 10)), pants); shin.position.y = -0.21; shin.castShadow = true; knee.add(shin);
      const foot = new THREE.Mesh(geo('foot', () => new THREE.BoxGeometry(0.095, 0.06, 0.26)), ghost || stone ? M() : mat(0x2a221c, 0.7)); foot.position.set(0, -0.44, 0.05); foot.castShadow = true; knee.add(foot);
      this.legs.push({ hp, knee, foot, side: sx });
    }
    // props for work animations
    this.rod = null;
    // state
    this.phase = Math.random() * 6; this.blinkT = 1 + Math.random() * 3; this.blink = 0; this.talkT = 0; this.speaking = false;
    this.gazeYaw = 0; this.gazePitch = 0; this.exprT = 0;
    this.expr = { brow: 0, browTilt: 0, mouthOpen: 0, smile: 0, lid: 0, shake: 0 };
    this.moodTarget = { brow: 0, browTilt: 0, smile: 0.15, lid: 0, shake: 0, wide: 0 };
    this.crouch = 0; this.lean = 0; this.dead = 0; this.swim = 0;
    this.emote = -1; this.emoteT = 0; this.mood = 0; this.act = 0; this.speedNow = 0;
    this.holdPose = 0;
    this.seed = Math.random() * 100;
  }

  addHair(head, style, hair) {
    if (style === 'bald') return;
    const cap = (r = 0.138) => new THREE.Mesh(geo('haircap' + r, () => new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)), hair);
    const c = cap(); c.scale.set(0.98, 1.1, 1.06); c.position.y = 0.012; c.rotation.x = -0.18; c.castShadow = true; head.add(c);
    if (style === 'long') {
      const back = new THREE.Mesh(geo('hairlong', () => new THREE.CapsuleGeometry(0.11, 0.26, 4, 10)), hair); back.position.set(0, -0.14, -0.06); back.scale.set(1, 1, 0.75); head.add(back);
      for (const sx of [-1, 1]) { const s = new THREE.Mesh(geo('hairside', () => new THREE.CapsuleGeometry(0.03, 0.16, 4, 6)), hair); s.position.set(sx * 0.115, -0.08, 0.0); head.add(s); }
    } else if (style === 'bun') {
      const b = new THREE.Mesh(geo('bun', () => new THREE.SphereGeometry(0.06, 10, 8)), hair); b.position.set(0, 0.13, -0.08); head.add(b);
    } else if (style === 'wild') {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283; const s = new THREE.Mesh(geo('spike', () => new THREE.ConeGeometry(0.03, 0.09, 5)), hair); s.position.set(Math.sin(a) * 0.1, 0.09 + (i % 3) * 0.02, Math.cos(a) * 0.1 - 0.02); s.rotation.set(Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8); head.add(s); }
    } else if (style === 'short') {
      const t = new THREE.Mesh(geo('tuft', () => new THREE.SphereGeometry(0.05, 8, 6)), hair); t.position.set(0, 0.125, 0.06); t.scale.set(1.3, 0.7, 1); head.add(t);
    }
  }

  addHat(head, hat) {
    const M = this.M;
    if (hat === 'none') return;
    if (hat === 'cap') {
      const c = new THREE.Mesh(geo('capd', () => new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), M(0x2a4a7a)); c.position.y = 0.03; c.scale.set(1, 0.9, 1.05); c.castShadow = true; head.add(c);
      const b = new THREE.Mesh(geo('capb', () => new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14, 1, false, -Math.PI * 0.5, Math.PI)), M(0x2a4a7a)); b.position.set(0, 0.045, 0.13); b.rotation.x = 0.08; head.add(b);
    } else if (hat === 'beanie') {
      const c = new THREE.Mesh(geo('beanie', () => new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58)), M(0x7a3a3a)); c.position.y = 0.02; c.scale.set(1, 1.05, 1.05); c.castShadow = true; head.add(c);
      const p = new THREE.Mesh(geo('pom', () => new THREE.SphereGeometry(0.03, 8, 6)), M(0xd9d0c0)); p.position.y = 0.155; head.add(p);
    } else if (hat === 'sheriff') {
      const brim = new THREE.Mesh(geo('sbrim', () => new THREE.CylinderGeometry(0.21, 0.21, 0.012, 20)), M(0x6a5030)); brim.position.y = 0.075; head.add(brim);
      const crown = new THREE.Mesh(geo('scrown', () => new THREE.CylinderGeometry(0.115, 0.13, 0.11, 16)), M(0x6a5030)); crown.position.y = 0.13; crown.castShadow = true; head.add(crown);
      const band = new THREE.Mesh(geo('sband', () => new THREE.CylinderGeometry(0.132, 0.132, 0.02, 16)), M(0x2a1a10)); band.position.y = 0.095; head.add(band);
    } else if (hat === 'hood') {
      const c = new THREE.Mesh(geo('hood', () => new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.75)), M(0x4a4a3a)); c.position.set(0, 0.005, -0.015); c.scale.set(1.02, 1.1, 1.06); c.rotation.x = -0.2; c.castShadow = true; head.add(c);
    } else if (hat === 'headphones') {
      const band = new THREE.Mesh(geo('hpband', () => new THREE.TorusGeometry(0.135, 0.01, 6, 20, Math.PI)), M(0x1a1a1a)); band.position.y = 0.01; band.rotation.z = 0; head.add(band);
      for (const sx of [-1, 1]) { const cup = new THREE.Mesh(geo('hpcup', () => new THREE.CylinderGeometry(0.05, 0.05, 0.035, 12)), M(0x222222)); cup.rotation.z = Math.PI / 2; cup.position.set(sx * 0.135, -0.005, 0); head.add(cup); }
    }
  }

  setLook(target) { this.gazeTarget = target; }

  /** state: {speed, act, mood, speaking, gaze:{yaw,pitch}|null, swim, air, carry, emote, dead, crouch} */
  update(dt, s) {
    const t = (this.time = (this.time || 0) + dt);
    const speed = s.speed || 0;
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 10);
    const sp = this.speedNow;
    const act = s.act ?? 0;
    const walking = sp > 0.25;
    this.phase += dt * (walking ? 3.2 + sp * 1.55 : 0.0);
    const ph = this.phase;
    const run = clamp((sp - 2.2) / 4, 0, 1);
    const amp = walking ? clamp(sp * 0.13, 0.12, 0.85) : 0;
    const dead = s.dead ? 1 : 0;
    this.dead += (dead - this.dead) * Math.min(1, dt * 6);

    // ---- targets for pose overrides
    let crouchT = 0, armLift = [0, 0], armFwd = [0, 0], elbowBend = [0.12, 0.12], headDown = 0, sway = 0, leanT = walking ? 0.06 + run * 0.22 : 0;
    let hipsY = 0.9, sit = 0, bodyRoll = 0;
    const acts = act;
    const emote = s.emote != null && s.emote >= 0 ? s.emote : -1;
    if (acts === ACT.cower || (emote === 3)) { crouchT = 0.85; armLift = [-2.6, -2.6]; elbowBend = [1.9, 1.9]; headDown = 0.4; }
    else if (acts === ACT.sleep) { headDown = 0.5; sway = 0.02; }
    else if (acts === ACT.mourn || acts === ACT.pray) { headDown = 0.55; armFwd = [-0.9, -0.9]; elbowBend = [1.6, 1.6]; }
    else if (acts === ACT.write) { headDown = 0.35; armFwd = [-0.7, -0.4]; elbowBend = [1.3, 1.0]; armLift[1] = Math.sin(t * 6) * 0.05; }
    else if (acts === ACT.hammer) { armFwd[1] = -0.6 + Math.sin(t * 5) * 0.7; elbowBend[1] = 1.0 + Math.sin(t * 5) * 0.3; }
    else if (acts === ACT.cook) { armFwd = [-0.5, -0.6 + Math.sin(t * 4) * 0.2]; elbowBend = [1.1, 1.2]; headDown = 0.25; }
    else if (acts === ACT.fish) { armFwd = [-0.7, -0.9]; elbowBend = [1.0, 0.9]; sway = 0.02; }
    else if (acts === ACT.dj) { armFwd = [-0.5, -1.4]; elbowBend = [1.2, 1.3]; headDown = 0.1; }
    else if (acts === ACT.point || emote === 1) { armFwd[1] = -1.5; elbowBend[1] = 0.1; }
    else if (acts === ACT.wave || emote === 0) { armLift[1] = 2.7; elbowBend[1] = 0.6 + Math.sin(t * 9) * 0.5; }
    else if (emote === 2) { armLift = [2.7 + Math.sin(t * 8) * 0.2, 2.7 + Math.cos(t * 8) * 0.2]; elbowBend = [0.4, 0.4]; }
    else if (emote === 4) { armLift = [1.2 + Math.sin(t * 5) * 0.8, 1.2 + Math.cos(t * 5) * 0.8]; sway = Math.sin(t * 5) * 0.12; crouchT = 0.12 + Math.abs(Math.sin(t * 5)) * 0.1; }
    else if (emote === 5) { sit = 1; }
    else if (emote === 6) { armFwd[1] = -0.2; armLift[1] = 1.5; elbowBend[1] = 2.3; }
    else if (emote === 7) { armLift = [0.7, 0.7]; elbowBend = [1.5, 1.5]; }
    else if (acts === ACT.talk || s.speaking) { armFwd[1] = -0.25 + Math.sin(t * 3.1 + this.seed) * 0.35; elbowBend[1] = 0.8 + Math.sin(t * 4.2) * 0.4; armFwd[0] = Math.sin(t * 2.3 + 1) * 0.12; }
    if (s.carry) { armFwd = [-1.15, -1.15]; elbowBend = [0.7, 0.7]; }
    if (s.swim) this.swim += (1 - this.swim) * Math.min(1, dt * 5); else this.swim += (0 - this.swim) * Math.min(1, dt * 5);

    this.crouch += (crouchT - this.crouch) * Math.min(1, dt * 8);
    this.lean += (leanT - this.lean) * Math.min(1, dt * 6);
    const sitK = (this.sitK = (this.sitK || 0) + (sit - (this.sitK || 0)) * Math.min(1, dt * 6));

    // ---- body
    const bob = walking ? Math.abs(Math.sin(ph)) * 0.035 * (1 + run) : Math.sin(t * 1.6 + this.seed) * 0.004;
    hipsY = 0.9 - this.crouch * 0.32 - sitK * 0.42 + bob - this.swim * 0.35;
    this.hips.position.y = hipsY;
    this.hips.rotation.x = this.lean + this.swim * 1.1 + this.crouch * 0.4 + (s.air ? -0.08 : 0);
    this.hips.rotation.z = sway * Math.sin(t * 1.2 + this.seed) + (walking ? Math.sin(ph) * 0.03 : 0);
    this.hips.rotation.y = walking ? Math.sin(ph) * 0.1 : 0;
    this.chest.rotation.x = -this.crouch * 0.3 + Math.sin(t * 1.5 + this.seed) * 0.006;
    this.chest.scale.y = 1 + Math.sin(t * 1.7 + this.seed) * 0.008;
    this.chest.rotation.y = walking ? -Math.sin(ph) * 0.12 : 0;

    // legs
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], side = i === 0 ? -1 : 1;
      let sw = walking ? Math.sin(ph + (i ? Math.PI : 0)) * amp : 0;
      let kn = walking ? Math.max(0, -Math.cos(ph + (i ? Math.PI : 0))) * amp * 1.1 + 0.03 : 0.02;
      if (this.swim > 0.3) { sw = Math.sin(t * 6 + i * Math.PI) * 0.35; kn = 0.25; }
      if (s.air) { sw = 0.5 * side * 0.3 + 0.35; kn = 0.9; }
      L.hp.rotation.x = sw + this.crouch * 1.2 + sitK * 1.45;
      L.knee.rotation.x = kn + this.crouch * 1.3 + sitK * -1.4;
      L.hp.rotation.z = side * 0.02;
    }
    // arms
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i];
      const swing = walking && !armLift[i] && !s.carry ? Math.sin(ph + (i ? 0 : Math.PI)) * amp * 1.1 : 0;
      let rx = swing + armFwd[i];
      let rz = i === 0 ? 0.06 : -0.06;
      if (armLift[i]) { rx = -armLift[i] * 0.55; rz = (i === 0 ? 1 : -1) * (armLift[i] > 2 ? 0.2 : 0.6); if (armLift[i] < 0) { rx = armLift[i] * -0.3; rz = 0; } }
      if (this.swim > 0.3) { rx = Math.sin(t * 6 + i * Math.PI) * 1.2 - 1.6; }
      if (s.throwT > 0 && i === 1) { rx = -2.4 + (1 - s.throwT) * 3.0; }
      A.sh.rotation.x = rx; A.sh.rotation.z = rz;
      A.elbow.rotation.x = -(elbowBend[i] + (walking ? Math.max(0, Math.sin(ph + (i ? 0 : Math.PI))) * 0.3 * amp : 0));
    }
    // fishing rod
    if (acts === ACT.fish) { if (!this.rod) { this.rod = new THREE.Mesh(geo('rod', () => new THREE.CylinderGeometry(0.008, 0.014, 2.2, 5)), mat(0x3a2a18, 0.7)); this.rod.rotation.x = 1.0; this.rod.position.set(0, 0.6, 0.5); this.arms[1].hold.add(this.rod); } this.rod.visible = true; }
    else if (this.rod) this.rod.visible = false;

    // dead: lie down
    if (this.dead > 0.01) {
      this.body.rotation.x = -this.dead * (Math.PI / 2);
      this.body.position.y = this.dead * 0.14;
    } else { this.body.rotation.x = 0; this.body.position.y = 0; }

    // ---- face
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt * 9);
    const mood = s.mood ?? 0;
    const M = MOOD_TARGETS[mood] || MOOD_TARGETS[0];
    const ex = this.expr;
    const k = Math.min(1, dt * 7);
    ex.brow += (M.brow - ex.brow) * k; ex.browTilt += (M.tilt - ex.browTilt) * k; ex.smile += (M.smile - ex.smile) * k; ex.lid += (M.lid - ex.lid) * k; ex.shake += (M.shake - ex.shake) * k;
    if (s.speaking || act === ACT.talk || act === ACT.dj) { this.speaking = true; this.talkT += dt * (9 + Math.random() * 6); } else this.speaking = false;
    const mouthOpen = (this.speaking ? (0.25 + 0.75 * Math.abs(Math.sin(this.talkT) * Math.sin(this.talkT * 0.53 + 1))) : 0) * 0.9 + M.open;
    ex.mouthOpen += (mouthOpen - ex.mouthOpen) * Math.min(1, dt * 16);
    const closed = act === ACT.sleep || (s.dead ? 1 : 0) ? 1 : 0;
    const lidClose = clamp(Math.max(this.blink, ex.lid, closed), 0, 1);
    for (const e of this.eyes) {
      e.lid.rotation.x = -0.15 + lidClose * 1.25 + (s.dead ? 0 : 0);
      e.lid.scale.y = 1 + (M.wide || 0) * -0.4;
      e.brow.position.y = 0.062 + ex.brow * 0.02;
      e.brow.rotation.z = e.side * ex.browTilt * 0.5 * (mood === 7 && e.side > 0 ? -0.4 : 1);
      if (mood === 7 && e.side < 0) e.brow.position.y += 0.012;
    }
    this.mouthInner.scale.y = 0.4 + ex.mouthOpen * 5;
    this.mouthInner.scale.x = 1 - ex.mouthOpen * 0.2;
    this.lip.position.y = -ex.mouthOpen * 0.005; this.lip.scale.y = 1 + ex.mouthOpen * 0.6;
    this.mouthCorners[0].position.y = this.mouthCorners[1].position.y = ex.smile * 0.012 - ex.mouthOpen * 0.004;
    this.mouthCorners[0].rotation.z = -ex.smile * 0.6; this.mouthCorners[1].rotation.z = ex.smile * 0.6;
    this.mouthG.position.y = -0.064 - ex.mouthOpen * 0.008;

    // gaze
    const gz = s.gaze;
    let gy = 0, gp = 0;
    if (gz) { gy = clamp(gz.yaw, -1.3, 1.3); gp = clamp(gz.pitch, -0.5, 0.5); }
    else { gy = Math.sin(t * 0.37 + this.seed) * 0.25; gp = Math.sin(t * 0.53 + this.seed * 2) * 0.06; }
    this.gazeYaw += (gy - this.gazeYaw) * Math.min(1, dt * 5); this.gazePitch += (gp - this.gazePitch) * Math.min(1, dt * 5);
    this.head.rotation.y = this.gazeYaw * 0.7 + (walking ? -Math.sin(ph) * 0.05 : 0) + (ex.shake ? (Math.random() - 0.5) * ex.shake * 0.05 : 0);
    this.head.rotation.x = -this.gazePitch * 0.7 + headDown + this.crouch * 0.2 - this.lean * 0.4 + (acts === ACT.talk ? Math.sin(t * 3.5) * 0.04 : 0);
    if (ex.shake) this.head.position.x = (Math.random() - 0.5) * ex.shake * 0.006; else this.head.position.x = 0;
    for (const e of this.eyes) { e.g.rotation.y = (this.gazeYaw - this.head.rotation.y / 0.7 * 0.7) * 0.5; e.g.rotation.x = -this.gazePitch * 0.4; }
  }
}

const MOOD_TARGETS = [
  { brow: 0, tilt: 0, smile: 0.15, lid: 0.0, open: 0, shake: 0 },
  { brow: 0.4, tilt: 0.0, smile: 1.0, lid: 0.15, open: 0.0, shake: 0 },
  { brow: -0.2, tilt: -0.9, smile: -0.8, lid: 0.25, open: 0, shake: 0 },
  { brow: 1.3, tilt: -0.5, smile: -0.2, lid: 0.0, open: 0.85, shake: 1, wide: 1 },
  { brow: -0.8, tilt: 0.95, smile: -0.7, lid: 0.35, open: 0.05, shake: 0.2 },
  { brow: 1.5, tilt: 0, smile: 0, lid: 0, open: 0.7, shake: 0, wide: 1 },
  { brow: -0.2, tilt: -0.2, smile: 0.1, lid: 0.85, open: 0, shake: 0 },
  { brow: 0.2, tilt: 0.4, smile: -0.1, lid: 0.45, open: 0, shake: 0 },
];

// ---------------------------------------------------------------------------------------------
/** Name plate sprite */
export function nameSprite(text, { color = '#ffffff', sub = '', live = false, title = '' } = {}) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  let size = 52; ctx.font = `700 ${size}px "Trebuchet MS", Arial`;
  while (ctx.measureText(text).width > 440 && size > 22) { size -= 3; ctx.font = `700 ${size}px "Trebuchet MS", Arial`; }
  ctx.fillStyle = color; ctx.fillText(text, 256, title || sub ? 52 : 64);
  if (title || sub) { ctx.font = '600 28px "Trebuchet MS", Arial'; ctx.fillStyle = 'rgba(255,220,150,0.95)'; ctx.fillText(title || sub, 256, 96); }
  if (live) { ctx.fillStyle = '#ff2b3a'; ctx.beginPath(); ctx.arc(30, 52, 12, 0, 7); ctx.fill(); ctx.font = '700 22px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('', 30, 52); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: true, fog: false });
  const sp = new THREE.Sprite(m); sp.scale.set(1.6, 0.4, 1); sp.renderOrder = 20;
  return sp;
}

export function speechSprite(text) {
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 256;
  const ctx = cv.getContext('2d');
  const words = text.split(' '); const lines = []; let cur = '';
  ctx.font = '600 34px "Trebuchet MS", Arial';
  for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > 560 && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 5);
  const h = 44 + shown.length * 42;
  ctx.fillStyle = 'rgba(14,16,20,0.82)'; roundRect(ctx, 20, 256 - h - 24, 600, h, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(14,16,20,0.82)'; ctx.beginPath(); ctx.moveTo(300, 256 - 24); ctx.lineTo(320, 256 - 2); ctx.lineTo(340, 256 - 24); ctx.fill();
  ctx.fillStyle = '#f5f0e2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 34px "Trebuchet MS", Arial';
  shown.forEach((l, i) => ctx.fillText(l, 320, 256 - h - 24 + 40 + i * 42));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(2.5, 1.0, 1); sp.renderOrder = 21;
  return sp;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
