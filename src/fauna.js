import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Fish of the Mediterranean and the Canaries, low poly with painted vertex colours.
 * - schools: bait balls that drift as one (sardines, salemas, damselfish, barracudas)
 * - wanderers: fish that roam the screen on their own, each picking places to swim to,
 *   turning smoothly and speeding up or idling (seabreams, wrasses, parrotfish, groupers...)
 * - bottom dwellers: red mullets nosing along the sand and a stingray gliding over it
 */
export function createFauna({ scene, rand, rr, floorY, smooth, lowPower, small }){
  const C = h => new THREE.Color(h);
  const tmpC = new THREE.Color(), dummy = new THREE.Object3D(), v = new THREE.Vector3();
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

  /* ---------- geometry: body along +x (head) to −x (tail), then turned to swim along +z ---------- */
  function painted(geo, paint, part){
    const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3){
      // one colour per face keeps the low-poly look crisp
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      paint(x, y, z, part, tmpC);
      for (let k = 0; k < 3; k++) col.set([tmpC.r, tmpC.g, tmpC.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function fishGeometry({ h = .36, w = .15, tail = 'fork', dorsal = [-.45, .2, .3], snout = 0, paint }){
    const parts = [];
    const body = new THREE.SphereGeometry(1, 12, 8); body.scale(1, h, w);
    if (snout){ const p = body.attributes.position; for (let i = 0; i < p.count; i++){ const x = p.getX(i); if (x > .4) p.setX(i, x + (x - .4) * snout); } }
    parts.push(painted(body, (x, y, z, _, out) => paint(x, y / h, z, 'body', out)));
    const th = h * 1.25, sh = new THREE.Shape();
    if (tail === 'fork'){ sh.moveTo(-.82, 0); sh.lineTo(-1.5, th); sh.lineTo(-1.32, 0); sh.lineTo(-1.5, -th); sh.lineTo(-.82, 0); }
    else { sh.moveTo(-.85, 0); sh.lineTo(-1.35, th * .8); sh.quadraticCurveTo(-1.55, 0, -1.35, -th * .8); sh.lineTo(-.85, 0); }
    parts.push(painted(new THREE.ShapeGeometry(sh), (x, y, z, _, out) => paint(x, y / h, z, 'fin', out)));
    if (dorsal){
      const [x0, x1, dh] = dorsal, ds = new THREE.Shape();
      ds.moveTo(x0, h * .82); ds.lineTo(x1, h * .9); ds.lineTo((x0 + x1) / 2 - .05, h + dh); ds.lineTo(x0, h * .82);
      parts.push(painted(new THREE.ShapeGeometry(ds), (x, y, z, _, out) => paint(x, y / h, z, 'fin', out)));
    }
    for (const s of [-1, 1]){
      const e = new THREE.IcosahedronGeometry(.075, 0); e.scale(1, 1, .5); e.translate(.62 + snout * .25, h * .22, s * w * .78);
      parts.push(painted(e, (x, y, z, _, out) => out.set(.02, .02, .03)));
    }
    const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); p.deleteAttribute('normal'); return p; }));
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }
  const grad = (top, bottom, yn, out) => out.copy(bottom).lerp(top, smooth(-.5, .6, yn));

  const silver = C('#cfdbe0'), silverTop = C('#5f7d8f'), white = C('#f2f2ee');
  const P = {
    sardine: (x, y, z, part, o) => part === 'fin' ? o.set(.55, .62, .66) : grad(silverTop, silver, y, o),
    salema: (x, y, z, part, o) => { if (part === 'fin') return o.set(.6, .6, .55); grad(C('#7d8a86'), silver, y, o); if (Math.abs(Math.sin(y * 7.5)) > .78) o.lerp(C('#e2b640'), .8); return o; },
    damsel: (x, y, z, part, o) => part === 'fin' ? o.set(.55, .55, .58) : grad(C('#9aa0a6'), white, y, o),
    barracuda: (x, y, z, part, o) => { if (part === 'fin') return o.set(.45, .5, .55); grad(C('#4d5f6c'), silver, y, o); if (y > .1 && Math.sin(x * 14) > .4) o.lerp(C('#33414b'), .5); return o; },
    sargo: (x, y, z, part, o) => {
      if (part === 'fin') return x < -1.2 ? o.set(.12, .12, .13) : o.set(.5, .53, .55);
      grad(C('#8b979d'), C('#dfe5e6'), y, o);
      if ((x > .22 && x < .42) || (x < -.62)) o.lerp(C('#141617'), .9);
      return o;
    },
    doncella: (x, y, z, part, o) => {
      if (part === 'fin') return o.set(.85, .45, .25);
      grad(C('#2f8a5e'), C('#d6cf72'), y, o);
      if (x > .14 && x < .3) o.copy(C('#2b5fd0'));
      else if (x > .45 && Math.abs(Math.sin(y * 6 + x * 4)) > .8) o.lerp(C('#e2643a'), .8);
      return o;
    },
    loro: (x, y, z, part, o) => {
      if (part === 'fin') return o.set(.55, .16, .17);
      grad(C('#6f6461'), C('#d1453f'), y, o);
      if (Math.hypot(x - .35, y - .55) < .25) o.copy(C('#e8c43c'));
      return o;
    },
    mero: (x, y, z, part, o) => {
      if (part === 'fin') return o.set(.24, .17, .11);
      grad(C('#4f3b28'), C('#a88a64'), y, o);
      if (hash(Math.floor(x * 6), Math.floor(y * 4 + z * 3)) > .7) o.lerp(C('#d6c4a0'), .45);
      return o;
    },
    mullet: (x, y, z, part, o) => {
      if (part === 'fin') return o.set(.9, .62, .55);
      grad(C('#cf5a46'), C('#f5e6da'), y, o);
      if (Math.abs(y - .02) < .14) o.lerp(C('#efc64a'), .8);
      return o;
    },
    trumpet: (x, y, z, part, o) => {
      if (part === 'fin') return o.set(.6, .45, .2);
      o.copy(C('#b48238'));
      if (Math.sin(x * 22) > .6) o.lerp(C('#e6d29a'), .6);
      return o;
    },
  };

  const geos = {
    sardine: fishGeometry({ h: .3, w: .12, dorsal: [-.3, .1, .18], paint: P.sardine }),
    salema: fishGeometry({ h: .38, w: .14, paint: P.salema }),
    damsel: fishGeometry({ h: .5, w: .16, dorsal: [-.6, .3, .2], paint: P.damsel }),
    barracuda: fishGeometry({ h: .17, w: .12, dorsal: [-.5, -.25, .2], snout: .5, paint: P.barracuda }),
    sargo: fishGeometry({ h: .55, w: .16, dorsal: [-.65, .3, .26], paint: P.sargo }),
    doncella: fishGeometry({ h: .26, w: .12, tail: 'round', dorsal: [-.75, .45, .1], paint: P.doncella }),
    loro: fishGeometry({ h: .42, w: .2, tail: 'round', dorsal: [-.7, .35, .12], paint: P.loro }),
    mero: fishGeometry({ h: .45, w: .28, tail: 'round', dorsal: [-.7, .35, .2], paint: P.mero }),
    mullet: fishGeometry({ h: .27, w: .16, dorsal: [-.2, .2, .28], paint: P.mullet }),
    trumpet: fishGeometry({ h: .08, w: .08, tail: 'round', dorsal: [-.85, -.7, .1], snout: 1.4, paint: P.trumpet }),
  };
  const fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .45, metalness: .2, side: THREE.DoubleSide });

  /* ---------- schools: a loose ball of fish drifting on a slow loop ---------- */
  const schools = [];
  function makeSchool(o){
    const mesh = new THREE.InstancedMesh(o.geo, fishMat, o.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    const fish = [];
    for (let i = 0; i < o.count; i++){
      const u = rand() * Math.PI * 2, w = Math.acos(2 * rand() - 1), r = Math.cbrt(rand());
      fish.push({ ox: Math.sin(w) * Math.cos(u) * r * o.rx, oy: Math.cos(w) * r * o.ry, oz: Math.sin(w) * Math.sin(u) * r * o.rz, ph: rand() * 6.28, sc: o.size * rr(.8, 1.2) });
      mesh.setColorAt(i, tmpC.set(o.colors ? o.colors(i) : '#ffffff'));
    }
    scene.add(mesh);
    schools.push({ ...o, mesh, fish });
  }
  const sc = lowPower ? .55 : 1;
  makeSchool({ geo: geos.sardine, count: Math.round(130 * sc), size: .085, y: -5.5, x: -1, z: -7, ax: 5, ay: 1.4, az: 3, rx: 2.8, ry: 1, rz: 2, w: .16, ph: 0 });
  makeSchool({ geo: geos.salema, count: Math.round(50 * sc), size: .12, y: -12.5, x: 1.5, z: -9, ax: 4.5, ay: 1.2, az: 2.5, rx: 2.4, ry: .9, rz: 1.8, w: .12, ph: 2 });
  // damselfish over the reef: chocolate adults and a few electric-blue juveniles
  makeSchool({ geo: geos.damsel, count: Math.round(40 * sc), size: .07, y: -8.5, x: 3.5, z: -4, ax: 1.6, ay: .6, az: 1.2, rx: 1.8, ry: .9, rz: 1.4, w: .2, ph: 1,
    colors: i => (i % 6 === 0 ? '#3a7dff' : '#5b4636') });
  // anthias: the pink-orange shoals that hover over deep Mediterranean reefs, and more damselfish
  makeSchool({ geo: geos.damsel, count: Math.round(45 * sc), size: .06, y: -31, x: 2.5, z: -6, ax: 1.4, ay: .5, az: 1, rx: 2, ry: 1, rz: 1.5, w: .18, ph: 3,
    colors: i => (i % 5 === 0 ? '#ffb347' : '#ff6f86') });
  makeSchool({ geo: geos.damsel, count: Math.round(32 * sc), size: .07, y: -24, x: -3, z: -5, ax: 1.5, ay: .6, az: 1.2, rx: 1.6, ry: .8, rz: 1.3, w: .2, ph: 5,
    colors: i => (i % 7 === 0 ? '#3a7dff' : '#4f3d30') });
  makeSchool({ geo: geos.barracuda, count: Math.round(28 * sc), size: .2, y: -20.5, x: -1.5, z: -10, ax: 4.5, ay: 1, az: 3, rx: 3.2, ry: .7, rz: 1.4, w: .08, ph: 4 });
  const hv = new THREE.Vector3();
  function updateSchool(s, t){
    const tt = t * s.w + s.ph;
    const cx = s.x + Math.sin(tt) * s.ax, cy = s.y + Math.sin(tt * .7) * s.ay, cz = s.z + Math.sin(tt * 2) * s.az * .5;
    const t2 = tt + .02;
    hv.set(s.x + Math.sin(t2) * s.ax - cx, s.y + Math.sin(t2 * .7) * s.ay - cy, s.z + Math.sin(t2 * 2) * s.az * .5 - cz).normalize();
    for (let i = 0; i < s.fish.length; i++){
      const f = s.fish[i], wob = t * .9 + f.ph;
      dummy.position.set(cx + f.ox + Math.sin(wob) * .25, cy + f.oy + Math.sin(wob * 1.4) * .12, cz + f.oz + Math.cos(wob) * .25);
      dummy.lookAt(dummy.position.x + hv.x + Math.cos(wob) * .12, dummy.position.y + hv.y * .5, dummy.position.z + hv.z - Math.sin(wob) * .12);
      dummy.rotateY(Math.sin(t * 9 + f.ph) * .14);
      dummy.scale.setScalar(f.sc);
      dummy.updateMatrix();
      s.mesh.setMatrixAt(i, dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------- wanderers ---------- */
  // the open part of the frame at each depth (the text panel covers the left on a desktop)
  const X = small ? [-2.6, 2.6] : [-6.5, 5.5], Z = small ? [-7, -.5] : [-10, -1.5];
  const species = [];
  function makeSpecies(o){
    const mesh = new THREE.InstancedMesh(o.geo, fishMat, o.count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    const sp = { ...o, mesh, fish: [], group: new THREE.Vector3() };
    pick(sp, sp.group);
    for (let i = 0; i < o.count; i++){
      const f = { p: new THREE.Vector3(), dir: new THREE.Vector3(rr(-1, 1), 0, rr(-1, 1)).normalize(), target: new THREE.Vector3(), off: new THREE.Vector3(),
        speed: 0, want: o.speed, wag: rand() * 6, size: rr(o.size[0], o.size[1]), pause: 0, timer: rr(1, 6), bank: 0 };
      pick(sp, f.p); if (o.shoal) f.p.copy(sp.group).add(f.off.set(rr(-1, 1), rr(-.3, .3), rr(-1, 1)).multiplyScalar(o.shoal));
      retarget(sp, f);
      sp.fish.push(f);
    }
    scene.add(mesh);
    species.push(sp);
  }
  function pick(sp, out){
    out.set(rr(X[0], X[1]), 0, rr(Z[0], Z[1]));
    out.y = sp.bottom ? floorY(out.x, out.z) + rr(sp.bottom[0], sp.bottom[1]) : rr(sp.y[0], sp.y[1]);
    return out;
  }
  function retarget(sp, f){
    if (sp.shoal){ f.off.set(rr(-1, 1), rr(-.35, .35), rr(-1, 1)).multiplyScalar(sp.shoal); f.target.copy(sp.group).add(f.off); }
    else pick(sp, f.target);
    if (sp.bottom) f.target.y = floorY(f.target.x, f.target.z) + rr(sp.bottom[0], sp.bottom[1]);
  }
  makeSpecies({ geo: geos.sargo, count: lowPower ? 6 : 9, size: [.17, .24], y: [-6, -25], speed: .55, turn: 1.6, shoal: 1.6 });
  makeSpecies({ geo: geos.doncella, count: 5, size: [.13, .17], y: [-4, -24], speed: .8, turn: 2.6 });
  makeSpecies({ geo: geos.loro, count: 3, size: [.2, .26], y: [-9, -30], speed: .45, turn: 1.4 });
  makeSpecies({ geo: geos.trumpet, count: 2, size: [.42, .52], y: [-8, -21], speed: .22, turn: .7 });
  makeSpecies({ geo: geos.mero, count: 3, size: [.36, .46], y: [-24, -39], speed: .3, turn: .8 });
  makeSpecies({ geo: geos.mullet, count: lowPower ? 4 : 6, size: [.15, .19], bottom: [.12, .3], speed: .38, turn: 1.8, pauses: true, shoal: 1.4 });

  const desired = new THREE.Vector3(), prevDir = new THREE.Vector3();
  function updateSpecies(sp, t, dt){
    // a shoal follows a shared point that moves on when most of the fish have caught up
    if (sp.shoal){
      let near = 0; for (const f of sp.fish) if (f.p.distanceTo(f.target) < 1) near++;
      if (near > sp.fish.length * .6){ pick(sp, sp.group); sp.fish.forEach(f => retarget(sp, f)); }
    }
    for (let i = 0; i < sp.fish.length; i++){
      const f = sp.fish[i];
      f.timer -= dt;
      if (sp.pauses && f.timer < 0){ f.pause = f.pause > 0 ? 0 : rr(1, 3); f.timer = f.pause || rr(3, 7); }
      if (!sp.shoal && f.p.distanceTo(f.target) < .5) retarget(sp, f);
      // now and then a little burst, otherwise a lazy cruise
      if (f.timer < 0 && !sp.pauses){ f.want = sp.speed * (rand() < .2 ? 2 : rr(.6, 1.15)); f.timer = rr(2, 6); }
      const want = f.pause > 0 ? .02 : f.want || sp.speed;
      f.speed += (want - f.speed) * Math.min(1, dt * 1.5);
      desired.copy(f.target).sub(f.p); desired.y *= sp.bottom ? 0 : 1.6; desired.normalize();
      prevDir.copy(f.dir);
      f.dir.lerp(desired, Math.min(1, dt * sp.turn * (.4 + f.speed / sp.speed * .6))); f.dir.y = Math.max(-.35, Math.min(.35, f.dir.y)); f.dir.normalize();
      f.p.addScaledVector(f.dir, f.speed * dt);
      if (sp.bottom) f.p.y += (floorY(f.p.x, f.p.z) + (sp.bottom[0] + sp.bottom[1]) / 2 - f.p.y) * Math.min(1, dt * 2);
      // lean into turns
      const turn = (prevDir.x * f.dir.z - prevDir.z * f.dir.x) / Math.max(dt, 1e-3);
      f.bank += (Math.max(-.6, Math.min(.6, -turn * .6)) - f.bank) * Math.min(1, dt * 3);
      f.wag += dt * (5 + f.speed * 14);
      dummy.position.copy(f.p);
      dummy.lookAt(v.copy(f.p).add(f.dir));
      dummy.rotateZ(f.bank);
      dummy.rotateY(Math.sin(f.wag) * (.1 + f.speed * .12));
      dummy.scale.setScalar(f.size);
      dummy.updateMatrix();
      sp.mesh.setMatrixAt(i, dummy.matrix);
    }
    sp.mesh.instanceMatrix.needsUpdate = true;
  }
  const yRange = sp => sp.bottom ? [-46, -30] : [Math.min(...sp.y), Math.max(...sp.y)];

  /* ---------- stingray gliding over the sand ---------- */
  const ray = (() => {
    const RINGS = 5, SEG = 22, verts = [], cols = [], idx = [];
    const top = C('#6f6352'), edge = C('#9a8b72'), spot = C('#3f372d');
    const radius = th => { const c = Math.cos(th), s = Math.sin(th); const k = 1 / Math.pow(Math.pow(Math.abs(c), 1.7) + Math.pow(Math.abs(s), 1.7), 1 / 1.7); return k * (s > 0 ? .78 : .62); };
    verts.push(0, .14, 0); cols.push(top.r, top.g, top.b);
    for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEG; s++){
      const th = s / SEG * Math.PI * 2, f = r / RINGS, R = radius(th) * f;
      verts.push(Math.cos(th) * R * 1.25, .14 * (1 - f * f), Math.sin(th) * R);
      tmpC.copy(top).lerp(edge, f * f); if (hash(r, s) > .82 && f < .9) tmpC.lerp(spot, .6);
      cols.push(tmpC.r, tmpC.g, tmpC.b);
    }
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + (s + 1) % SEG, 1 + s);
    for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEG; s++){
      const a = 1 + (r - 1) * SEG + s, b = 1 + (r - 1) * SEG + (s + 1) % SEG, c = a + SEG, d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); geo.setIndex(idx);
    const base = geo.attributes.position.array.slice();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8, side: THREE.DoubleSide });
    const group = new THREE.Group(), body = new THREE.Mesh(geo, mat); body.frustumCulled = false; group.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(.012, .004, 1.2, 5), new THREE.MeshStandardMaterial({ color: '#4c4336', roughness: .8 }));
    tail.rotation.x = Math.PI / 2; tail.position.set(0, .05, -1.15); group.add(tail);
    group.scale.setScalar(.75);
    scene.add(group);
    const sp = { bottom: [.18, .3], y: [-44, -38] };
    const st = { p: pick(sp, new THREE.Vector3()), dir: new THREE.Vector3(1, 0, 0), target: pick(sp, new THREE.Vector3()), speed: .35 };
    function update(t, dt){
      if (st.p.distanceTo(st.target) < .8) pick(sp, st.target);
      desired.copy(st.target).sub(st.p); desired.y = 0; desired.normalize();
      st.dir.lerp(desired, Math.min(1, dt * .5)).normalize();
      st.p.addScaledVector(st.dir, st.speed * dt);
      st.p.y = floorY(st.p.x, st.p.z) + .22 + Math.sin(t * .7) * .04;
      group.position.copy(st.p);
      group.lookAt(v.copy(st.p).add(st.dir));
      // the wing edges ripple from nose to tail
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3){
        const x = base[i], z = base[i + 2], side = Math.abs(x) / 1;
        p[i + 1] = base[i + 1] + Math.pow(side, 1.6) * .16 * Math.sin(t * 2.6 - z * 3.2);
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      tail.rotation.z = Math.sin(t * 1.3) * .15;
    }
    return { group, update };
  })();

  return {
    update(t, dt, camY){
      for (const s of schools){ const near = Math.abs(s.y - camY) < 22; s.mesh.visible = near; if (near) updateSchool(s, t); }
      for (const sp of species){
        const [lo, hi] = yRange(sp), near = camY > lo - 14 && camY < hi + 14;
        sp.mesh.visible = near; if (near) updateSpecies(sp, t, dt);
      }
      const rayNear = camY < -26; ray.group.visible = rayNear; if (rayNear) ray.update(t, dt);
    },
  };
}
