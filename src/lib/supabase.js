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
