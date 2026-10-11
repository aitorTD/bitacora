/*
 * The weather at the surface, drawn once per visit.
 *
 * clear    nothing special
 * rain     overcast, rain streaks over the sea and pockmarked water
 * storm    darker sky, heavier rain, a rougher sea and lightning (no flashes with reduced motion)
 * fog      the horizon and the boat fade into a grey haze; the water gets murkier too
 * special  a sunset by day, a meteor shower by night: it follows the day/night switch
 *
 * What can come up is set from the admin panel (settings.data.weather in Supabase): each state on
 * or off, its weight in the draw, or one fixed state that always shows. The draw never repeats the
 * previous visit, and ?tiempo=lluvia|tormenta|niebla|atardecer|estrellas|despejado forces one.
 */
export const STATES = ['clear', 'rain', 'storm', 'fog', 'special'];
export const STATE_NAMES = { clear: 'Despejado', rain: 'Lluvia', storm: 'Tormenta', fog: 'Niebla', special: 'Atardecer / estrellas' };
export const STATE_PARAM = { clear: 'despejado', rain: 'lluvia', storm: 'tormenta', fog: 'niebla', special: 'atardecer' };
export const DEFAULT_WX = {
  enabled: { clear: true, rain: true, storm: true, fog: true, special: true },
  weights: { clear: 38, rain: 15, storm: 12, fog: 15, special: 20 },
  fixed: null,
};
const FORCE = { despejado: 'clear', lluvia: 'rain', tormenta: 'storm', niebla: 'fog', atardecer: 'special', estrellas: 'special' };
const LAST = 'dive-weather', CFG = 'dive-weather-cfg';

// fills gaps and drops anything unknown, so an old or hand-edited setting never breaks the page
export function normalizeWx(cfg){
  const c = cfg || {}, out = { enabled: {}, weights: {}, fixed: STATES.includes(c.fixed) ? c.fixed : null };
  for (const k of STATES){
    out.enabled[k] = c.enabled && typeof c.enabled[k] === 'boolean' ? c.enabled[k] : DEFAULT_WX.enabled[k];
    const w = c.weights ? Number(c.weights[k]) : NaN;
    out.weights[k] = Number.isFinite(w) ? Math.max(0, Math.min(100, Math.round(w))) : DEFAULT_WX.weights[k];
  }
  return out;
}
export function allowed(cfg, w){ return cfg.fixed ? w === cfg.fixed : !!cfg.enabled[w] && cfg.weights[w] > 0; }

// chance of each state in the draw (0..1), before the no-repeat rule
export function chances(cfg){
  const out = {};
  if (cfg.fixed){ for (const k of STATES) out[k] = k === cfg.fixed ? 1 : 0; return out; }
  const sum = STATES.reduce((s, k) => s + (allowed(cfg, k) ? cfg.weights[k] : 0), 0);
  for (const k of STATES) out[k] = sum && allowed(cfg, k) ? cfg.weights[k] / sum : 0;
  return out;
}

export function forcedWeather(){
  const asked = new URLSearchParams(location.search).get('tiempo');
  return asked && FORCE[asked] ? { weather: FORCE[asked], mode: asked === 'atardecer' ? 'day' : asked === 'estrellas' ? 'night' : null } : null;
}

export function pickWeather(cfg){
  if (cfg.fixed) return cfg.fixed;
  let last = null;
  try { last = localStorage.getItem(LAST); } catch (e) {}
  let pool = STATES.filter(k => allowed(cfg, k));
  if (pool.length > 1) pool = pool.filter(k => k !== last);
  if (!pool.length) return 'clear';
  let r = Math.random() * pool.reduce((s, k) => s + cfg.weights[k], 0), weather = pool[0];
  for (const k of pool){ if ((r -= cfg.weights[k]) < 0){ weather = k; break; } }
  try { localStorage.setItem(LAST, weather); } catch (e) {}
  return weather;
}

// the last settings this browser saw, so the first draw does not wait for the network
export function cachedWx(){
  try { return normalizeWx(JSON.parse(localStorage.getItem(CFG) || 'null')); } catch (e) { return normalizeWx(null); }
}
export function cacheWx(cfg){ try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch (e) {} }

export function weatherLabel(weather, night){
  return { clear: '', rain: 'Lluvia', storm: 'Tormenta', fog: 'Niebla', special: night ? 'Lluvia de estrellas' : 'Atardecer' }[weather] || '';
}
