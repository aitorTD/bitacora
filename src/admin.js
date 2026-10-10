import './admin.css';
import { configured, supabase, listDives, insertDives, deleteDive } from './lib/supabase.js';
import { parseUDDF } from './lib/uddf.js';
import { mergeDives } from './lib/logbook.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const when = iso => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

let saved = [];      // dives in Supabase
let pending = [];    // parsed from the chosen files: { dive, status: 'new' | 'dup' | 'bad', file, error }

function toast(msg, isError = false){
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('err', isError); t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
}

function explain(err){
  const m = (err && (err.message || err.error_description)) || String(err);
  if (/invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
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
}

function row(d, side){
  const no = d.number != null ? `nº ${d.number}` : '';
  return `<li class="row" data-id="${esc(d.id)}">
    <span class="row-no">${esc(no)}</span>
    <div class="row-main">
      <div class="row-title">${esc(d.site?.name || 'Sin sitio')}</div>
      <div class="row-meta">${esc(when(d.start))} · ${fmt(d.maxDepth)} m · ${clock(d.duration)}</div>
    </div>
    <div class="row-side">${side}</div>
  </li>`;
}

function renderSaved(){
  $('count').textContent = saved.length ? `${saved.length} ${saved.length === 1 ? 'inmersión' : 'inmersiones'}` : '';
  $('logEmpty').hidden = saved.length > 0;
  $('logList').innerHTML = saved.map(d => row(d, '<button class="btn danger small" type="button" data-act="ask">Borrar</button>')).join('');
}

$('logList').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const li = btn.closest('.row'), side = li.querySelector('.row-side'), id = li.dataset.id;
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

/* ---------- import ---------- */
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
