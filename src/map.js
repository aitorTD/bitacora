import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/*
 * Map of the places I have dived. Sites are grouped by name; each marker grows with the
 * number of dives there. Tiles follow the day / night mode of the page.
 */
const TILES = {
  day: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  night: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const fmt = (n, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function groupSites(dives){
  const map = new Map();
  for (const d of dives){
    const s = d.site || {}; const name = s.name || 'Sin nombre';
    const g = map.get(name) || { name, n: 0, lat: 0, lon: 0, located: 0, maxDepth: 0, last: null };
    g.n++; g.maxDepth = Math.max(g.maxDepth, d.maxDepth || 0);
    if (!g.last || d.start > g.last) g.last = d.start;
    if (s.lat != null && s.lon != null){ g.lat += s.lat; g.lon += s.lon; g.located++; }
    map.set(name, g);
  }
  return [...map.values()].map(g => ({ ...g, lat: g.located ? g.lat / g.located : null, lon: g.located ? g.lon / g.located : null }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export function renderMap(el, dives){
  const sites = groupSites(dives).filter(s => s.lat != null);
  if (!sites.length) return null;
  const map = L.map(el, {
    zoomControl: true, attributionControl: true, scrollWheelZoom: false,
    dragging: !L.Browser.mobile, tap: false, worldCopyJump: true,
  });
  const mode = () => (document.documentElement.getAttribute('data-dive') === 'night' ? 'night' : 'day');
  let tiles = L.tileLayer(TILES[mode()], { subdomains: 'abcd', maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>' }).addTo(map);
  new MutationObserver(() => tiles.setUrl(TILES[mode()])).observe(document.documentElement, { attributes: true, attributeFilter: ['data-dive'] });

  for (const s of sites){
    const r = 5 + 3.2 * Math.sqrt(s.n);
    L.circleMarker([s.lat, s.lon], { radius: r, className: 'site-dot', weight: 2 })
      .bindTooltip(`<strong>${esc(s.name)}</strong><br>${s.n} ${s.n === 1 ? 'inmersión' : 'inmersiones'} · máx. ${fmt(s.maxDepth)} m`, { direction: 'top', offset: [0, -r], className: 'site-tip' })
      .addTo(map);
  }
  map.fitBounds(L.latLngBounds(sites.map(s => [s.lat, s.lon])), { padding: [28, 28], maxZoom: 9 });
  // the map lives in a panel that can change size while the page lays out
  new ResizeObserver(() => map.invalidateSize()).observe(el);
  return map;
}
