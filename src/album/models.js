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
function eyes(x, y, z, size, { white = '#f4f1e8', pupil = '#0c0c0e', iris = null, up = false } = {}){
  const out = [];
  for (const s of [-1, 1]){
    out.push(solid(xf(new THREE.IcosahedronGeometry(size, 1), { p: [x, y, s * z] }), white));
    const d = up ? [.01, size * .55, 0] : [size * .15, 0, s * size * .62];
    if (iris) out.push(solid(xf(new THREE.IcosahedronGeometry(size * .72, 1), { p: [x + d[0] * .8, y + d[1] * .8, s * z + d[2] * .8] }), iris));
    out.push(solid(xf(new THREE.IcosahedronGeometry(size * .55, 1), { p: [x + d[0], y + d[1], s * z + d[2]] }), pupil));
    const g = up ? [size * .2, size * .95, size * .2] : [size * .32, size * .3, s * size * .9];
    out.push(solid(xf(new THREE.IcosahedronGeometry(size * .2, 0), { p: [x + g[0], y + g[1], s * z + g[2]] }), '#ffffff'));
  }
  return out;
}

/* ---------- fish: an ellipsoid shaped by a side profile, plus fins, eyes, mouth and painted marks ----------
 * shape: h/w body height/width · c where it is tallest · headPow/tailPow how blunt the head / thin the tail
 *        back/belly stretch the upper / lower half · snout lengthens the head · tail fork|lyre|round|truncate|shark|clavus|fluke
 *        dorsal/dorsal2/anal [x0, x1, height, 'spiky'|'soft'|'dolphin'] · pect size (default on) · pelvic · eye size · eyeY height
 *        mouth 'small'|'big'|'lips'|'beak'|'jaw'|'up'|'none' · teeth · barbels · tentacles · spines (on the head) · beak (dolphin rostrum)
 * paint: top/bottom body colours, fin, finEdge (outer edge of the fins), pelvicFin/analFin overrides, marks (see species.js) */
function fishGeometry(s, pt){
  const h = s.h, w = s.w, c = s.c ?? .15, snout = s.snout || 0, back = s.back ?? 1, belly = s.belly ?? 1;
  // a real fish narrows into a slim tail stem before the caudal fin, and its head is a little pointed
  const stem = s.stem ?? .17;
  const prof = x => {
    if (x >= c) return Math.pow(Math.max(0, 1 - ((x - c) / (1 - c)) ** 2), s.headPow ?? .62);
    const t = (c - x) / (1 + c);
    if (s.tailPow != null) return Math.pow(Math.max(0, 1 - t * t), s.tailPow);
    // full body to mid-length, then a clear taper into the slim tail stem
    const e = Math.sqrt(Math.max(0, 1 - t * t)), k = smooth(.42, .9, t);
    return t > .985 ? 0 : e * (1 - k) + stem * k * (1 - smooth(.94, .985, t));
  };
  const unstretch = x => (x > .5 ? .5 + (x - .5) / (1 + snout) : x);
  const stretch = x => (x > .5 ? x + (x - .5) * snout : x);
  const topAt = x => h * prof(x) * back, botAt = x => -h * prof(x) * belly;
  const col = v => (typeof v === 'string' && v[0] === '#' ? C(v) : v);
  const top = C(pt.top), bottom = C(pt.bottom), finC = C(pt.fin), edgeC = pt.finEdge ? C(pt.finEdge) : null;
  const marks = (pt.marks || []).map(m => m.map(col));
  const paintBody = (x, y, z, o) => {
    const xb = unstretch(x), pn = Math.max(prof(xb), .18), yn = y > 0 ? y / (h * pn * back) : y / (h * pn * belly);
    o.copy(bottom).lerp(top, smooth(-.3, .5, yn));
    for (const m of marks){
      const k = m[0];
      if (k === 'vband' && xb > m[1] && xb < m[2]) o.lerp(m[3], .92);
      else if (k === 'vbars' && xb > m[3] && xb < m[4] && yn > (m[5] ?? -2) && frac((xb - m[3]) / (m[4] - m[3]) * m[1]) < .42) o.lerp(m[2], .8);
      else if (k === 'hstripes' && Math.abs(yn) < .9 && frac((yn + 1) / 2 * m[1]) < (m[3] ?? .3)) o.lerp(m[2], .85);
      else if (k === 'hband' && yn > m[1] && yn < m[2] && xb < (m[4] ?? 2)) o.lerp(m[3], .9);
      else if (k === 'spots' && hash(Math.round(x * (m[3] || 30)), Math.round(y * (m[3] || 30)), Math.round(z * (m[3] || 30))) < m[1]) o.lerp(m[2], .85);
      else if (k === 'patch' && Math.hypot((xb - m[1]) * 1.2, (yn - m[2]) * .5) < m[3]) o.lerp(m[4], .95);
      else if (k === 'zigzag' && Math.abs(yn - (m[2] ?? .05) - Math.abs(frac(xb * (m[3] ?? 3)) - .5) * .5) < (m[4] ?? .14) && xb < .55) o.lerp(m[1], .9);
      else if (k === 'eyestripe' && Math.abs((yn - .25) - (xb - .62) * (m[2] ?? 1.6)) < (m[3] ?? .16) && xb > .2) o.lerp(m[1], .85);
      else if (k === 'headlines' && xb > .5 && frac((yn + xb * .8) * (m[2] ?? 4)) < .25) o.lerp(m[1], .85);
      else if (k === 'belly' && yn < m[2]) o.lerp(m[1], .85);
      else if (k === 'back' && yn > m[2]) o.lerp(m[1], .85);
    }
    return o;
  };
  const parts = [];
  const body = new THREE.SphereGeometry(1, s.smooth ? 30 : 26, s.smooth ? 18 : 16);
  { const p = body.attributes.position;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), r0 = Math.sqrt(Math.max(0, 1 - x * x)), k = r0 > 1e-4 ? prof(x) / r0 : 0, y = p.getY(i);
      p.setY(i, y * k * h * (y > 0 ? back : belly)); p.setZ(i, p.getZ(i) * k * w);
      p.setX(i, stretch(x));
    } }
  parts.push(paint(body, paintBody));
  // fins: own colour, a lighter or darker outer edge where the species has one
  const finPaint = (g, color = finC, edgeFrom = null) => paint(g, (x, y, z, o) => {
    o.copy(color);
    if (edgeC && edgeFrom && edgeFrom(x, y)) o.copy(edgeC);
    return o;
  });
  const th = Math.max(.15, h * 1.15) * (s.tailH ?? 1);
  const tails = {
    fork: [[-.86, 0], [-1.5, th], [-1.32, 0], [-1.5, -th]],
    lyre: [[-.86, 0], [-1.9, th * 1.3], [-1.35, 0], [-1.9, -th * 1.3]],
    truncate: [[-.86, 0], [-1.38, th], [-1.44, 0], [-1.38, -th]],
    shark: [[-.86, .02], [-1.78, th * 1.15], [-1.58, .03], [-1.3, -th * .55]],
  };
  const tailEdge = (x, y) => x < -1.3;
  const tailC = pt.tailFin ? C(pt.tailFin) : finC;
  if (tails[s.tail]) parts.push(finPaint(shapeGeo(tails[s.tail]), tailC, tailEdge));
  else if (s.tail === 'round'){ const sh = new THREE.Shape(); sh.moveTo(-.86, 0); sh.lineTo(-1.2, th * .85); sh.quadraticCurveTo(-1.6, 0, -1.2, -th * .85); sh.lineTo(-.86, 0); parts.push(finPaint(new THREE.ShapeGeometry(sh, 8), tailC, (x) => x < -1.33)); }
  else if (s.tail === 'clavus'){ const sh = new THREE.Shape(); sh.moveTo(-.9, h * .75); sh.quadraticCurveTo(-1.3, 0, -.9, -h * .75); sh.lineTo(-.9, h * .75); parts.push(finPaint(new THREE.ShapeGeometry(sh, 8), tailC)); }
  else if (s.tail === 'fluke') parts.push(finPaint(xf(shapeGeo([[-.82, 0], [-1.42, .42], [-1.26, 0], [-1.42, -.42]]), { r: [Math.PI / 2, 0, 0] })));
  const fin = (spec, sign = 1, color = finC) => {
    if (!spec) return;
    const [x0, x1, fh, kind] = spec, base = x => (sign > 0 ? topAt(x) : botAt(x)) * .92;
    let pts;
    if (kind === 'spiky'){
      pts = [[x0, base(x0)]]; const n = Math.max(4, Math.round((x1 - x0) * 10));
      for (let i = 0; i <= n; i++){ const x = x0 + (x1 - x0) * i / n; pts.push([x - .02, base(x) + sign * fh * (i % 2 ? .55 : 1) * (1 - .25 * i / n)]); }
      pts.push([x1, base(x1)]);
    } else if (kind === 'dolphin') pts = [[x1, base(x1)], [x0 - .05, base(x0) + sign * fh], [x0 + (x1 - x0) * .3, base(x0) + sign * fh * .7], [x0, base(x0)]];
    else pts = [[x0, base(x0)], [x0 + (x1 - x0) * .3, base(x0) + sign * fh], [x1, base(x1) + sign * fh * .45], [x1, base(x1)]];
    const lim = (x0 + x1) / 2;
    parts.push(finPaint(shapeGeo(pts), color, (x, y) => Math.abs(y) > Math.abs(base(Math.max(x0, Math.min(x1, x)))) + fh * .6));
  };
  fin(s.dorsal, 1, pt.dorsalFin ? C(pt.dorsalFin) : finC); fin(s.dorsal2); fin(s.anal, -1, pt.analFin ? C(pt.analFin) : finC);
  // pectoral fins on the flanks (every fish has them unless told otherwise)
  const ps = s.pect ?? Math.min(.26, .12 + h * .3);
  if (ps > 0){
    const px = .32, py = -h * .2, pz = w * prof(px) * .95 + .012;
    for (const sz of [-1, 1]) parts.push(finPaint(xf(shapeGeo([[0, 0], [-ps * 1.3, ps * .55], [-ps * 1.15, -ps * .3]]), { p: [px, py, sz * pz], r: [0, sz * .4, -.3] }), pt.pectFin ? C(pt.pectFin) : finC));
  }
  if (s.pelvic) for (const sz of [-1, 1]) parts.push(finPaint(xf(shapeGeo(s.pelvic === 'long' ? [[0, 0], [-.06, -h * 1.15], [-.14, -h * .2]] : [[0, 0], [-.1, -h * .45], [-.2, -h * .1]]), { p: [.3, botAt(.3) * .85, sz * w * .35] }), pt.pelvicFin ? C(pt.pelvicFin) : finC));
  // head details
  const nose = stretch(1), mouthY = s.mouth === 'up' ? h * .05 : -h * .12;
  const mouthColor = pt.mouth || '#2a1a16';
  if (s.mouth !== 'none' && !s.beak){
    // a small dark slit at the front of the head, wider for big-mouthed fish
    const big = s.mouth === 'big' ? 1.5 : s.mouth === 'lips' ? 1.25 : 1;
    parts.push(solid(xf(new THREE.SphereGeometry(1, 8, 5), { p: [nose - .035, mouthY, 0], s: [.04 * big, .014 * big, Math.max(.03, w * .42) * big] }), mouthColor));
    if (s.mouth === 'lips') parts.push(solid(xf(new THREE.TorusGeometry(.05, .022, 5, 8), { p: [nose - .01, mouthY, 0], r: [0, Math.PI / 2, 0], s: [1, .7, Math.max(1, w * 6)] }), pt.lips || pt.bottom));
    if (s.mouth === 'beak') parts.push(solid(xf(new THREE.ConeGeometry(.06, .1, 5), { p: [nose + .02, mouthY + .01, 0], r: [0, 0, -Math.PI / 2] }), '#f2ede0'));
    if (s.mouth === 'jaw') parts.push(solid(xf(new THREE.ConeGeometry(.04, .14, 4), { p: [nose + .04, mouthY - .03, 0], r: [0, 0, -Math.PI / 2 - .15] }), pt.bottom));
  }
  if (s.teeth) for (let i = 0; i < 3; i++) parts.push(solid(xf(new THREE.ConeGeometry(.012, .04, 3), { p: [nose - .06 + i * .02, mouthY + .015, w * .2 * (i % 2 ? 1 : -1)], r: [Math.PI, 0, 0] }), '#ffffff'));
  if (s.barbels) for (const sz of [-1, 1]) parts.push(solid(tube([V(nose - .06, botAt(.9) * .7, sz * .03), V(nose - .1, botAt(.9) - .12, sz * .05), V(nose - .16, botAt(.9) - .26, sz * .06)], () => .012, { seg: 6, radial: 4 }), pt.barbel || '#f2e6cf'));
  if (s.tentacles) for (const sz of [-1, 1]) for (let i = 0; i < 2; i++) parts.push(solid(xf(new THREE.ConeGeometry(.022, .14 - i * .04, 4), { p: [stretch(.6) + i * .03, topAt(.6) * .95 + .04, sz * (.05 + i * .02)], r: [sz * .3, 0, -.25] }), pt.fin));
  if (s.spines) for (let i = 0; i < 6; i++){ const x = stretch(.45 + i * .07); parts.push(solid(xf(new THREE.ConeGeometry(.02, .06, 3), { p: [x, topAt(.45 + i * .07) * .9, (i % 2 ? 1 : -1) * w * .35], r: [(i % 2 ? 1 : -1) * .6, 0, 0] }), pt.fin)); }
  // eyes: big and round, with a glint, for the friendly look
  const ex = s.eyeX ?? .62, es = .085 * (s.eye ?? 1) * Math.min(1, Math.max(.5, h / .35));
  if (s.eyeUp) parts.push(eyes(stretch(ex) - .05, topAt(ex) * .85, .05, es * .9, { up: true, iris: pt.iris }));
  else {
    const ey = topAt(ex) * (s.eyeY ?? .3), ez = w * prof(ex) * Math.sqrt(Math.max(0, 1 - (s.eyeY ?? .3) ** 2)) * .92;
    parts.push(eyes(stretch(ex), ey, ez, es, { iris: pt.iris }));
  }
  if (s.beak){
    // dolphin: a short rostrum under a rounded melon
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [nose - .02, -h * .32, 0], s: [.16, h * .2, w * .28] }), (x, y, z, o) => o.copy(bottom).lerp(top, smooth(-.05, .08, y + h * .3))));
    parts.push(paint(xf(new THREE.SphereGeometry(1, 14, 10), { p: [nose - .2, h * .06, 0], s: [.2, h * .5, w * .62] }), (x, y, z, o) => o.copy(bottom).lerp(top, smooth(-.3, .3, y / h))));
  }
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
  const pts = [V(-1.5, -.3, .05), V(-1, .05, .15), V(-.4, -.2, -.05), V(.2, .06, 0), V(.72, .26, 0), V(1.15, .33, 0)];
  const r = t => (conger ? .13 : .15) * (t < .8 ? .18 + .82 * smooth(0, .45, t) : 1 - (t - .8) / .2 * .55);
  const base = C(pt.base), spot = pt.spot && C(pt.spot), belly = pt.belly && C(pt.belly);
  const body = paint(tube(pts, r, { seg: 80, radial: 10 }), (x, y, z, o, f) => {
    o.copy(base);
    if (belly && Math.sin(f.a) < -.25) o.copy(belly);
    // the moray's marbling: pale yellow blotches on dark brown, finer toward the head
    if (spot && hash(Math.round(x * 22), Math.round(y * 22), Math.round(z * 22)) < .38) o.lerp(spot, .9);
    return o;
  });
  const parts = [body];
  // a fin fold along the back (the conger's edged in black)
  const curve = new THREE.CatmullRomCurve3(pts), N = 40, rp = [];
  for (let i = 0; i < N; i++){
    const t0 = .04 + .72 * i / N, t1 = .04 + .72 * (i + 1) / N, a = curve.getPointAt(t0), b = curve.getPointAt(t1), ra = r(t0), rb = r(t1), fa = ra + .06, fb = rb + .06;
    rp.push(a.x, a.y + ra * .8, a.z, b.x, b.y + rb * .8, b.z, a.x, a.y + fa, a.z, b.x, b.y + rb * .8, b.z, b.x, b.y + fb, b.z, a.x, a.y + fa, a.z);
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  parts.push(paint(rg, (x, y, z, o) => o.copy(conger ? C(pt.base) : base).lerp(C(pt.fin || pt.base), conger ? .7 : 0)));
  const head = curve.getPointAt(.92), tip = curve.getPointAt(1);
  parts.push(eyes(head.x, head.y + .07, .07, .035, { white: conger ? '#e8ebe6' : '#f0e2a8', iris: conger ? null : '#c8a040' }));
  if (!conger){
    // open mouth with a few teeth, and the tube nostrils on the snout
    parts.push(solid(xf(new THREE.ConeGeometry(.055, .2, 6), { p: [tip.x + .02, tip.y - .03, 0], r: [0, 0, -Math.PI / 2 - .3] }), '#3a1a14'));
    for (let i = 0; i < 4; i++) parts.push(solid(xf(new THREE.ConeGeometry(.01, .04, 3), { p: [tip.x - .04 + i * .025, tip.y - .015, (i % 2 ? 1 : -1) * .03], r: [Math.PI, 0, 0] }), '#ffffff'));
    for (const s of [-1, 1]) parts.push(solid(xf(new THREE.CylinderGeometry(.008, .012, .05, 4), { p: [tip.x + .02, tip.y + .05, s * .03], r: [0, 0, -.6] }), pt.base));
  } else parts.push(solid(xf(new THREE.SphereGeometry(1, 8, 6), { p: [tip.x, tip.y - .02, 0], s: [.05, .025, .05] }), '#2a2a2a'));
  return merge(parts);
}
/* ---------- seahorse ---------- */
function seahorseGeometry(pt){
  const base = C(pt.base), spot = C(pt.spot), ring = C(pt.base).multiplyScalar(.75);
  const pts = [V(.26, -1.1, 0), V(.12, -1.22, 0), V(-.02, -1.1, 0), V(.02, -.92, 0), V(.12, -.64, 0), V(.06, -.3, 0), V(.02, .04, 0), V(.08, .32, 0), V(.18, .5, 0)];
  const r = t => (t < .35 ? .022 + .075 * smooth(0, .35, t) : t < .7 ? .097 + .075 * Math.sin((t - .35) / .35 * Math.PI) : .1 - .04 * (t - .7) / .3);
  // bony rings along the body, white dots, a curly tail
  const col = (x, y, z, o, f) => { o.copy(base); if (f && frac(f.t * 34) < .25) o.copy(ring); if (hash(Math.round(x * 28), Math.round(y * 28), Math.round(z * 28)) < .2) o.lerp(spot, .9); return o; };
  const parts = [paint(tube(pts, r, { seg: 60, radial: 9 }), col)];
  parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 9), { p: [.24, .57, 0], s: [.17, .13, .1] }), col));
  parts.push(paint(tube([V(.32, .54, 0), V(.5, .5, 0), V(.66, .46, 0)], t => .028 + (t > .85 ? .016 : 0), { seg: 10, radial: 6 }), col));
  parts.push(solid(xf(shapeGeo([[0, 0], [-.17, .13], [-.21, -.08]]), { p: [.0, -.05, 0] }), pt.base));
  // coronet and the skin filaments of the mane
  for (let i = 0; i < 5; i++) parts.push(solid(xf(new THREE.ConeGeometry(.018, .08, 4), { p: [.16 + i * .025, .71 - Math.abs(i - 2) * .01, (i - 2) * .012], r: [0, 0, -.2 + (i - 2) * .1] }), pt.base));
  for (let i = 0; i < 9; i++){
    const t = .5 + i * .05, P = new THREE.CatmullRomCurve3(pts).getPointAt(Math.min(.98, t));
    parts.push(solid(tube([V(P.x - .06, P.y, 0), V(P.x - .13, P.y + .04, .01), V(P.x - .17, P.y + .1, .02)], () => .007, { seg: 5, radial: 3 }), pt.spot));
  }
  parts.push(eyes(.28, .61, .085, .032, { iris: '#c89040' }));
  return merge(parts);
}
/* ---------- rays and the angel shark, flat on the sand ---------- */
function rayGeometry(m){
  if (m.shape === 'angel') return angelSharkGeometry(m.paint);
  const pt = m.paint, top = C(pt.top), edge = C(pt.edge), spot = pt.spot && C(pt.spot);
  // outlines: a rhombus with pointed wing tips for the stingray, a wide diamond for the butterfly ray, a disc for the torpedo
  const sup = (th, front, back, side, p) => { const c = Math.cos(th), s = Math.sin(th), k = 1 / Math.pow(Math.abs(c) ** p + Math.abs(s) ** p, 1 / p); return [k * (c > 0 ? front : back) * c, k * side * s]; };
  const shapes = { sting: th => sup(th, .62, .62, .88, 1.25), butterfly: th => { const [x, z] = sup(th, .46, .3, 1.3, 1.2); return [x - .3 * Math.abs(z / 1.3) ** 1.5, z]; }, torpedo: th => [.6 * Math.cos(th), .58 * Math.sin(th)] };
  const f = shapes[m.shape];
  const RINGS = 7, SEG = 32, verts = [0, .13, 0], idx = [];
  for (let r = 1; r <= RINGS; r++) for (let i = 0; i < SEG; i++){
    const th = i / SEG * Math.PI * 2, k = r / RINGS, [x, z] = f(th);
    verts.push(x * k, (m.shape === 'torpedo' ? .17 : .13) * (1 - k * k) + (m.shape === 'torpedo' ? 0 : .03 * Math.sin(k * Math.PI) * Math.abs(Math.sin(th))), z * k);
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + (i + 1) % SEG, 1 + i);
  for (let r = 1; r < RINGS; r++) for (let i = 0; i < SEG; i++){ const a = 1 + (r - 1) * SEG + i, b = 1 + (r - 1) * SEG + (i + 1) % SEG; idx.push(a, b, a + SEG, b, b + SEG, a + SEG); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx);
  const parts = [paint(g, (x, y, z, o) => {
    const k = Math.min(1, Math.hypot(x / .6, z / 1)); o.copy(top).lerp(edge, k * k);
    if (spot && hash(Math.round(x * 16), Math.round(z * 16)) < .32) o.lerp(spot, .7);
    return o;
  })];
  if (m.shape === 'torpedo'){
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 8), { p: [-.75, .04, 0], s: [.42, .09, .12] }), (x, y, z, o) => o.copy(top)));
    parts.push(solid(shapeGeo([[-1.05, 0], [-1.38, .24], [-1.42, -.2]]), pt.top), solid(shapeGeo([[-.6, .11], [-.7, .27], [-.78, .11]]), pt.top), solid(shapeGeo([[-.82, .1], [-.9, .22], [-.97, .1]]), pt.top));
  } else {
    const L = m.shape === 'sting' ? 1.6 : .5, x0 = m.shape === 'sting' ? -.55 : -.26;
    parts.push(solid(tube([V(x0, .03, 0), V(x0 - L * .5, .04, .06), V(x0 - L, .02, .12)], t => .035 * (1 - t) + .006, { seg: 12, radial: 5 }), pt.top));
    parts.push(solid(xf(new THREE.ConeGeometry(.014, .22, 4), { p: [x0 - L * .45, .07, .05], r: [0, 0, Math.PI / 2] }), '#e8dcc0'));
  }
  // eyes and spiracles on top
  parts.push(eyes(.24, .15, .11, .038, { up: true }));
  for (const s of [-1, 1]) parts.push(solid(xf(new THREE.SphereGeometry(1, 6, 4), { p: [.12, .14, s * .12], s: [.03, .01, .02] }), '#2a241c'));
  return merge(parts);
}
function angelSharkGeometry(pt){
  const top = C(pt.top), edge = C(pt.edge), spot = C(pt.spot);
  const col = (x, y, z, o) => { o.copy(top).lerp(edge, Math.min(1, Math.abs(z) * 1.3)); if (hash(Math.round(x * 18), Math.round(z * 18), 2) < .2) o.lerp(spot, .85); return o; };
  const flat = pts => paint(xf(shapeGeo(pts), { p: [0, .04, 0], r: [Math.PI / 2, 0, 0] }), col);
  const parts = [paint(xf(new THREE.SphereGeometry(1, 20, 10), { p: [-.35, 0, 0], s: [.95, .11, .26] }), col)];
  parts.push(paint(xf(new THREE.SphereGeometry(1, 14, 8), { p: [.42, 0, 0], s: [.22, .1, .3] }), col));
  for (const s of [-1, 1]){
    // the big pectoral "wings" and the pelvic fins behind them, flat on the sand
    parts.push(flat([[.38, .2 * s], [.12, .82 * s], [-.22, .74 * s], [-.32, .24 * s]]));
    parts.push(flat([[-.42, .18 * s], [-.55, .48 * s], [-.75, .4 * s], [-.72, .14 * s]]));
  }
  parts.push(solid(shapeGeo([[-.95, .08], [-1.05, .26], [-1.12, .08]]), pt.top), solid(shapeGeo([[-1.17, .06], [-1.25, .2], [-1.3, .06]]), pt.top));
  parts.push(solid(shapeGeo([[-1.28, .02], [-1.62, .22], [-1.52, .02], [-1.6, -.12]]), pt.top));
  parts.push(eyes(.4, .1, .1, .035, { up: true }));
  for (const s of [-1, 1]) parts.push(solid(tube([V(.62, -.02, s * .05), V(.67, -.06, s * .06), V(.7, -.1, s * .07)], () => .008, { seg: 4, radial: 3 }), pt.edge));
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
  const top = C('#e2683f'), belly = C('#ffc29c'), spot = C('#b8452a'), sucker = C('#ffe2cc');
  const col = (x, y, z, o) => { o.copy(belly).lerp(top, smooth(-.3, .3, y)); if (y > .15 && hash(Math.round(x * 11), Math.round(y * 11), Math.round(z * 11)) > .82) o.lerp(spot, .8); return o; };
  const parts = [paint(xf(new THREE.IcosahedronGeometry(1, 3), { p: [0, .55, 0], s: [.52, .62, .5] }), col)];
  // warts on the mantle
  for (let i = 0; i < 14; i++){ const a = hash(i, 1) * Math.PI * 2, b = .2 + hash(i, 2) * 1.1; parts.push(solid(xf(new THREE.IcosahedronGeometry(.035, 0), { p: [Math.cos(a) * Math.sin(b) * .52, .55 + Math.cos(b) * .62, Math.sin(a) * Math.sin(b) * .5] }), '#c8502e')); }
  for (let i = 0; i < 8; i++){
    const a = (i + .5) / 8 * Math.PI * 2, out = V(Math.cos(a), -.35, Math.sin(a)), root = V(Math.cos(a) * .25, .12, Math.sin(a) * .25);
    const arm = armTube(root, out, 1.5, .12, 2.6, -1);
    parts.push(paint(arm, (x, y, z, o, f) => o.copy(top).lerp(belly, Math.cos(f.a) < -.2 ? .8 : .15 + f.t * .3)));
    // a row of suckers along the inside of the curl
    const path = armPath(root, out, 1.5, 2.6, -1);
    for (let k = 2; k < 9; k++){ const P = path[k], n = path[Math.min(8, k + 1)].clone().sub(path[k - 1]).normalize(), side = V(0, 1, 0).cross(n).normalize(), inward = n.clone().cross(side).normalize();
      parts.push(solid(xf(new THREE.SphereGeometry(.028 * (1 - k / 12), 6, 4), { p: [P.x + inward.x * .07, P.y + inward.y * .07, P.z + inward.z * .07] }), sucker)); }
  }
  parts.push(solid(xf(new THREE.CylinderGeometry(.04, .06, .14, 6), { p: [.18, .22, .38], r: [.9, 0, -.3] }), '#e8784a'));
  parts.push(eyes(.44, .55, .2, .1, { iris: '#e8c060' }));
  return merge(parts);
}
function armPath(root, dir, len, curl, side){
  const pts = [root.clone()]; const d = dir.clone().normalize(), p = root.clone();
  const axis = V(0, 1, 0).cross(d).normalize(); const q = new THREE.Quaternion();
  for (let i = 1; i <= 8; i++){ q.setFromAxisAngle(axis.lengthSq() > 0 ? axis : V(0, 0, 1), curl * (i / 8) ** 1.6 * side); d.applyQuaternion(q); p.addScaledVector(d, len / 8); pts.push(p.clone()); }
  return pts;
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
  const base = C(slipper ? '#8a5a34' : '#a83e28'), spot = C(slipper ? '#d8b070' : '#f2dc8a'), band = C(slipper ? '#5e3a20' : '#7a2a1a');
  const col = (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 22), Math.round(y * 22), Math.round(z * 22)) < .16) o.lerp(spot, .85); return o; };
  const parts = [];
  if (slipper){
    // flat, broad, armoured, with shovel-like plates instead of long antennae
    parts.push(paint(xf(new THREE.SphereGeometry(1, 18, 9), { p: [.25, 0, 0], s: [.55, .17, .42] }), col));
    for (const s of [-1, 1]) parts.push(paint(xf(new THREE.SphereGeometry(1, 10, 5), { p: [.88, .01, s * .2], s: [.24, .045, .17] }), (x, y, z, o) => o.set('#9a6a40').lerp(C('#c8945a'), frac(x * 12) < .3 ? .6 : 0)));
  } else {
    parts.push(paint(xf(new THREE.SphereGeometry(1, 18, 12), { p: [.3, .02, 0], s: [.58, .25, .27] }), col));
    for (let i = 0; i < 14; i++){ const x = .0 + (i % 7) * .1, s = i < 7 ? 1 : -1; parts.push(solid(xf(new THREE.ConeGeometry(.025, .08, 4), { p: [x, .2 + Math.sin(x * 2) * .03, s * .12] }), '#7a2a1a')); }
    for (const s of [-1, 1]) parts.push(solid(xf(new THREE.ConeGeometry(.05, .16, 5), { p: [.82, .2, s * .1], r: [0, 0, -.6] }), '#8a3020'));
    // the long, thick, spiny antennae
    for (const s of [-1, 1]) parts.push(paint(tube([V(.85, .1, s * .08), V(1.4, .32, s * .3), V(1.65, .12, s * .9), V(1.25, -.08, s * 1.45)], t => .055 * (1 - t) + .008, { seg: 34, radial: 6 }), (x, y, z, o, f) => o.copy(base).lerp(spot, frac(f.t * 16) < .25 ? .6 : 0)));
  }
  for (let i = 0; i < 5; i++){
    const x = -.3 - i * .2, r = (slipper ? .32 : .21) * (1 - i * .1);
    parts.push(paint(xf(new THREE.SphereGeometry(1, 12, 6), { p: [x, -.02, 0], s: [.13, r * .72, r] }), (xx, yy, zz, o) => { o.copy(i % 2 ? base : band); if (!slipper && Math.abs(Math.abs(zz) - r * .5) < .04 && yy > 0) o.copy(spot); return o; }));
  }
  parts.push(paint(xf(shapeGeo([[-1.2, 0], [-1.52, .26], [-1.58, 0], [-1.52, -.26]]), { r: [Math.PI / 2, 0, 0] }), (x, y, z, o) => o.set(slipper ? '#7a4e2c' : '#c05a3a').lerp(spot, x < -1.45 ? .5 : 0)));
  parts.push(...legs([.1, .25, .4, .55], -.12, .2, .45, slipper ? '#6a4426' : '#d8925a'));
  parts.push(eyes(.86, .16, .08, .035));
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
  const pt = m.paint, base = C(pt.base), parts = [];
  if (m.style === 'doris'){
    // Felimare picta: deep blue with yellow lines, a pale foot rim, dark blue rhinophores and gill tuft
    const line = C(pt.line);
    parts.push(paint(xf(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI * .55), { s: [1, .36, .36] }), (x, y, z, o) => { o.copy(base); if (y > .02 && (frac(Math.abs(z) * 10 + .15) < .2 || Math.abs(z) < .02)) o.copy(line); if (y < .035) o.set('#f2e8c8'); return o; }));
    for (const s of [-1, 1]) parts.push(paint(xf(new THREE.ConeGeometry(.045, .22, 7), { p: [.7, .4, s * .1], r: [0, 0, -.3] }), (x, y, z, o) => o.set('#1d2a7a').lerp(line, y > .48 ? .7 : 0)));
    for (let i = 0; i < 9; i++){ const a = i / 9 * Math.PI * 2; parts.push(paint(xf(new THREE.ConeGeometry(.032, .2, 4), { p: [-.62 + Math.cos(a) * .08, .38, Math.sin(a) * .08], r: [Math.sin(a) * .7, 0, -Math.cos(a) * .7] }), (x, y, z, o) => o.set('#1d2a7a').lerp(line, y > .45 ? .6 : 0))); }
  } else {
    const tip = C(pt.tip);
    parts.push(paint(tube([V(-1, 0, 0), V(0, .05, 0), V(.8, .08, 0)], t => .04 + .07 * Math.sin(t * Math.PI * .9), { seg: 28, radial: 8 }), (x, y, z, o) => o.copy(base).lerp(C('#efd0f2'), .2)));
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
  // two slightly domed valves, narrow and buried at the bottom, wide and rounded at the top
  const parts = [], NU = 14, NV = 18;
  for (const side of [-1, 1]){
    const pos = [], idx = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++){
      const v = j / NV, u = i / NU * 2 - 1, hw = .08 + .7 * Math.sin(Math.min(1, v * 1.05) * Math.PI * .5);
      const y = -1 + 2.15 * v - .12 * u * u * smooth(.8, 1, v), z = side * (.04 + .13 * (1 - u * u) * Math.sin(v * Math.PI * .8));
      pos.push(u * hw, y + .3, z);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++){ const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    parts.push(paint(g, (x, y, z, o) => {
      o.set('#9a7448').lerp(C('#5e4128'), smooth(.4, -.6, y));
      if (frac(Math.atan2(x, y + 1) * 10) < .3) o.lerp(C('#c9a676'), .55);
      if (frac((y + 1) * 9) < .16) o.lerp(C('#dcc08e'), .45);
      return o;
    }));
  }
  parts.push(solid(xf(new THREE.CylinderGeometry(.55, .65, .1, 14), { p: [0, -.6, 0] }), '#d8c8a0'));
  return merge(parts);
}
/* ---------- echinoderms ---------- */
function starGeometry(pt){
  // Echinaster: five long, rounded, tapering arms
  const sh = new THREE.Shape(), N = 5, pts = [];
  for (let i = 0; i < N * 12; i++){
    const a = i / (N * 12) * Math.PI * 2 + Math.PI / 2, ph = (i % 12) / 12, arm = Math.pow(Math.abs(Math.cos(ph * Math.PI)), 3);
    const r = .2 + .85 * arm; pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: .06, bevelEnabled: true, bevelThickness: .09, bevelSize: .07, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const r = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) * (1.1 - r * .7) + r * r * .1); }
  const base = C(pt.base);
  return merge([paint(g, (x, y, z, o) => { o.copy(base); if (hash(Math.round(x * 24), Math.round(z * 24)) < .22) o.multiplyScalar(.78); return o; })]);
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
  const shellC = C('#8a4824'), plate = C('#b0662e'), seam = C('#5a2c14'), skin = C('#b0743a'), scale = C('#7a4a22');
  // heart-shaped carapace with big scutes
  const shell = paint(xf(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * .5), { s: [1, .42, .8] }), (x, y, z, o) => {
    const u = x * 2.2, v = z * 2.6 + (Math.floor(x * 2.2) % 2 ? .5 : 0);
    o.copy(shellC).lerp(plate, .3 + .4 * hash(Math.floor(u), Math.floor(v)));
    if (frac(u) < .08 || frac(v) < .08) o.copy(seam);
    if (y < .06) o.set('#d8b47a');
    return o;
  });
  { const p = shell.attributes.position; for (let i = 0; i < p.count; i++){ const x = p.getX(i); if (x < -.3) p.setZ(i, p.getZ(i) * (1 + (x + .3) * .45)); } }
  const plastron = solid(xf(new THREE.SphereGeometry(1, 16, 6), { p: [0, -.02, 0], s: [.95, .08, .74] }), '#e6c890');
  const skinCol = (x, y, z, o) => { o.copy(skin); if (hash(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) < .3) o.copy(scale); if (y < -.02) o.lerp(C('#e8c890'), .7); return o; };
  const head = paint(xf(new THREE.SphereGeometry(1, 14, 10), { p: [1.12, .08, 0], s: [.34, .24, .25] }), skinCol);
  const beak = solid(xf(new THREE.ConeGeometry(.1, .14, 6), { p: [1.43, .03, 0], r: [0, 0, -Math.PI / 2] }), '#d8b070');
  const neck = paint(xf(new THREE.CylinderGeometry(.16, .2, .3, 10), { p: [.85, .03, 0], r: [0, 0, Math.PI / 2] }), skinCol);
  const paddle = (pts, x, z, side) => paint(xf(shapeGeo(pts.map(([px, py]) => [px, py * side])), { p: [x, -.01, z * side], r: [Math.PI / 2, 0, 0] }), skinCol);
  const front = [[0, 0], [.15, .35], [-.15, .95], [-.48, 1.08], [-.36, .55], [-.25, .1]], back = [[0, 0], [-.05, .3], [-.35, .4], [-.44, .2], [-.25, 0]];
  const flips = [paddle(front, .45, .55, 1), paddle(front, .45, .55, -1), paddle(back, -.6, .5, 1), paddle(back, -.6, .5, -1)];
  return merge([shell, plastron, neck, head, beak, eyes(1.28, .16, .15, .05, { iris: '#5a3a1a' }), ...flips]);
}
/* ---------- entry point ---------- */
export const VIEWS = { side: [.35, .18], top: [.25, .95], high: [.4, .55], front: [.9, .15], face: [.15, .12], face3q: [1.05, .38], topUp: [-Math.PI / 2, 1.1] };
export function viewFor(spec){
  const k = spec.model.kind;
  if (k === 'ray' && spec.model.shape === 'butterfly') return 'topUp';
  if (['ray', 'flatfish', 'star', 'crab'].includes(k)) return 'top';
  if (['urchin', 'holothurian', 'nudibranch', 'turtle', 'coral', 'hermit', 'anemone', 'cuttlefish', 'lobster'].includes(k)) return 'high';
  if (k === 'octopus') return 'face3q';
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
