import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/*
 * Diver model "Diver" by nolanfa (https://sketchfab.com/nolanfa), CC BY 4.0.
 *
 * The model ships as a single static mesh, so it gets a small skeleton built
 * in code (pelvis, chest, head, torch arm and three joints per leg) and is
 * skinned here. Every pose is computed each frame from the swim state:
 * flutter kick, body pitch, head and arm aim. Nothing is keyframed, which is
 * what keeps transitions continuous whatever the scroll does.
 */

// Model-space landmarks measured on the mesh (head = +y, back = +z, right = +x).
const J = {
  pelvis: [0.01, -0.11, 0.0],
  chest: [0.01, 0.0, 0.0],
  head: [-0.02, 0.09, -0.01],
  shoulder: [0.12, 0.07, 0.0],
  hand: [0.285, -0.04, -0.155],
  mouth: [-0.022, 0.118, -0.125],
  L: { hip: [-0.06, -0.13, -0.01], knee: [-0.055, -0.36, 0.035], ankle: [-0.068, -0.5, 0.135], tip: [-0.075, -0.7, -0.19] },
  R: { hip: [0.08, -0.13, 0.03], knee: [0.118, -0.31, -0.09], ankle: [0.15, -0.46, -0.05], tip: [0.19, -0.69, -0.3] },
};
const V = a => new THREE.Vector3(...a);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Critically damped spring: smooth, no overshoot, frame-rate independent.
export function spring(s, target, omega, dt){
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++){
    s.v += (omega * omega * (target - s.x) - 2 * omega * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

function cleanGeometry(src){
  const geo = src.clone();
  const pos = geo.attributes.position, n = pos.count;
  // connected parts: shared indices or shared positions (uv seams split vertices)
  const parent = new Int32Array(n).map((_, i) => i);
  const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3){ join(idx[i], idx[i + 1]); join(idx[i], idx[i + 2]); }
  const seen = new Map();
  for (let i = 0; i < n; i++){
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (seen.has(k)) join(seen.get(k), i); else seen.set(k, i);
  }
  const parts = new Map(), vtx = new THREE.Vector3();
  for (let i = 0; i < n; i++){
    const r = find(i);
    const p = parts.get(r) || { n: 0, min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) };
    p.n++; p.min.min(vtx.fromBufferAttribute(pos, i)); p.max.max(vtx);
    parts.set(r, p);
  }
  const ranked = [...parts.entries()].sort((a, b) => b[1].n - a[1].n);
  const body = ranked[0][0], shell = ranked[1][0];
  // the exhaled bubbles are baked into the mesh as small spheres above the shoulders; the scene makes its own
  const bubble = r => { const p = parts.get(r); return r !== body && r !== shell && p.min.y > 0.1 && p.max.distanceTo(p.min) < 0.08; };
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) if (!bubble(find(idx[i]))) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  geo.setIndex(keep);
  const part = new Int32Array(n);
  for (let i = 0; i < n; i++){ const r = find(i); part[i] = r === body ? 0 : r === shell ? 1 : 2; }
  return { geo, part };
}

// bone order
const B = { pelvis: 0, chest: 1, head: 2, arm: 3, lHip: 4, lKnee: 5, lAnkle: 6, rHip: 7, rKnee: 8, rAnkle: 9 };

function skinWeights(geo, part){
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++){
    const x = pos.getX(i), y = pos.getY(i);
    const w = {};
    const add = (b, v) => { if (v > 1e-4) w[b] = (w[b] || 0) + v; };
    if (part[i] === 1){ add(B.chest, 1); }
    else if (y > -0.09){
      if (part[i] === 0 && x > 0.115 && y < 0.13 && y > -0.12){ const a = sstep(0.115, 0.15, x); add(B.arm, a); add(B.chest, 1 - a); }
      else if (y > 0.065 && x < 0.07){ const h = sstep(0.065, 0.11, y); add(B.head, h); add(B.chest, 1 - h); }
      else { const c = sstep(-0.075, 0.0, y); add(B.chest, c); add(B.pelvis, 1 - c); }
    } else {
      const side = x < 0.01 ? J.L : J.R;
      const [hip, knee, ankle] = x < 0.01 ? [B.lHip, B.lKnee, B.lAnkle] : [B.rHip, B.rKnee, B.rAnkle];
      const leg = sstep(-0.075, -0.15, y);
      add(B.pelvis, 1 - leg);
      const k = sstep(side.knee[1] + 0.03, side.knee[1] - 0.03, y);
      const a = sstep(side.ankle[1] + 0.025, side.ankle[1] - 0.025, y);
      add(hip, leg * (1 - k));
      add(knee, leg * k * (1 - a));
      add(ankle, leg * k * a);
    }
    const top = Object.entries(w).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([b, v], k) => { si[i * 4 + k] = +b; sw[i * 4 + k] = v / sum; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

function makeSkeleton(){
  const mk = (name, at, parentAt) => { const b = new THREE.Bone(); b.name = name; b.position.copy(V(at).sub(V(parentAt || [0, 0, 0]))); return b; };
  const pelvis = mk('pelvis', J.pelvis);
  const chest = mk('chest', J.chest, J.pelvis); pelvis.add(chest);
  const head = mk('head', J.head, J.chest); chest.add(head);
  const arm = mk('arm', J.shoulder, J.chest); chest.add(arm);
  const leg = s => {
    const hip = mk('hip', s.hip, J.pelvis); pelvis.add(hip);
    const knee = mk('knee', s.knee, s.hip); hip.add(knee);
    const ankle = mk('ankle', s.ankle, s.knee); knee.add(ankle);
    return { hip, knee, ankle,
      d0: [V(s.knee).sub(V(s.hip)).normalize(), V(s.ankle).sub(V(s.knee)).normalize(), V(s.tip).sub(V(s.ankle)).normalize()] };
  };
  const L = leg(J.L), R = leg(J.R);
  const bones = [pelvis, chest, head, arm, L.hip, L.knee, L.ankle, R.hip, R.knee, R.ankle];
  return { bones, pelvis, chest, head, arm, L, R, armD0: V(J.hand).sub(V(J.shoulder)).normalize() };
}

export async function loadDiver(url, { decorate } = {}){
  const gltf = await new GLTFLoader().loadAsync(url);
  let src; gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  gltf.scene.updateMatrixWorld(true);
  const baked = src.geometry.clone(); baked.applyMatrix4(src.matrixWorld);
  const { geo, part } = cleanGeometry(baked);
  skinWeights(geo, part);

  // The file only carries its texture as emissive, which would make the diver glow in the dark.
  // Re-light it with a regular material so the water, the moon and the torch all reach it.
  const tex = src.material.emissiveMap || src.material.map;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, metalness: 0.06, side: THREE.DoubleSide });
  if (decorate) decorate(material);

  const sk = makeSkeleton();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(sk.pelvis);
  mesh.bind(new THREE.Skeleton(sk.bones));
  mesh.frustumCulled = false;

  // anchors for the scene: torch hand and regulator
  const hand = new THREE.Object3D(); hand.position.copy(V(J.hand).sub(V(J.shoulder))); sk.arm.add(hand);
  const mouth = new THREE.Object3D(); mouth.position.copy(V(J.mouth).sub(V(J.head))); sk.head.add(mouth);

  return { mesh, skeleton: sk, hand, mouth };
}

/*
 * Pose solver. `s` is the smoothed swim state:
 *   phase  - kick phase in radians (accumulated, never jumps)
 *   amp    - kick amplitude 0..1
 *   effort - 0 hovering .. 1 swimming hard
 *   pitch  - body pitch in radians (negative = head down)
 *   aim    - unit vector, torch direction in model space
 */
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion(), qP = new THREE.Quaternion(), qInv = new THREE.Quaternion();
const vT = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const restThigh = new THREE.Vector3(0, -1, 0.06).normalize();
const restShin = new THREE.Vector3(0, -1, 0.34).normalize();
const restFin = new THREE.Vector3(0, -1, 0.5).normalize();
const qRot = new THREE.Quaternion();
function dirRot(out, d0, base, angle){
  vT.copy(base).applyQuaternion(qRot.setFromAxisAngle(X, angle));
  return out.setFromUnitVectors(d0, vT);
}

export function poseDiver(sk, s){
  const { phase, amp, effort } = s;
  // hips roll a little against each kick, the chest counters it
  qP.setFromAxisAngle(Y, Math.sin(phase) * 0.07 * amp);
  sk.pelvis.quaternion.copy(qP);
  qA.setFromAxisAngle(Y, -Math.sin(phase) * 0.05 * amp).multiply(qB.setFromAxisAngle(X, Math.sin(phase * 2 + 0.6) * 0.025 * amp));
  sk.chest.quaternion.copy(qA);
  const chestModel = qC.copy(qP).multiply(qA);

  // flutter kick: hip drives, knee and fin follow with growing lag; legs in opposite phase
  const A = 0.08 + 0.3 * amp;
  [[sk.L, 0], [sk.R, Math.PI]].forEach(([leg, off]) => {
    const p = phase + off;
    const aHip = A * Math.sin(p);
    const aKnee = -A * (0.55 + 0.45 * Math.sin(p - 1.0)) * 0.9;
    const aFin = A * 1.15 * Math.sin(p - 1.9);
    const rHip = dirRot(new THREE.Quaternion(), leg.d0[0], restThigh, aHip);
    const rKnee = dirRot(new THREE.Quaternion(), leg.d0[1], restShin, aHip + aKnee);
    const rAnkle = dirRot(new THREE.Quaternion(), leg.d0[2], restFin, aHip + aKnee + aFin);
    leg.hip.quaternion.copy(qInv.copy(qP).invert().multiply(rHip));
    leg.knee.quaternion.copy(qInv.copy(rHip).invert().multiply(rKnee));
    leg.ankle.quaternion.copy(qInv.copy(rKnee).invert().multiply(rAnkle));
  });

  // head lifts to look ahead, more when the body tips down
  const look = 0.28 + 0.45 * Math.max(0, -s.pitch) - 0.25 * Math.max(0, s.pitch);
  sk.head.quaternion.copy(qInv.copy(chestModel).invert().multiply(qB.setFromAxisAngle(X, look)));

  // torch arm points where the light goes
  const rArm = new THREE.Quaternion().setFromUnitVectors(sk.armD0, s.aim);
  sk.arm.quaternion.copy(qInv.copy(chestModel).invert().multiply(rArm));
  return effort;
}
