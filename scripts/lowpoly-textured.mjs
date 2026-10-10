#!/usr/bin/env node
/*
 * Low-poly conversion that keeps the model's colour texture (resized), for props whose painted
 * detail matters, like the Nomai mask. The mesh is simplified and later drawn with flat shading.
 *
 *   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
 *   node scripts/lowpoly-textured.mjs nomai-mask-scan.glb public/models/nomai-mask.glb 0.08 1024
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, flatten, join, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [inp, out, ratioArg, sizeArg] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
for (const mat of root.listMaterials()){
  mat.setOcclusionTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null);
  mat.setMetallicFactor(0).setRoughnessFactor(0.8);
}
await doc.transform(
  prune(), flatten(), join(), weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: +(ratioArg || 0.08), error: 0.01 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [+(sizeArg || 1024), +(sizeArg || 1024)], quality: 85 }),
  prune(), dedup(),
);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
await io.write(out, doc);
console.log('triangles', tris);
