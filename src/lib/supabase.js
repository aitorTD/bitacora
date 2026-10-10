import { createClient } from '@supabase/supabase-js';

/*
 * Supabase client. The URL and the anon key are public by design: what visitors and the
 * admin may do is decided by the row level security policies in supabase/schema.sql.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

// Each dive carries two flags set from the admin: hidden (not shown on the web) and noSac
// (left out of the air consumption, e.g. a training dive with many ascents).
export async function listDives(){
  let res = await supabase.from('dives').select('data, hidden, no_sac').order('start_at', { ascending: false });
  // before supabase/migrations/002_ajustes.sql is run the flag columns do not exist yet
  if (res.error && /hidden|no_sac|column/i.test(res.error.message)) res = await supabase.from('dives').select('data').order('start_at', { ascending: false });
  if (res.error) throw res.error;
  return res.data.map(r => ({ ...r.data, hidden: !!r.hidden, noSac: !!r.no_sac }));
}

export async function setDiveFlags(id, { hidden, noSac }){
  const patch = {};
  if (hidden !== undefined) patch.hidden = hidden;
  if (noSac !== undefined) patch.no_sac = noSac;
  const { error } = await supabase.from('dives').update(patch).eq('id', id);
  if (error) throw error;
}

// statsOff: the statistics this dive is left out of; kept inside the dive's data
export async function setDiveStats(dive, statsOff, clearNoSac = false){
  const { hidden, noSac, ...data } = dive;
  const patch = { data: { ...data, statsOff } };
  if (clearNoSac) patch.no_sac = false;
  const { error } = await supabase.from('dives').update(patch).eq('id', dive.id);
  if (error) throw error;
}

export async function setDiveType(dive, type){
  const { hidden, noSac, ...data } = dive;
  const { error } = await supabase.from('dives').update({ data: { ...data, type } }).eq('id', dive.id);
  if (error) throw error;
}

// notes live inside the dive's data, like everything Pro Dive exports; empty clears them
export async function setDiveNotes(dive, notes){
  const { hidden, noSac, notes: _old, ...data } = dive;
  const { error } = await supabase.from('dives').update({ data: notes ? { ...data, notes } : data }).eq('id', dive.id);
  if (error) throw error;
}

export async function getSettings(){
  const { data, error } = await supabase.from('settings').select('data').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

export async function saveSettings(settings){
  const { error } = await supabase.from('settings').upsert({ id: 1, data: settings, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function insertDives(dives){
  if (!dives.length) return;
  const rows = dives.map(({ hidden, noSac, ...d }) => ({ id: d.id, start_at: d.start, data: d }));
  const { error } = await supabase.from('dives').insert(rows);
  if (error) throw error;
}

export async function deleteDive(id){
  const { error } = await supabase.from('dives').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- certifications ---------- */
export async function listCerts(){
  const { data, error } = await supabase.from('certifications').select('*');
  if (error) throw error;
  return sortCerts(data);
}
// obtained ones by date, then the planned ones
export function sortCerts(list){
  return [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === 'done' ? -1 : 1)
    || String(a.obtained_on || '9999').localeCompare(String(b.obtained_on || '9999'))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}
export async function saveCert(cert){
  const row = { title: cert.title, agency: cert.agency || null, center: cert.center || null, obtained_on: cert.obtained_on || null, status: cert.status };
  const q = cert.id ? supabase.from('certifications').update(row).eq('id', cert.id) : supabase.from('certifications').insert(row);
  const { error } = await q;
  if (error) throw error;
}
export async function deleteCert(id){
  const { error } = await supabase.from('certifications').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- species album ---------- */
export async function listSeen(){
  const { data, error } = await supabase.from('species_seen').select('species_id');
  if (error) throw error;
  return data;
}
export async function markSeen(speciesId){
  const { error } = await supabase.from('species_seen').upsert({ species_id: speciesId });
  if (error) throw error;
}
export async function unmarkSeen(speciesId){
  const { error } = await supabase.from('species_seen').delete().eq('species_id', speciesId);
  if (error) throw error;
}

/* ---------- backup: every table to one JSON file, and back ---------- */
const BACKUP_TABLES = { settings: 'id', certifications: 'id', dives: 'id', species_seen: 'species_id' };
async function selectAll(table){
  const rows = [];
  for (let from = 0; ; from += 1000){
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
export async function exportAll(){
  const tables = {};
  for (const t of Object.keys(BACKUP_TABLES)) tables[t] = await selectAll(t);
  return { app: 'bitacora', version: 1, exported_at: new Date().toISOString(), tables };
}
export function readBackup(json){
  const b = typeof json === 'string' ? JSON.parse(json) : json;
  if (!b || b.app !== 'bitacora' || !b.tables) throw new Error('Este archivo no es una copia de la bitácora.');
  return b;
}
// upserts: what is in the copy is written back, nothing that is only in the database is deleted
export async function restoreAll(backup){
  const counts = {};
  for (const [t, key] of Object.entries(BACKUP_TABLES)){
    const rows = backup.tables[t] || [];
    for (let i = 0; i < rows.length; i += 200){
      const { error } = await supabase.from(t).upsert(rows.slice(i, i + 200), { onConflict: key });
      if (error) throw error;
    }
    counts[t] = rows.length;
  }
  return counts;
}
