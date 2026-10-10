import './styles.css';
import { dives, stats, records } from './data/sample.js';

var MAXD = 40;
var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function fmt(n, d){ d = d == null ? 1 : d; return n.toLocaleString('es-ES',{minimumFractionDigits:d, maximumFractionDigits:d}); }


document.getElementById('stats').innerHTML = stats.map(function(s){
  return '<div class="stat"><b>' + s[0] + (s[1] ? '<small>' + s[1] + '</small>' : '') + '</b><span>' + s[2] + '</span></div>';
}).join('');

document.getElementById('records').innerHTML = records.map(function(r){
  return '<div class="record"><span><strong>' + r[0] + '</strong>' + r[1] + '</span><b>' + r[2] + '<small>' + r[3] + '</small></b></div>';
}).join('');

/* ---------- Synthetic depth profiles ---------- */
function rng(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function profile(dv){
  var r = rng(dv.seed), max = dv.max, dur = dv.dur;
  var tDesc = 0.8 * max / 12, asc = (0.6 * max - 5) / 3.5, B = dur - tDesc - asc - 3 - 0.6;
  var k = [
    [0, 0], [tDesc, 0.8 * max], [tDesc + 0.15 * B, max], [tDesc + 0.35 * B, 0.74 * max],
    [tDesc + 0.6 * B, 0.86 * max], [tDesc + 0.82 * B, 0.68 * max], [tDesc + B, 0.6 * max],
    [tDesc + B + asc, 5], [tDesc + B + asc + 3, 5], [dur, 0]
  ];
  var a1 = r() * 6, a2 = r() * 6, pts = [];
  for (var t = 0; t <= dur + 0.001; t += 0.25){
    var i = 0; while (i < k.length - 2 && t > k[i + 1][0]) i++;
    var p = (t - k[i][0]) / (k[i + 1][0] - k[i][0]); p = Math.max(0, Math.min(1, p));
    var d = k[i][1] + (k[i + 1][1] - k[i][1]) * p;
    var inBottom = t > tDesc && t < tDesc + B;
    if (inBottom) d += (Math.sin(t * 0.9 + a1) * 0.7 + Math.sin(t * 2.3 + a2) * 0.35) * (1 - Math.exp(-Math.abs(t - k[2][0]) * 0.8));
    pts.push([t, Math.max(0, Math.min(max, d))]);
  }
  return pts;
}

function niceTicks(max, step){ var a = []; for (var v = 0; v <= max + 1e-6; v += step) a.push(v); return a; }

var divesEl = document.getElementById('dives');
dives.forEach(function(dv, idx){
  var pts = profile(dv);
  var W = 320, H = 132, ml = 34, mr = 10, mt = 10, mb = 22;
  var yMax = Math.ceil(dv.max / 10) * 10, xMax = dv.dur;
  var x = function(t){ return ml + (t / xMax) * (W - ml - mr); };
  var y = function(d){ return mt + (d / yMax) * (H - mt - mb); };
  var line = pts.map(function(p, i){ return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
  var area = line + ' L' + x(pts[pts.length - 1][0]).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(0) + ' ' + y(0) + ' Z';
  var peak = pts.reduce(function(a, b){ return b[1] > a[1] ? b : a; });
  var grid = niceTicks(yMax, 10).map(function(v){
    return '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/>' +
           '<text x="' + (ml - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" fill="var(--ink-dim)" font-size="9" font-family="var(--f-mono)">' + v + ' m</text>';
  }).join('');
  var xt = niceTicks(xMax, 10).map(function(v){
    return '<text x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle" fill="var(--ink-dim)" font-size="9" font-family="var(--f-mono)">' + v + '′</text>';
  }).join('');
  var gid = 'pg' + idx;
  var px = x(peak[0]), py = y(peak[1]);
  var labelLeft = px > W * 0.6;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Perfil de profundidad: máxima ' + fmt(dv.max) + ' metros en ' + dv.dur + ' minutos">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".05"/><stop offset="1" stop-color="var(--cyan)" stop-opacity=".28"/></linearGradient></defs>' +
    grid + xt +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + px + '" cy="' + py + '" r="4" fill="var(--amber)" stroke="var(--abyss)" stroke-width="2"/>' +
    '<text x="' + (px + (labelLeft ? -8 : 8)) + '" y="' + (py + 3.5) + '" text-anchor="' + (labelLeft ? 'end' : 'start') + '" fill="var(--ink)" font-size="10" font-family="var(--f-mono)">' + fmt(dv.max) + ' m</text>' +
    '<g class="hover" visibility="hidden"><line class="hx" y1="' + mt + '" y2="' + (H - mb) + '" stroke="var(--ink-dim)" stroke-width="1" stroke-dasharray="2 3"/><circle class="hc" r="4" fill="var(--cyan)" stroke="var(--abyss)" stroke-width="2"/></g>' +
    '<rect class="hit" x="' + ml + '" y="0" width="' + (W - ml - mr) + '" height="' + H + '" fill="transparent"/>' +
    '</svg>';
  var date = new Date(dv.date + 'T12:00:00');
  var dateStr = date.toLocaleDateString('es-ES', {day:'numeric', month:'short', year:'numeric'});
  var card = document.createElement('article');
  card.className = 'dive';
  card.innerHTML =
    '<div class="dive-head"><h3>' + dv.site + '</h3><time datetime="' + dv.date + '">' + dateStr + '</time></div>' +
    '<p class="dive-place">' + dv.place + '</p>' +
    '<div class="dive-facts"><span><em>Máx</em>' + fmt(dv.max) + ' m</span><span><em>Tiempo</em>' + dv.dur + ' min</span><span><em>Agua</em>' + dv.tmin + ' °C</span></div>' +
    '<div class="profile">' + svg + '<div class="tip" hidden></div></div>';
  divesEl.appendChild(card);

  var svgEl = card.querySelector('svg'), hov = card.querySelector('.hover'), hx = card.querySelector('.hx'), hc = card.querySelector('.hc'), tip = card.querySelector('.tip'), box = card.querySelector('.profile');
  function move(ev){
    var r = svgEl.getBoundingClientRect();
    var sx = (ev.clientX - r.left) / r.width * W;
    var t = Math.max(0, Math.min(xMax, (sx - ml) / (W - ml - mr) * xMax));
    var p = pts[Math.round(t / 0.25)] || pts[pts.length - 1];
    var cx = x(p[0]), cy = y(p[1]);
    hx.setAttribute('x1', cx); hx.setAttribute('x2', cx);
    hc.setAttribute('cx', cx); hc.setAttribute('cy', cy);
    hov.setAttribute('visibility', 'visible');
    var m = Math.floor(p[0]), s = Math.round((p[0] - m) * 60);
    tip.textContent = m + ':' + (s < 10 ? '0' : '') + s + ' · ' + fmt(p[1]) + ' m';
    tip.hidden = false;
    var tx = cx / W * r.width;
    tx = Math.max(52, Math.min(r.width - 52, tx));
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
var gDepth = document.getElementById('gDepth'), gMark = document.getElementById('gMark'), gTemp = document.getElementById('gTemp'), gTorch = document.getElementById('gTorch'), gStop = document.getElementById('gStop');

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

var dive = {depth:0, target:0, torch:false, reduce:reduce, night:false};
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
var maxReached = 0, lastShown = -1, lastTorch = null, lastStop = null;

computeAnchors();
dive.depth = dive.target = depthAt(scrollY);
addEventListener('resize', computeAnchors);
addEventListener('load', computeAnchors);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(computeAnchors);
if ('ResizeObserver' in window) new ResizeObserver(computeAnchors).observe(document.querySelector('main'));

function tick(){
  dive.target = depthAt(scrollY);
  var prev = dive.depth;
  dive.depth = reduce ? dive.target : dive.depth + (dive.target - dive.depth) * 0.08;
  if (Math.abs(dive.target - dive.depth) < 0.005) dive.depth = dive.target;
  var d = dive.depth;
  if (dive.night || d > 27) dive.torch = true; else if (d < 25) dive.torch = false;
  if (d > maxReached) maxReached = d;
  if (d < 1) maxReached = 0;
  var stop = maxReached > 15 && d > 3 && d < 6.5 && d <= prev + 1e-4;
  var shown = Math.round(Math.max(0, d) * 10);
  if (shown !== lastShown){
    lastShown = shown;
    gDepth.textContent = fmt(shown / 10);
    gMark.style.top = (Math.max(0, d) / MAXD * 100) + '%';
    gTemp.textContent = Math.round(tempAt(Math.max(0, d))) + ' °C';
  }
  if (dive.torch !== lastTorch){ lastTorch = dive.torch; gTorch.textContent = dive.torch ? 'ON' : 'OFF'; gTorch.className = dive.torch ? 'on' : ''; }
  if (stop !== lastStop){ lastStop = stop; gStop.hidden = !stop; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.getElementById('ascend').addEventListener('click', function(){
  window.scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'});
});

// The 3D scene loads after the content so the text paints first.
import('./scene.js').then(function(m){ m.initScene(dive); });
