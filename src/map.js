import land from './data/land.json';

/*
 * Map of the places I have dived: just the coastline (prebuilt by scripts/build-land.mjs) and
 * a dot per site, with no tiles and no background, so the sea of the page shows through.
 * Land and dots share Mercator units; the view is fitted to the sites and to the box size.
 */
const U = land.unitsPerDeg;
const MIN_SPAN = 4 * U;          // never zoom in closer than about 4 degrees across
const PAD = 0.18;                // room around the sites, as a share of the view
const fmt = (n, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const project = (lon, lat) => [lon * U, -U * 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];

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
  const sites = groupSites(dives).filter(s => s.lat != null).map(s => ({ ...s, p: project(s.lon, s.lat) }));
  if (!sites.length) return null;

  el.innerHTML = `<svg class="map-land" aria-hidden="true" preserveAspectRatio="none"><path d="${land.d}"/></svg><div class="sites"></div>` +
    '<div class="site-tip" role="presentation" hidden></div>';
  const svg = el.querySelector('svg'), layer = el.querySelector('.sites'), tip = el.querySelector('.site-tip');
  const radius = n => 3.5 + 1.6 * Math.sqrt(n);
  const many = n => `${n} ${n === 1 ? 'inmersión' : 'inmersiones'}`;

  // bounds of the sites, padded, at least MIN_SPAN wide, stretched to the shape of the box
  const xs = sites.map(s => s.p[0]), ys = sites.map(s => s.p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w0 = Math.max(...xs) - Math.min(...xs) || 1, h0 = Math.max(...ys) - Math.min(...ys) || 1;
  let groups = [];

  function layout(){
    const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
    const aspect = W / H;
    let w = w0 / (1 - 2 * PAD), h = h0 / (1 - 2 * PAD);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    if (w < MIN_SPAN){ w = MIN_SPAN; h = w / aspect; }
    const vx = cx - w / 2, vy = cy - h / 2;
    svg.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);

    // sites whose dots would touch at this size become one dot (e.g. two coves a few km apart)
    groups = [];
    for (const s of sites){
      const px = (s.p[0] - vx) / w * W, py = (s.p[1] - vy) / h * H;
      const g = groups.find(g => Math.hypot(g.px - px, g.py - py) < radius(g.n) + radius(s.n) + 6);
      if (g){ g.px = (g.px * g.n + px * s.n) / (g.n + s.n); g.py = (g.py * g.n + py * s.n) / (g.n + s.n); g.n += s.n; g.sites.push(s); }
      else groups.push({ px, py, n: s.n, sites: [s] });
    }
    layer.innerHTML = groups.map((g, i) => {
      const names = g.sites.map(s => s.name);
      const label = names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(' · ');
      const aria = g.sites.map(s => `${s.name}: ${many(s.n)}, máxima ${fmt(s.maxDepth)} metros`).join('; ');
      return `<button class="site" type="button" data-i="${i}" style="left:${g.px / W * 100}%;top:${g.py / H * 100}%;--r:${radius(g.n).toFixed(1)}px" aria-label="${esc(aria)}">` +
        `<span class="site-dot" aria-hidden="true"></span><span class="site-label" aria-hidden="true">${esc(label)}</span></button>`;
    }).join('');
    placeLabels();
  }

  // names next to the dots, biggest sites first; a name that would overlap another is left out
  // (it still shows on hover or tap)
  function placeLabels(){
    const buttons = [...layer.children];
    const taken = buttons.map(b => b.querySelector('.site-dot').getBoundingClientRect());
    const box = el.getBoundingClientRect(), shown = [];
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    buttons.forEach((b, i) => {
      const label = b.querySelector('.site-label');
      for (const side of ['right', 'left', null]){
        if (!side){ b.classList.add('lbl-off'); return; }
        b.classList.toggle('lbl-left', side === 'left');
        const r = label.getBoundingClientRect();
        const inside = r.left >= box.left + 2 && r.right <= box.right - 2 && r.top >= box.top && r.bottom <= box.bottom;
        if (inside && !shown.some(o => hit(r, o)) && !taken.some((t, j) => j !== i && hit(r, t))){ shown.push(r); return; }
      }
    });
  }

  function showTip(b){
    const g = groups[+b.dataset.i];
    tip.innerHTML = g.sites.map(s => `<strong>${esc(s.name)}</strong><span>${many(s.n)} · máx. ${fmt(s.maxDepth)} m</span>`).join('');
    tip.style.left = b.style.left; tip.style.top = b.style.top; tip.hidden = false;
    b.classList.add('is-active');
  }
  let pinned = null; // the dot whose card stays open after a tap
  function hideTip(b){ tip.hidden = true; b.classList.remove('is-active'); if (pinned === b) pinned = null; }
  const site = e => e.target.closest?.('.site');
  // mouse: the card follows the pointer
  layer.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const b = site(e); if (b) showTip(b); });
  layer.addEventListener('pointerout', e => { if (e.pointerType !== 'mouse') return; const b = site(e); if (b && !b.contains(e.relatedTarget)) hideTip(b); });
  // touch (and clicks): a tap opens the card and leaves it open; tapping the dot again or anywhere else closes it
  layer.addEventListener('click', e => {
    const b = site(e); if (!b) return;
    if (pinned === b){ hideTip(b); return; }
    if (pinned) hideTip(pinned);
    layer.querySelectorAll('.site.is-active').forEach(x => x.classList.remove('is-active'));
    showTip(b); pinned = b;
  });
  document.addEventListener('pointerdown', e => { if (pinned && !e.target.closest?.('.site')) hideTip(pinned); });
  // keyboard
  layer.addEventListener('focusin', e => { const b = site(e); if (b && b.matches(':focus-visible')) showTip(b); });
  layer.addEventListener('focusout', e => { const b = site(e); if (b && pinned !== b) hideTip(b); });

  let last = '';
  const relayout = () => { const k = el.clientWidth + 'x' + el.clientHeight; if (k !== last){ last = k; layout(); } };
  relayout();
  new ResizeObserver(relayout).observe(el);
  document.fonts?.ready.then(layout);
  return { layout };
}
