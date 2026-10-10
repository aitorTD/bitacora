import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Low-poly figures for the species album. Every builder returns one BufferGeometry with a colour
 * per face (flat, like the rest of the site), head toward +x, back toward +y, about 2–3 units long.
 * buildModel(spec) picks the builder from spec.model.kind (see species.js).
 */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = h => new THREE.Color(h);
const tmp = new THREE.Color(), tmp2 = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (a, b, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const frac = x => x - Math.floor(x);

export const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .55, metalness: .05, side: THREE.DoubleSide });

/* ---------- geometry helpers ---------- */
// colour every face from its centre: fn(x, y, z, out, face) -> out
function paint(geo, fn){
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = g.attributes.position, col = new Float32Array(p.count * 3), extra = g.attributes.aT;
  for (let i = 0; i < p.count; i += 3){
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const t = extra ? (extra.getX(i) + extra.getX(i + 1) + extra.getX(i + 2)) / 3 : 0;
    const a = extra ? (extra.getY(i) + extra.getY(i + 1) + extra.getY(i + 2)) / 3 : 0;
    fn(x, y, z, tmp, { t, a, i: i / 3 });
    for (let k = 0; k < 3; k++) col.set([tmp.r, tmp.g, tmp.b], (i + k) * 3);
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const solid = (geo, color) => { const c = C(color); return paint(geo, (x, y, z, o) => o.copy(c)); };
const xf = (geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) => geo.applyMatrix4(new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V(...s)));
function merge(parts){ const g = mergeGeometries(parts.flat()); g.computeVertexNormals(); return g; }

// a tube along a smooth path with a radius that changes along it; aT holds (t, angle) for painting
function tube(points, radius, { seg = 40, radial = 7, cap = true } = {}){
  const curve = new THREE.CatmullRomCurve3(points), frames = curve.computeFrenetFrames(seg, false);
  const pos = [], ta = [], idx = [];
  for (let i = 0; i <= seg; i++){
    const t = i / seg, P = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i], r = radius(t);
    for (let j = 0; j < radial; j++){
      const th = j / radial * Math.PI * 2;
      pos.push(P.x + r * (Math.cos(th) * N.x + Math.sin(th) * B.x), P.y + r * (Math.cos(th) * N.y + Math.sin(th) * B.y), P.z + r * (Math.cos(th) * N.z + Math.sin(th) * B.z));
      ta.push(t, th);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++){
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  if (cap){
    const end = curve.getPointAt(1); pos.push(end.x, end.y, end.z); ta.push(1, 0);
    const e = pos.length / 3 - 1; for (let j = 0; j < radial; j++) idx.push(seg * radial + j, e, seg * radial + (j + 1) % radial);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(ta, 2)); g.setIndex(idx);
  return g;
}
const shapeGeo = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return new THREE.ShapeGeometry(s); };
function eyes(x, y, z, size, { white = '#f4f1e8', pupil = '#0c0c0e', up = false } = {}){
  const out = [];
  for (const s of [-1, 1]){
    out.push(solid(xf(new THREE.IcosahedronGeometry(size, 1), { p: [x, y, s * z] }), white));
    const d = up ? [.01, size * .55, 0] : [size * .15, 0, s * size * .6];
    out.push(solid(xf(new THREE.IcosahedronGeometry(size * .6, 1), { p: [x + d[0], y + d[1], s * z + d[2]] }), pupil));
  }
  return out;
}

/* ---------- fish: an ellipsoid shaped by a side profile, plus fins, eyes and painted marks ---------- */
function fishGeometry(s, pt){
  const h = s.h, w = s.w, c = s.c ?? .15, snout = s.snout || 0;
  const prof = x => x >= c ? Math.pow(Math.max(0, 1 - ((x - c) / (1 - c)) ** 2), s.headPow ?? .5) : Math.pow(Math.max(0, 1 - ((c - x) / (1 + c)) ** 2), s.tailPow ?? .5);
  const unstretch = x => (x > .5 ? .5 + (x - .5) / (1 + snout) : x);
  const top = C(pt.top), bottom = C(pt.bottom), finC = C(pt.fin), marks = (pt.marks || []).map(m => m.map(v => (typeof v === 'string' && v[0] === '#' ? C(v) : v)));
  const paintBody = (x, y, z, o) => {
    const xb = unstretch(x), pn = Math.max(prof(xb), .18), yn = y / (h * pn);
    o.copy(bottom).lerp(top, smooth(-.35, .55, yn));
    for (const m of marks){
      if (m[0] === 'vband' && xb > m[1] && xb < m[2]) o.lerp(m[3], .92);
      else if (m[0] === 'vbars' && xb > m[3] && xb < m[4] && frac((xb - m[3]) / (m[4] - m[3]) * m[1]) < .4) o.lerp(m[2], .8);
      else if (m[0] === 'hstripes' && Math.abs(yn) < .85 && frac((yn + 1) / 2 * m[1]) < (m[3] ?? .2) * 1.6) o.lerp(m[2], .85);
      else if (m[0] === 'hband' && yn > m[1] && yn < m[2]) o.lerp(m[3], .9);
      else if (m[0] === 'spots' && hash(Math.round(x * 30), Math.round(y * 30), Math.round(z * 30)) < m[1]) o.lerp(m[2], .85);
      else if (m[0] === 'patch' && Math.hypot((xb - m[1]) * 1.2, (yn - m[2]) * .5) < m[3]) o.lerp(m[4], .95);
    }
    return o;
  };
  const parts = [];
  const body = new THREE.SphereGeometry(1, s.smooth ? 26 : 18, s.smooth ? 16 : 12);
  { const p = body.attributes.position;
    for (let i = 0; i < p.count; i++){
      let x = p.getX(i); const r0 = Math.sqrt(Math.max(0, 1 - x * x)), k = r0 > 1e-4 ? prof(x) / r0 : 0;
      if (s.shark && p.getY(i) < 0) p.setY(i, p.getY(i) * .75);
      p.setY(i, p.getY(i) * k * h); p.setZ(i, p.getZ(i) * k * w);
      if (x > .5) x += (x - .5) * snout;
      p.setX(i, x);
    } }
  parts.push(paint(body, paintBody));
  const finPaint = g => paint(g, (x, y, z, o) => o.copy(finC));
  const topAt = x => h * prof(x) * .9;
  // tail
  const th = Math.max(.15, h * 1.15) * (s.tailH ?? 1);
  const tails = {
    fork: [[-.86, 0], [-1.5, th], [-1.32, 0], [-1.5, -th]],
    lyre: [[-.86, 0], [-1.85, th * 1.25], [-1.3, 0], [-1.85, -th * 1.25]],
    truncate: [[-.86, 0], [-1.38, th], [-1.44, 0], [-1.38, -th]],
    shark: [[-.86, .02], [-1.78, th * 1.15], [-1.58, .03], [-1.3, -th * .55]],
  };
  if (tails[s.tail]) parts.push(finPaint(shapeGeo(tails[s.tail])));
  else if (s.tail === 'round'){ const sh = new THREE.Shape(); sh.moveTo(-.86, 0); sh.lineTo(-1.2, th * .85); sh.quadraticCurveTo(-1.6, 0, -1.2, -th * .85); sh.lineTo(-.86, 0); parts.push(finPaint(new THREE.ShapeGeometry(sh))); }
  else if (s.tail === 'clavus'){ const sh = new THREE.Shape(); sh.moveTo(-.9, h * .75); sh.quadraticCurveTo(-1.3, 0, -.9, -h * .75); sh.lineTo(-.9, h * .75); parts.push(finPaint(new THREE.ShapeGeometry(sh))); }
  else if (s.tail === 'fluke') parts.push(finPaint(xf(shapeGeo([[-.82, 0], [-1.42, .42], [-1.26, 0], [-1.42, -.42]]), { r: [Math.PI / 2, 0, 0] })));
  // dorsal fins
  const fin = (spec, sign = 1) => {
    if (!spec) return;
    const [x0, x1, fh, kind] = spec, base = x => sign * topAt(x);
    let pts;
    if (kind === 'spiky'){
      pts = [[x0, base(x0)]]; const n = Math.max(4, Math.round((x1 - x0) * 10));
      for (let i = 0; i <= n; i++){ const x = x0 + (x1 - x0) * i / n; pts.push([x - .02, base(x) + sign * fh * (i % 2 ? .55 : 1) * (1 - .25 * i / n)]); }
      pts.push([x1, base(x1)]);
    } else if (kind === 'dolphin') pts = [[x1, base(x1)], [x0 - .05, base(x0) + sign * fh], [x0 + (x1 - x0) * .3, base(x0) + sign * fh * .7], [x0, base(x0)]];
    else pts = [[x0, base(x0)], [x0 + (x1 - x0) * .3, base(x0) + sign * fh], [x1, base(x1) + sign * fh * .45], [x1, base(x1)]];
    parts.push(finPaint(shapeGeo(pts)));
  };
  fin(s.dorsal); fin(s.dorsal2); fin(s.anal, -1);
  if (s.pect){
    const ps = s.pect, px = .3, py = -h * .25, pz = w * prof(px) * .95 + .01;
    for (const sz of [-1, 1]) parts.push(finPaint(xf(shapeGeo([[0, 0], [-ps * 1.4, ps * .5], [-ps * 1.2, -ps * .35]]), { p: [px, py, sz * pz], r: [0, sz * .35, -.25] })));
  }
  if (s.pelvic) for (const sz of [-1, 1]) parts.push(finPaint(xf(shapeGeo([[0, 0], [-.05, -h * 1.1], [-.12, -h * .2]]), { p: [.32, -h * .6, sz * w * .4] })));
  if (s.barbels) for (const sz of [-1, 1]) parts.push(solid(tube([V(.82 + snout * .3, -h * .55, sz * .03), V(.78, -h * 1.05, sz * .06), V(.72, -h * 1.3, sz * .07)], () => .012, { seg: 6, radial: 4 }), '#f2e6cf'));
  if (s.tentacles) for (const sz of [-1, 1]) parts.push(solid(xf(new THREE.ConeGeometry(.03, .14, 4), { p: [.62, h * prof(.62) * .95 + .05, sz * .07], r: [0, 0, -.3] }), pt.fin));
  // eyes
  const ex = .62, eyeX = ex + (ex > .5 ? (ex - .5) * snout : 0), es = .07 * (s.eye ?? 1) * Math.min(1, Math.max(.5, h / .35));
  if (s.eyeUp) parts.push(eyes(eyeX - .05, h * prof(ex) * .85, .045, es * .9));
  else { const ey = h * prof(ex) * .22, ez = w * prof(ex) * Math.sqrt(1 - .22 * .22) * .92; parts.push(eyes(eyeX, ey, ez, es)); }
  if (s.beak) parts.push(paint(xf(new THREE.SphereGeometry(1, 10, 6), { p: [1.05 + snout * .5, -h * .25, 0], s: [.22, h * .28, w * .3] }), (x, y, z, o) => o.copy(bottom).lerp(top, smooth(-.1, .1, y + h * .25))));
  return merge(parts);
}

/* ---------- flatfish lying on the sand, both eyes on top ---------- */
function flatfishGeometry(pt){
  const top = C(pt.top), spot = C(pt.spot);
  const body = paint(xf(new THREE.SphereGeometry(1, 20, 10), { s: [1, .07, .62] }), (x, y, z, o) => {
    o.copy(top).multiplyScalar(.85 + .3 * hash(Math.round(x * 12), Math.round(z * 12)));
    const r = frac(hash(Math.round(x * 6), Math.round(z * 6)) * 7); if (y > 0 && r < .16) o.lerp(spot, .9);
    if (y < 0) o.set('#efe8d8');
    return o;
  });
  const fringe = paint(xf(new THREE.SphereGeometry(1, 20, 6), { p: [-.02, -.01, 0], s: [1.1, .025, .74] }), (x, y, z, o) => o.copy(top).multiplyScalar(1.12));
  const tail = solid(xf(shapeGeo([[-.95, 0], [-1.35, .28], [-1.4, 0], [-1.35, -.28]]), { r: [Math.PI / 2, 0, 0] }), pt.top);
  return merge([body, fringe, tail, eyes(.55, .06, .1, .06, { up: true })]);
}

/* ---------- eels: moray and conger ---------- */
function eelGeometry(spec){
  const pt = spec.model.paint, conger = spec.model.conger;
  const pts = [V(-1.5, -.3, .05), V(-1, .05, .15), V(-.4, -.18, -.05), V(.2, .08, 0), V(.75, .26, 0), V(1.2, .32, 0)];
  const r = t => .14 * (t < .82 ? .2 + .8 * smooth(0, .45, t) : 1 - (t - .82) / .18 * .6);
  const base = C(pt.base), spot = pt.spot && C(pt.spot), belly = pt.belly && C(pt.belly);
  const body = paint(tube(pts, r, { seg: 60, radial: 8 }), (x, y, z, o, f) => {
    o.copy(base);
    if (belly && Math.sin(f.a) < -.3) o.copy(belly);
    if (spot && hash(Math.round(x * 14), Math.round(y * 14), Math.round(z * 14)) < .32) o.lerp(spot, .9);
    return o;
  });
  const parts = [body];
  // a fin ribbon along the back
  const ribbon = [], N = 30, curve = new THREE.CatmullRomCurve3(pts);
  for (let i = 0; i <= N; i++){ const t = .05 + .7 * i / N, P = curve.getPointAt(t); ribbon.push([P, r(t)]); }
  const rp = [];
  for (let i = 0; i < N; i++){
    const [a, ra] = ribbon[i], [b, rb] = ribbon[i + 1], ha = ra + .05, hb = rb + .05;
    rp.push(a.x, a.y + ra * .8, a.z, b.x, b.y + rb * .8, b.z, a.x, a.y + ha, a.z, b.x, b.y + rb * .8, b.z, b.x, b.y + hb, b.z, a.x, a.y + ha, a.z);
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  parts.push(solid(rg, pt.fin || pt.base));
  const head = curve.getPointAt(.93);
  parts.push(eyes(head.x, head.y + .06, .065, .03, { white: conger ? '#d9dcd6' : '#e9d9a0' }));
  // the moray's open mouth
  if (!conger) parts.push(solid(xf(new THREE.ConeGeometry(.05, .2, 5), { p: [1.18, .26, 0], r: [0, 0, -Math.PI / 2 - .35] }), '#2a1a12'));
  return merge(parts);
}

/* ---------- seahorse ---------- */
function seahorseGeometry(pt){
  const base = C(pt.base), spot = C(pt.spot);
  const pts = [V(.28, -1.08, 0), V(.12, -1.2, 0), V(-.02, -1.08, 0), V(.02, -.9, 0), V(.12, -.62, 0), V(.06, -.28, 0), V(.02, .05, 0), V(.08, .32, 0), V(.18, .5, 0)];
  const r = t => (t < .35 ? .025 + .07 * smooth(0, .35, t) : t < .7 ? .095 + .07 * Math.sin((t - .35) / .35 * Math.PI) : .1 - .04 * (t - .7) / .3);
  const col = (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 25), Math.round(y * 25), Math.round(z * 25)) < .22) o.lerp(spot, .85); return o; };
  const parts = [paint(tube(pts, r, { seg: 50, radial: 8 }), col)];
  parts.push(paint(xf(new THREE.SphereGeometry(1, 10, 8), { p: [.24, .56, 0], s: [.17, .13, .1] }), col));
  parts.push(paint(tube([V(.3, .52, 0), V(.48, .48, 0), V(.62, .45, 0)], t => .032 + (t > .85 ? .015 : 0), { seg: 8, radial: 6 }), col));
  parts.push(solid(xf(shapeGeo([[0, 0], [-.16, .12], [-.2, -.08]]), { p: [.0, -.05, 0] }), pt.base));
  for (let i = 0; i < 4; i++) parts.push(solid(xf(new THREE.ConeGeometry(.02, .07, 4), { p: [.16 + i * .04, .7 - i * .015, 0], r: [0, 0, -.2] }), pt.base));
  parts.push(eyes(.28, .6, .085, .03));
  return merge(parts);
}

/* ---------- rays and the angel shark, flat on the sand ---------- */
function rayGeometry(m){
  const pt = m.paint, top = C(pt.top), edge = C(pt.edge), spot = pt.spot && C(pt.spot);
  const shapes = {
    sting: th => { const c = Math.cos(th), s = Math.sin(th); const k = 1 / Math.pow(Math.abs(c) ** 1.7 + Math.abs(s) ** 1.7, 1 / 1.7); return [k * (c > 0 ? .62 : .72) * c, k * .85 * s]; },
    butterfly: th => { const c = Math.cos(th), s = Math.sin(th); return [(c > 0 ? .4 : .38) * c, 1.3 * s * (1 - .25 * Math.abs(c))]; },
    torpedo: th => [.62 * Math.cos(th), .6 * Math.sin(th)],
    angel: th => { const c = Math.cos(th), s = Math.sin(th); const wing = Math.max(0, Math.sin(th * 2 - .4)) * .0; return [c > 0 ? .55 * c : .5 * c, (.62 + wing) * s * (c > -.3 ? 1 : .55)]; },
  };
  const f = shapes[m.shape];
  const RINGS = 6, SEG = 28, verts = [0, .12, 0], idx = [];
  for (let r = 1; r <= RINGS; r++) for (let i = 0; i < SEG; i++){
    const th = i / SEG * Math.PI * 2, k = r / RINGS, [x, z] = f(th);
    verts.push(x * k, (m.shape === 'torpedo' ? .16 : .12) * (1 - k * k), z * k);
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + (i + 1) % SEG, 1 + i);
  for (let r = 1; r < RINGS; r++) for (let i = 0; i < SEG; i++){ const a = 1 + (r - 1) * SEG + i, b = 1 + (r - 1) * SEG + (i + 1) % SEG; idx.push(a, b, a + SEG, b, b + SEG, a + SEG); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx);
  const parts = [paint(g, (x, y, z, o) => {
    const k = Math.min(1, Math.hypot(x / .7, z / 1)); o.copy(top).lerp(edge, k * k);
    if (spot && hash(Math.round(x * 14), Math.round(z * 14)) < .3) o.lerp(spot, .7);
    if (pt.spot && m.shape === 'angel' && hash(Math.round(x * 20), Math.round(z * 20), 3) < .15) o.lerp(C(pt.spot), .8);
    return o;
  })];
  if (m.shape === 'angel'){
    // the angel shark: a flattened shark body behind the wings
    parts.push(paint(xf(new THREE.SphereGeometry(1, 14, 8), { p: [-.55, .03, 0], s: [.85, .1, .2] }), (x, y, z, o) => o.copy(top)));
    parts.push(solid(shapeGeo([[-1.25, .02], [-1.7, .3], [-1.58, .02], [-1.5, -.15]]), pt.top));
    parts.push(solid(shapeGeo([[-.85, .1], [-.98, .26], [-1.02, .1]]), pt.top), solid(shapeGeo([[-1.05, .08], [-1.17, .22], [-1.2, .08]]), pt.top));
  } else if (m.shape === 'torpedo'){
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [-.75, .03, 0], s: [.4, .09, .12] }), (x, y, z, o) => o.copy(top)));
    parts.push(solid(shapeGeo([[-1.05, 0], [-1.35, .22], [-1.38, -.2]]), pt.top), solid(shapeGeo([[-.62, .1], [-.72, .24], [-.78, .1]]), pt.top));
  } else {
    const L = m.shape === 'sting' ? 1.5 : .6;
    parts.push(solid(tube([V(-.6, .02, 0), V(-.6 - L * .5, .03, .05), V(-.6 - L, .02, .1)], t => .03 * (1 - t) + .006, { seg: 10, radial: 5 }), pt.top));
    if (m.shape === 'sting') parts.push(solid(xf(new THREE.ConeGeometry(.012, .2, 4), { p: [-1.1, .05, .06], r: [0, 0, Math.PI / 2] }), '#e0d4b8'));
  }
  parts.push(eyes(.25, .13, .12, .035, { up: true }));
  return merge(parts);
}

/* ---------- octopus, cuttlefish, squid ---------- */
function armTube(root, dir, len, r0, curl, side){
  const pts = [root.clone()]; const d = dir.clone().normalize(), p = root.clone();
  const axis = V(0, 1, 0).cross(d).normalize(); const q = new THREE.Quaternion();
  for (let i = 1; i <= 8; i++){
    q.setFromAxisAngle(axis.lengthSq() > 0 ? axis : V(0, 0, 1), curl * (i / 8) ** 1.6 * side); d.applyQuaternion(q);
    p.addScaledVector(d, len / 8); pts.push(p.clone());
  }
  return tube(pts, t => r0 * (1 - t * .85) + .008, { seg: 18, radial: 6 });
}
function octopusGeometry(){
  const top = C('#e8673f'), belly = C('#ffbf98'), spot = C('#c84a2c');
  const col = (x, y, z, o) => { o.copy(belly).lerp(top, smooth(-.3, .3, y)); if (y > .2 && hash(Math.round(x * 9), Math.round(y * 9), Math.round(z * 9)) > .85) o.lerp(spot, .8); return o; };
  const mantle = paint(xf(new THREE.IcosahedronGeometry(1, 2), { p: [0, .55, 0], s: [.52, .6, .5] }), col);
  const parts = [mantle];
  for (let i = 0; i < 8; i++){
    const a = (i + .5) / 8 * Math.PI * 2, out = V(Math.cos(a), -.35, Math.sin(a));
    const root = V(Math.cos(a) * .25, .12, Math.sin(a) * .25);
    parts.push(paint(armTube(root, out, 1.5, .12, 2.6, -1), (x, y, z, o, f) => o.copy(top).lerp(belly, Math.cos(f.a) < -.2 ? .8 : .15 + f.t * .3)));
  }
  parts.push(eyes(.44, .55, .2, .1));
  return merge(parts);
}
function cuttlefishGeometry(){
  const base = C('#8a6a4a'), light = C('#e8dcc8'), dark = C('#3a2a1e');
  const mantle = paint(xf(new THREE.SphereGeometry(1, 20, 12), { s: [1, .32, .45] }), (x, y, z, o) => {
    o.copy(light).lerp(base, smooth(-.1, .15, y));
    if (y > .05 && frac((x + 1) * 5 + Math.abs(z) * 2) < .35) o.lerp(dark, .7);
    return o;
  });
  const skirt = paint(xf(new THREE.SphereGeometry(1, 24, 4), { p: [-.02, -.02, 0], s: [1.04, .03, .58] }), (x, y, z, o) => o.copy(light).lerp(C('#c9b28a'), .3 + .3 * Math.sin(x * 20)));
  const head = paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [1, -.02, 0], s: [.24, .22, .26] }), (x, y, z, o) => o.copy(base));
  const parts = [mantle, skirt, head, eyes(1.02, .1, .2, .07, { white: '#d8c070' })];
  for (let i = 0; i < 8; i++){
    const a = (i / 8) * Math.PI * 2;
    parts.push(paint(armTube(V(1.18, Math.cos(a) * .08 - .04, Math.sin(a) * .1), V(1, Math.cos(a) * .25 - .1, Math.sin(a) * .3), .5, .05, .5, 1), (x, y, z, o) => o.copy(base).lerp(light, .3)));
  }
  return merge(parts);
}
function squidGeometry(){
  const base = C('#e8a0a0'), dot = C('#b0403a');
  const col = (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 30), Math.round(y * 30), Math.round(z * 30)) < .3) o.lerp(dot, .7); return o; };
  const mantle = paint(tube([V(-1.4, 0, 0), V(-.6, 0, 0), V(.3, 0, 0)], t => .03 + .16 * Math.sqrt(t), { seg: 20, radial: 9, cap: false }), col);
  const fins = solid(xf(shapeGeo([[-1.4, 0], [-1.05, .42], [-.7, 0], [-1.05, -.42]]), { r: [Math.PI / 2, 0, 0] }), '#e8b0ac');
  const head = paint(xf(new THREE.SphereGeometry(1, 10, 8), { p: [.42, 0, 0], s: [.16, .13, .14] }), col);
  const parts = [mantle, fins, head, eyes(.44, .05, .12, .06, { white: '#c8d8e0' })];
  for (let i = 0; i < 8; i++){
    const a = (i / 8) * Math.PI * 2;
    parts.push(paint(armTube(V(.55, Math.cos(a) * .05, Math.sin(a) * .06), V(1, Math.cos(a) * .15, Math.sin(a) * .2), .45, .035, .3, 1), col));
  }
  for (const s of [-1, 1]) parts.push(paint(tube([V(.55, 0, s * .03), V(1.1, -.05, s * .08), V(1.5, -.02, s * .14)], t => (t > .85 ? .03 : .012), { seg: 14, radial: 5 }), col));
  return merge(parts);
}

/* ---------- crustaceans ---------- */
// walking legs fanned out like a real crustacean's: the front ones reach forward, the back ones back
function legs(xs, y, z, len, color, drop = .25, knee = .12){
  const out = [], n = xs.length;
  xs.forEach((x, i) => {
    const a = (n > 1 ? i / (n - 1) - .5 : 0) * 1.3;
    for (const s of [-1, 1]){
      const k = V(x + Math.sin(a) * len * .45, y + knee, s * (z + Math.cos(a) * len * .45));
      const f = V(x + Math.sin(a) * len, y - drop, s * (z + Math.cos(a) * len * .85));
      out.push(solid(tube([V(x, y, s * z), k, f], t => .02 * (1 - t * .5), { seg: 8, radial: 4 }), color));
    }
  });
  return out;
}
function lobsterGeometry(slipper){
  const base = C(slipper ? '#8a5a34' : '#a8402a'), spot = C('#f0d890'), band = C(slipper ? '#5e3a20' : '#6e2418');
  const col = (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) < .18) o.lerp(spot, .8); return o; };
  const parts = [];
  if (slipper){
    parts.push(paint(xf(new THREE.SphereGeometry(1, 16, 8), { p: [.25, 0, 0], s: [.55, .16, .4] }), col));
    for (const s of [-1, 1]) parts.push(solid(xf(new THREE.SphereGeometry(1, 8, 4), { p: [.85, 0, s * .2], s: [.22, .04, .16] }), '#9a6a40'));
  } else {
    parts.push(paint(xf(new THREE.SphereGeometry(1, 16, 10), { p: [.3, 0, 0], s: [.55, .22, .24] }), col));
    for (const s of [-1, 1]) parts.push(solid(tube([V(.8, .08, s * .06), V(1.4, .3, s * .3), V(1.6, .1, s * .9), V(1.2, -.1, s * 1.4)], t => .04 * (1 - t) + .008, { seg: 30, radial: 5 }), '#b24a2e'));
  }
  // tail: segments, then the fan
  for (let i = 0; i < 5; i++){
    const x = -.3 - i * .2, r = (slipper ? .32 : .2) * (1 - i * .1);
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 6), { p: [x, -.02, 0], s: [.13, r * .7, r] }), (xx, yy, zz, o) => o.copy(i % 2 ? base : band)));
  }
  parts.push(solid(xf(shapeGeo([[-1.2, 0], [-1.5, .25], [-1.55, 0], [-1.5, -.25]]), { r: [Math.PI / 2, 0, 0] }), slipper ? '#7a4e2c' : '#c05a3a'));
  parts.push(...legs([.1, .25, .4, .55], -.12, .2, .45, slipper ? '#6a4426' : '#c86a3c'));
  parts.push(eyes(.85, .14, .08, .035));
  return merge(parts);
}
function hermitGeometry(){
  const parts = [];
  // a whelk-like shell: whorls shrinking toward the tip, banded
  for (let i = 0; i < 5; i++){
    const k = 1 - i * .19, a = i * 1.1;
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [-.18 - i * .17, .28 + i * .16, Math.sin(a) * .05], s: [.4 * k, .3 * k, .32 * k] }),
      (x, y, z, o) => o.set('#ddc9a2').lerp(C('#9a7a4c'), frac(y * 9 + x * 3) < .3 ? .6 : 0)));
  }
  parts.push(solid(xf(new THREE.ConeGeometry(.07, .22, 6), { p: [-1.02, 1.0, 0], r: [0, 0, .8] }), '#c8b48a'));
  parts.push(paint(xf(new THREE.SphereGeometry(1, 10, 8), { p: [.22, .12, 0], s: [.2, .17, .2] }), (x, y, z, o) => o.set('#c8352a')));
  for (const s of [-1, 1]) parts.push(solid(xf(new THREE.SphereGeometry(1, 8, 6), { p: [.45, .02, s * .14], s: [.2, .11, .1], r: [0, s * .3, 0] }), '#d8402e'));
  parts.push(...legs([.05, .2, .3], 0, .14, .45, '#c8402e', .2));
  parts.push(eyes(.38, .26, .06, .03));
  // anemones riding on the shell
  for (const [x, y, z] of [[-.25, .58, .2], [-.45, .66, -.18]]){
    parts.push(solid(xf(new THREE.CylinderGeometry(.08, .1, .14, 8), { p: [x, y, z] }), '#e8b8a0'));
    for (let i = 0; i < 9; i++){ const a = i / 9 * Math.PI * 2; parts.push(solid(xf(new THREE.ConeGeometry(.018, .14, 4), { p: [x + Math.cos(a) * .07, y + .14, z + Math.sin(a) * .07], r: [Math.sin(a) * .5, 0, -Math.cos(a) * .5] }), '#f2d6c8')); }
  }
  return merge(parts);
}
function shrimpGeometry(){
  const red = C('#d8382c'), white = C('#ffffff');
  const pts = [V(-.9, -.15, 0), V(-.6, .05, 0), V(-.1, .12, 0), V(.4, .05, 0), V(.7, 0, 0)];
  const body = paint(tube(pts, t => .04 + .1 * Math.sin(Math.min(1, t * 1.2) * Math.PI * .6), { seg: 30, radial: 8 }), (x, y, z, o, f) => o.copy(red).lerp(white, Math.abs(Math.sin(f.a * 2)) > .93 ? .9 : 0));
  const parts = [body, solid(xf(shapeGeo([[-.9, -.15], [-1.15, .05], [-1.2, -.3]]), {}), '#e85a40')];
  for (const s of [-1, 1]) parts.push(solid(tube([V(.7, .02, s * .03), V(1.2, .3, s * .15), V(1.7, .1, s * .3), V(2, -.2, s * .4)], () => .006, { seg: 24, radial: 3 }), '#ffffff'));
  parts.push(...legs([-.1, .05, .2, .35], -.05, .05, .3, '#f0a090', .3));
  parts.push(eyes(.66, .1, .05, .03));
  return merge(parts);
}
function crabGeometry(){
  const base = C('#b8582e'), algae = C('#6a8a3a');
  const shell = paint(xf(new THREE.IcosahedronGeometry(1, 2), { s: [.45, .25, .4] }), (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 12), Math.round(y * 12), Math.round(z * 12)) < .2) o.lerp(algae, .8); return o; });
  const parts = [shell];
  for (let i = 0; i < 10; i++){ const a = hash(i, 1) * Math.PI * 2, b = hash(i, 2) * 1.2; parts.push(solid(xf(new THREE.ConeGeometry(.03, .1, 4), { p: [Math.cos(a) * .35 * Math.cos(b), .2 + Math.sin(b) * .05, Math.sin(a) * .32], r: [0, 0, 0] }), '#c86a3a')); }
  parts.push(...legs([-.25, -.1, .05, .2], -.05, .28, 1.05, '#c8683a', .35, .3));
  for (const s of [-1, 1]) parts.push(solid(xf(new THREE.SphereGeometry(1, 8, 6), { p: [.55, -.05, s * .25], s: [.18, .08, .07] }), '#d8783e'));
  parts.push(eyes(.42, .2, .08, .03));
  return merge(parts);
}

/* ---------- molluscs ---------- */
function nudibranchGeometry(m){
  const pt = m.paint, base = C(pt.base);
  const parts = [];
  if (m.style === 'doris'){
    const line = C(pt.line);
    parts.push(paint(xf(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI * .55), { s: [1, .35, .38] }), (x, y, z, o) => { o.copy(base); if (frac(Math.abs(z) * 9 + .2) < .22 && y > .02) o.copy(line); if (y < .03) o.set('#f2e8d0'); return o; }));
    for (const s of [-1, 1]) parts.push(solid(xf(new THREE.ConeGeometry(.04, .2, 6), { p: [.7, .38, s * .1], r: [0, 0, -.3] }), '#2a2a8a'));
    for (let i = 0; i < 8; i++){ const a = i / 8 * Math.PI * 2; parts.push(solid(xf(new THREE.ConeGeometry(.03, .18, 4), { p: [-.65 + Math.cos(a) * .08, .38, Math.sin(a) * .08], r: [Math.sin(a) * .7, 0, -Math.cos(a) * .7] }), pt.gill)); }
  } else {
    const tip = C(pt.tip);
    parts.push(paint(tube([V(-1, 0, 0), V(0, .05, 0), V(.8, .08, 0)], t => .04 + .07 * Math.sin(t * Math.PI * .9), { seg: 24, radial: 8 }), (x, y, z, o) => o.copy(base).lerp(C('#e8d0f0'), .25)));
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]){
      const x = -.7 + i * .15;
      for (let k = 0; k < 2; k++) parts.push(paint(xf(new THREE.ConeGeometry(.035, .32, 5), { p: [x + k * .06, .2, s * (.06 + k * .05)], r: [s * (.5 + k * .3), 0, .1] }), (xx, yy, zz, o) => o.copy(base).lerp(tip, smooth(.15, .35, yy))));
    }
    for (const s of [-1, 1]) parts.push(solid(tube([V(.8, .08, s * .03), V(1.05, .1, s * .12), V(1.25, .02, s * .2)], () => .015, { seg: 8, radial: 4 }), pt.base));
    for (const s of [-1, 1]) parts.push(solid(xf(new THREE.ConeGeometry(.025, .2, 5), { p: [.65, .25, s * .05], r: [0, 0, -.3] }), pt.tip));
  }
  return merge(parts);
}
function pinnaGeometry(){
  const parts = [];
  for (const s of [-1, 1]){
    const sh = new THREE.Shape(); sh.moveTo(0, -1); sh.quadraticCurveTo(.55, .1, .4, .9); sh.quadraticCurveTo(0, 1.15, -.4, .9); sh.quadraticCurveTo(-.55, .1, 0, -1);
    const g = new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: false, curveSegments: 10 });
    xf(g, { p: [0, .3, s * .06], r: [0, s * .18, 0] });
    parts.push(paint(g, (x, y, z, o) => o.set('#8a6a44').lerp(C('#c8a678'), frac((y + 1) * 6) < .3 ? .7 : 0)));
  }
  parts.push(solid(xf(new THREE.CylinderGeometry(.55, .65, .1, 14), { p: [0, -.6, 0] }), '#d8c8a0'));
  return merge(parts);
}

/* ---------- echinoderms ---------- */
function starGeometry(pt){
  const sh = new THREE.Shape();
  for (let i = 0; i <= 10; i++){ const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? .28 : 1; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: .08, bevelEnabled: true, bevelThickness: .08, bevelSize: .08, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const r = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) * (1 - r * .5) + r * r * .08); }
  const base = C(pt.base);
  return merge([paint(g, (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 18), Math.round(z * 18)) < .25) o.multiplyScalar(.75); return o; })]);
}
function urchinGeometry(m){
  const base = C(m.paint.base), parts = [];
  parts.push(paint(xf(new THREE.IcosahedronGeometry(.5, 2), { s: [1, .7, 1] }), (x, y, z, o) => { o.copy(base); if (m.long && hash(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) < .12) o.set('#3a6ad8'); return o; }));
  const ico = new THREE.IcosahedronGeometry(1, m.long ? 1 : 2), ip = ico.attributes.position, seen = new Set(), up = V(0, 1, 0), d = V(), q = new THREE.Quaternion();
  for (let i = 0; i < ip.count; i++){
    d.fromBufferAttribute(ip, i).normalize(); if (d.y < -.4) continue;
    const key = d.toArray().map(v => v.toFixed(2)).join(); if (seen.has(key)) continue; seen.add(key);
    const L = m.long ? 1.1 : .3, cone = new THREE.ConeGeometry(m.long ? .02 : .035, L, 4); cone.translate(0, L / 2 + .3, 0);
    q.setFromUnitVectors(up, d); cone.applyQuaternion(q); cone.scale(1, .75, 1);
    parts.push(solid(cone, m.long ? '#16161c' : '#5a3368'));
  }
  return merge(parts);
}
function holothurianGeometry(){
  const base = C('#5a3a28'), tip = C('#c8a07a');
  const parts = [paint(tube([V(-1, 0, 0), V(-.3, .05, .05), V(.4, .02, -.03), V(1, 0, 0)], t => .1 + .14 * Math.sin(t * Math.PI), { seg: 26, radial: 10 }), (x, y, z, o) => o.copy(base).lerp(C('#8a6a4a'), y < 0 ? .5 : 0))];
  for (let i = 0; i < 26; i++){ const x = -.85 + hash(i, 4) * 1.7, a = (hash(i, 5) - .5) * 2.2, r = .1 + .14 * Math.sin((x + 1) / 2 * Math.PI);
    parts.push(paint(xf(new THREE.ConeGeometry(.03, .1, 4), { p: [x, Math.cos(a) * r + .04, Math.sin(a) * r], r: [a, 0, 0] }), (xx, yy, zz, o) => o.copy(tip))); }
  return merge(parts);
}

/* ---------- cnidarians ---------- */
function jellyGeometry(m){
  const parts = [];
  if (m.style === 'egg'){
    parts.push(paint(xf(new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI * .5), { s: [.95, .3, .95] }), (x, y, z, o) => o.set('#e8d070').lerp(C('#f2e8b0'), Math.hypot(x, z) > .7 ? .7 : 0)));
    parts.push(solid(xf(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * .5), { p: [0, .2, 0], s: [.35, .2, .35] }), '#e89a2a'));
    for (let i = 0; i < 14; i++){ const a = i / 14 * Math.PI * 2, r = .15 + hash(i, 2) * .3;
      parts.push(solid(tube([V(Math.cos(a) * r, 0, Math.sin(a) * r), V(Math.cos(a) * r * 1.1, -.25, Math.sin(a) * r * 1.1), V(Math.cos(a) * r, -.45, Math.sin(a) * r)], () => .03, { seg: 6, radial: 5 }), '#f2e6c0'));
      parts.push(solid(xf(new THREE.IcosahedronGeometry(.055, 0), { p: [Math.cos(a) * r, -.5, Math.sin(a) * r] }), i % 3 ? '#7a6ad8' : '#ffffff')); }
  } else {
    parts.push(paint(xf(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI * .55), { s: [.6, .5, .6] }), (x, y, z, o) => { o.set('#c86aa8'); if (hash(Math.round(x * 16), Math.round(y * 16), Math.round(z * 16)) < .25) o.set('#8a2a6a'); return o; }));
    for (let i = 0; i < 8; i++){ const a = i / 8 * Math.PI * 2;
      parts.push(solid(tube([V(Math.cos(a) * .55, -.05, Math.sin(a) * .55), V(Math.cos(a) * .6, -.6, Math.sin(a) * .6), V(Math.cos(a) * .5, -1.3, Math.sin(a) * .55), V(Math.cos(a) * .55, -1.9, Math.sin(a) * .5)], () => .01, { seg: 16, radial: 3 }), '#e8a8d0')); }
    for (let i = 0; i < 4; i++){ const a = i / 4 * Math.PI * 2 + .4;
      parts.push(solid(tube([V(Math.cos(a) * .1, -.1, Math.sin(a) * .1), V(Math.cos(a) * .2, -.6, Math.sin(a) * .2), V(Math.cos(a) * .1, -1.1, Math.sin(a) * .15)], t => .05 * (1 - t) + .01, { seg: 14, radial: 5 }), '#b04a90')); }
  }
  return merge(parts);
}
function gorgonianGeometry(){
  const parts = [], red = C('#c0283a'), tip = C('#e8b23c'); let seed = 4242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const branch = (start, angle, len, r, depth, lvl) => {
    const dir = V(Math.sin(angle), Math.cos(angle), (rand() - .5) * .15).normalize(), end = start.clone().addScaledVector(dir, len);
    parts.push(paint(tube([start, start.clone().lerp(end, .5), end], t => r * (1 - t * .3), { seg: 3, radial: 5, cap: false }), (x, y, z, o, f) => o.copy(red).lerp(tip, depth === 0 ? smooth(.3, 1, f.t) : 0)));
    if (depth > 0){ const n = depth > 4 ? 2 : rand() > .35 ? 2 : 3; for (let i = 0; i < n; i++) branch(end, angle * .85 + (rand() - .5) * .7 + (i - (n - 1) / 2) * .55, len * (.68 + rand() * .18), r * .74, depth - 1, lvl + 1); }
  };
  branch(V(0, -1.1, 0), 0, .45, .07, 6, 0);
  parts.push(solid(xf(new THREE.IcosahedronGeometry(.25, 1), { p: [0, -1.15, 0], s: [1.3, .5, 1] }), '#6a6a60'));
  return merge(parts);
}
function anemoneGeometry(){
  const parts = [solid(xf(new THREE.CylinderGeometry(.35, .42, .3, 12), { p: [0, -.3, 0] }), '#7a5a3a')];
  for (let i = 0; i < 46; i++){
    const a = i * 2.39996, r = .08 + .3 * Math.sqrt(i / 46), out = V(Math.cos(a), 0, Math.sin(a));
    const pts = [V(out.x * r, -.15, out.z * r), V(out.x * (r + .15), .2, out.z * (r + .15)), V(out.x * (r + .35), .45 + hash(i, 1) * .2, out.z * (r + .35))];
    parts.push(paint(tube(pts, t => .035 * (1 - t * .6), { seg: 8, radial: 5 }), (x, y, z, o, f) => o.set('#7a9a5a').lerp(C('#c84ab0'), smooth(.7, 1, f.t))));
  }
  return merge(parts);
}
function coralGeometry(){
  const parts = [paint(xf(new THREE.IcosahedronGeometry(1, 2), { p: [0, -.6, 0], s: [1.1, .5, .8] }), (x, y, z, o) => o.set('#5a5a54').multiplyScalar(.8 + .4 * hash(Math.round(x * 6), Math.round(y * 6), Math.round(z * 6))))];
  for (let i = 0; i < 26; i++){
    const a = i * 2.39996, r = .9 * Math.sqrt(i / 26), x = Math.cos(a) * r, z = Math.sin(a) * r * .7, y = -.6 + .5 * Math.sqrt(Math.max(0, 1 - (x / 1.1) ** 2 - (z / .8) ** 2));
    parts.push(solid(xf(new THREE.CylinderGeometry(.09, .07, .22, 8), { p: [x, y + .08, z] }), '#ef7a1e'));
    for (let k = 0; k < 6; k++){ const b = k / 6 * Math.PI * 2; parts.push(solid(xf(new THREE.ConeGeometry(.015, .08, 3), { p: [x + Math.cos(b) * .06, y + .23, z + Math.sin(b) * .06] }), '#ffc24a')); }
  }
  return merge(parts);
}

/* ---------- turtle ---------- */
function turtleGeometry(){
  const shellC = C('#8a4a24'), plate = C('#b0662e');
  const shell = paint(xf(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * .5), { s: [1, .42, .78] }), (x, y, z, o) => o.copy(shellC).lerp(plate, (Math.floor(x * 3.2) + Math.floor(z * 3.2 + 10)) % 2 ? .65 : 0));
  const plastron = solid(xf(new THREE.SphereGeometry(1, 16, 6), { p: [0, -.02, 0], s: [.95, .08, .74] }), '#e6c890');
  const head = paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [1.15, .08, 0], s: [.3, .2, .2] }), (x, y, z, o) => o.set('#a8642e').lerp(C('#e2c48a'), y < .05 ? .8 : 0));
  // paddles drawn in x/y and laid flat (y becomes z); the left ones are mirrored
  const paddle = (pts, x, z, side) => solid(xf(shapeGeo(pts.map(([px, py]) => [px, py * side])), { p: [x, -.01, z * side], r: [Math.PI / 2, 0, 0] }), '#9a5a2a');
  const front = [[0, 0], [.15, .35], [-.2, .95], [-.5, 1.05], [-.35, .55], [-.25, .1]], back = [[0, 0], [-.05, .3], [-.35, .38], [-.42, .2], [-.25, 0]];
  const flips = [paddle(front, .45, .55, 1), paddle(front, .45, .55, -1), paddle(back, -.6, .5, 1), paddle(back, -.6, .5, -1)];
  return merge([shell, plastron, head, eyes(1.32, .14, .12, .04), ...flips]);
}

/* ---------- entry point ---------- */
export const VIEWS = { side: [.35, .18], top: [.25, .95], high: [.4, .55], front: [.9, .15], face: [.15, .12] };
export function viewFor(spec){
  const k = spec.model.kind;
  if (['ray', 'flatfish', 'star', 'crab'].includes(k)) return 'top';
  if (['urchin', 'holothurian', 'nudibranch', 'octopus', 'turtle', 'coral', 'hermit', 'anemone', 'cuttlefish', 'lobster'].includes(k)) return 'high';
  if (['pinna', 'gorgonian'].includes(k)) return 'face';
  if (['jelly', 'seahorse'].includes(k)) return 'front';
  return 'side';
}
const BUILDERS = {
  fish: s => fishGeometry(s.model.shape, s.model.paint),
  flatfish: s => flatfishGeometry(s.model.paint),
  eel: s => eelGeometry(s),
  seahorse: s => seahorseGeometry(s.model.paint),
  ray: s => rayGeometry(s.model),
  octopus: () => octopusGeometry(),
  cuttlefish: () => cuttlefishGeometry(),
  squid: () => squidGeometry(),
  lobster: s => lobsterGeometry(s.model.slipper),
  hermit: () => hermitGeometry(),
  shrimp: () => shrimpGeometry(),
  crab: () => crabGeometry(),
  nudibranch: s => nudibranchGeometry(s.model),
  pinna: () => pinnaGeometry(),
  star: s => starGeometry(s.model.paint),
  urchin: s => urchinGeometry(s.model),
  holothurian: () => holothurianGeometry(),
  jelly: s => jellyGeometry(s.model),
  gorgonian: () => gorgonianGeometry(),
  anemone: () => anemoneGeometry(),
  coral: () => coralGeometry(),
  turtle: () => turtleGeometry(),
};
const cache = new Map();
export function buildGeometry(spec){
  if (!cache.has(spec.id)){
    const g = BUILDERS[spec.model.kind](spec);
    g.computeBoundingSphere();
    const c = g.boundingSphere.center; g.translate(-c.x, -c.y, -c.z);
    g.computeBoundingSphere();
    cache.set(spec.id, g);
  }
  return cache.get(spec.id);
}
