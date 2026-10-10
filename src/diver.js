import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/*
 * Diver model "Diver" by ucdavisterc (https://sketchfab.com/ucdavisterc), CC BY 4.0,
 * converted to a low-poly, flat-coloured version by scripts/lowpoly-model.mjs.
 *
 * The file brings its own swim cycle (flutter kick with flexing fins). On top of it:
 *   - kick strength: the full cycle is blended with a neutral glide pose made from two
 *     opposite frames of the same cycle, so the kick can go from a gentle scull to full power;
 *   - kick speed: the clip's time scale, which keeps the phase continuous;
 *   - posture layers for the descent (head down, right hand to the nose to equalize) and the
 *     ascent (looking up, left hand raised holding the inflator, the way divers are taught),
 *     blended in by how fast the diver is going down or up.
 */

// File space: head toward +z, back toward +y, the diver's left toward +x. Units are metres.
const BONES = {
  head: 'head_016', neck: 'neck_015', chest: 'spine2_014', spine: 'spine1_013',
  lShoulder: 'l_shoulder_018', lElbow: 'l_elbow_019', lWrist: 'l_wrist_020',
  rShoulder: 'r_shoulder_040', rElbow: 'r_elbow_041', rWrist: 'r_wrist_042',
};

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

export async function loadDiver(url, { decorate } = {}){
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  let skinned = null;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const glass = o.material.transparent;
    o.material = glass
      ? new THREE.MeshStandardMaterial({ color: '#8fd4e6', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide });
    if (!glass && decorate) decorate(o.material);
    if (o.isSkinnedMesh && !skinned) skinned = o;
  });
  const bones = {};
  for (const [k, name] of Object.entries(BONES)) bones[k] = root.getObjectByName(name);

  // anchors placed in the bind pose, then carried by the bones: regulator and a chest point
  // for the dive light (a light without a torch: it simply comes from the chest rig)
  // a point carried rigidly by bone i sits at boneInverse_i · bindMatrix · p in that bone's space
  root.updateMatrixWorld(true);
  const anchor = (bone, pointInBindSpace) => {
    const o = new THREE.Object3D();
    const i = skinned.skeleton.bones.indexOf(bone);
    o.position.set(...pointInBindSpace).applyMatrix4(skinned.bindMatrix).applyMatrix4(skinned.skeleton.boneInverses[i]);
    bone.add(o);
    return o;
  };
  // bind pose is standing, facing +z, in centimetres
  const mouth = anchor(bones.head, [0, 165, 19]);
  const lightAnchor = anchor(bones.chest, [-15, 140, 16]);

  // actions: full kick, and a neutral glide built from two opposite frames of the cycle
  const clip = gltf.animations[0];
  const fps = 30, T = clip.duration;
  const mixer = new THREE.AnimationMixer(root);
  const kick = mixer.clipAction(clip);
  const f0 = 10, f1 = f0 + Math.round(T * fps / 2);
  const glideA = mixer.clipAction(THREE.AnimationUtils.subclip(clip, 'glideA', f0, f0 + 1, fps));
  const glideB = mixer.clipAction(THREE.AnimationUtils.subclip(clip, 'glideB', f1, f1 + 1, fps));
  for (const a of [kick, glideA, glideB]){ a.play(); a.setEffectiveWeight(a === kick ? 1 : 0); }

  // rest directions of the arm segments, for the posture layers
  const seg = child => child.position.clone().normalize();
  const arms = {
    l: { up: bones.lShoulder, low: bones.lElbow, upAxis: seg(bones.lElbow), lowAxis: seg(bones.lWrist) },
    r: { up: bones.rShoulder, low: bones.rElbow, upAxis: seg(bones.rElbow), lowAxis: seg(bones.rWrist) },
  };
  return { object: root, mixer, kick, glideA, glideB, bones, arms, mouth, lightAnchor, period: T };
}

/* ---------- Posture layers ---------- */
const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qD = new THREE.Quaternion(), qL = new THREE.Quaternion();
const vCur = new THREE.Vector3(), vTgt = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3();

// Turn a bone so its segment points along `dirWorld`, blended by `w`.
function aim(bone, axisLocal, dirWorld, w){
  if (w <= 0.001) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(qW);
  vCur.copy(axisLocal).applyQuaternion(qW);
  qD.setFromUnitVectors(vCur, vTgt.copy(dirWorld).normalize());
  bone.parent.getWorldQuaternion(qP);
  qL.copy(qP).invert().multiply(qD).multiply(qW);
  bone.quaternion.slerp(qL, Math.min(1, w));
}

const fileToWorld = new THREE.Quaternion();
function fileDir(x, y, z, out){ return out.set(x, y, z).normalize().applyQuaternion(fileToWorld); }

/*
 * s: { rate, amp, descend 0..1, ascend 0..1, dt }
 */
export function updateDiver(rig, s){
  const { kick, glideA, glideB } = rig;
  kick.setEffectiveWeight(s.amp);
  glideA.setEffectiveWeight((1 - s.amp) / 2);
  glideB.setEffectiveWeight((1 - s.amp) / 2);
  kick.setEffectiveTimeScale(s.rate);
  rig.mixer.update(s.dt);

  rig.object.updateMatrixWorld(true);
  rig.object.getWorldQuaternion(fileToWorld);
  const b = rig.bones, A = rig.arms;

  // ascent: look up toward the surface, left arm raised overhead holding the inflator
  if (s.ascend > 0.001){
    const w = s.ascend;
    aim(A.l.up, A.l.upAxis, fileDir(0.32, -0.42, 0.85, vA), w * 0.9);
    A.l.up.updateWorldMatrix(true, true);
    aim(A.l.low, A.l.lowAxis, fileDir(-0.12, -0.05, 1, vA), w * 0.9);
    b.neck.rotateX(-0.35 * w);
  }
  // descent: head down, right hand to the mask to equalize
  if (s.descend > 0.001){
    const w = s.descend;
    aim(A.r.up, A.r.upAxis, fileDir(-0.25, -0.92, 0.3, vA), w * 0.85);
    A.r.up.updateWorldMatrix(true, true);
    A.r.low.getWorldPosition(vB);
    rig.mouth.getWorldPosition(vA);
    aim(A.r.low, A.r.lowAxis, vA.sub(vB), w * 0.85);
    b.neck.rotateX(-0.2 * w);
  }
}
