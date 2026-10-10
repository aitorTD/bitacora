import { createClient } from '@supabase/supabase-js';

/*
 * Supabase client. The URL and the anon key are public by design: what visitors and the
 * admin may do is decided by the row level security policies in supabase/schema.sql.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

export async function listDives(){
  const { data, error } = await supabase.from('dives').select('data').order('start_at', { ascending: false });
  if (error) throw error;
  return data.map(r => r.data);
}

export async function insertDives(dives){
  if (!dives.length) return;
  const rows = dives.map(d => ({ id: d.id, start_at: d.start, data: d }));
  const { error } = await supabase.from('dives').insert(rows);
  if (error) throw error;
}

export async function deleteDive(id){
  const { error } = await supabase.from('dives').delete().eq('id', id);
  if (error) throw error;
}
