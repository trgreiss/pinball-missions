// Local dev server: serves public/ and routes /api/pinballmap to the Netlify function handler,
// so the site can be tested without the Netlify CLI. Usage: npm run dev  (PORT env to override 8888)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { ROOT } from './lib/db.js';
import pinballmap from '../netlify/functions/pinballmap.js';

try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {}

const PUBLIC = resolve(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 8888);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/pinballmap') {
    const response = await pinballmap(new Request(url));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(await response.text());
  }
  let path = normalize(join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!path.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
  } catch {
    if (!extname(path)) path += '.html'; // pretty URLs, like Netlify
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => console.log(`Pinball Missions dev server: http://localhost:${PORT}`));
