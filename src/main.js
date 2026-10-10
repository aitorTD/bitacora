import './styles.css';
import { inject } from '@vercel/analytics';
import localDives from './data/dives.json';
import { summarize, sac, statOn, normalizeDive } from './lib/logbook.js';

var MAXD = 40;
var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function fmt(n, d){ d = d == null ? 1 : d; return n.toLocaleString('es-ES',{minimumFractionDigits:d, maximumFractionDigits:d}); }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function clock(sec){ var m = Math.floor(sec / 60), s = Math.round(sec % 60); if (s === 60){ m++; s = 0; } return m + ':' + (s < 10 ? '0' : '') + s; }
function hoursMin(sec){ var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? [h + '', 'h ' + m + ' min'] : [m + '', 'min']; }
var TZ = 'Europe/Madrid';
function dateLabel(iso, withTime){
  var d = new Date(iso);
  var s = d.toLocaleDateString('es-ES', {day:'numeric', month:'short', year:'numeric', timeZone:TZ});
  return withTime ? s + ' · ' + d.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit', timeZone:TZ}) : s;
}
function gasName(g){ return ({Air:'aire', Nitrox:'nitrox'})[g] || (g ? g.toLowerCase() : 'aire'); }
function coords(site){
  if (site.lat == null || site.lon == null) return '';
  return fmt(Math.abs(site.lat), 4) + '° ' + (site.lat >= 0 ? 'N' : 'S') + ' · ' + fmt(Math.abs(site.lon), 4) + '° ' + (site.lon >= 0 ? 'E' : 'O');
}

/* ---------- Logbook: from Supabase when it is configured, else the bundled dives.json ---------- */
const DEFAULTS = { stats: { count: true, time: true, maxDepth: true, avgDepth: true, minTemp: true, sac: true }, showDives: true };
async function loadLogbook(){
  if (!import.meta.env.VITE_SUPABASE_URL) return { dives: localDives, certs: [], settings: DEFAULTS };
  try {
    const { listDives, listCerts, listSeen } = await import('./lib/supabase.js');
    // how much of the species album is filled in, shown on the link to it
    Promise.all([listSeen(), import('./album/species.js')]).then(([rows, m]) => {
      const ids = new Set(m.SPECIES.map(s => s.id)), n = rows.filter(r => ids.has(r.species_id)).length;
      document.getElementById('albumCount').textContent = n + ' / ' + m.SPECIES.length;
      document.getElementById('navAlbumCount').textContent = n + '/' + m.SPECIES.length;
    }).catch(() => {});
    const [dives, certs] = await Promise.all([listDives(), listCerts().catch(() => [])]);
    return { dives: dives.length ? dives.filter(d => !d.hidden) : localDives, certs, settings: DEFAULTS };
  } catch (err){
    console.warn('No se pudieron leer las inmersiones de Supabase; uso la copia local.', err);
    return { dives: localDives, certs: [], settings: DEFAULTS };
  }
}
loadLogbook().then(({ dives, certs, settings }) => {
  dives = dives.map(normalizeDive);
  renderCerts(certs);
  renderSites(dives);
  renderLogbook(dives, settings);
});

/* ---------- Certifications: a short timeline, obtained first, then the ones still to come ---------- */
function renderCerts(certs){
  if (!certs || !certs.length){ removeSection('h-cert'); return; }
  var month = function(iso){ return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }); };
  document.getElementById('certs').innerHTML = certs.map(function(c){
    var planned = c.status === 'planned';
    var meta = [c.agency, planned ? 'Próximamente' : (c.obtained_on ? month(c.obtained_on) : ''), c.center].filter(Boolean).map(esc).join(' · ');
    return '<li class="cert' + (planned ? ' is-planned' : '') + '"><span class="cert-dot" aria-hidden="true"></span>' +
      '<div class="cert-txt"><span class="cert-title">' + esc(c.title) + '</span>' + (meta ? '<span class="cert-meta">' + meta + '</span>' : '') + '</div></li>';
  }).join('');
}

/* ---------- Map of dive sites (the coastline loads only here) ---------- */
function renderSites(dives){
  var located = dives.filter(function(d){ return d.site && d.site.lat != null; });
  if (!located.length){ removeSection('h-map'); return; }
  import('./map.js').then(function(m){
    m.renderMap(document.getElementById('map'), dives);
  }).catch(function(err){ console.warn('Map failed to load', err); removeSection('h-map'); });
}

/* ---------- Small graphics for each statistic on a dive card (40×40, theme colours) ---------- */
function clamp01(v){ return Math.max(0, Math.min(1, v || 0)); }
function icoSvg(inner, title){ return '<svg class="dstat-g" viewBox="0 0 40 40" aria-hidden="true">' + inner + '</svg>'; }
// depth reached on a 0–40 m column
function icoDepth(f){
  f = clamp01(f); var y = 5 + 30 * f;
  return icoSvg('<line x1="20" y1="5" x2="20" y2="35" class="g-track"/><line x1="20" y1="5" x2="20" y2="' + y.toFixed(1) + '" class="g-fill"/>' +
    '<line x1="14" y1="5" x2="26" y2="5" class="g-track"/><path d="M15 ' + (y - 3).toFixed(1) + 'L20 ' + (y + 2).toFixed(1) + 'L25 ' + (y - 3).toFixed(1) + '" class="g-mark"/>');
}
// minutes on a one-hour dial
function icoRing(f){
  f = clamp01(f); var a = f * Math.PI * 2 - Math.PI / 2, x = 20 + 14 * Math.cos(a), y = 20 + 14 * Math.sin(a);
  var arc = f >= .999 ? '<circle cx="20" cy="20" r="14" class="g-fill"/>' :
    '<path d="M20 6A14 14 0 ' + (f > .5 ? 1 : 0) + ' 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + '" class="g-fill"/>';
  return icoSvg('<circle cx="20" cy="20" r="14" class="g-track"/>' + arc + '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="2.4" class="g-dot"/>');
}
// average level inside the water column, surface on top, deepest point at the bottom
function icoLevel(f){
  f = clamp01(f); var y = 7 + 26 * f;
  return icoSvg('<path d="M7 7q3.25-2.5 6.5 0t6.5 0t6.5 0t6.5 0" class="g-track"/><line x1="7" y1="33" x2="33" y2="33" class="g-track"/>' +
    '<line x1="7" y1="' + y.toFixed(1) + '" x2="33" y2="' + y.toFixed(1) + '" class="g-fill g-dash"/><circle cx="20" cy="' + y.toFixed(1) + '" r="2.4" class="g-dot"/>');
}
// thermometer filled from 5 to 30 °C
function icoThermo(f){
  f = clamp01(f); var top = 27 - 20 * f;
  return icoSvg('<line x1="20" y1="6" x2="20" y2="27" class="g-track g-thick"/><line x1="20" y1="' + top.toFixed(1) + '" x2="20" y2="29" class="g-fill g-thick"/>' +
    '<circle cx="20" cy="31" r="4.5" class="g-bulb"/>');
}
// tank, filled with what was left at the end
function icoTank(f){
  f = clamp01(f); var h = 24 * f;
  return icoSvg('<rect x="13" y="10" width="14" height="26" rx="5" class="g-track"/><rect x="15.5" y="' + (34 - h).toFixed(1) + '" width="9" height="' + h.toFixed(1) + '" rx="2.5" class="g-solid"/>' +
    '<path d="M17 10V6h6v4M23 7h3" class="g-track"/>');
}
// rising bubbles for air consumption
function icoBubbles(){
  return icoSvg('<circle cx="15" cy="29" r="5" class="g-track"/><circle cx="24" cy="18" r="3.6" class="g-fill"/><circle cx="17" cy="9" r="2.4" class="g-track"/>' +
    '<circle cx="26" cy="8" r="1.4" class="g-dot"/>');
}

function removeSection(headingId){
  var h = document.getElementById(headingId), sec = h && h.closest('section');
  if (sec) sec.remove();
  if (typeof computeAnchors === 'function') computeAnchors();
}

function renderLogbook(dives, settings){
  var show = settings.stats;
  /* ---------- Logbook summary ---------- */
  var sum = summarize(dives);
  var statsEl = document.getElementById('stats');
  if (sum){
    var tt = sum.totalTime != null ? hoursMin(sum.totalTime) : ['', ''];
    var tiles = [
      ['count', sum.count, String(sum.count), '', sum.count === 1 ? 'inmersión registrada' : 'inmersiones registradas'],
      ['time', sum.totalTime, tt[0], tt[1], 'bajo el agua'],
      ['maxDepth', sum.maxDepth, sum.maxDepth != null ? fmt(sum.maxDepth) : '', 'm', 'profundidad máxima'],
      ['avgDepth', sum.avgDepth, sum.avgDepth != null ? fmt(sum.avgDepth) : '', 'm', 'profundidad media'],
      ['minTemp', sum.minTemp, sum.minTemp != null ? fmt(sum.minTemp) : '', '°C', 'agua más fría'],
      ['sac', sum.sac, sum.sac != null ? fmt(sum.sac) : '', 'L/min', 'consumo de aire en superficie']
    ].filter(function(t){ return show[t[0]] && t[1] != null && t[1] !== 0; }).map(function(t){ return t.slice(2); });
    statsEl.innerHTML = tiles.map(function(s){
      return '<div class="stat"><b>' + s[0] + (s[1] ? '<small>' + s[1] + '</small>' : '') + '</b><span>' + s[2] + '</span></div>';
    }).join('');
    var rec = [
      ['maxDepth', 'Inmersión más profunda', sum.deepest, sum.deepest && fmt(sum.deepest.maxDepth), 'm'],
      ['time', 'Inmersión más larga', sum.longest, sum.longest && String(Math.round(sum.longest.duration / 60)), 'min'],
      ['minTemp', 'Agua más fría', sum.coldest, sum.coldest && fmt(sum.coldest.minTemp), '°C']
    ].filter(function(r){ return show[r[0]] && r[2]; }).map(function(r){ return r.slice(1); });
    // a section left with nothing to show is taken out of the descent
    if (!tiles.length) removeSection('h-stats');
    if (!rec.length) removeSection('h-rec');
    document.getElementById('records').innerHTML = rec.map(function(r){
      return '<div class="record"><span><strong>' + r[0] + '</strong>' + esc(r[1].site.name) + ' · ' + dateLabel(r[1].start) + '</span><b>' + r[2] + '<small>' + r[3] + '</small></b></div>';
    }).join('');
  } else {
    statsEl.outerHTML = '<p class="empty">Todavía no hay inmersiones importadas.</p>';
  }

  /* ---------- Dive cards with the recorded depth profile ---------- */
  function niceTicks(max, step){ var a = []; for (var v = 0; v <= max + 1e-6; v += step) a.push(v); return a; }
  function nearest(pts, t){
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1){ var mid = (lo + hi) >> 1; if (pts[mid][0] < t) lo = mid; else hi = mid; }
    return (t - pts[lo][0] < pts[hi][0] - t) ? pts[lo] : pts[hi];
  }

  if (!settings.showDives){ removeSection('h-dives'); return; }
  var divesEl = document.getElementById('dives');
  if (!dives.length) divesEl.innerHTML = '<p class="empty">Aquí aparecerán los perfiles cuando importe mis inmersiones.</p>';
  dives.forEach(function(dv, idx){
    var pts = dv.profile;
    var hasProfile = pts.length > 1;
    if (!hasProfile) pts = [[0, 0], [dv.duration || 1, 0]];   // placeholder so the chart maths below stays valid
    var W = 320, H = 140, ml = 34, mr = 10, mt = 10, mb = 22;
    var yStep = dv.maxDepth > 20 ? 10 : 5;
    var yMax = Math.ceil(dv.maxDepth / yStep) * yStep, xMax = dv.duration;
    var xStepMin = xMax > 3600 ? 15 : 10;
    var x = function(t){ return ml + (t / xMax) * (W - ml - mr); };
    var y = function(d){ return mt + (d / yMax) * (H - mt - mb); };
    var line = pts.map(function(p, i){ return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
    var area = line + ' L' + x(pts[pts.length - 1][0]).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0) + ' ' + y(0) + ' Z';
    var peak = pts.reduce(function(a, b){ return b[1] > a[1] ? b : a; });
    var grid = niceTicks(yMax, yStep).map(function(v){
      return '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/>' +
             '<text x="' + (ml - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" fill="var(--ink-dim)" font-size="9" font-family="var(--f-mono)">' + v + ' m</text>';
    }).join('');
    var xt = niceTicks(xMax / 60, xStepMin).map(function(v){
      return '<text x="' + x(v * 60) + '" y="' + (H - 6) + '" text-anchor="middle" fill="var(--ink-dim)" font-size="9" font-family="var(--f-mono)">' + v + '′</text>';
    }).join('');
    // safety stop band, 3 to 6 m: just a tinted strip behind the profile; its name goes in a small
    // legend above the chart, so no label ever sits on top of the line
    var hasBand = yMax >= 6;
    var band = hasBand ? '<g class="stop-band"><rect x="' + ml + '" y="' + y(3) + '" width="' + (W - ml - mr) + '" height="' + (y(6) - y(3)) + '" fill="var(--stop)" opacity=".16"/>' +
      '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(3) + '" y2="' + y(3) + '" stroke="var(--stop)" stroke-width=".9" stroke-dasharray="3 3" opacity=".8"/>' +
      '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(6) + '" y2="' + y(6) + '" stroke="var(--stop)" stroke-width=".9" stroke-dasharray="3 3" opacity=".8"/></g>' : '';
    var gid = 'pg' + idx;
    var px = x(peak[0]), py = y(peak[1]);
    var labelLeft = px > W * 0.6;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Perfil de profundidad: máxima ' + fmt(dv.maxDepth) + ' metros en ' + Math.round(dv.duration / 60) + ' minutos">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".05"/><stop offset="1" stop-color="var(--cyan)" stop-opacity=".28"/></linearGradient></defs>' +
      grid + xt + band +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + px + '" cy="' + py + '" r="4" fill="var(--amber)" stroke="var(--abyss)" stroke-width="2"/>' +
      '<text x="' + (px + (labelLeft ? -8 : 8)) + '" y="' + (py + 3.5) + '" text-anchor="' + (labelLeft ? 'end' : 'start') + '" fill="var(--ink)" font-size="10" font-family="var(--f-mono)">' + fmt(dv.maxDepth) + ' m</text>' +
      '<g class="hover" visibility="hidden"><line class="hx" y1="' + mt + '" y2="' + (H - mb) + '" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="2 3"/><circle class="hc" r="4" fill="var(--cyan)" stroke="var(--abyss)" stroke-width="2"/></g>' +
      '<rect class="hit" x="' + ml + '" y="0" width="' + (W - ml - mr) + '" height="' + H + '" fill="transparent"/>' +
      '</svg>';

    var on = function(key){ return statOn(dv, key) && show[key] !== false; };
    var c = on('sac') ? sac(dv) : null;
    var place = coords(dv.site);
    var tilesHtml = [];
    var tile = function(key, graphic, value, unitTxt, label, sub){
      tilesHtml.push('<div class="dstat dstat-' + key + '">' + graphic +
        '<div class="dstat-txt"><span class="dstat-val">' + value + (unitTxt ? '<small>' + unitTxt + '</small>' : '') + '</span>' +
        '<span class="dstat-lbl">' + label + '</span>' + (sub ? '<span class="dstat-sub">' + sub + '</span>' : '') + '</div></div>');
    };
    if (on('maxDepth')) tile('max', icoDepth(dv.maxDepth / 40), fmt(dv.maxDepth), 'm', 'Prof. máxima');
    if (on('time')) tile('time', icoRing(dv.duration / 3600), String(Math.round(dv.duration / 60)), 'min', 'Duración');
    if (on('avgDepth') && dv.avgDepth > 0) tile('avg', icoLevel(dv.avgDepth / dv.maxDepth), fmt(dv.avgDepth), 'm', 'Prof. media');
    if (on('minTemp') && dv.minTemp != null) tile('temp', icoThermo((dv.minTemp - 5) / 25), fmt(dv.minTemp), '°C', 'Agua',
      dv.maxTemp != null && dv.maxTemp - dv.minTemp >= .5 ? 'hasta ' + fmt(dv.maxTemp) + ' °C' : '');
    if (dv.tank && dv.tank.start != null) tile('tank', icoTank(dv.tank.end / dv.tank.start), dv.tank.start + '→' + dv.tank.end, '', 'Botella · bar', fmt(dv.tank.volume, 0) + ' L · ' + gasName(dv.tank.gas));
    if (c != null) tile('sac', icoBubbles(), fmt(c), 'L/min', 'Consumo (SAC)');
    var kicker = (dv.number != null ? 'Nº ' + dv.number + ' · ' : '') + dateLabel(dv.start, true);
    var training = dv.type === 'training';
    var badge = training
      ? '<span class="dive-type"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5"/></svg>Entrenamiento</span>'
      : '<span class="dive-type"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 9c1.6-2 3.3-2 4.9 0s3.3 2 4.9 0 2.6-1.4 3.2-.6"/></svg>Recreativa</span>';
    var card = document.createElement('article');
    card.className = 'dive ' + (training ? 'is-training' : 'is-recreational');
    card.innerHTML =
      '<header class="dive-head"><p class="dive-kicker"><time datetime="' + esc(dv.start) + '">' + esc(kicker) + '</time>' + badge + '</p>' +
      '<h3>' + esc(dv.site.name) + '</h3>' +
      (place ? '<a class="dive-place" href="https://www.openstreetmap.org/?mlat=' + dv.site.lat + '&amp;mlon=' + dv.site.lon + '#map=14/' + dv.site.lat + '/' + dv.site.lon + '" target="_blank" rel="noopener">' + place + '</a>' : '') + '</header>' +
      (hasProfile ? (hasBand ? '<p class="profile-legend"><span class="sw" aria-hidden="true"></span>Parada de seguridad · 3–6 m</p>' : '') +
        '<div class="profile">' + svg + '<div class="tip" hidden></div></div>'
        : '<p class="no-profile">Inmersión registrada a mano: sin perfil de profundidad.</p>') +
      (tilesHtml.length ? '<div class="dstats">' + tilesHtml.join('') + '</div>' : '') +
      (dv.notes ? '<p class="dive-notes">' + esc(dv.notes) + '</p>' : '');
    divesEl.appendChild(card);

    if (!hasProfile) return;
    var svgEl = card.querySelector('.profile svg'), hov = card.querySelector('.hover'), hx = card.querySelector('.hx'), hc = card.querySelector('.hc'), tip = card.querySelector('.tip');
    function move(ev){
      var r = svgEl.getBoundingClientRect();
      var sx = (ev.clientX - r.left) / r.width * W;
      var t = Math.max(0, Math.min(xMax, (sx - ml) / (W - ml - mr) * xMax));
      var p = nearest(pts, t);
      var cx = x(p[0]), cy = y(p[1]);
      hx.setAttribute('x1', cx); hx.setAttribute('x2', cx);
      hc.setAttribute('cx', cx); hc.setAttribute('cy', cy);
      hov.setAttribute('visibility', 'visible');
      var temp = dv.temps && dv.temps.length ? nearest(dv.temps, p[0])[1] : null;
      tip.textContent = clock(p[0]) + ' · ' + fmt(p[1]) + ' m' + (temp != null ? ' · ' + fmt(temp) + ' °C' : '');
      tip.hidden = false;
      var tx = cx / W * r.width;
      tx = Math.max(70, Math.min(r.width - 70, tx));
      tip.style.left = tx + 'px';
      tip.style.top = (cy / H * r.height) + 'px';
    }
    function leave(){ hov.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    svgEl.addEventListener('pointermove', move);
    svgEl.addEventListener('pointerdown', move);
    svgEl.addEventListener('pointerleave', leave);
  });

  // only the latest few at first; the rest a batch at a time, so the page never becomes endless
  var PAGE = 5, cards = Array.prototype.slice.call(divesEl.querySelectorAll('.dive'));
  if (cards.length > PAGE){
    cards.forEach(function(c, i){ c.hidden = i >= PAGE; });
    var more = document.createElement('div'); more.className = 'more-dives';
    more.innerHTML = '<button class="btn" type="button"></button>';
    var btn = more.firstChild;
    function label(){
      var left = cards.filter(function(c){ return c.hidden; }).length;
      btn.textContent = 'Ver más inmersiones (quedan ' + left + ')';
      if (!left) more.remove();
    }
    btn.addEventListener('click', function(){
      var shownNow = 0;
      cards.forEach(function(c){ if (c.hidden && shownNow < PAGE){ c.hidden = false; shownNow++; } });
      label();
    });
    divesEl.after(more);
    label();
  }
}

/* ---------- Scroll → depth ---------- */
var gScale = document.getElementById('gScale');
[0, 10, 20, 30, 40].forEach(function(v){
  var t = document.createElement('div'); t.className = 'g-tick'; t.style.top = (v / MAXD * 100) + '%'; t.textContent = v; gScale.appendChild(t);
});
var gDepth = document.getElementById('gDepth'), gMark = document.getElementById('gMark'), gTemp = document.getElementById('gTemp'), gPres = document.getElementById('gPres'), gStop = document.getElementById('gStop');

var anchors = [];
function computeAnchors(){
  var secs = Array.prototype.slice.call(document.querySelectorAll('[data-depth]'));
  var maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  anchors = secs.map(function(s){
    var top = s.getBoundingClientRect().top + scrollY;
    return {y: Math.max(0, Math.min(maxScroll, top - innerHeight * 0.32)), d: +s.dataset.depth};
  });
  anchors[0].y = 0;
  anchors[anchors.length - 1].y = maxScroll;
  for (var i = 1; i < anchors.length; i++) if (anchors[i].y <= anchors[i - 1].y) anchors[i].y = anchors[i - 1].y + 1;
}
function depthAt(sy){
  if (!anchors.length) return 0;
  if (sy <= anchors[0].y) return anchors[0].d;
  for (var i = 1; i < anchors.length; i++){
    if (sy <= anchors[i].y){
      var a = anchors[i - 1], b = anchors[i], p = (sy - a.y) / (b.y - a.y);
      p = p * p * (3 - 2 * p);
      return a.d + (b.d - a.d) * p;
    }
  }
  return anchors[anchors.length - 1].d;
}
function tempAt(d){ return d < 8 ? 21.5 - d * 0.12 : d < 22 ? 20.54 - (d - 8) * 0.36 : 15.5 - (d - 22) * 0.07; }

var dive = {depth:0, target:0, reduce:reduce, night:false};
var root = document.documentElement, modeBtns = document.querySelectorAll('.mode button');
function setMode(m, save){
  root.setAttribute('data-dive', m);
  dive.night = m === 'night';
  modeBtns.forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
  if (save) { try { localStorage.setItem('dive-mode', m); } catch (e) {} }
}
setMode(root.getAttribute('data-dive') === 'night' ? 'night' : 'day', false);
modeBtns.forEach(function(b){ b.addEventListener('click', function(){ setMode(b.dataset.mode, true); }); });
new MutationObserver(function(){
  var th = root.getAttribute('data-theme');
  if (th === 'light' || th === 'dark') setMode(th === 'light' ? 'day' : 'night', true);
}).observe(root, {attributes:true, attributeFilter:['data-theme']});
var maxReached = 0, lastShown = -1, lastStop = null;

computeAnchors();
dive.depth = dive.target = depthAt(scrollY);
addEventListener('resize', computeAnchors);
addEventListener('load', computeAnchors);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(computeAnchors);
if ('ResizeObserver' in window) new ResizeObserver(computeAnchors).observe(document.querySelector('main'));

// Depth follows the scroll through a critically damped spring: position and speed
// both stay continuous, so the diver never jerks when you start or stop scrolling.
var depthVel = 0, lastT = performance.now();
var DT_MAX = (import.meta.env.DEV && +new URLSearchParams(location.search).get('dtmax')) || 0.1;
function tick(now){
  var dt = Math.min(DT_MAX, Math.max(0, ((now || performance.now()) - lastT) / 1000)); lastT = now || performance.now();
  dive.target = depthAt(scrollY);
  var prev = dive.depth;
  if (reduce) { dive.depth = dive.target; depthVel = 0; }
  else {
    var w = 3.4, steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (var i = 0; i < steps; i++){ depthVel += (w * w * (dive.target - dive.depth) - 2 * w * depthVel) * h; dive.depth += depthVel * h; }
    if (Math.abs(dive.target - dive.depth) < 0.002 && Math.abs(depthVel) < 0.01) { dive.depth = dive.target; depthVel = 0; }
  }
  var d = dive.depth;
  if (d > maxReached) maxReached = d;
  if (d < 1) maxReached = 0;
  var stop = maxReached > 15 && d > 3 && d < 6.5 && d <= prev + 1e-4;
  var shown = Math.round(Math.max(0, d) * 10);
  if (shown !== lastShown){
    lastShown = shown;
    gDepth.textContent = fmt(shown / 10);
    gMark.style.top = (Math.max(0, d) / MAXD * 100) + '%';
    gTemp.textContent = Math.round(tempAt(Math.max(0, d))) + ' °C';
    gPres.textContent = fmt(Math.max(0, d) / 10 + 1) + ' bar';   // absolute pressure: 1 bar of air plus 1 bar every 10 m of water
  }
  if (stop !== lastStop){ lastStop = stop; gStop.hidden = !stop; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.getElementById('ascend').addEventListener('click', function(){
  window.scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'});
});

// Visit counts (Vercel Web Analytics: no cookies, nothing personal). Does nothing until it is
// switched on in the Vercel project.
inject();

// The 3D scene loads after the content so the text paints first.
import('./scene.js').then(function(m){ m.initScene(dive); });
