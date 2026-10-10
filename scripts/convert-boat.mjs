// Converts Beedle's boat (The Wind Waker, extracted by AJD-262) from COLLADA to public/models/beedle-boat.glb.
// One-off: needs three@0.160.0, @xmldom/xmldom and @gltf-transform/core installed next to it.
//   node scripts/convert-boat.mjs "<folder with Boat.dae and V_tsp.png>" public/models/beedle-boat.glb
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';

const SRC = process.argv[2], OUT = process.argv[3];
globalThis.DOMParser = DOMParser;
// textures are attached by hand below; give the loader a dummy image element
globalThis.document = { createElementNS: () => ({ addEventListener(){}, removeEventListener(){}, set src(v){}, style: {} }) };
globalThis.self = globalThis;

// the joint and the mesh node share the id 'vtsp' and the loader would drop the mesh
const dae = readFileSync(`${SRC}/Boat.dae`, 'utf8').replace('<node id="vtsp" name="vtsp" type="NODE">', '<node id="vtsp_mesh" name="vtsp_mesh" type="NODE">');
const { scene } = new ColladaLoader().parse(dae, '');
scene.updateMatrixWorld(true);

const pos = [], nrm = [], uv = [];
const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
scene.traverse(o => {
  if (!o.isMesh) return;
  let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  nm.getNormalMatrix(o.matrixWorld);
  const P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv;
  // keep only the faces of the textured material (the ERROR_MATERIAL group, if any, is dropped)
  const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const gr of groups){
    const m = mats[gr.materialIndex];
    if (m && /ERROR/i.test(m.name)) { console.log('skip group', m.name, gr.count / 3, 'tris'); continue; }
    for (let i = gr.start; i < gr.start + gr.count; i++){
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(n.x, n.y, n.z);
      const a = T.getX(i), b = T.getY(i); uv.push(a, 1 - b);
      uMin = Math.min(uMin, a); uMax = Math.max(uMax, a); vMin = Math.min(vMin, b); vMax = Math.max(vMax, b);
    }
  }
});
console.log('triangles', pos.length / 9, 'uv range', uMin.toFixed(2), uMax.toFixed(2), vMin.toFixed(2), vMax.toFixed(2));
const box = new THREE.Box3().setFromArray(pos); console.log('bounds', box.min.toArray().map(x => x.toFixed(2)), box.max.toArray().map(x => x.toFixed(2)));

const doc = new Document(), buf = doc.createBuffer();
const tex = doc.createTexture('V_tsp').setImage(readFileSync(`${SRC}/V_tsp.png`)).setMimeType('image/png');
const mat = doc.createMaterial('boat').setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(.5).setDoubleSided(true).setRoughnessFactor(.85).setMetallicFactor(0);
mat.getBaseColorTextureInfo().setWrapS(33648).setWrapT(33648);   // MIRRORED_REPEAT, as in the game
const acc = (arr, type) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
const prim = doc.createPrimitive().setAttribute('POSITION', acc(pos, 'VEC3')).setAttribute('NORMAL', acc(nrm, 'VEC3')).setAttribute('TEXCOORD_0', acc(uv, 'VEC2')).setMaterial(mat);
doc.createScene().addChild(doc.createNode('beedle-boat').setMesh(doc.createMesh('boat').addPrimitive(prim)));
await new NodeIO().write(OUT, doc);
console.log('wrote', OUT);
