import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

let failed = false;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status) { failed = true; console.error(result.stderr); }
    }
  }
}
await check('.');
const html = await readFile('index.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
if (new Set(ids).size !== ids.length) { failed = true; console.error('IDs duplicados.'); }
for (const [, id] of html.matchAll(/for="([^"]+)"/g)) if (!ids.includes(id)) { failed = true; console.error('Rótulo sem campo:', id); }
if (failed) process.exitCode = 1;
else console.log('Sintaxe JavaScript e associações HTML válidas.');
