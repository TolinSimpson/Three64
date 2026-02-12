import express from 'express';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'src/assets/models');
const COMP_DATA_DIR = path.join(PROJECT_ROOT, 'src/assets/default-component-data');
const EDITOR_PUBLIC = path.join(__dirname, 'public');
const THREE_DIR = path.join(PROJECT_ROOT, 'node_modules/three');

const PORT = parseInt(process.env.EDITOR_PORT || '3664', 10);

const app = express();

// --- Static serving ---

// Editor frontend
app.use('/', express.static(EDITOR_PUBLIC));

// Three.js from node_modules (for ES module imports in the browser)
app.use('/three/', express.static(path.join(THREE_DIR, 'build')));
app.use('/three/addons/', express.static(path.join(THREE_DIR, 'examples/jsm')));

// Model files
app.use('/models/', express.static(MODELS_DIR));

// --- API ---

// List available GLTF/GLB models
app.get('/api/models', async (_req, res) => {
  try {
    if (!existsSync(MODELS_DIR)) {
      await mkdir(MODELS_DIR, { recursive: true });
    }
    const files = await readdir(MODELS_DIR);
    const models = files.filter(f => /\.(glb|gltf)$/i.test(f));
    res.json({ models });
  } catch (err) {
    console.error('GET /api/models error:', err);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

// List available components with params and descriptions
app.get('/api/components', async (_req, res) => {
  try {
    if (!existsSync(COMP_DATA_DIR)) {
      res.json({ components: [] });
      return;
    }
    const files = await readdir(COMP_DATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
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
    // Sort alphabetically by type
    components.sort((a, b) => a.type.localeCompare(b.type));
    res.json({ components });
  } catch (err) {
    console.error('GET /api/components error:', err);
    res.status(500).json({ error: 'Failed to list components' });
  }
});

// Save GLB to disk
app.post('/api/save-gltf', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  try {
    const filename = req.query.filename || 'scene.glb';
    // Sanitize filename
    const safe = path.basename(String(filename));
    if (!safe || !/\.(glb|gltf)$/i.test(safe)) {
      res.status(400).json({ error: 'Invalid filename. Must end with .glb or .gltf' });
      return;
    }
    if (!existsSync(MODELS_DIR)) {
      await mkdir(MODELS_DIR, { recursive: true });
    }
    const dest = path.join(MODELS_DIR, safe);
    await writeFile(dest, req.body);
    console.log(`Saved ${safe} (${req.body.length} bytes)`);
    res.json({ ok: true, path: dest });
  } catch (err) {
    console.error('POST /api/save-gltf error:', err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// --- Start ---

const server = app.listen(PORT, () => {
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
