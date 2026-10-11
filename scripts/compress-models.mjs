#!/usr/bin/env node
/*
 * Shrinks the diver and the Nomai mask for the web: both are drawn with flat shading (the normals
 * come from the shader), so their NORMAL attribute is dropped; the mask texture is resized; both
 * are quantized and meshopt-compressed (the page decodes them with three's MeshoptDecoder).
 *
 *   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
 *   node scripts/compress-models.mjs public/models/diver.glb public/models/nomai-mask.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)){
  const doc = await io.read(file);
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  await doc.transform(
    prune(), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [768, 768], quality: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(file, doc);
  console.log(file, 'done');
}
