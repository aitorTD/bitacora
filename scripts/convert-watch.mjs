#!/usr/bin/env node
/*
 * Apple Watch Ultra 2 for the "Lo que llevo buceado" panel: recoloured to the black titanium
 * version with a black Ocean band (the Action button stays orange), simplified and with the
 * watch-face texture resized.
 *
 * Model: "Apple Watch Ultra Made In Blender (PolygonMBW)" by PolygonMBW, CC BY 4.0
 * https://sketchfab.com/3d-models/apple-watch-ultra-made-in-blender-polygonmbw-bd089526a71c4517956c94f32a081210
 *
 *   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
 *   node scripts/convert-watch.mjs apple_watch_ultra.glb public/models/apple-watch-ultra.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, prune, dedup, flatten, join, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [inp, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
const root = doc.getRoot();

// linear-space colours: black titanium case, black band and buckle, orange Action button kept
const TITANIUM = { color: [.03, .03, .032, 1], metal: 1, rough: .34 };
const LOOK = {
  Watch_Body: TITANIUM,
  Watch_Crown: TITANIUM,
  Watch_Crown_Ring: { color: [.05, .05, .052, 1], metal: 1, rough: .4 },
  Watch_Strap: { color: [.016, .016, .018, 1], metal: 0, rough: .62 },
  Strap_Lock: { color: [.045, .045, .048, 1], metal: 1, rough: .3 },
  'Material.005': { color: [.035, .035, .037, 1], metal: 0, rough: .2 }, // back plate
};
for (const mat of root.listMaterials()){
  const look = LOOK[mat.getName()];
  if (look) mat.setBaseColorFactor(look.color).setMetallicFactor(look.metal).setRoughnessFactor(look.rough);
}

await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
await doc.transform(prune(), flatten(), weld({ tolerance: 0.00005 }));
// the buckle alone has ~80k vertices; the band and case keep more of their detail
const RATIO = { Strap_Lock: .06, Watch_Strap: .35, Watch_Body: .5, Watch_Crown: .4 };
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()){
  const ratio = RATIO[prim.getMaterial()?.getName()];
  if (ratio) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: .002 });
}
await doc.transform(
  join(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [512, 512], quality: 82 }),
  prune(), dedup(),
  // quantized and meshopt-compressed: the page decodes it with three's MeshoptDecoder
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
await io.write(out, doc);
console.log('triangles', tris);
