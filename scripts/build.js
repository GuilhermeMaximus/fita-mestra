import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['app.js', 'obs.js'], bundle: true, outdir: 'dist', format: 'esm', target: 'es2022', minify: true, sourcemap: false });
for (const file of ['index.html', 'obs.html', 'style.css', '_headers']) await copyFile(file, `dist/${file}`);
await copyFile(process.env.FITA_CONFIG_FILE || 'config.js', 'dist/config.js');
await cp('assets/optimized', 'dist/assets', { recursive: true });
console.log('Publicação pronta em dist/ (somente arquivos públicos).');
