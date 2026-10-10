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
  elbow: [0.2, -0.002, -0.012],
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
const B = { pelvis: 0, chest: 1, head: 2, arm: 3, lHip: 4, lKnee: 5, lAnkle: 6, rHip: 7, rKnee: 8, rAnkle: 9, fore: 10 };

function skinWeights(geo, part){
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++){
    const x = pos.getX(i), y = pos.getY(i);
    const w = {};
    const add = (b, v) => { if (v > 1e-4) w[b] = (w[b] || 0) + v; };
    if (part[i] === 1){ add(B.chest, 1); }
    else if (y > -0.09){
      if (part[i] === 0 && x > 0.115 && y < 0.13 && y > -0.12){
        const a = sstep(0.115, 0.15, x), f = sstep(0.18, 0.215, x);
        add(B.arm, a * (1 - f)); add(B.fore, a * f); add(B.chest, 1 - a);
      }
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
  const fore = mk('fore', J.elbow, J.shoulder); arm.add(fore);
  const leg = s => {
    const hip = mk('hip', s.hip, J.pelvis); pelvis.add(hip);
    const knee = mk('knee', s.knee, s.hip); hip.add(knee);
    const ankle = mk('ankle', s.ankle, s.knee); knee.add(ankle);
    return { hip, knee, ankle,
      d0: [V(s.knee).sub(V(s.hip)).normalize(), V(s.ankle).sub(V(s.knee)).normalize(), V(s.tip).sub(V(s.ankle)).normalize()] };
  };
  const L = leg(J.L), R = leg(J.R);
  const bones = [pelvis, chest, head, arm, L.hip, L.knee, L.ankle, R.hip, R.knee, R.ankle, fore];
  return { bones, pelvis, chest, head, arm, fore, L, R,
    upperD0: V(J.elbow).sub(V(J.shoulder)).normalize(), foreD0: V(J.hand).sub(V(J.elbow)).normalize() };
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
  const hand = new THREE.Object3D(); hand.position.copy(V(J.hand).sub(V(J.elbow))); sk.fore.add(hand);
  finFrames(geo, sk);
  const mouth = new THREE.Object3D(); mouth.position.copy(V(J.mouth).sub(V(J.head))); sk.head.add(mouth);

  return { mesh, skeleton: sk, hand, mouth };
}

/*
 * Every segment is rotated from its bind orientation to a target orientation
 * given as a full frame (direction + reference axis), not a minimal rotation.
 * That keeps fins and limbs from rolling around their own axis as they move.
 */
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4();
const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
function basis(m, dir, ref){
  vz.copy(dir).normalize();
  vx.copy(ref).addScaledVector(vz, -ref.dot(vz)).normalize();
  vy.crossVectors(vz, vx);
  return m.makeBasis(vx, vy, vz);
}
function frameRot(out, d0, r0, d1, r1){
  basis(mA, d0, r0); basis(mB, d1, r1);
  return out.setFromRotationMatrix(mB.multiply(mA.transpose()));
}

// Blade normal of each fin, from the vertices that follow the ankle (smallest principal axis).
function finFrames(geo, sk){
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  [[sk.L, B.lAnkle], [sk.R, B.rAnkle]].forEach(([leg, bone]) => {
    const pts = [];
    for (let i = 0; i < pos.count; i++){
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone && sw.getComponent(i, k) > 0.9){ pts.push(new THREE.Vector3().fromBufferAttribute(pos, i)); break; }
    }
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts){ const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[r][q] += d[r] * d[q]; }
    // smallest eigenvector = largest eigenvector of (trace·I − C), by power iteration
    const tr = C[0][0] + C[1][1] + C[2][2];
    let v = new THREE.Vector3(1, 1, 1).normalize();
    for (let it = 0; it < 60; it++){
      v = new THREE.Vector3(
        (tr - C[0][0]) * v.x - C[0][1] * v.y - C[0][2] * v.z,
        -C[1][0] * v.x + (tr - C[1][1]) * v.y - C[1][2] * v.z,
        -C[2][0] * v.x - C[2][1] * v.y + (tr - C[2][2]) * v.z).normalize();
    }
    // pick the sign that needs the smaller turn to reach the rest pose
    const q1 = frameRot(new THREE.Quaternion(), leg.d0[2], v, REST.fin, REST.finUp);
    const q2 = frameRot(new THREE.Quaternion(), leg.d0[2], v.clone().negate(), REST.fin, REST.finUp);
    leg.finN0 = Math.abs(q1.w) >= Math.abs(q2.w) ? v : v.negate();
  });
}

// Rest posture in model space (+y head, +z back, +x right): horizontal trim,
// thighs slightly down, knees bent so the shins rise, fins flat and trailing.
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rotX = (v, a) => v.clone().applyAxisAngle(X, a);
const DOWN = new THREE.Vector3(0, -1, 0);
const REST = {
  hip: 0.24,          // thigh angle from the body axis, toward the belly
  knee: -1.02,        // knee bend, toward the back
  ankle: 0.86,        // fin angle back toward horizontal
  fin: null, finUp: null,
};
REST.fin = rotX(DOWN, REST.hip + REST.knee + REST.ankle);
REST.finUp = rotX(Z, REST.hip + REST.knee + REST.ankle);
// torch arm: upper arm forward and down beside the chest
const UPPER = new THREE.Vector3(0.32, 0.5, -0.8).normalize();

const qP = new THREE.Quaternion(), qC = new THREE.Quaternion(), qT = new THREE.Quaternion(), qInv = new THREE.Quaternion();
const qHip = new THREE.Quaternion(), qKnee = new THREE.Quaternion(), qAnk = new THREE.Quaternion();
const qUp = new THREE.Quaternion(), qFore = new THREE.Quaternion();
const aim = new THREE.Vector3(), tA = new THREE.Vector3(), tB = new THREE.Vector3();

/*
 * Pose solver. `s` is the smoothed swim state:
 *   phase  - kick phase in radians (accumulated, never jumps)
 *   amp    - kick amplitude 0..1
 *   pitch  - body pitch in radians (negative = head down)
 *   aim    - unit vector, torch direction in model space
 */
export function poseDiver(sk, s){
  const { phase, amp } = s;
  // a calm body: the hips roll a touch with each kick and the chest gives some of it back
  qP.setFromAxisAngle(Y, Math.sin(phase) * 0.035 * amp);
  sk.pelvis.quaternion.copy(qP);
  sk.chest.quaternion.setFromAxisAngle(Y, -Math.sin(phase) * 0.02 * amp).multiply(qT.setFromAxisAngle(X, Math.sin(phase * 2 + 0.6) * 0.012 * amp));
  qC.copy(qP).multiply(sk.chest.quaternion);

  // modified flutter kick: driven from the knees, small hip motion, fins whip a little behind
  const A = 0.4 + 0.6 * amp;
  [[sk.L, 0], [sk.R, Math.PI]].forEach(([leg, off]) => {
    const p = phase + off;
    const h = REST.hip + 0.1 * A * Math.sin(p);
    const k = h + REST.knee + 0.32 * A * Math.sin(p - 0.7);
    const f = k + REST.ankle + 0.3 * A * Math.sin(p - 1.6);
    frameRot(qHip, leg.d0[0], X, rotX(DOWN, h), X);
    frameRot(qKnee, leg.d0[1], X, rotX(DOWN, k), X);
    frameRot(qAnk, leg.d0[2], leg.finN0, rotX(DOWN, f), rotX(Z, f));
    leg.hip.quaternion.copy(qInv.copy(qP).invert().multiply(qHip));
    leg.knee.quaternion.copy(qInv.copy(qHip).invert().multiply(qKnee));
    leg.ankle.quaternion.copy(qInv.copy(qKnee).invert().multiply(qAnk));
  });

  // head lifts to look ahead, more when the body tips down
  const look = 0.3 + 0.45 * Math.max(0, -s.pitch) - 0.25 * Math.max(0, s.pitch);
  sk.head.quaternion.copy(qInv.copy(qC).invert().multiply(qT.setFromAxisAngle(X, look)));

  // torch arm: the upper arm stays near the chest, the forearm points the light
  aim.copy(s.aim);
  if (aim.y < 0.15) aim.y = 0.15;           // never behind the shoulder
  if (aim.x < -0.1) aim.x = -0.1;           // never across the chest
  aim.normalize();
  tA.copy(UPPER).lerp(aim, 0.25).normalize();
  frameRot(qUp, sk.upperD0, Z, tA, Z);
  frameRot(qFore, sk.foreD0, Z, aim, Z);
  sk.arm.quaternion.copy(qInv.copy(qC).invert().multiply(qUp));
  sk.fore.quaternion.copy(qInv.copy(qUp).invert().multiply(qFore));
}
