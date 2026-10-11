/*
 * The weather at the surface, drawn once per visit.
 *
 * clear    nothing special (the most common)
 * rain     overcast, rain streaks over the sea and pockmarked water
 * storm    darker sky, heavier rain and lightning (no flashes with reduced motion)
 * fog      the horizon and the boat fade into a grey haze; the water gets murkier too
 * special  a sunset by day, a meteor shower by night: it follows the day/night switch
 *
 * The draw is weighted so the special states stay a surprise, never repeats the previous visit,
 * and can be forced with ?tiempo=lluvia|tormenta|niebla|atardecer|estrellas|despejado.
 */
const WEIGHTS = { clear: 38, rain: 15, storm: 12, fog: 15, special: 20 };
const FORCE = { despejado: 'clear', lluvia: 'rain', tormenta: 'storm', niebla: 'fog', atardecer: 'special', estrellas: 'special' };
const KEY = 'dive-weather';

export function pickWeather(){
  const asked = new URLSearchParams(location.search).get('tiempo');
  if (asked && FORCE[asked]) return { weather: FORCE[asked], mode: asked === 'atardecer' ? 'day' : asked === 'estrellas' ? 'night' : null };
  let last = null;
  try { last = localStorage.getItem(KEY); } catch (e) {}
  const pool = Object.entries(WEIGHTS).filter(([k]) => k !== last);
  let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0), weather = pool[0][0];
  for (const [k, w] of pool){ if ((r -= w) < 0){ weather = k; break; } }
  try { localStorage.setItem(KEY, weather); } catch (e) {}
  return { weather, mode: null };
}

export function weatherLabel(weather, night){
  return { clear: '', rain: 'Lluvia', storm: 'Tormenta', fog: 'Niebla', special: night ? 'Lluvia de estrellas' : 'Atardecer' }[weather] || '';
}
