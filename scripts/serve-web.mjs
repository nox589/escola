// Serves the exported web build (apps/mobile/dist) with SPA fallback, for demos and the walkthrough.
//   node scripts/serve-web.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url));
const port = Number(process.argv[2] ?? 8081);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  for (const p of [join(root, path), join(root, 'index.html')]) {
    try {
      const data = await readFile(p);
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
      return res.end(data);
    } catch {
      /* try fallback */
    }
  }
  res.writeHead(404).end();
}).listen(port, () => process.stdout.write(`web app on http://localhost:${port}\n`));
