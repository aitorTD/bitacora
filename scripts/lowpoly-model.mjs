#!/usr/bin/env node
/*
 * One-off conversion of the Sketchfab diver to the low-poly model in public/models/diver.glb:
 * simplified mesh, one flat colour per triangle (taken from the textures and snapped to a
 * small palette), no textures. Keeps the skeleton and the swim animation.
 *
 *   npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
 *   node scripts/lowpoly-model.mjs original.glb public/models/diver.glb 0.4 9
 *                                  input        output                  ratio palette [max error]
 *   node scripts/lowpoly-model.mjs nomai-mask.glb public/models/nomai-mask.glb 0.03 14 0.02
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, unweld, prune, dedup, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [inp, out, ratioArg, , errArg] = process.argv.slice(2);
const RATIO = +(ratioArg || 0.3);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();

// 1. drop the ground/shadow plane
for (const n of root.listNodes()) if (n.getName().startsWith('pPlane1')) n.dispose();

// 2. decode diffuse textures once
const ext = m => m.getExtension('KHR_materials_pbrSpecularGlossiness');
const texData = new Map();
async function pixels(tex){
  if (texData.has(tex)) return texData.get(tex);
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const v = { data, w: info.width, h: info.height }; texData.set(tex, v); return v;
}
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function sample(px, u, v){
  u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
  const x = Math.min(px.w - 1, Math.floor(u * px.w)), y = Math.min(px.h - 1, Math.floor(v * px.h));
  const i = (y * px.w + x) * 4; return [px.data[i] / 255, px.data[i + 1] / 255, px.data[i + 2] / 255];
}

// 3. simplify
await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: +(errArg || 0.004), lockBorder: false }));
// 4. one colour per triangle, from the texture under it, then snapped to a small palette
await doc.transform(unweld());
const faces = [];   // {prim, t, c, area}
for (const mesh of root.listMeshes()){
  for (const prim of mesh.listPrimitives()){
    const mat = prim.getMaterial(); const sg = mat && ext(mat);
    const diffTex = sg ? sg.getDiffuseTexture() : mat?.getBaseColorTexture();
    const factor = sg ? sg.getDiffuseFactor() : (mat ? mat.getBaseColorFactor() : [1, 1, 1, 1]);
    const uv = prim.getAttribute('TEXCOORD_0'), pos = prim.getAttribute('POSITION');
    const n = pos.getCount();
    const px = diffTex ? await pixels(diffTex) : null;
    const glass = mat && mat.getAlphaMode() === 'BLEND';
    for (let t = 0; t < n; t += 3){
      let c = [factor[0], factor[1], factor[2]];
      if (px && uv){
        const a = uv.getElement(t, []), b = uv.getElement(t + 1, []), d = uv.getElement(t + 2, []);
        const cu = (a[0] + b[0] + d[0]) / 3, cv = (a[1] + b[1] + d[1]) / 3;
        const pts = [[cu, cv]];
        for (const f of [0.35, 0.7]) for (const p of [a, b, d]) pts.push([cu + (p[0] - cu) * f, cv + (p[1] - cv) * f]);
        const cols = pts.map(([su, sv]) => sample(px, su, sv).map(toLin));
        // the colour most samples agree on, so thin stripes do not tint a whole triangle
        let best = cols[0], bestScore = -1;
        for (const ci of cols){ let sc = 0; for (const cj of cols){ const dd = Math.hypot(ci[0] - cj[0], ci[1] - cj[1], ci[2] - cj[2]); if (dd < 0.08) sc++; } if (sc > bestScore){ bestScore = sc; best = ci; } }
        const near = cols.filter(cj => Math.hypot(best[0] - cj[0], best[1] - cj[1], best[2] - cj[2]) < 0.08);
        c = [0, 1, 2].map(k => near.reduce((s, cj) => s + cj[k], 0) / near.length * factor[k]);
      }
      const A = pos.getElement(t, []), B = pos.getElement(t + 1, []), Cc = pos.getElement(t + 2, []);
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
      const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
      faces.push({ prim, t, c, area, glass });
    }
  }
}
// k-means palette in a perceptual-ish space (sqrt of linear)
const K = +(process.argv[5] || 9);
const P = f => f.c.map(v => Math.sqrt(Math.max(0, v)));
const solid = faces.filter(f => !f.glass);
let cent = []; { const sorted = [...solid].sort((a, b) => P(a).reduce((s, v) => s + v, 0) - P(b).reduce((s, v) => s + v, 0)); for (let k = 0; k < K; k++) cent.push(P(sorted[Math.floor((k + .5) / K * sorted.length)])); }
for (let it = 0; it < 25; it++){
  const acc = cent.map(() => [0, 0, 0, 0]);
  for (const f of solid){ const p = P(f); let bi = 0, bd = 1e9; cent.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd){ bd = d; bi = i; } }); f.k = bi; const w = f.area; acc[bi][0] += p[0] * w; acc[bi][1] += p[1] * w; acc[bi][2] += p[2] * w; acc[bi][3] += w; }
  cent = cent.map((c, i) => acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c);
}
console.log('palette (sRGB):', cent.map(c => '#' + c.map(v => Math.round(Math.min(1, Math.pow(v * v, 1 / 2.4) * 1.055 - 0.055) * 255).toString(16).padStart(2, '0')).join('')).join(' '));
const byPrim = new Map();
for (const f of faces){
  const c = f.glass ? f.c : cent[f.k].map(v => v * v);
  if (!byPrim.has(f.prim)) byPrim.set(f.prim, new Float32Array(f.prim.getAttribute('POSITION').getCount() * 4));
  const arr = byPrim.get(f.prim); for (let k = 0; k < 3; k++) arr.set([c[0], c[1], c[2], 1], (f.t + k) * 4);
}
for (const [prim, col] of byPrim){
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setBuffer(prim.getAttribute('POSITION').getBuffer()));
  for (const s of ['TEXCOORD_0', 'TEXCOORD_1', 'TANGENT']) if (prim.getAttribute(s)) prim.setAttribute(s, null);
}
// 5. plain materials: colour comes from the vertices, normals are flat at runtime
for (const mat of root.listMaterials()){
  const sg = ext(mat);
  const glass = mat.getAlphaMode() === 'BLEND';
  if (sg) mat.setExtension('KHR_materials_pbrSpecularGlossiness', null);
  mat.setBaseColorTexture(null).setNormalTexture(null).setEmissiveTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null);
  mat.setBaseColorFactor(glass ? [0.55, 0.8, 0.9, 0.45] : [1, 1, 1, 1]).setMetallicFactor(0.05).setRoughnessFactor(glass ? 0.15 : 0.62).setEmissiveFactor([0, 0, 0]);
}
for (const t of root.listTextures()) t.dispose();
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_pbrSpecularGlossiness') e.dispose();
await doc.transform(resample(), prune(), dedup());
await io.write(out, doc);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getAttribute('POSITION').getCount() / 3;
console.log('triangles', tris);
