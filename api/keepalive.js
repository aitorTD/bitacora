// Daily ping so the free Supabase project never counts as inactive (free projects pause after a
// quiet week). Vercel calls it once a day (see "crons" in vercel.json); it reads one row.
// The URL and the publishable key are public by design (they are in .env and in the site itself).
const URL = process.env.VITE_SUPABASE_URL || 'https://uszmsjnkmfggiwouqprm.supabase.co';
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_nzcmGKhu-bH9vx-khpn2dA_vma3FUVM';

export default async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  try {
    const r = await fetch(`${URL}/rest/v1/dives?select=id&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (err){
    res.status(502).json({ ok: false, error: String(err) });
  }
}
