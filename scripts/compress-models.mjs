#!/usr/bin/env node
/*
 * Shrinks the diver and the Nomai mask for the web: both are drawn with flat shading (the normals
 * come from the shader), so their NORMAL attribute is dropped; the mask texture is resized; both
 * are meshopt-compressed (the page decodes them with three's MeshoptDecoder).
 * The diver is skinned and src/diver.js places the dive light and the regulator at fixed points in
 * its bind space, so it is NOT quantized (quantizing rewrites that space): its buffers are only
 * filtered and compressed. The mask is quantized too.
 *
 *   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
 *   node scripts/compress-models.mjs public/models/diver.glb public/models/nomai-mask.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)){
  const doc = await io.read(file);
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
  const skinned = doc.getRoot().listSkins().length > 0;
  await doc.transform(
    prune(), dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [768, 768], quality: 80 }),
    ...(skinned ? [] : [meshopt({ encoder: MeshoptEncoder, level: 'medium' })]),
  );
  if (skinned) doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  console.log(file, 'done');
}
