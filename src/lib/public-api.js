/*
 * Read-only access for the public pages: plain fetch calls to Supabase's REST API with the
 * publishable key. The landing page only reads, so it skips the full supabase-js client (~60 kB
 * gzipped); the admin panel, which signs in and writes, keeps using src/lib/supabase.js.
 */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function get(path){
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok){ const e = new Error(`Supabase ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

export async function listDives(){
  const rows = await get('dives?select=data,hidden,no_sac&order=start_at.desc');
  return rows.map(r => ({ ...r.data, hidden: !!r.hidden, noSac: !!r.no_sac }));
}
// obtained ones by date, then the planned ones
export function sortCerts(list){
  return [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === 'done' ? -1 : 1)
    || String(a.obtained_on || '9999').localeCompare(String(b.obtained_on || '9999'))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}
export async function listCerts(){ return sortCerts(await get('certifications?select=*')); }
export async function listSeen(){ return get('species_seen?select=species_id'); }
export async function getSettings(){ const rows = await get('settings?select=data&id=eq.1'); return rows[0] ? rows[0].data : null; }
