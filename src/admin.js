import './admin.css';
import { configured, supabase, listDives, insertDives, deleteDive, setDiveFlags, setDiveStats, setDiveType, setDiveNotes, listCerts, saveCert, deleteCert, exportAll, readBackup, restoreAll, listSeen, getSettings, saveSettings } from './lib/supabase.js';
import { STATES, STATE_NAMES, STATE_PARAM, DEFAULT_WX, normalizeWx, chances } from './weather.js';
import { parseUDDF } from './lib/uddf.js';
import { mergeDives, statOn } from './lib/logbook.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const when = iso => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

let saved = [];      // dives in Supabase
let certs = [];      // certifications in Supabase
let pending = [];    // parsed from the chosen files: { dive, status: 'new' | 'dup' | 'bad', file, error }

function toast(msg, isError = false){
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', isError); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
}

function explain(err){
  const m = (err && (err.message || err.error_description)) || String(err);
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/species_seen/i.test(m) && /could not find|schema cache|does not exist/i.test(m)) return 'Falta la tabla del álbum: ejecuta supabase/migrations/004_album.sql en el SQL Editor.';
  if (/certifications/i.test(m) && /could not find|schema cache|does not exist/i.test(m)) return 'Falta preparar las titulaciones en Supabase: ejecuta supabase/migrations/003_formacion.sql en el SQL Editor.';
  if (/settings|hidden|no_sac/i.test(m)) return 'Falta preparar los ajustes en Supabase: ejecuta supabase/migrations/002_ajustes.sql en el SQL Editor.';
  if (/could not find the table|schema cache|relation .* does not exist/i.test(m)) return 'La tabla de inmersiones aún no existe en Supabase. Ejecuta supabase/schema.sql en el SQL Editor y vuelve a probar.';
  if (/email not confirmed/i.test(m)) return 'Este email aún no está confirmado en Supabase.';
  if (/row-level security|permission denied|violates row/i.test(m)) return 'Tu usuario no tiene permiso para cambiar la bitácora. Añádelo a la tabla admins (ver supabase/schema.sql).';
  if (/duplicate key|dives_start_minute/i.test(m)) return 'Alguna inmersión ya estaba guardada. Recarga la página y vuelve a probar.';
  if (/failed to fetch|network/i.test(m)) return 'No hay conexión con Supabase. Revisa la conexión y vuelve a probar.';
  return m;
}

/* ---------- views ---------- */
function show(view){
  $('notConfigured').hidden = view !== 'notConfigured';
  $('login').hidden = view !== 'login';
  $('panel').hidden = view !== 'panel';
}

async function enterPanel(session){
  $('who').textContent = session.user.email; $('who').hidden = false; $('logout').hidden = false;
  show('panel');
  await refresh();
  loadWeather();
  watchAlbum();
}

/* ---------- species album: the same album as the public page, but editable ---------- */
let albumLoaded = false, adminAlbum = null;
function watchAlbum(){
  if (albumLoaded) return;
  // three.js and the figures only load when the album card comes into view
  const io = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect(); albumLoaded = true; loadAlbum();
  }, { rootMargin: '300px' });
  io.observe($('albumCard'));
}
async function loadAlbum(){
  const holder = $('adminAlbum');
  try {
    const [{ createAlbum }, , api] = await Promise.all([import('./album/ui.js'), import('./album/ui.css'), import('./lib/supabase.js')]);
    const { SPECIES } = await import('./album/species.js');
    let rows = [];
    try { rows = await api.listSeen(); } catch (err){ toast(explain(err), true); }
    const setCount = n => { $('albumCount').textContent = `${n} / ${SPECIES.length}`; };
    setCount(rows.filter(r => SPECIES.some(s => s.id === r.species_id)).length);
    holder.innerHTML = '';
    adminAlbum = createAlbum(holder, { editable: true, api, seen: rows, showProgress: false,
      onChange: (msg, seen, isError) => { toast(msg, isError); setCount(seen.size); } });
  } catch (err){
    holder.innerHTML = '<p class="empty">No se pudo cargar el álbum.</p>'; console.error(err);
  }
}
function leavePanel(){
  $('who').hidden = true; $('logout').hidden = true;
  saved = []; pending = []; renderPreview();
  show('login');
}

/* ---------- logbook list ---------- */
async function refresh(){
  try { saved = await listDives(); }
  catch (err){ toast(explain(err), true); saved = []; }
  renderSaved();
  refreshCerts();
}

function row(d, side, below = ''){
  const no = d.number != null ? `nº ${d.number}` : '';
  return `<li class="row" data-id="${esc(d.id)}">
    <span class="row-no">${esc(no)}</span>
    <div class="row-main">
      <div class="row-title">${esc(d.site?.name || 'Sin sitio')}</div>
      <div class="row-meta">${esc(when(d.start))} · ${fmt(d.maxDepth)} m · ${clock(d.duration)}</div>
      ${d.notes && side.includes('data-act="notes"') ? `<div class="row-note">${esc(d.notes)}</div>` : ''}
    </div>
    <div class="row-side">${side}</div>${below}
  </li>`;
}

const sw = (act, on, label, title) =>
  `<button class="switch" type="button" role="switch" aria-checked="${on}" data-act="${act}" title="${esc(title)}"><span class="knob" aria-hidden="true"></span><span class="sw-label">${label}</span></button>`;

const STAT_LABELS = [['count', 'Nº'], ['time', 'Tiempo'], ['maxDepth', 'Máx.'], ['avgDepth', 'Media'], ['minTemp', 'Agua'], ['sac', 'SAC']];
const STAT_TITLES = { count: 'número de inmersiones', time: 'tiempo bajo el agua y la más larga', maxDepth: 'profundidad máxima y la más profunda', avgDepth: 'profundidad media (media de las máximas, como Pro Dive)', minTemp: 'agua más fría', sac: 'consumo de aire (SAC)' };

// the saved list shows a page at a time, so the cards below never get buried under a long log
const PAGE = 8;
let shown = PAGE, query = '', filter = 'all';
let notesOpen = null; // id of the dive whose notes are being edited

function matches(d){
  if (filter === 'training' && d.type !== 'training') return false;
  if (filter === 'hidden' && !d.hidden) return false;
  if (!query) return true;
  const hay = [d.site?.name, d.number != null ? `nº ${d.number} ${d.number}` : '', d.notes, when(d.start)].join(' ').toLowerCase();
  return query.split(/\s+/).every(w => hay.includes(w));
}

function updateKpis(){
  $('kDives').textContent = saved.length;
  $('kWeb').textContent = saved.filter(d => !d.hidden).length;
  $('kTraining').textContent = saved.filter(d => d.type === 'training').length;
  const planned = certs.filter(c => c.status === 'planned').length;
  $('kCerts').textContent = certs.length - planned;
  $('kCertsLbl').textContent = planned ? `titulaciones · ${planned} pendiente${planned > 1 ? 's' : ''}` : 'titulaciones';
}

const NOTES_MAX = 500;
const notesEditor = d => `<div class="notes-edit">
    <label class="label" for="notes-${esc(d.id)}">Notas de la inmersión <span>Salen en su ficha de la web, entre comillas.</span></label>
    <textarea id="notes-${esc(d.id)}" rows="3" maxlength="${NOTES_MAX}" placeholder="Qué viste, cómo estaba el agua, con quién bajaste…">${esc(d.notes || '')}</textarea>
    <div class="notes-foot"><span class="count notes-count">${(d.notes || '').length} / ${NOTES_MAX}</span>
      <div class="actions"><button class="btn ghost small" type="button" data-act="notes-cancel">Cancelar</button><button class="btn primary small" type="button" data-act="notes-save">Guardar</button></div></div>
  </div>`;

async function saveNotes(li){
  const d = saved.find(x => x.id === li.dataset.id); if (!d) return;
  const ta = li.querySelector('.notes-edit textarea'), btn = li.querySelector('[data-act="notes-save"]');
  const notes = ta.value.replace(/\r\n?/g, '\n').trim().replace(/\n{3,}/g, '\n\n'); // keeps line breaks, at most one blank line
  if (notes === (d.notes || '')){ notesOpen = null; renderSaved(); return; }
  btn.disabled = true; ta.disabled = true; btn.textContent = 'Guardando…';
  try {
    await setDiveNotes(d, notes);
    if (notes) d.notes = notes; else delete d.notes;
    notesOpen = null; toast(notes ? 'Notas guardadas' : 'Notas borradas');
  } catch (err){ toast(explain(err), true); }
  renderSaved();
}

function renderSaved(){
  updateKpis();
  $('count').textContent = saved.length ? `${saved.length} ${saved.length === 1 ? 'inmersión' : 'inmersiones'}` : '';
  const list = saved.filter(matches), page = list.slice(0, shown);
  $('logEmpty').hidden = list.length > 0;
  $('logEmpty').textContent = saved.length ? 'Ninguna inmersión coincide con la búsqueda.' : 'Todavía no hay inmersiones guardadas. Importa la primera.';
  $('logMore').hidden = list.length <= PAGE;
  $('logShown').textContent = `${page.length} de ${list.length}`;
  $('logMoreBtn').hidden = page.length >= list.length;
  $('logMoreBtn').textContent = `Ver ${Math.min(PAGE, list.length - page.length)} más`;
  $('logList').innerHTML = page.map(d => row(d,
    `<div class="seg" role="group" aria-label="Tipo de inmersión"><button type="button" data-type="recreational" aria-pressed="${d.type !== 'training'}">Recreativa</button><button type="button" data-type="training" aria-pressed="${d.type === 'training'}">Entreno</button></div>` +
    sw('web', !d.hidden, 'Web', 'Mostrar esta inmersión en la web') +
    `<button class="btn small" type="button" data-act="notes" aria-expanded="${notesOpen === d.id}">${d.notes ? 'Editar notas' : 'Añadir notas'}</button>` +
    '<button class="btn danger small" type="button" data-act="ask">Borrar</button>',
    `<div class="row-stats" role="group" aria-label="Estadísticas en las que cuenta">${STAT_LABELS.map(([k, l]) =>
      `<button class="pill" type="button" aria-pressed="${statOn(d, k)}" data-stat="${k}" title="Contar en ${STAT_TITLES[k]}">${l}</button>`).join('')}</div>` +
    (notesOpen === d.id ? notesEditor(d) : ''))).join('');
  if (notesOpen){ const ta = $('logList').querySelector('.notes-edit textarea'); if (ta && document.activeElement !== ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
}

$('logMoreBtn').addEventListener('click', () => { shown += PAGE; renderSaved(); });
$('logSearch').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); shown = PAGE; renderSaved(); });
$('logCard').querySelector('.log-tools .seg').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  filter = b.dataset.filter; shown = PAGE;
  b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderSaved();
});

$('logList').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const li = btn.closest('.row'), side = li.querySelector('.row-side'), id = li.dataset.id;
  if (btn.dataset.type){
    const d = saved.find(x => x.id === id); if (!d || btn.getAttribute('aria-pressed') === 'true') return;
    const type = btn.dataset.type, group = btn.parentElement;
    group.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(b === btn)); b.disabled = true; });
    try { await setDiveType(d, type); d.type = type; toast(type === 'training' ? 'Marcada como entrenamiento' : 'Marcada como recreativa'); }
    catch (err){ toast(explain(err), true); }
    renderSaved();
    return;
  }
  if (btn.dataset.stat){
    const d = saved.find(x => x.id === id); if (!d) return;
    const key = btn.dataset.stat, on = btn.getAttribute('aria-pressed') !== 'true';
    const off = new Set(d.statsOff || []); on ? off.delete(key) : off.add(key);
    btn.setAttribute('aria-pressed', String(on)); btn.disabled = true;
    try {
      await setDiveStats(d, [...off], key === 'sac' && on && d.noSac);
      d.statsOff = [...off]; if (key === 'sac' && on) d.noSac = false;
      toast(`${on ? 'Cuenta' : 'Ya no cuenta'} en ${STAT_TITLES[key]}`);
    } catch (err){ btn.setAttribute('aria-pressed', String(!on)); toast(explain(err), true); }
    btn.disabled = false;
    return;
  }
  if (btn.dataset.act === 'web'){
    const d = saved.find(x => x.id === id); if (!d) return;
    const on = btn.getAttribute('aria-checked') !== 'true';
    const patch = { hidden: !on };
    btn.setAttribute('aria-checked', String(on)); btn.disabled = true;
    try {
      await setDiveFlags(id, patch); Object.assign(d, patch); updateKpis();
      toast(on ? 'Se muestra en la web' : 'Oculta en la web');
    } catch (err){ btn.setAttribute('aria-checked', String(!on)); toast(explain(err), true); }
    btn.disabled = false;
    return;
  }
  if (btn.dataset.act === 'notes'){
    notesOpen = notesOpen === id ? null : id; renderSaved(); return;
  }
  if (btn.dataset.act === 'notes-cancel'){ notesOpen = null; renderSaved(); return; }
  if (btn.dataset.act === 'notes-save'){ saveNotes(li); return; }
  if (btn.dataset.act === 'ask'){
    side.innerHTML = '<span class="confirm">¿Borrar?</span><button class="btn danger small" type="button" data-act="yes">Sí, borrar</button><button class="btn small" type="button" data-act="no">No</button>';
  } else if (btn.dataset.act === 'no'){
    renderSaved();
  } else if (btn.dataset.act === 'yes'){
    btn.disabled = true;
    try { await deleteDive(id); toast('Inmersión borrada'); await refresh(); }
    catch (err){ toast(explain(err), true); renderSaved(); }
  }
});

// notes editor: live counter, ⌘/Ctrl+Enter saves, Esc cancels
$('logList').addEventListener('input', e => {
  if (!e.target.matches('.notes-edit textarea')) return;
  e.target.closest('.notes-edit').querySelector('.notes-count').textContent = `${e.target.value.length} / ${NOTES_MAX}`;
});
$('logList').addEventListener('keydown', e => {
  if (!e.target.matches('.notes-edit textarea')) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); saveNotes(e.target.closest('.row')); }
  else if (e.key === 'Escape'){ notesOpen = null; renderSaved(); }
});

/* ---------- certifications ---------- */
let editing = null;   // id of the certification in the form, or 'new'
const monthYear = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

async function refreshCerts(){
  try { certs = await listCerts(); }
  catch (err){
    certs = [];
    $('certEmpty').textContent = explain(err); $('certEmpty').hidden = false;
    $('certList').innerHTML = ''; $('certAdd').disabled = true;
    return;
  }
  $('certAdd').disabled = false;
  $('certEmpty').textContent = 'Aún no hay titulaciones. Añade la primera.';
  renderCerts();
}

function renderCerts(){
  updateKpis();
  $('certEmpty').hidden = certs.length > 0;
  $('certList').innerHTML = certs.map(c => {
    const meta = [c.agency, c.status === 'planned' ? 'pendiente' : c.obtained_on ? monthYear(c.obtained_on) : 'sin fecha', c.center].filter(Boolean).join(' · ');
    return `<li class="row" data-id="${esc(c.id)}">
      <span class="row-no">${c.status === 'planned' ? '○' : '●'}</span>
      <div class="row-main"><div class="row-title">${esc(c.title)}</div><div class="row-meta">${esc(meta)}</div></div>
      <div class="row-side">${c.status === 'planned' ? '<span class="chip planned">Pendiente</span>' : ''}
        <button class="btn small" type="button" data-act="edit">Editar</button>
        <button class="btn danger small" type="button" data-act="ask">Borrar</button></div>
    </li>`;
  }).join('');
}

function setStatus(status){
  $('certForm').querySelectorAll('[data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
  $('cDate').disabled = status === 'planned';
  if (status === 'planned') $('cDate').value = '';
}
const formStatus = () => $('certForm').querySelector('[data-status][aria-pressed="true"]').dataset.status;

function openForm(c){
  editing = c ? c.id : 'new';
  $('cTitle').value = c?.title ?? ''; $('cAgency').value = c?.agency ?? ''; $('cCenter').value = c?.center ?? '';
  $('cDate').value = c?.obtained_on ?? '';
  setStatus(c?.status ?? 'done');
  $('certSave').textContent = c ? 'Guardar cambios' : 'Añadir titulación';
  $('certForm').hidden = false; $('certAdd').hidden = true;
  $('cTitle').focus();
}
function closeForm(){ editing = null; $('certForm').hidden = true; $('certAdd').hidden = false; }

$('certAdd').addEventListener('click', () => openForm(null));
$('certCancel').addEventListener('click', closeForm);
$('certForm').addEventListener('click', e => { const b = e.target.closest('[data-status]'); if (b) setStatus(b.dataset.status); });
$('certForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('cTitle').value.trim();
  if (!title){ toast('Escribe el nombre de la titulación.', true); $('cTitle').focus(); return; }
  const cert = { id: editing === 'new' ? null : editing, title, agency: $('cAgency').value.trim(), center: $('cCenter').value.trim(), status: formStatus(), obtained_on: $('cDate').value || null };
  const btn = $('certSave'); btn.disabled = true;
  try { await saveCert(cert); toast(cert.id ? 'Titulación actualizada' : 'Titulación añadida'); closeForm(); await refreshCerts(); }
  catch (err){ toast(explain(err), true); }
  btn.disabled = false;
});
$('certList').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const li = btn.closest('.row'), id = li.dataset.id, side = li.querySelector('.row-side');
  if (btn.dataset.act === 'edit') openForm(certs.find(c => String(c.id) === id));
  else if (btn.dataset.act === 'ask') side.innerHTML = '<span class="confirm">¿Borrar?</span><button class="btn danger small" type="button" data-act="yes">Sí, borrar</button><button class="btn small" type="button" data-act="no">No</button>';
  else if (btn.dataset.act === 'no') renderCerts();
  else if (btn.dataset.act === 'yes'){
    btn.disabled = true;
    try { await deleteCert(id); toast('Titulación borrada'); if (editing === id) closeForm(); await refreshCerts(); }
    catch (err){ toast(explain(err), true); renderCerts(); }
  }
});

/* ---------- import ---------- */
// iOS greys out files whose extension it does not know (.uddf), so phones get no filter: the parser checks anyway
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) $('files').removeAttribute('accept');

async function readFiles(files){
  const found = [];
  for (const f of files){
    try {
      const dives = parseUDDF(await f.text());
      dives.forEach(dive => found.push({ dive, file: f.name }));
    } catch (err){
      pending.push({ status: 'bad', file: f.name, error: err.message });
    }
  }
  // what is already saved, or already chosen in this batch, is skipped
  const already = [...saved, ...pending.filter(p => p.status === 'new').map(p => p.dive)];
  const { added } = mergeDives(already, found.map(f => f.dive));
  const isNew = new Set(added.map(d => d.id));
  for (const f of found) pending.push({ dive: f.dive, file: f.file, status: isNew.has(f.dive.id) ? 'new' : 'dup' });
  renderPreview();
}

function renderPreview(){
  $('preview').hidden = pending.length === 0;
  const chip = { new: '<span class="chip new">Nueva</span>', dup: '<span class="chip dup">Ya está</span>' };
  $('previewList').innerHTML = pending.map(p => p.status === 'bad'
    ? `<li class="row"><span class="row-no"></span><div class="row-main"><div class="row-title">${esc(p.file)}</div><div class="row-meta">${esc(p.error)}</div></div><div class="row-side"><span class="chip bad">No se puede leer</span></div></li>`
    : row(p.dive, chip[p.status])).join('');
  const n = pending.filter(p => p.status === 'new').length;
  const btn = $('importBtn');
  btn.textContent = n ? `Importar ${n} ${n === 1 ? 'inmersión' : 'inmersiones'}` : 'Nada nuevo que importar';
  btn.disabled = n === 0;
}

$('files').addEventListener('change', e => { readFiles([...e.target.files]); e.target.value = ''; });
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => readFiles([...e.dataTransfer.files]));
$('clearBtn').addEventListener('click', () => { pending = []; renderPreview(); });

$('importBtn').addEventListener('click', async () => {
  const fresh = pending.filter(p => p.status === 'new').map(p => p.dive);
  if (!fresh.length) return;
  const btn = $('importBtn'); btn.disabled = true; btn.textContent = 'Importando…';
  try {
    await insertDives(fresh);
    toast(`${fresh.length} ${fresh.length === 1 ? 'inmersión importada' : 'inmersiones importadas'}`);
    pending = []; renderPreview();
    await refresh();
  } catch (err){
    toast(explain(err), true);
    renderPreview();
  }
});

/* ---------- session ---------- */
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim(), password = $('password').value;
  const err = $('loginError'), btn = $('loginBtn');
  if (!email || !password){ err.textContent = 'Escribe tu email y tu contraseña.'; err.hidden = false; return; }
  err.hidden = true; btn.disabled = true; btn.textContent = 'Entrando…';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error){ err.textContent = explain(error); err.hidden = false; $('password').select(); }
});

$('logout').addEventListener('click', async () => { await supabase.auth.signOut(); });

(async () => {
  if (!configured){ show('notConfigured'); return; }
  const { data } = await supabase.auth.getSession();
  if (data.session) await enterPanel(data.session); else show('login');
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && $('panel').hidden) enterPanel(session);
    if (event === 'SIGNED_OUT') leavePanel();
  });
})();

/* ---------- backup ---------- */
const BACKUP_KEY = 'bitacora-last-backup';
const day = iso => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
function showLastBackup(){
  let iso = null; try { iso = localStorage.getItem(BACKUP_KEY); } catch (e) {}
  $('backupLast').hidden = !iso;
  if (iso) $('backupLast').textContent = `Última copia: ${day(iso)} (desde este navegador)`;
}
showLastBackup();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const describe = t => [plural((t.dives || []).length, 'inmersión', 'inmersiones'), plural((t.certifications || []).length, 'titulación', 'titulaciones'), plural((t.species_seen || []).length, 'especie vista', 'especies vistas')].join(', ');

$('backupBtn').addEventListener('click', async () => {
  const btn = $('backupBtn'); btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const backup = await exportAll();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bitacora-copia-${backup.exported_at.slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    try { localStorage.setItem(BACKUP_KEY, backup.exported_at); } catch (e) {}
    showLastBackup();
    toast(`Copia descargada: ${describe(backup.tables)}`);
  } catch (err){ toast(explain(err), true); }
  btn.disabled = false; btn.textContent = 'Descargar copia';
});

let restoring = null;
$('restoreFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    restoring = readBackup(await file.text());
    $('restoreSummary').innerHTML = `<strong>${esc(file.name)}</strong> · copia del ${esc(day(restoring.exported_at))}: ${esc(describe(restoring.tables))}.`;
    $('restoreConfirm').hidden = false;
  } catch (err){
    restoring = null;
    toast(err instanceof SyntaxError ? 'El archivo no se puede leer: no es un JSON válido.' : explain(err), true);
  }
});
$('restoreCancel').addEventListener('click', () => { restoring = null; $('restoreConfirm').hidden = true; });
$('restoreGo').addEventListener('click', async () => {
  if (!restoring) return;
  const btn = $('restoreGo'); btn.disabled = true; btn.textContent = 'Restaurando…';
  try {
    await restoreAll(restoring);
    toast(`Copia restaurada: ${describe(restoring.tables)}`);
    $('restoreConfirm').hidden = true;
    await refresh();
    if (adminAlbum){
      adminAlbum.setSeen(await listSeen());
      const total = $('albumCount').textContent.split('/')[1]?.trim();
      if (total) $('albumCount').textContent = `${adminAlbum.count()} / ${total}`;
    }
    restoring = null;
  } catch (err){ toast(explain(err), true); }
  btn.disabled = false; btn.textContent = 'Restaurar';
});

/* ---------- weather at the surface ---------- */
let settingsData = {}, wxCfg = normalizeWx(null), wxTimer = 0;
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/></svg>';
async function loadWeather(){
  try { settingsData = (await getSettings()) || {}; }
  catch (err){ settingsData = {}; toast(explain(err), true); }
  wxCfg = normalizeWx(settingsData.weather);
  renderWeather();
}
function renderWeather(){
  const ch = chances(wxCfg);
  $('wxStatus').textContent = wxCfg.fixed ? `Siempre: ${STATE_NAMES[wxCfg.fixed]}` : 'Aleatorio';
  $('wxList').classList.toggle('is-fixed', !!wxCfg.fixed);
  $('wxList').innerHTML = STATES.map(k => {
    const on = wxCfg.enabled[k], pinned = wxCfg.fixed === k;
    return `<li class="wx-row${pinned ? ' is-pinned' : ''}${on ? '' : ' is-off'}" data-k="${k}">
      <span class="wx-name">${STATE_NAMES[k]}<small>${pinned ? 'siempre' : Math.round(ch[k] * 100) + ' %'}</small></span>
      <input class="wx-weight" type="range" min="0" max="100" step="1" value="${wxCfg.weights[k]}" aria-label="Peso de ${STATE_NAMES[k]}" ${on && !wxCfg.fixed ? '' : 'disabled'}>
      ${sw('wx-on', on, 'Activo', `Que ${STATE_NAMES[k].toLowerCase()} pueda salir`)}
      <button class="wx-pin" type="button" data-act="wx-pin" aria-pressed="${pinned}" title="${pinned ? 'Volver al sorteo' : 'Que salga siempre'}" aria-label="Fijar ${STATE_NAMES[k]}">${PIN}</button>
    </li>`;
  }).join('');
  $('wxPreview').href = '/?tiempo=' + STATE_PARAM[wxCfg.fixed || 'storm'];
  $('wxPreview').textContent = wxCfg.fixed ? 'Ver en la web ↗' : 'Ver la tormenta en la web ↗';
}
function saveWeather(msg){
  clearTimeout(wxTimer);
  wxTimer = setTimeout(async () => {
    try { settingsData = { ...settingsData, weather: wxCfg }; await saveSettings(settingsData); toast(msg || 'Tiempo guardado'); }
    catch (err){ toast(explain(err), true); }
  }, 450);
}
$('wxList').addEventListener('input', e => {
  if (!e.target.matches('.wx-weight')) return;
  const k = e.target.closest('.wx-row').dataset.k;
  wxCfg.weights[k] = +e.target.value;
  // live percentages without rebuilding the row under the finger
  const ch = chances(wxCfg);
  $('wxList').querySelectorAll('.wx-row').forEach(r => { if (!r.classList.contains('is-pinned')) r.querySelector('small').textContent = Math.round(ch[r.dataset.k] * 100) + ' %'; });
  saveWeather();
});
$('wxList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.closest('.wx-row').dataset.k;
  if (b.dataset.act === 'wx-on'){
    wxCfg.enabled[k] = b.getAttribute('aria-checked') !== 'true';
    if (!wxCfg.enabled[k] && wxCfg.fixed === k) wxCfg.fixed = null;
    renderWeather(); saveWeather(`${STATE_NAMES[k]}: ${wxCfg.enabled[k] ? 'puede salir' : 'ya no sale'}`);
  } else if (b.dataset.act === 'wx-pin'){
    wxCfg.fixed = wxCfg.fixed === k ? null : k;
    if (wxCfg.fixed) wxCfg.enabled[k] = true;
    renderWeather(); saveWeather(wxCfg.fixed ? `Siempre ${STATE_NAMES[k].toLowerCase()}` : 'Vuelve el sorteo');
  }
});
$('wxReset').addEventListener('click', () => { wxCfg = normalizeWx(DEFAULT_WX); renderWeather(); saveWeather('Tiempo con los valores por defecto'); });
