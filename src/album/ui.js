import * as THREE from 'three';
import { SPECIES, GROUPS, REGIONS, RARITY, ZONES, hotspots } from './species.js';
import { buildGeometry, MATERIAL, VIEWS, viewFor } from './models.js';

/*
 * The species album as a component: progress, legend, filters, the card grid and the card viewer
 * (3D figure, facts and a map of where it is easiest to see). The public page mounts it read-only;
 * the admin dashboard mounts it with editing, writing to Supabase through `api`.
 */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = sp => 'Nº ' + String(SPECIES.indexOf(sp) + 1).padStart(2, '0');
const gems = r => (r > 1 ? '<span class="c-gems" aria-hidden="true">' + '◆'.repeat(r - 1) + '</span>' : '');

/* ---------- 3D: an offscreen renderer for the cards, a live one for the viewer ---------- */
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
function makeStage(canvas, size){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!size });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (size) renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x22404e, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(2, 4, 3); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd8ff, .6); fill.position.set(-3, 1, -2); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), MATERIAL); scene.add(mesh);
  return { renderer, scene, camera, mesh };
}
function frame(stage, sp, az = 0, elOffset = 0){
  const g = buildGeometry(sp), R = g.boundingSphere.radius, [baseAz, el0] = VIEWS[viewFor(sp)], el = el0 + elOffset;
  // fit the bounding sphere in the narrower of the two directions of the canvas
  const fit = Math.max(1, 1 / (stage.camera.aspect || 1)), d = R / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04 * fit * (stage.live ? 1.12 : 1), a = baseAz + az;
  stage.mesh.geometry = g;
  stage.camera.position.set(Math.sin(a) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(a) * Math.cos(el) * d);
  stage.camera.lookAt(0, 0, 0);
}
let thumbs = null;
const queue = [], thumbCache = new Map();
function requestThumb(sp, isSeen, img){
  const key = sp.id + (isSeen ? ':c' : ':s');
  if (thumbCache.has(key)){ img.src = thumbCache.get(key); return; }
  queue.push([sp, img, key]); if (queue.length === 1) requestAnimationFrame(drainQueue);
}
function drainQueue(){
  if (!thumbs){ try { thumbs = makeStage(document.createElement('canvas'), 320); } catch (e) { queue.length = 0; return; } }
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 12){
    const [sp, img, key] = queue.shift();
    if (!thumbCache.has(key)){
      frame(thumbs, sp);
      thumbs.mesh.material = key.endsWith(':c') ? MATERIAL : SILHOUETTE;
      thumbs.renderer.render(thumbs.scene, thumbs.camera);
      thumbCache.set(key, thumbs.renderer.domElement.toDataURL('image/png'));
    }
    img.src = thumbCache.get(key);
  }
  if (queue.length) requestAnimationFrame(drainQueue);
}

/* ---------- map of Spain with the Canaries in an inset, for the heat zones ---------- */
const U = 100;
const mx = lon => lon * U, my = lat => -U * 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const MAIN = { x: mx(-9.7), y: my(44.05), w: mx(4.6) - mx(-9.7), h: my(35.55) - my(44.05) };
const INSET = { x: mx(-18.4), y: my(29.55), w: mx(-13.15) - mx(-18.4), h: my(27.45) - my(29.55) };
const INSET_BOX = { w: MAIN.w * .36, h: MAIN.w * .36 * INSET.h / INSET.w };
INSET_BOX.x = MAIN.x + MAIN.w * .015; INSET_BOX.y = MAIN.y + MAIN.h - INSET_BOX.h - MAIN.h * .02;
let landPath = null;
async function mapSvg(){
  if (!landPath) landPath = (await import('../data/land.json')).default.d;
  return `<svg class="v-map-svg" viewBox="${MAIN.x} ${MAIN.y} ${MAIN.w} ${MAIN.h}" role="img" aria-label="Mapa de España con las zonas donde es más fácil verla">
    <defs><radialGradient id="heatG"><stop offset="0" style="stop-color:var(--heat);stop-opacity:.9"/><stop offset=".5" style="stop-color:var(--heat);stop-opacity:.4"/><stop offset="1" style="stop-color:var(--heat);stop-opacity:0"/></radialGradient></defs>
    <path class="land" d="${landPath}"/><g class="heat heat-main"></g>
    <svg x="${INSET_BOX.x}" y="${INSET_BOX.y}" width="${INSET_BOX.w}" height="${INSET_BOX.h}" viewBox="${INSET.x} ${INSET.y} ${INSET.w} ${INSET.h}">
      <rect class="inset-bg" x="${INSET.x}" y="${INSET.y}" width="${INSET.w}" height="${INSET.h}"/>
      <path class="land" d="${landPath}"/><g class="heat heat-inset"></g>
    </svg>
    <rect class="inset-frame" x="${INSET_BOX.x}" y="${INSET_BOX.y}" width="${INSET_BOX.w}" height="${INSET_BOX.h}"/>
  </svg>`;
}
function paintHeat(svg, sp){
  const spots = hotspots(sp), main = svg.querySelector('.heat-main'), inset = svg.querySelector('.heat-inset');
  const circles = (region, r) => Object.entries(spots).filter(([id]) => (ZONES[id].region === 'can') === region)
    .map(([id, w]) => `<circle cx="${mx(ZONES[id].lon)}" cy="${my(ZONES[id].lat)}" r="${r * (.55 + .7 * w)}" fill="url(#heatG)" opacity="${.45 + .55 * w}"><title>${esc(ZONES[id].name)}</title></circle>`).join('');
  main.innerHTML = circles(false, 75); inset.innerHTML = circles(true, 58);
  return Object.entries(spots).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => ZONES[id].name);
}

/* ---------- the component ---------- */
export function createAlbum(root, { editable = false, api = null, seen: seenRows = [], showProgress = true, onChange = () => {} } = {}){
  let seen = new Map(seenRows.map(r => [r.species_id, {}]));
  const filter = { region: 'all', state: 'all' };
  root.classList.add('album-ui');
  root.innerHTML = `
    ${showProgress ? `<div class="progress" aria-live="polite"><p class="count"><b data-k="n">0</b><span>de ${SPECIES.length} descubiertas</span></p><div class="bar"><span data-k="bar"></span></div></div>` : ''}
    <ul class="legend" aria-label="Rareza">${RARITY.slice(1).map((r, i) => `<li data-r="${i + 1}"><span class="sw"></span>${r.name}</li>`).join('')}</ul>
    <nav class="filters" aria-label="Filtrar el álbum">
      <div class="chips" role="group" aria-label="Zona">${[['all', 'Todas'], ...Object.entries(REGIONS)].map(([k, v], i) => `<button type="button" data-region="${k}" aria-pressed="${!i}">${v}</button>`).join('')}</div>
      <div class="chips" role="group" aria-label="Estado">${[['all', 'Todas'], ['seen', 'Vistas'], ['missing', 'Por descubrir']].map(([k, v], i) => `<button type="button" data-state="${k}" aria-pressed="${!i}">${v}</button>`).join('')}</div>
    </nav>
    <div data-k="groups"></div>
    <p class="empty" data-k="empty" hidden>Ninguna especie con estos filtros.</p>`;
  const q = k => root.querySelector(`[data-k="${k}"]`);

  const visible = sp => !(filter.region !== 'all' && !sp.regions.includes(filter.region)) && !(filter.state === 'seen' && !seen.has(sp.id)) && !(filter.state === 'missing' && seen.has(sp.id));
  const order = () => SPECIES.filter(visible);

  function render(){
    const holder = q('groups'); holder.innerHTML = '';
    let shown = 0;
    for (const [gid, gname] of GROUPS){
      const list = SPECIES.filter(sp => sp.group === gid && visible(sp));
      if (!list.length) continue;
      shown += list.length;
      const total = SPECIES.filter(s => s.group === gid), got = total.filter(s => seen.has(s.id)).length;
      const sec = document.createElement('section'); sec.className = 'group';
      sec.innerHTML = `<header class="group-head"><h2>${esc(gname)}</h2><span>${got} / ${total.length}</span></header><ol class="cards"></ol>`;
      const ol = sec.querySelector('ol');
      for (const sp of list){
        const isSeen = seen.has(sp.id), li = document.createElement('li');
        li.innerHTML = `<button type="button" class="card ${isSeen ? 'is-seen' : 'is-locked'}" data-r="${sp.rarity}" data-id="${sp.id}" aria-label="${esc(sp.name)}, ${RARITY[sp.rarity].name.toLowerCase()}${isSeen ? '' : ', por descubrir'}">
          <span class="c-no">${num(sp)}</span>${gems(sp.rarity)}
          <span class="c-art"><img alt="" width="320" height="320"></span>
          <span class="c-name">${esc(sp.name)}</span><span class="c-sci">${esc(sp.sci)}</span></button>`;
        ol.appendChild(li);
        requestThumb(sp, isSeen, li.querySelector('img'));
      }
      holder.appendChild(sec);
    }
    q('empty').hidden = shown > 0;
    if (showProgress){
      const n = SPECIES.filter(s => seen.has(s.id)).length;
      q('n').textContent = n; q('bar').style.width = (n / SPECIES.length * 100) + '%';
    }
  }
  root.querySelector('.filters').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const key = b.dataset.region ? 'region' : 'state';
    filter[key] = b.dataset[key];
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  q('groups').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openViewer(c.dataset.id); });

  /* ---------- viewer ---------- */
  const dialog = document.createElement('dialog');
  dialog.className = 'album-viewer';
  dialog.innerHTML = `
    <div class="v-stage"><canvas aria-hidden="true"></canvas><p class="v-hint">Arrastra para girarlo</p>
      <button class="v-nav prev" type="button" aria-label="Anterior">‹</button><button class="v-nav next" type="button" aria-label="Siguiente">›</button></div>
    <div class="v-info">
      <p class="v-no"></p><h2 class="v-name"></h2><p class="v-sci"></p>
      <p class="v-tags"></p>
      <p class="v-fact"></p>
      <p class="v-seen"></p>
      <figure class="v-map"><figcaption>Dónde es más fácil verla</figcaption><div class="v-map-box"></div><p class="v-zones"></p></figure>
      ${editable ? `<div class="v-edit"><button class="btn primary" type="button" data-act="toggle">La he visto</button></div>` : ''}
    </div>
    <button class="v-close" type="button" aria-label="Cerrar">✕</button>`;
  document.body.appendChild(dialog);
  const d = s => dialog.querySelector(s);
  let stage = null, current = -1, raf = 0, lastT = 0, mapEl = null;
  const spin = { az: 0, el: 0, v: .35, drag: null };

  async function openViewer(id){
    const list = order(); current = list.findIndex(s => s.id === id); if (current < 0) return;
    if (!stage){ try { stage = makeStage(d('canvas')); stage.live = true; } catch (e) { stage = null; } }
    if (!dialog.open) dialog.showModal();
    if (!mapEl){ try { d('.v-map-box').innerHTML = await mapSvg(); mapEl = d('.v-map-svg'); } catch (e) { d('.v-map').hidden = true; } }
    show(list[current]);
    resize(); lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function show(sp){
    const isSeen = seen.has(sp.id);
    dialog.classList.toggle('is-locked', !isSeen); dialog.dataset.r = sp.rarity;
    d('.v-no').textContent = num(sp);
    d('.v-name').textContent = sp.name; d('.v-sci').textContent = sp.sci;
    d('.v-tags').innerHTML = `<span class="tier">${gems(sp.rarity)}${RARITY[sp.rarity].name}</span>` + sp.regions.map(r => `<span>${REGIONS[r]}</span>`).join('');
    d('.v-fact').textContent = sp.fact;
    d('.v-seen').textContent = isSeen ? '✓ Ya la he visto' : 'Todavía no la he visto.';
    if (mapEl){ const top = paintHeat(mapEl, sp); d('.v-zones').textContent = top.join(' · '); }
    if (editable){
      const b = d('[data-act="toggle"]');
      b.textContent = isSeen ? 'Quitar de vistas' : 'La he visto';
      b.classList.toggle('primary', !isSeen);
    }
    spin.az = 0; spin.el = 0;
    if (stage){ stage.mesh.material = isSeen ? MATERIAL : SILHOUETTE; frame(stage, sp); }
    current = order().indexOf(sp);
  }
  function resize(){
    if (!stage) return;
    const c = d('canvas'), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    stage.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); stage.renderer.setSize(w, h, false);
    stage.camera.aspect = w / h; stage.camera.updateProjectionMatrix();
  }
  function loop(t){
    if (!dialog.open) return;
    const dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
    if (!spin.drag) spin.az += spin.v * dt;
    const sp = order()[current];
    if (stage && sp){ frame(stage, sp, spin.az, spin.el); stage.renderer.render(stage.scene, stage.camera); }
    raf = requestAnimationFrame(loop);
  }
  const cv = d('canvas');
  cv.addEventListener('pointerdown', e => { spin.drag = { x: e.clientX, y: e.clientY, az: spin.az, el: spin.el }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!spin.drag) return; spin.az = spin.drag.az - (e.clientX - spin.drag.x) * .012; spin.el = Math.max(-.6, Math.min(.9, spin.drag.el + (e.clientY - spin.drag.y) * .008)); });
  cv.addEventListener('pointerup', () => { spin.drag = null; });
  const step = k => { const list = order(); if (!list.length) return; current = (current + k + list.length) % list.length; show(list[current]); };
  d('.prev').addEventListener('click', () => step(-1));
  d('.next').addEventListener('click', () => step(1));
  d('.v-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
  dialog.addEventListener('close', () => cancelAnimationFrame(raf));
  addEventListener('resize', () => dialog.open && resize());

  /* ---------- editing ---------- */
  if (editable){
    const b = d('[data-act="toggle"]');
    b.addEventListener('click', async () => {
      const sp = order()[current]; if (!sp) return;
      const wasSeen = seen.has(sp.id);
      b.disabled = true;
      try {
        if (wasSeen){ await api.unmarkSeen(sp.id); seen.delete(sp.id); }
        else { await api.markSeen(sp.id); seen.set(sp.id, {}); }
        render();
        if (order().includes(sp)) show(sp); else dialog.close();
        onChange(wasSeen ? `${sp.name}: vuelve a estar por descubrir` : `${sp.name}: desbloqueada`, seen);
      } catch (err){ onChange(explain(err), seen, true); }
      b.disabled = false;
    });
  }
  function explain(err){
    const m = (err && err.message) || String(err);
    if (/species_seen|schema cache|does not exist/i.test(m)) return 'Falta la tabla del álbum: ejecuta supabase/migrations/004_album.sql en Supabase.';
    if (/row-level security|permission/i.test(m)) return 'Tu usuario no tiene permiso para editar el álbum.';
    return m;
  }

  render();
  return { setSeen(rows){ seen = new Map(rows.map(r => [r.species_id, {}])); render(); }, count: () => seen.size };
}
