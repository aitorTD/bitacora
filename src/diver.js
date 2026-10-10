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
 *   - only the legs move: the body and the hands hold still, as they do on a real dive;
 *   - the head turns a little toward where the diver is going.
 */

// File space: head toward +z, back toward +y, the diver's left toward +x. Units are metres.
const BONES = {
  head: 'head_016', neck: 'neck_015', chest: 'spine2_014', spine: 'spine1_013',
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

  // Real divers keep the body still and the hands quiet: only the legs take the swim cycle.
  // The rest of the body holds one calm frame of it.
  const clip = gltf.animations[0];
  const fps = 30, T = clip.duration;
  const isLeg = tr => /^(l|r)_(leg|knee|ankle|ball|toe|fin)/.test(tr.name);
  const legClip = new THREE.AnimationClip('kick', T, clip.tracks.filter(isLeg));
  const bodyClip = new THREE.AnimationClip('body', T, clip.tracks.filter(tr => !isLeg(tr) && !/ctrl|ikHandle/i.test(tr.name)));
  const mixer = new THREE.AnimationMixer(root);
  const kick = mixer.clipAction(legClip);
  // neutral glide: two opposite frames of the kick averaged, so the legs sit together
  const f0 = 10, f1 = f0 + Math.round(T * fps / 2);
  const glideA = mixer.clipAction(THREE.AnimationUtils.subclip(legClip, 'glideA', f0, f0 + 1, fps));
  const glideB = mixer.clipAction(THREE.AnimationUtils.subclip(legClip, 'glideB', f1, f1 + 1, fps));
  const body = mixer.clipAction(THREE.AnimationUtils.subclip(bodyClip, 'still', f0, f0 + 1, fps));
  for (const a of [kick, glideA, glideB, body]){ a.play(); a.setEffectiveWeight(a === glideA || a === glideB ? 0 : 1); }

  return { object: root, mixer, kick, glideA, glideB, bones, mouth, lightAnchor, period: T };
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

  // the head follows the swim a little: looks ahead when going down, up toward the surface when going up
  rig.bones.neck.rotateX(-0.22 * s.ascend - 0.12 * s.descend);
}
