import './styles.css';
import dives from './data/dives.json';
import { summarize, sac } from './lib/logbook.js';

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

/* ---------- Logbook summary ---------- */
var sum = summarize(dives);
var statsEl = document.getElementById('stats');
if (sum){
  var tt = hoursMin(sum.totalTime);
  var tiles = [
    [String(sum.count), '', sum.count === 1 ? 'inmersión importada' : 'inmersiones importadas'],
    [tt[0], tt[1], 'bajo el agua'],
    [fmt(sum.maxDepth), 'm', 'profundidad máxima'],
    [fmt(sum.avgDepth), 'm', 'profundidad media'],
    [sum.minTemp != null ? fmt(sum.minTemp) : '–', '°C', 'agua más fría'],
    [sum.sac != null ? fmt(sum.sac) : '–', 'L/min', 'consumo de aire en superficie']
  ];
  statsEl.innerHTML = tiles.map(function(s){
    return '<div class="stat"><b>' + s[0] + (s[1] ? '<small>' + s[1] + '</small>' : '') + '</b><span>' + s[2] + '</span></div>';
  }).join('');
  var rec = [
    ['Inmersión más profunda', sum.deepest, fmt(sum.deepest.maxDepth), 'm'],
    ['Inmersión más larga', sum.longest, String(Math.round(sum.longest.duration / 60)), 'min'],
    ['Agua más fría', sum.coldest, sum.coldest && sum.coldest.minTemp != null ? fmt(sum.coldest.minTemp) : '–', '°C']
  ].filter(function(r){ return r[1]; });
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

var divesEl = document.getElementById('dives');
if (!dives.length) divesEl.innerHTML = '<p class="empty">Aquí aparecerán los perfiles cuando importe mis inmersiones.</p>';
dives.forEach(function(dv, idx){
  var pts = dv.profile;
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
  // safety stop band, 3 to 6 m
  var band = yMax >= 6 ? '<rect x="' + ml + '" y="' + y(3) + '" width="' + (W - ml - mr) + '" height="' + (y(6) - y(3)) + '" fill="var(--amber)" opacity=".07"/>' +
    '<text x="' + x(xMax * .5) + '" y="' + (y(4.5) + 3) + '" text-anchor="middle" fill="var(--ink-dim)" font-size="8" font-family="var(--f-mono)">parada de seguridad</text>' : '';
  var gid = 'pg' + idx;
  var px = x(peak[0]), py = y(peak[1]);
  var labelLeft = px > W * 0.6;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Perfil de profundidad: máxima ' + fmt(dv.maxDepth) + ' metros en ' + Math.round(dv.duration / 60) + ' minutos">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".05"/><stop offset="1" stop-color="var(--cyan)" stop-opacity=".28"/></linearGradient></defs>' +
    band + grid + xt +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + px + '" cy="' + py + '" r="4" fill="var(--amber)" stroke="var(--abyss)" stroke-width="2"/>' +
    '<text x="' + (px + (labelLeft ? -8 : 8)) + '" y="' + (py + 3.5) + '" text-anchor="' + (labelLeft ? 'end' : 'start') + '" fill="var(--ink)" font-size="10" font-family="var(--f-mono)">' + fmt(dv.maxDepth) + ' m</text>' +
    '<g class="hover" visibility="hidden"><line class="hx" y1="' + mt + '" y2="' + (H - mb) + '" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="2 3"/><circle class="hc" r="4" fill="var(--cyan)" stroke="var(--abyss)" stroke-width="2"/></g>' +
    '<rect class="hit" x="' + ml + '" y="0" width="' + (W - ml - mr) + '" height="' + H + '" fill="transparent"/>' +
    '</svg>';

  var facts = [['Máx', fmt(dv.maxDepth) + ' m'], ['Media', fmt(dv.avgDepth) + ' m'], ['Tiempo', clock(dv.duration)]];
  if (dv.minTemp != null) facts.push(['Agua', (dv.maxTemp != null && Math.round(dv.maxTemp) !== Math.round(dv.minTemp) ? fmt(dv.minTemp) + '–' + fmt(dv.maxTemp) : fmt(dv.minTemp)) + ' °C']);
  if (dv.tank && dv.tank.start != null) facts.push(['Botella', dv.tank.start + ' → ' + dv.tank.end + ' bar · ' + fmt(dv.tank.volume, 0) + ' L de ' + gasName(dv.tank.gas)]);
  var c = sac(dv); if (c != null) facts.push(['Consumo', fmt(c) + ' L/min']);
  var place = coords(dv.site);
  var card = document.createElement('article');
  card.className = 'dive';
  card.innerHTML =
    '<div class="dive-head"><h3>' + esc(dv.site.name) + (dv.number != null ? ' <span class="dive-no">nº ' + dv.number + '</span>' : '') + '</h3><time datetime="' + esc(dv.start) + '">' + dateLabel(dv.start, true) + '</time></div>' +
    (place ? '<p class="dive-place"><a href="https://www.openstreetmap.org/?mlat=' + dv.site.lat + '&amp;mlon=' + dv.site.lon + '#map=14/' + dv.site.lat + '/' + dv.site.lon + '" target="_blank" rel="noopener">' + place + '</a></p>' : '') +
    '<div class="dive-facts">' + facts.map(function(f){ return '<span><em>' + f[0] + '</em>' + f[1] + '</span>'; }).join('') + '</div>' +
    (dv.notes ? '<p class="dive-notes">' + esc(dv.notes) + '</p>' : '') +
    '<div class="profile">' + svg + '<div class="tip" hidden></div></div>';
  divesEl.appendChild(card);

  var svgEl = card.querySelector('svg'), hov = card.querySelector('.hover'), hx = card.querySelector('.hx'), hc = card.querySelector('.hc'), tip = card.querySelector('.tip');
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
function tick(now){
  var dt = Math.min(0.1, Math.max(0, ((now || performance.now()) - lastT) / 1000)); lastT = now || performance.now();
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

// The 3D scene loads after the content so the text paints first.
import('./scene.js').then(function(m){ m.initScene(dive); });
