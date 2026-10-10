import './album.css';
import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { SPECIES, GROUPS, REGIONS } from './species.js';
import { buildGeometry, MATERIAL, VIEWS, viewFor } from './models.js';

inject();
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateLabel = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const num = i => 'Nº ' + String(i + 1).padStart(2, '0');

let seen = new Map();          // species_id -> { seen_on, site }
let admin = false, api = null;
const filter = { region: 'all', state: 'all' };

function toast(msg, isError = false){
  const t = $('toast'); t.textContent = msg; t.classList.toggle('err', isError); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

/* ---------- thumbnails: one offscreen renderer draws every card, a few per frame ---------- */
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
  const d = R / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04, a = baseAz + az;
  stage.mesh.geometry = g;
  stage.camera.position.set(Math.sin(a) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(a) * Math.cos(el) * d);
  stage.camera.lookAt(0, 0, 0);
}
let thumbs = null;
const queue = [], thumbCache = new Map();
function requestThumb(sp, img){
  const key = sp.id + (seen.has(sp.id) ? ':c' : ':s');
  if (thumbCache.has(key)){ img.src = thumbCache.get(key); return; }
  queue.push([sp, img, key]); if (queue.length === 1) requestAnimationFrame(drainQueue);
}
function drainQueue(){
  if (!thumbs){ try { thumbs = makeStage(document.createElement('canvas'), 320); } catch (e) { queue.length = 0; document.body.classList.add('no-webgl'); return; } }
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

/* ---------- the album grid ---------- */
function visible(sp){
  if (filter.region !== 'all' && !sp.regions.includes(filter.region)) return false;
  if (filter.state === 'seen' && !seen.has(sp.id)) return false;
  if (filter.state === 'missing' && seen.has(sp.id)) return false;
  return true;
}
function render(){
  const holder = $('groups'); holder.innerHTML = '';
  let shown = 0;
  for (const [gid, gname] of GROUPS){
    const list = SPECIES.map((sp, i) => [sp, i]).filter(([sp]) => sp.group === gid && visible(sp));
    if (!list.length) continue;
    shown += list.length;
    const total = SPECIES.filter(s => s.group === gid), got = total.filter(s => seen.has(s.id)).length;
    const sec = document.createElement('section'); sec.className = 'group';
    sec.innerHTML = `<header class="group-head"><h2>${esc(gname)}</h2><span>${got} / ${total.length}</span></header><ol class="cards"></ol>`;
    const ol = sec.querySelector('ol');
    for (const [sp, i] of list){
      const isSeen = seen.has(sp.id);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="card${isSeen ? ' is-seen' : ' is-locked'}${sp.rare ? ' is-rare' : ''}" data-id="${sp.id}" aria-label="${esc(sp.name)}${isSeen ? '' : ', por descubrir'}">
        <span class="c-no">${num(i)}</span>${sp.rare ? '<span class="c-rare" title="Especie difícil de ver">★</span>' : ''}
        <span class="c-art"><img alt="" width="320" height="320"></span>
        <span class="c-name">${esc(sp.name)}</span><span class="c-sci">${esc(sp.sci)}</span></button>`;
      ol.appendChild(li);
      requestThumb(sp, li.querySelector('img'));
    }
    holder.appendChild(sec);
  }
  $('empty').hidden = shown > 0;
  const n = SPECIES.filter(s => seen.has(s.id)).length;
  $('seenN').textContent = n; $('totalN').textContent = SPECIES.length;
  $('bar').style.width = (n / SPECIES.length * 100) + '%';
}
document.querySelectorAll('.filters [data-region], .filters [data-state]').forEach(b => b.addEventListener('click', () => {
  const key = b.dataset.region ? 'region' : 'state';
  filter[key] = b.dataset[key];
  b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));
$('groups').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openViewer(c.dataset.id); });

/* ---------- viewer: the figure in 3D, drag to turn it ---------- */
let stage = null, current = -1, spin = { az: 0, el: 0, v: .35, drag: null }, raf = 0, lastT = 0;
const dialog = $('viewer');
function order(){ return SPECIES.filter(visible); }
function openViewer(id){
  const list = order(); current = list.findIndex(s => s.id === id); if (current < 0) return;
  if (!stage){ try { stage = makeStage($('vCanvas')); } catch (e) { stage = null; } }
  showSpecies(list[current]);
  if (!dialog.open) dialog.showModal();
  resize(); lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function showSpecies(sp){
  const i = SPECIES.indexOf(sp), isSeen = seen.has(sp.id), info = seen.get(sp.id);
  dialog.classList.toggle('is-locked', !isSeen); dialog.classList.toggle('is-rare', !!sp.rare);
  $('vNo').textContent = num(i) + (sp.rare ? ' · Rara de ver' : '');
  $('vName').textContent = sp.name; $('vSci').textContent = sp.sci;
  $('vRegions').innerHTML = sp.regions.map(r => `<span>${REGIONS[r]}</span>`).join('');
  $('vFact').textContent = sp.fact;
  $('vSeen').textContent = isSeen ? 'Vista' + (info.seen_on ? ` el ${dateLabel(info.seen_on)}` : '') + (info.site ? ` en ${info.site}` : '') : 'Todavía no la he visto.';
  $('vEdit').hidden = !admin;
  if (admin){
    $('vDate').value = info?.seen_on || ''; $('vSite').value = info?.site || '';
    $('vMark').textContent = isSeen ? 'Guardar' : 'Marcar como vista'; $('vUnmark').hidden = !isSeen;
  }
  spin.az = 0; spin.el = 0;
  if (stage){ stage.mesh.material = isSeen ? MATERIAL : SILHOUETTE; frame(stage, sp); }
  current = order().indexOf(sp);
}
function resize(){
  if (!stage) return;
  const c = $('vCanvas'), w = c.clientWidth, h = c.clientHeight;
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
const canvasEl = $('vCanvas');
canvasEl.addEventListener('pointerdown', e => { spin.drag = { x: e.clientX, y: e.clientY, az: spin.az, el: spin.el }; canvasEl.setPointerCapture(e.pointerId); });
canvasEl.addEventListener('pointermove', e => { if (!spin.drag) return; spin.az = spin.drag.az - (e.clientX - spin.drag.x) * .012; spin.el = Math.max(-.6, Math.min(.9, spin.drag.el + (e.clientY - spin.drag.y) * .008)); });
canvasEl.addEventListener('pointerup', () => { spin.drag = null; });
const step = d => { const list = order(); if (!list.length) return; current = (current + d + list.length) % list.length; showSpecies(list[current]); };
$('vPrev').addEventListener('click', () => step(-1));
$('vNext').addEventListener('click', () => step(1));
$('vClose').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
dialog.addEventListener('close', () => cancelAnimationFrame(raf));
addEventListener('resize', () => dialog.open && resize());

/* ---------- editing (only with the admin session from /admin) ---------- */
$('vEdit').addEventListener('submit', async e => {
  e.preventDefault();
  const sp = order()[current]; if (!sp || !api) return;
  const rec = { seen_on: $('vDate').value || null, site: $('vSite').value.trim() || null };
  try {
    await api.markSeen(sp.id, rec); seen.set(sp.id, rec);
    toast(`${sp.name}: desbloqueada`); render(); showSpecies(sp);
  } catch (err){ toast(explain(err), true); }
});
$('vUnmark').addEventListener('click', async () => {
  const sp = order()[current]; if (!sp || !api) return;
  try { await api.unmarkSeen(sp.id); seen.delete(sp.id); toast(`${sp.name}: vuelve a estar por descubrir`); render(); const list = order(); if (list.includes(sp)) showSpecies(sp); else dialog.close(); }
  catch (err){ toast(explain(err), true); }
});
function explain(err){
  const m = (err && err.message) || String(err);
  if (/species_seen|schema cache|does not exist/i.test(m)) return 'Falta la tabla del álbum: ejecuta supabase/migrations/004_album.sql en Supabase.';
  if (/row-level security|permission/i.test(m)) return 'Tu usuario no tiene permiso para editar el álbum.';
  return m;
}

/* ---------- start: wait for what has been seen, so the cards do not flash grey first ---------- */
(async () => {
  if (!import.meta.env.VITE_SUPABASE_URL){ render(); return; }
  const fallback = setTimeout(render, 2500);
  try {
    api = await import('../lib/supabase.js');
    const [rows, session] = await Promise.all([api.listSeen().catch(err => { console.warn('Álbum:', err.message); return []; }), api.supabase.auth.getSession()]);
    seen = new Map(rows.map(r => [r.species_id, { seen_on: r.seen_on, site: r.site }]));
    admin = !!session.data.session; $('editing').hidden = !admin;
  } catch (err){ console.warn('No se pudo leer el álbum', err); }
  clearTimeout(fallback); render();
})();
