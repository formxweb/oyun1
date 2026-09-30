// THE UNDERSTORY — the city beneath Hollowmere. Everything players destroy is reborn here; everyone who dies stands in its Hall.
import * as THREE from 'three';
import { UNDER } from '/shared/layout.js';
import { mulberry32 } from '/shared/util.js';
import { textTexture } from './tex.js';

export class Understory {
  constructor(group, tex, world) {
    this.group = group; this.tex = tex; this.world = world;
    const rnd = mulberry32(777);
    const Y = UNDER.y;
    const R = UNDER.r;
    // ---- floor
    const ft = tex.rock.clone(); ft.repeat.set(24, 24); ft.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 8, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ft, color: 0x8a8f90, roughness: 0.92 }));
    floor.position.y = Y; floor.receiveShadow = true; group.add(floor);
    // paved radial streets + plaza ring
    const paveT = tex.stone.clone(); paveT.repeat.set(3, 20); paveT.needsUpdate = true;
    const pave = new THREE.MeshStandardMaterial({ map: paveT, roughness: 0.9, color: 0xb0b4b8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.25;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5, R - 10).rotateX(-Math.PI / 2), pave);
      m.position.set(Math.cos(a) * (R / 2 + 4), Y + 0.03, Math.sin(a) * (R / 2 + 4)); m.rotation.y = -a + Math.PI / 2; group.add(m);
    }
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(14, 40).rotateX(-Math.PI / 2), pave); plaza.position.y = Y + 0.04; group.add(plaza);
    // ---- cavern wall + ceiling
    const wt = tex.rock.clone(); wt.repeat.set(14, 5); wt.needsUpdate = true;
    const wallGeo = new THREE.CylinderGeometry(R + 10, R + 6, UNDER.ceiling + 26, 72, 12, true);
    const wp = wallGeo.attributes.position;
    for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), y = wp.getY(i), z = wp.getZ(i); const k = 1 + Math.sin(Math.atan2(z, x) * 7 + y * 0.3) * 0.05 + Math.sin(Math.atan2(z, x) * 19 + y * 0.9) * 0.02; wp.setXYZ(i, x * k, y, z * k); }
    wallGeo.computeVertexNormals();
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ map: wt, color: 0x777c80, roughness: 1, side: THREE.BackSide }));
    wall.position.y = Y + (UNDER.ceiling + 26) / 2 - 4; group.add(wall);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R + 10, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: wt, color: 0x5a5f64, roughness: 1, side: THREE.BackSide }));
    dome.scale.y = 0.38; dome.position.y = Y + UNDER.ceiling + 18; group.add(dome);
    // stalactites
    const stal = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7, 1), new THREE.MeshStandardMaterial({ map: tex.rock, color: 0x666b70, roughness: 1 }), 220);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 220; i++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * (R + 4), h = 2 + rnd() * 9;
      const cy = Y + UNDER.ceiling + 8 - (Math.hypot(Math.cos(a) * r, Math.sin(a) * r) / (R + 10)) ** 2 * 12;
      p.set(Math.cos(a) * r, cy - h / 2, Math.sin(a) * r); q.setFromEuler(new THREE.Euler(Math.PI, rnd() * 6, 0)); s.set(0.6 + rnd() * 1.6, h, 0.6 + rnd() * 1.6); m4.compose(p, q, s); stal.setMatrixAt(i, m4);
    }
    group.add(stal);
    // ---- crystals (emissive) and glow motes on the ceiling
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x55ffe6, emissive: 0x18e0c8, emissiveIntensity: 1.8, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.92 });
    const crystalMat2 = new THREE.MeshStandardMaterial({ color: 0xb07aff, emissive: 0x7a3cff, emissiveIntensity: 1.8, roughness: 0.2, transparent: true, opacity: 0.92 });
    this.crystals = [];
    for (let c = 0; c < 26; c++) {
      const a = rnd() * 6.283, r = R - 4 + rnd() * 10;
      const g = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) { const h = 1.5 + rnd() * 4.5; const m = new THREE.Mesh(new THREE.ConeGeometry(0.35 + rnd() * 0.4, h, 5), c % 3 === 0 ? crystalMat2 : crystalMat); m.position.set((rnd() - 0.5) * 2.2, h / 2, (rnd() - 0.5) * 2.2); m.rotation.set((rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.7); g.add(m); }
      g.position.set(Math.cos(a) * r, Y, Math.sin(a) * r); group.add(g);
      if (c % 4 === 0) { const l = new THREE.PointLight(c % 3 === 0 ? 0x9a5aff : 0x30ffe0, 25, 34, 1.6); l.position.set(g.position.x, Y + 3, g.position.z); group.add(l); this.crystals.push(l); }
    }
    const pts = []; for (let i = 0; i < 900; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * (R + 8); pts.push(Math.cos(a) * r, Y + UNDER.ceiling + 10 - (r / (R + 10)) ** 2 * 12 - rnd() * 3, Math.sin(a) * r); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9ffff0, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    group.add(this.motes);
    // ---- plaza fountain (dry), lamps around it
    const stone = new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.9 });
    const fnt = new THREE.Group(); fnt.position.set(0, Y, -6);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.9, 24), stone); bowl.position.y = 0.45; fnt.add(bowl);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x23e0d0, emissive: 0x18c0b8, emissiveIntensity: 1.4, roughness: 0.2 })); basin.position.y = 0.88; fnt.add(basin);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 10), stone); col.position.y = 2; fnt.add(col);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7affee, emissiveIntensity: 2.6 })); orb.position.y = 4.2; fnt.add(orb); this.orb = orb;
    const fl = new THREE.PointLight(0x50ffe6, 90, 60, 1.6); fl.position.y = 4.4; fnt.add(fl); this.fountainLight = fl;
    group.add(fnt);
    // sign over the plaza
    this.signMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, fog: false });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), this.signMat); this.sign.position.set(0, Y + 13, -6); group.add(this.sign);
    this.refreshSign();
    // lamp posts along the streets
    const lampM = new THREE.MeshStandardMaterial({ color: 0xbff8ff, emissive: 0x6affea, emissiveIntensity: 2.4 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 8; i++) for (const rr of [24, 44, 66, 88]) {
      const a = (i / 8) * Math.PI * 2 + 0.25 + 0.12;
      const g = new THREE.Group(); g.position.set(Math.cos(a) * rr, Y, Math.sin(a) * rr);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 6), iron); pole.position.y = 1.8; g.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampM); bulb.position.y = 3.7; g.add(bulb);
      group.add(g);
    }
  }

  refreshSign() {
    const name = this.world.portals?.hatch1?.name;
    const t = textTexture('', { w: 1024, h: 256, lines: [name ? name.toUpperCase() : 'THE UNDERSTORY', name ? 'THE CITY OF THINGS THAT WERE' : 'EVERYTHING YOU BREAK ENDS UP HERE'], font: 'bold 110px "Trebuchet MS", Arial', color: '#a8fff2', bg: null, glow: '#20ffe0' });
    this.signMat.map = t; this.signMat.needsUpdate = true;
  }

  update(dt, time, visible) {
    if (!visible) return;
    this.orb.rotation.y = time * 0.6; this.orb.position.y = 4.2 + Math.sin(time * 1.2) * 0.15;
    this.fountainLight.intensity = 80 + Math.sin(time * 2.1) * 12;
    this.motes.material.opacity = 0.7 + Math.sin(time * 0.7) * 0.2;
    this.sign.lookAt(this.sign.position.x, this.sign.position.y, this.sign.position.z + 100);
  }
}

/** Live Chronicle wall inside the Archive. */
export class ArchiveScreen {
  constructor(buildings) { this.buildings = buildings; this.entries = []; this.mesh = null; }
  attach() {
    const v = this.buildings.views.get('u_archive');
    if (!v || !v.archiveSlot) return;
    if (this.mesh) { this.mesh.parent?.remove(this.mesh); }
    const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 500; this.cv = cv;
    this.tex = new THREE.CanvasTexture(cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const s = v.archiveSlot;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, fog: false }));
    this.mesh.position.set(s.x, s.y + 0.4, s.z); v.root.add(this.mesh);
    this.draw();
  }
  setEntries(list) { this.entries = list; this.draw(); }
  draw() {
    if (!this.cv) return;
    const c = this.cv.getContext('2d');
    c.fillStyle = '#031014'; c.fillRect(0, 0, 1400, 500);
    c.fillStyle = '#20ffe0'; c.font = 'bold 34px "Courier New", monospace'; c.textAlign = 'left';
    c.fillText('THE ARCHIVE · WHAT THE SERVER REMEMBERS', 30, 48);
    c.strokeStyle = '#1a6a66'; c.beginPath(); c.moveTo(30, 62); c.lineTo(1370, 62); c.stroke();
    c.font = '26px "Courier New", monospace';
    this.entries.slice(0, 12).forEach((e, i) => {
      c.fillStyle = e.legend >= 60 ? '#ffe890' : '#8ff5e8';
      const line = `${e.clock}  ${e.title}`.slice(0, 82);
      c.fillText(line, 30, 100 + i * 33);
    });
    this.tex.needsUpdate = true;
  }
}
