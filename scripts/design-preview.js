// Persistent local simulator. Deliberately never connects to Supabase.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createMockStore } from './mock-store.js';

const root = resolve('dist'), port = Number(process.env.MOCK_PORT || 4174);
const store = createMockStore(resolve('.local-test/data.json'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    const allowed = ['127.0.0.1:' + port, 'localhost:' + port];
    if (!allowed.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) {
      res.writeHead(403); res.end('Origem não permitida.'); return;
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/__mock/api') {
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(405); res.end(); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('Arquivo muito grande.'); chunks.push(chunk); }
      const { op, args, userId } = JSON.parse(Buffer.concat(chunks).toString());
      const data = store.execute(op, args, userId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ data })); return;
    }
    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end('window.FITA_CONFIG = { mode: "mock" };'); return;
    }
    const filename = resolve(root, '.' + decodeURIComponent(pathname).replace(/\/$/, '/index.html'));
    if (!filename.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${port} já está em uso.\nSe o Fita Mestra já estiver rodando, abra http://127.0.0.1:${port}/ — não precisa iniciar novamente.\nPara reiniciar, encerre o servidor anterior com Ctrl+C no terminal dele e execute pnpm demo novamente.`);
  } else {
    console.error(`Não foi possível iniciar o teste local: ${error.message}`);
  }
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Teste local persistente: http://127.0.0.1:' + port + '\nDados: .local-test/data.json'));
