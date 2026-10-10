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
  if (!t || !t.volume || t.start == null || t.end == null || !d.duration || d.avgDepth == null) return null;
  const litres = t.volume * (t.start - t.end);
  return litres / (d.duration / 60) / (d.avgDepth / 10 + 1);
}

export function summarize(dives){
  if (!dives.length) return null;
  const totalTime = dives.reduce((s, d) => s + (d.duration || 0), 0);
  const weightedAvg = dives.reduce((s, d) => s + (d.avgDepth || 0) * (d.duration || 0), 0) / (totalTime || 1);
  const by = (key, pick) => dives.filter(d => key(d) != null).reduce((a, b) => (pick(key(b), key(a)) ? b : a), dives.find(d => key(d) != null));
  const deepest = by(d => d.maxDepth, (b, a) => b > a);
  const longest = by(d => d.duration, (b, a) => b > a);
  const coldest = by(d => d.minTemp, (b, a) => b < a);
  const sacs = dives.map(sac).filter(v => v != null);
  return {
    count: dives.length,
    totalTime,
    maxDepth: deepest?.maxDepth ?? null,
    avgDepth: weightedAvg,
    minTemp: coldest?.minTemp ?? null,
    sites: new Set(dives.map(d => d.site?.name)).size,
    sac: sacs.length ? sacs.reduce((s, v) => s + v, 0) / sacs.length : null,
    deepest, longest, coldest,
  };
}
