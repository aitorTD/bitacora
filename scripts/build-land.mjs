/*
 * Builds src/data/land.json: the coastline drawn behind the dive-site map.
 * Natural Earth land (world-atlas, 1:10m) is simplified, clipped to the region below and
 * projected once to Mercator, so the page only has to draw one SVG path, with no map service.
 *
 *   node scripts/build-land.mjs            (re-run after changing REGION, e.g. a trip far away)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import { geoMercator, geoPath } from 'd3-geo';

// lon/lat box that gets drawn: the Atlantic islands, the Mediterranean and the Red Sea
const REGION = { west: -32, east: 46, south: 8, north: 62 };
const UNITS_PER_DEG = 100;       // map units per degree of longitude; must match src/map.js
const MIN_AREA = 0.001;         // simplification, in square degrees

const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-10m.json', import.meta.url)));
const land = feature(simplify(presimplify(topo), MIN_AREA), topo.objects.land);

const projection = geoMercator().scale(UNITS_PER_DEG * 180 / Math.PI).translate([0, 0]);
const [x0, y1] = projection([REGION.west, REGION.south]);
const [x1, y0] = projection([REGION.east, REGION.north]);
projection.clipExtent([[x0, y0], [x1, y1]]);

const d = geoPath(projection).digits(0)(land);
writeFileSync(new URL('../src/data/land.json', import.meta.url), JSON.stringify({ unitsPerDeg: UNITS_PER_DEG, region: REGION, d }));
console.log(`land.json: ${(d.length / 1024).toFixed(0)} KB of path`);
