// Local player: input, movement (shares collision code with the server), third/first person camera,
// aiming, and the tool belt (hands / charge / plank / sign).
import * as THREE from 'three';
import { Humanoid } from './characters.js';
import { resolveXZ, groundAt, insideBox, STEP, PLAYER_R, PLAYER_H } from '/shared/collide.js';
import { lakeD, VOID_DEPTH } from '/shared/terrain.js';
import { UNDER, WATER_LEVEL } from '/shared/layout.js';
import { clamp } from '/shared/util.js';
import { lookForName } from './entities.js';

const WALK = 4.4, RUN = 7.6, SWIM = 2.9, JUMP = 6.5, GRAV = 22;
const TOOLS = ['HANDS', 'CHARGE', 'PLANK', 'SIGN'];

export class LocalPlayer {
  constructor({ camera, scene, terrain, col, net, world, objects, hooks }) {
    this.camera = camera; this.scene = scene; this.terrain = terrain; this.col = col; this.net = net; this.world = world; this.objects = objects; this.hooks = hooks;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.vy = 0;
    this.yaw = 0; this.pitch = 0; this.onGround = true; this.swim = false; this.zone = 'surface';
    this.keys = new Set(); this.mdx = 0; this.mdy = 0; this.locked = false;
    this.tool = 0; this.heldId = null; this.dead = false; this.name = 'you';
    this.firstPerson = false; this.camDist = 3.9; this.camDistCur = 3.9; this.fov = 66;
    this.shake = 0; this.shakeT = 0; this.bob = 0; this.speedH = 0;
    this.chargeT = 0; this.charging = false; this.plankRot = 0;
    this.emote = -1; this.emoteT = 0; this.throwT = 0;
    this.lastSend = 0; this.sendAcc = 0; this.frozen = false; this.sensitivity = 1;
    this.hud = { prompt: null };
    this.aimHit = null; this.eyeHeight = 1.62;
    this.deadT = 0; this.landV = 0;
    this.inside = null; this.intro = null;
    this.preview = this.makePreview();
    scene.add(this.preview.root);
  }

  init(name, pos) {
    this.name = name;
    this.pos.set(pos.x, pos.y, pos.z); this.yaw = pos.yaw ?? 0; this.zone = pos.zone || 'surface';
    this.human = new Humanoid(lookForName(name));
    this.human.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.human.root);
    this.bindInput();
  }

  makePreview() {
    const root = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 3.2), new THREE.MeshBasicMaterial({ color: 0x7affc0, transparent: true, opacity: 0.4, depthWrite: false }));
    const charge = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 10), new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.55, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(15.4, 16, 64), new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.72, 0.06), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.45, depthWrite: false })); sign.position.y = 1.5;
    root.add(plank, charge, ring, sign); root.visible = false;
    return { root, plank, charge, ring, sign };
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const H = this.hooks;
    addEventListener('keydown', (e) => {
      if (H.uiOpen()) return;
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      if (k >= 'Digit1' && k <= 'Digit4') this.setTool(Number(k.slice(5)) - 1);
      else if (k === 'KeyE') H.interact();
      else if (k === 'KeyG') H.give();
      else if (k === 'KeyV') this.firstPerson = !this.firstPerson;
      else if (k === 'KeyF') this.net.send({ t: 'act', a: 'clip' });
      else if (k === 'KeyQ') this.plankRot -= Math.PI / 12;
      else if (k === 'KeyR') this.plankRot += Math.PI / 12;
      else if (k === 'KeyZ') this.doEmote(0); else if (k === 'KeyX') this.doEmote(1); else if (k === 'KeyC') this.doEmote(2); else if (k === 'KeyB') this.doEmote(3); else if (k === 'KeyN') this.doEmote(4);
      else if (k === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    addEventListener('wheel', (e) => { if (!this.locked) return; this.setTool((this.tool + (e.deltaY > 0 ? 1 : 3)) % 4); }, { passive: true });
    addEventListener('mousedown', (e) => {
      if (!this.locked || H.uiOpen() || this.dead) return;
      if (e.button === 0) this.primaryDown(); else if (e.button === 2) this.secondary();
    });
    addEventListener('mouseup', (e) => { if (e.button === 0 && this.locked) this.primaryUp(); });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTool(i) { this.tool = i; this.hooks.toolChanged?.(i, TOOLS[i]); }
  doEmote(i) { this.emote = i; this.emoteT = 2.8; this.net.send({ t: 'act', a: 'emote', e: i }); }

  aim() {
    // camera ray → world hit → aim from the eye through that point
    const cam = this.camera;
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    const o = cam.position.clone();
    let hit = this.rayWorld(o, d, 70);
    const target = hit || o.clone().addScaledVector(d, 60);
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    const dir = target.clone().sub(eye).normalize();
    this.aimHit = hit;
    return { o: [eye.x, eye.y, eye.z], d: [dir.x, dir.y, dir.z], point: hit };
  }

  rayWorld(o, d, max) {
    const T = this.terrain;
    let prevT = 0;
    for (let t = 1.2; t < max; t += t < 12 ? 0.35 : 1.0) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      let hit = false;
      if (this.zone === 'surface') { if (T.height(x, z) >= y) hit = true; }
      else if (y <= UNDER.y) hit = true;
      if (!hit) for (const b of this.col.near(x, z, 1, this.zone)) { if (y > b.y0 && y < b.y1 && insideBox(b, x, z, 0)) { hit = true; break; } }
      if (hit) {
        // refine
        let lo = prevT, hi = t;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m; const h2 = this.zone === 'surface' ? T.height(mx, mz) >= my : my <= UNDER.y; if (h2) hi = m; else lo = m; }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prevT = t;
    }
    return null;
  }

  primaryDown() {
    if (this.tool === 0) {
      if (this.heldId) { this.charging = true; this.chargeT = 0; }
      else { const a = this.aim(); this.net.send({ t: 'act', a: 'grab', o: a.o, d: a.d }); }
    } else if (this.tool === 1) { const a = this.aim(); this.net.send({ t: 'act', a: 'charge', o: a.o, d: a.d }); this.throwT = 1; }
    else if (this.tool === 2) { const a = this.aim(); this.net.send({ t: 'act', a: 'plank', o: a.o, d: a.d, yaw: this.yaw + this.plankRot }); }
    else if (this.tool === 3) { const a = this.aim(); this.hooks.askSign?.(a); }
  }
  primaryUp() {
    if (this.tool === 0 && this.charging) {
      this.charging = false;
      const a = this.aim();
      const power = clamp(0.25 + this.chargeT / 0.9, 0.25, 1);
      this.net.send({ t: 'act', a: 'throw', o: a.o, d: a.d, power });
      this.throwT = 1;
    }
  }
  secondary() { if (this.heldId) { this.net.send({ t: 'act', a: 'drop' }); this.charging = false; } }

  // ------------------------------------------------------------------ movement
  gravityScale(serverNow) {
    const p = this.world.physics;
    return p && p.until > serverNow ? p.g : 1;
  }

  update(dt, serverNow, env) {
    dt = Math.min(dt, 0.05);
    const T = this.terrain, col = this.col;
    // look
    if (this.locked && !this.frozen) {
      const s = 0.0022 * this.sensitivity;
      this.yaw -= this.mdx * s; this.pitch = clamp(this.pitch - this.mdy * s, -1.45, 1.35);
    }
    this.mdx = this.mdy = 0;
    if (this.dead) { this.deadT += dt; }
    const k = this.keys;
    const canMove = !this.dead && !this.frozen && this.locked;
    let fw = 0, rt = 0;
    if (canMove) { fw = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0); rt = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0); }
    const sprint = canMove && (k.has('ShiftLeft') || k.has('ShiftRight')) && fw > 0;
    const gs = this.gravityScale(serverNow);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let wx = fx * fw + -fz * rt, wz = fz * fw + fx * rt;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }

    // water state
    const inLake = this.zone === 'surface' && lakeD(this.pos.x, this.pos.z) < 1.06;
    const level = this.world.lake?.level ?? 0;
    const bed = this.zone === 'surface' ? T.height(this.pos.x, this.pos.z) : -1e9;
    const depth = inLake ? level - bed : 0;
    this.swim = depth > 1.25;
    const wading = depth > 0.45 && !this.swim;
    let speed = this.swim ? SWIM : sprint ? RUN : WALK;
    if (wading) speed *= 0.72;
    if (this.throwT > 0) this.throwT = Math.max(0, this.throwT - dt * 3);
    if (this.charging) { this.chargeT += dt; speed *= 0.85; }
    const accel = this.onGround || this.swim ? 14 : 3.2;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, dt * accel);

    // horizontal move with step-limited axes
    const p = this.pos;
    const feet = p.y;
    const tryMove = (dx, dz) => {
      const np = { x: p.x + dx, z: p.z + dz };
      resolveXZ(col, np, PLAYER_R, feet, feet + PLAYER_H, this.zone);
      const g = groundAt(col, T, np.x, np.z, feet, this.zone);
      if (this.zone === 'surface' && this.onGround && g - feet > STEP + 0.05 && !this.swim) return false; // too steep to climb
      if (this.zone === 'surface' && T.height(np.x, np.z) < VOID_DEPTH * 0.5 && feet > -8) { /* allow — the Null is deadly, but not forbidden */ }
      p.x = np.x; p.z = np.z; return true;
    };
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (!tryMove(dx, dz)) { if (!tryMove(dx, 0)) this.vel.x = 0; if (!tryMove(0, dz)) this.vel.z = 0; }
    // world boundary
    if (this.zone === 'surface') { const r = Math.hypot(p.x, p.z); if (r > 292) { p.x *= 292 / r; p.z *= 292 / r; } }
    else { const r = Math.hypot(p.x, p.z); if (r > UNDER.r - 1.2) { p.x *= (UNDER.r - 1.2) / r; p.z *= (UNDER.r - 1.2) / r; } }

    // vertical
    let ground = groundAt(col, T, p.x, p.z, p.y, this.zone);
    const propTop = this.hooks.propGround?.(p.x, p.z, p.y);
    if (propTop != null && propTop > ground && propTop <= p.y + STEP + 0.05) ground = propTop;
    if (this.swim) {
      const target = level - 0.85;
      this.vy += ((target - p.y) * 6 - this.vy) * Math.min(1, dt * 5);
      if (canMove && k.has('Space')) this.vy = Math.max(this.vy, 2.2);
      p.y += this.vy * dt;
      this.onGround = false;
      if (p.y < ground) { p.y = ground; this.vy = 0; }
    } else {
      if (canMove && k.has('Space') && this.onGround) { this.vy = JUMP; this.onGround = false; }
      this.vy -= GRAV * gs * dt;
      p.y += this.vy * dt;
      if (p.y <= ground + 0.001 && this.vy <= 0) {
        if (!this.onGround && this.vy < -13 && this.zone !== 'x') this.net.send({ t: 'act', a: 'landed', v: -this.vy });
        if (!this.onGround && this.vy < -4) this.hooks.landed?.(-this.vy);
        p.y = ground; this.vy = 0; this.onGround = true;
      } else if (this.onGround && p.y - ground < 0.3 && this.vy <= 0.01) { p.y = ground; }
      else this.onGround = false;
      if (this.onGround && p.y - ground > 0.05) this.onGround = false;
    }
    this.speedH = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * this.speedH * 1.7;

    // emote timing
    if (this.emoteT > 0) { this.emoteT -= dt; if (this.emoteT <= 0) this.emote = -1; }
    if (canMove && (fw || rt)) { if (this.emote >= 0 && this.emote !== 4 && this.emote !== 3) this.emote = -1; }

    // avatar
    const h = this.human;
    h.root.position.set(p.x, p.y, p.z);
    let want = this.yaw;
    if (this.speedH > 0.4 || this.charging || this.throwT > 0) this.faceYaw = this.faceYaw === undefined ? want : this.faceYaw + Math.atan2(Math.sin(want - this.faceYaw), Math.cos(want - this.faceYaw)) * Math.min(1, dt * 12);
    else this.faceYaw = this.faceYaw === undefined ? want : this.faceYaw + Math.atan2(Math.sin(want - this.faceYaw), Math.cos(want - this.faceYaw)) * Math.min(1, dt * 3.5);
    h.root.rotation.y = this.faceYaw;
    h.update(dt, { speed: this.speedH, act: 0, mood: this.dead ? 0 : (this.hooks.mood?.() || 0), gaze: { yaw: 0, pitch: this.pitch * 0.7 }, swim: this.swim, air: !this.onGround && !this.swim && this.vy !== 0, carry: !!this.heldId && !this.charging, emote: this.emote, dead: this.dead, throwT: this.throwT });
    h.root.visible = !(this.firstPerson && !this.dead);

    // camera
    this.updateCamera(dt, env);
    this.updatePreview();
    this.updateNet(dt, sprint);
  }

  updateCamera(dt, env) {
    const cam = this.camera, p = this.pos;
    const head = new THREE.Vector3(p.x, p.y + (this.swim ? 1.15 : this.eyeHeight) - (this.human?.crouch || 0) * 0.5, p.z);
    if (this.dead) {
      const a = this.yaw + this.deadT * 0.25;
      cam.position.set(p.x + Math.sin(a) * 3.2, p.y + 1.6 + Math.min(1.5, this.deadT * 0.4), p.z + Math.cos(a) * 3.2);
      cam.lookAt(p.x, p.y + 0.3, p.z);
      return;
    }
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shake = this.shake > 0.001 ? this.shake : 0;
    const bobY = this.firstPerson ? Math.sin(this.bob * 2) * 0.03 * Math.min(1, this.speedH / 4) : 0;
    let dist = this.firstPerson ? 0 : this.camDist;
    if (this.inside && !this.firstPerson) dist = Math.min(dist, 2.2);
    if (dist > 0) {
      // camera boom with collision
      const off = right.clone().multiplyScalar(0.55 * Math.min(1, dist / 2)).add(new THREE.Vector3(0, 0.25, 0));
      const want = head.clone().addScaledVector(fwd, -dist).add(off);
      let best = dist;
      const step = 0.2, n = Math.ceil(dist / step);
      for (let i = 1; i <= n; i++) {
        const t = (i / n);
        const q = head.clone().lerp(want, t);
        let blocked = false;
        if (this.zone === 'surface' && this.terrain.height(q.x, q.z) + 0.25 > q.y) blocked = true;
        else if (this.zone === 'under' && q.y < UNDER.y + 0.25) blocked = true;
        if (!blocked) for (const b of this.col.near(q.x, q.z, 1, this.zone)) { if (b.kind === 'wall' && q.y > b.y0 && q.y < b.y1 && insideBox(b, q.x, q.z, 0.18)) { blocked = true; break; } }
        if (blocked) { best = Math.max(0.5, dist * ((i - 1.5) / n)); break; }
      }
      this.camDistCur += (best - this.camDistCur) * Math.min(1, dt * (best < this.camDistCur ? 30 : 6));
      const k2 = this.camDistCur / dist;
      cam.position.copy(head).addScaledVector(fwd, -this.camDistCur).addScaledVector(off, k2);
    } else cam.position.set(head.x, head.y + bobY, head.z);
    if (shake) { cam.position.x += (Math.random() - 0.5) * shake * 0.5; cam.position.y += (Math.random() - 0.5) * shake * 0.5; cam.position.z += (Math.random() - 0.5) * shake * 0.5; this.shake = Math.max(0, this.shake - dt * 1.6); }
    const target = cam.position.clone().add(fwd);
    cam.lookAt(target);
    if (shake) cam.rotateZ((Math.random() - 0.5) * shake * 0.02);
    const wantFov = 66 + (this.speedH > 6.3 ? 6 : 0) + (this.charging ? -4 : 0);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  updatePreview() {
    const pv = this.preview;
    pv.root.visible = false;
    if (this.dead || !this.locked) return;
    if (this.tool === 0) return;
    // recompute the aim only occasionally to spare the ray march
    this._pc = (this._pc || 0) + 1;
    if (this._pc % 2 === 0 || !this.aimHit) { const cam = this.camera; const d = new THREE.Vector3(); cam.getWorldDirection(d); this.aimHit = this.rayWorld(cam.position.clone(), d, 40); }
    const h = this.aimHit;
    if (!h) return;
    pv.plank.visible = pv.charge.visible = pv.ring.visible = pv.sign.visible = false;
    pv.root.position.copy(h);
    pv.root.rotation.y = 0;
    const dist = Math.hypot(h.x - this.pos.x, h.z - this.pos.z);
    if (this.tool === 1) { pv.charge.visible = true; pv.charge.position.set(0, 0.17, 0); pv.ring.visible = true; pv.ring.position.set(this.pos.x - h.x, this.pos.y - h.y + 0.1, this.pos.z - h.z); pv.charge.material.opacity = dist < 12 ? 0.6 : 0.15; }
    else if (this.tool === 2) { pv.plank.visible = true; pv.plank.position.y = Math.max(h.y, WATER_LEVEL + (this.world.lake?.level || 0) + 0.02) - h.y + 0.1; pv.plank.rotation.y = this.yaw + this.plankRot; pv.plank.material.color.set(dist < 13 ? 0x7affc0 : 0xff6a6a); }
    else if (this.tool === 3) { pv.sign.visible = true; pv.sign.rotation.y = this.yaw + Math.PI; pv.sign.position.y = 1.5; }
    pv.root.visible = true;
  }

  updateNet(dt, sprint) {
    this.sendAcc += dt;
    if (this.sendAcc < 0.05) return;
    this.sendAcc = 0;
    const an = this.swim ? 3 : !this.onGround ? 4 : this.speedH > 6.2 ? 2 : this.speedH > 0.6 ? 1 : 0;
    this.net.send({ t: 'st', x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), an, em: this.emote >= 0 ? this.emote : 0, tool: this.tool });
  }

  teleport(x, y, z, zone, yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.vy = 0;
    if (zone) this.zone = zone;
    if (yaw != null) { this.yaw = yaw; }
    this.onGround = true;
  }
}
export { TOOLS };
