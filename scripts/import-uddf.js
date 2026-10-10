#!/usr/bin/env node
/*
 * Imports Pro Dive (UDDF) exports into src/data/dives.json.
 *
 *   npm run import -- ruta/a/inmersion.uddf [otra.uddf ...]
 *   npm run import -- carpeta/con/exportaciones
 *
 * Dives already in the log are skipped, so the same files can be imported again safely.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUDDF } from '../src/lib/uddf.js';
import { mergeDives } from '../src/lib/logbook.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(root, 'src/data/dives.json');

async function collect(paths){
  const files = [];
  for (const p of paths){
    const s = await stat(p).catch(() => null);
    if (!s){ console.error(`No encuentro ${p}`); continue; }
    if (s.isDirectory()){
      for (const f of await readdir(p)) if (extname(f).toLowerCase() === '.uddf') files.push(join(p, f));
    } else files.push(p);
  }
  return files;
}

const args = process.argv.slice(2);
if (!args.length){
  console.log('Uso: npm run import -- archivo.uddf [más archivos o carpetas]');
  process.exit(1);
}

const existing = JSON.parse(await readFile(LOG, 'utf8').catch(() => '[]'));
const incoming = [];
for (const f of await collect(args)){
  try {
    const dives = parseUDDF(await readFile(f, 'utf8'));
    incoming.push(...dives);
    console.log(`✓ ${f}: ${dives.length} inmersión(es)`);
  } catch (e){
    console.error(`✗ ${f}: ${e.message}`);
  }
}

const { all, added, skipped } = mergeDives(existing, incoming);
await writeFile(LOG, JSON.stringify(all, null, 1) + '\n');
for (const d of added) console.log(`  + nº ${d.number ?? '?'} · ${d.site.name} · ${d.start} · ${d.maxDepth} m`);
console.log(`\n${added.length} nueva(s), ${skipped.length} ya estaba(n) en la bitácora. Total: ${all.length}.`);
