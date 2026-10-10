import { XMLParser } from 'fast-xml-parser';

/*
 * UDDF (Universal Dive Data Format) reader, tested with Pro Dive exports.
 * UDDF uses SI units: depth in metres, time in seconds, temperature in kelvin,
 * pressure in pascal and tank volume in cubic metres. Everything is converted
 * here to what a diver reads: m, s, °C, bar and litres.
 */

const LISTS = new Set(['site', 'mix', 'repetitiongroup', 'dive', 'waypoint', 'link', 'para', 'tankdata', 'divecomputer']);
const PROFILE_STEP = 5;      // seconds per point kept for the depth chart
const TEMP_STEP = 30;        // seconds per point kept for the temperature line

const num = v => (v === undefined || v === null || v === '' ? null : Number(v));
const round = (v, d = 1) => (v === null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const kToC = k => (k === null ? null : k - 273.15);
const paToBar = p => (p === null ? null : p / 1e5);
const text = v => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();

export function parseUDDF(xml){
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: true,
    isArray: name => LISTS.has(name),
  });
  const doc = parser.parse(xml)?.uddf;
  if (!doc) throw new Error('El archivo no es un UDDF válido.');

  const sites = new Map();
  for (const s of doc.divesite?.site ?? []){
    sites.set(s.id, { name: text(s.name) || 'Sin nombre', lat: num(s.geography?.latitude), lon: num(s.geography?.longitude) });
  }
  const mixes = new Map();
  for (const m of doc.gasdefinitions?.mix ?? []){
    mixes.set(m.id, { name: text(m.name) || 'Aire', o2: num(m.o2), he: num(m.he) });
  }
  const computers = new Map();
  for (const c of doc.diver?.owner?.equipment?.divecomputer ?? []) computers.set(c.id, text(c.model) || text(c.name));

  const dives = [];
  for (const group of doc.profiledata?.repetitiongroup ?? []){
    for (const d of group.dive ?? []) dives.push(readDive(d, { sites, mixes, computers, generator: text(doc.generator?.name) }));
  }
  if (!dives.length) throw new Error('El archivo no contiene inmersiones.');
  return dives;
}

function readDive(d, ctx){
  const before = d.informationbeforedive ?? {}, after = d.informationafterdive ?? {};
  const refs = (before.link ?? []).map(l => l.ref);
  const site = refs.map(r => ctx.sites.get(r)).find(Boolean) ?? { name: 'Sin sitio', lat: null, lon: null };
  const computer = (before.equipmentused?.link ?? []).map(l => ctx.computers.get(l.ref)).find(Boolean) ?? null;

  const samples = (d.samples?.waypoint ?? [])
    .map(w => ({ t: num(w.divetime), z: num(w.depth), k: num(w.temperature) }))
    .filter(w => w.t !== null && w.z !== null)
    .sort((a, b) => a.t - b.t);

  const duration = num(after.diveduration) ?? (samples.length ? samples[samples.length - 1].t : null);
  const maxDepth = num(after.greatestdepth) ?? Math.max(0, ...samples.map(s => s.z));
  const avgDepth = num(after.averagedepth) ?? timeWeightedAverage(samples);
  const temps = samples.filter(s => s.k !== null).map(s => [s.t, kToC(s.k)]);
  const minTemp = after.lowesttemperature !== undefined ? kToC(num(after.lowesttemperature)) : (temps.length ? Math.min(...temps.map(x => x[1])) : null);

  const tank = (d.tankdata ?? [])[0];
  const mix = tank ? (tank.link ?? []).map(l => ctx.mixes.get(l.ref)).find(Boolean) : null;
  const notes = (after.notes?.para ?? []).map(text).filter(Boolean).join('\n');
  const start = text(before.datetime);

  return {
    // Pro Dive gives every dive a stable id; the start time is the fallback key for other apps
    id: d.id || `dive_${start}`,
    number: num(before.divenumber),
    start,
    site: { name: site.name, lat: round(site.lat, 6), lon: round(site.lon, 6) },
    maxDepth: round(maxDepth, 2),
    avgDepth: round(avgDepth, 2),
    duration,
    minTemp: round(minTemp, 1),
    maxTemp: round(temps.length ? Math.max(...temps.map(x => x[1])) : null, 1),
    tank: tank ? {
      volume: round(num(tank.tankvolume) * 1000, 1),
      start: round(paToBar(num(tank.tankpressurebegin)), 0),
      end: round(paToBar(num(tank.tankpressureend)), 0),
      gas: mix?.name ?? 'Aire',
      o2: mix?.o2 ?? 0.21,
    } : null,
    notes,
    computer,
    source: ctx.generator || null,
    profile: downsample(samples, PROFILE_STEP, maxDepth),
    temps: bucket(temps, TEMP_STEP).map(([t, c]) => [t, round(c, 1)]),
  };
}

function timeWeightedAverage(s){
  if (s.length < 2) return s[0]?.z ?? 0;
  let area = 0;
  for (let i = 1; i < s.length; i++) area += (s[i].t - s[i - 1].t) * (s[i].z + s[i - 1].z) / 2;
  return area / (s[s.length - 1].t - s[0].t || 1);
}

// Average depth per bucket, always keeping the surface start, the end and the deepest sample.
function downsample(samples, step, maxDepth){
  if (!samples.length) return [];
  const out = [[0, 0]];
  const buckets = new Map();
  for (const s of samples){
    const k = Math.floor(s.t / step);
    const b = buckets.get(k) ?? { t: 0, z: 0, n: 0 };
    b.t += s.t; b.z += s.z; b.n++;
    buckets.set(k, b);
  }
  for (const [, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) out.push([Math.round(b.t / b.n), round(b.z / b.n, 1)]);
  const deepest = samples.reduce((a, b) => (b.z > a.z ? b : a));
  const at = out.findIndex(p => p[0] >= deepest.t);
  const peak = [Math.round(deepest.t), round(Math.max(deepest.z, maxDepth ?? 0), 1)];
  if (at === -1) out.push(peak); else if (out[at][0] === peak[0]) out[at] = peak; else out.splice(at, 0, peak);
  const last = samples[samples.length - 1];
  if (out[out.length - 1][0] < last.t) out.push([Math.round(last.t), round(last.z, 1)]);
  return out;
}

function bucket(points, step){
  const m = new Map();
  for (const [t, v] of points){ const k = Math.floor(t / step); const b = m.get(k) ?? [0, 0, 0]; b[0] += t; b[1] += v; b[2]++; m.set(k, b); }
  return [...m.values()].map(b => [Math.round(b[0] / b[2]), b[1] / b[2]]);
}
