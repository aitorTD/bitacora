import './page.css';
import './ui.css';
import { inject } from '@vercel/analytics';
import { createAlbum } from './ui.js';

// Public album: read-only. What has been seen is edited from the admin dashboard.
inject();
const root = document.getElementById('album');
(async () => {
  let rows = [];
  if (import.meta.env.VITE_SUPABASE_URL){
    try { rows = await (await import('../lib/supabase.js')).listSeen(); }
    catch (err){ console.warn('Álbum:', err.message || err); }
  }
  createAlbum(root, { seen: rows });
})();
