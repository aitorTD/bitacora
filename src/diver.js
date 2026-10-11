import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/*
 * Diver model "Diver" by ucdavisterc (https://sketchfab.com/ucdavisterc), CC BY 4.0,
 * converted to a low-poly, flat-coloured version by scripts/lowpoly-model.mjs.
 *
 * The file brings its own swim cycle (flutter kick with flexing fins). On top of it:
 *   - kick strength: the full cycle is blended with a neutral glide pose made from two
 *     opposite frames of the same cycle, so the kick can go from a gentle scull to full power;
 *   - kick speed: the clip's time scale, which keeps the phase continuous;
 *   - the arms and hands stay still; only the legs and the head follow the swim.
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
  // meshopt-compressed and without normals: everything is flat shaded (scripts/compress-models.mjs)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const root = gltf.scene;
  let skinned = null;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const glass = o.material.transparent;
    o.material = glass
      ? new THREE.MeshStandardMaterial({ color: '#8fd4e6', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false, flatShading: true })
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

  // Arms and hands stay still, as on a real dive: their pose is read once from a calm frame of
  // the cycle and written back after the mixer every frame.
  const isArm = name => /^(l|r)_(clav|shoulder|elbow|wrist|thumb|index|middle|ring|pinky)/.test(name);
  const armPose = [];
  for (const tr of clip.tracks){
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(tr.name);
    if (!isArm(nodeName)) continue;
    const node = root.getObjectByName(nodeName); if (!node || !node[propertyName]) continue;
    const value = tr.createInterpolant().evaluate(f0 / fps).slice();
    armPose.push({ target: node[propertyName], value });
  }
  return { object: root, mixer, kick, glideA, glideB, bones, armPose, mouth, lightAnchor, period: T };
}

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

  for (const p of rig.armPose) p.target.fromArray(p.value);
  // the head turns a little toward where the diver is going; the neck is reset by the mixer each frame
  rig.bones.neck.rotateX(-0.35 * s.ascend - 0.2 * s.descend);
}
