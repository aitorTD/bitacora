/*
 * Logbook helpers shared by the page and the import script.
 */

// Adds new dives and leaves the ones already in the log untouched.
// A dive counts as already imported when its id matches, or when it starts at the same minute.
export function mergeDives(existing, incoming){
  const ids = new Set(existing.map(d => d.id));
  const minutes = new Set(existing.map(d => minuteKey(d.start)));
  const added = [], skipped = [];
  for (const d of incoming){
    if (ids.has(d.id) || minutes.has(minuteKey(d.start))){ skipped.push(d); continue; }
    ids.add(d.id); minutes.add(minuteKey(d.start));
    added.push(d);
  }
  const all = [...existing, ...added].sort((a, b) => new Date(b.start) - new Date(a.start));
  return { all, added, skipped };
}
const minuteKey = iso => (iso ? new Date(iso).toISOString().slice(0, 16) : '');

// Surface air consumption in litres per minute, from tank volume, pressure used, time and average depth.
export function sac(d){
  const t = d.tank;
  // without a real average depth (dives logged by hand) the consumption cannot be worked out
  if (!t || !t.volume || t.start == null || t.end == null || !d.duration || !(d.avgDepth > 0)) return null;
  const litres = t.volume * (t.start - t.end);
  return litres / (d.duration / 60) / (d.avgDepth / 10 + 1);
}

// Statistics a dive can take part in. Each dive can switch any of them off from the admin
// (e.g. a training dive left out of the air consumption); that data is then also hidden on its card.
// Older imports stored 0 as the average depth of dives logged by hand; treat it as unknown.
export function normalizeDive(d){
  const hasProfile = Array.isArray(d.profile) && d.profile.length > 1;
  return { ...d, profile: hasProfile ? d.profile : [], avgDepth: d.avgDepth > 0 ? d.avgDepth : null };
}

export const STATS = ['count', 'time', 'maxDepth', 'avgDepth', 'minTemp', 'sac'];
export const statOn = (d, key) => !(d.statsOff || []).includes(key) && !(key === 'sac' && d.noSac);

export function summarize(dives){
  if (!dives.length) return null;
  const on = key => dives.filter(d => statOn(d, key));
  const timed = on('time'), avgs = on('avgDepth').filter(d => d.avgDepth > 0 && d.duration);
  const totalTime = timed.reduce((s, d) => s + (d.duration || 0), 0);
  const avgTime = avgs.reduce((s, d) => s + d.duration, 0);
  const pickBy = (list, key, better) => list.filter(d => key(d) != null).reduce((a, b) => (a == null || better(key(b), key(a)) ? b : a), null);
  const deepest = pickBy(on('maxDepth'), d => d.maxDepth, (b, a) => b > a);
  const longest = pickBy(timed, d => d.duration, (b, a) => b > a);
  const coldest = pickBy(on('minTemp'), d => d.minTemp, (b, a) => b < a);
  const sacs = on('sac').map(sac).filter(v => v != null);
  return {
    count: on('count').length,
    totalTime: timed.length ? totalTime : null,
    maxDepth: deepest?.maxDepth ?? null,
    avgDepth: avgTime ? avgs.reduce((s, d) => s + d.avgDepth * d.duration, 0) / avgTime : null,
    minTemp: coldest?.minTemp ?? null,
    sites: new Set(dives.map(d => d.site?.name)).size,
    sac: sacs.length ? sacs.reduce((s, v) => s + v, 0) / sacs.length : null,
    deepest, longest, coldest,
  };
}
