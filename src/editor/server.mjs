import http from 'node:http';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'src/assets/models');
const COMP_DATA_DIR = path.join(PROJECT_ROOT, 'src/assets/default-component-data');
const EDITOR_PUBLIC = path.join(__dirname, 'public');
const THREE_DIR = path.join(PROJECT_ROOT, 'node_modules/three');

const PORT = parseInt(process.env.EDITOR_PORT || '3664', 10);

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const staticRoots = [
  { prefix: '/three/addons/', dir: path.join(THREE_DIR, 'examples/jsm') },
  { prefix: '/three/', dir: path.join(THREE_DIR, 'build') },
  { prefix: '/models/', dir: MODELS_DIR },
  { prefix: '/', dir: EDITOR_PUBLIC },
];

function getMime(ext) {
  return MIME[ext?.toLowerCase()] || 'application/octet-stream';
}

function serveStatic(url, res) {
  for (const { prefix, dir } of staticRoots) {
    if (!url.startsWith(prefix) || !existsSync(dir)) continue;
    const subpath = url === prefix ? 'index.html' : url.slice(prefix.length);
    const filepath = path.join(dir, subpath.replace(/\.\./g, ''));
    if (!filepath.startsWith(dir)) {
      res.writeHead(403);
      res.end();
      return true;
    }
    if (!existsSync(filepath)) continue;
    try {
      const ext = path.extname(filepath);
      const stream = createReadStream(filepath);
      res.setHeader('Content-Type', getMime(ext));
      stream.pipe(res);
      return true;
    } catch (_) {
      continue;
    }
  }
  return false;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on('data', (chunk) => {
      len += chunk.length;
      if (len > limit) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost`);
  const pathname = url.pathname;

  // --- API ---
  if (pathname === '/api/models') {
    try {
      if (!existsSync(MODELS_DIR)) {
        await mkdir(MODELS_DIR, { recursive: true });
      }
      const files = await readdir(MODELS_DIR);
      const models = files.filter(f => /\.(glb|gltf)$/i.test(f));
      json(res, 200, { models });
    } catch (err) {
      console.error('GET /api/models error:', err);
      json(res, 500, { error: 'Failed to list models' });
    }
    return;
  }

  if (pathname === '/api/components') {
    try {
      const actions = [];
      if (existsSync(COMP_DATA_DIR)) {
        const actionsPath = path.join(COMP_DATA_DIR, 'actions.json');
        if (existsSync(actionsPath)) {
          try {
            const raw = await readFile(actionsPath, 'utf-8');
            actions.push(...(JSON.parse(raw) || []));
          } catch (e) {
            console.warn('Skipping actions.json:', e.message);
          }
        }
      }

      if (!existsSync(COMP_DATA_DIR)) {
        json(res, 200, { components: [], actions });
        return;
      }
      const files = await readdir(COMP_DATA_DIR);
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'actions.json');
      const components = [];
      for (const f of jsonFiles) {
        try {
          const raw = await readFile(path.join(COMP_DATA_DIR, f), 'utf-8');
          const data = JSON.parse(raw);
          components.push({
            type: data.type || f.replace('.json', ''),
            params: data.params || {},
            paramDescriptions: data.paramDescriptions || [],
          });
        } catch (e) {
          console.warn(`Skipping ${f}:`, e.message);
        }
      }
      components.sort((a, b) => a.type.localeCompare(b.type));
      json(res, 200, { components, actions });
    } catch (err) {
      console.error('GET /api/components error:', err);
      json(res, 500, { error: 'Failed to list components' });
    }
    return;
  }

  if (pathname === '/api/save-gltf' && req.method === 'POST') {
    try {
      const filename = url.searchParams.get('filename') || 'scene.glb';
      const safe = path.basename(String(filename));
      if (!safe || !/\.(glb|gltf)$/i.test(safe)) {
        json(res, 400, { error: 'Invalid filename. Must end with .glb or .gltf' });
        return;
      }
      const body = await readBody(req);
      if (!existsSync(MODELS_DIR)) {
        await mkdir(MODELS_DIR, { recursive: true });
      }
      const dest = path.join(MODELS_DIR, safe);
      await writeFile(dest, body);
      console.log(`Saved ${safe} (${body.length} bytes)`);
      json(res, 200, { ok: true, path: dest });
    } catch (err) {
      console.error('POST /api/save-gltf error:', err);
      json(res, 500, { error: err.message || 'Failed to save file' });
    }
    return;
  }

  // --- Static ---
  if (serveStatic(pathname, res)) return;

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Three64 Editor running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`Either stop the other process or run with a different port:\n`);
    console.error(`  npm run editor -- --port=3665\n`);
    process.exit(1);
  }
  throw err;
});
