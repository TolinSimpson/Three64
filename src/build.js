'use strict';

// Webpack-based build script to bundle the runtime into public/runtime.js
// Requires devDependencies: webpack, webpack-cli
import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import url from 'url';
import { ComponentRegistry } from './runtime/component.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev/watch flags
const isWatch = process.argv.includes('--watch');
const isDevEnv = (process.env.NODE_ENV || 'production') === 'development';
const mode = (isWatch || isDevEnv) ? 'development' : (process.env.NODE_ENV || 'production');
const isDev = mode === 'development';

// Attempt to load GLTF optimizer (gltf-pipeline) lazily so it's optional
let __gltfPipelineChecked = false;
let __gltfPipeline = null;
async function getGltfPipeline() {
  if (__gltfPipelineChecked) return __gltfPipeline;
  __gltfPipelineChecked = true;
  try {
    const mod = await import('gltf-pipeline');
    __gltfPipeline = mod?.default ?? mod;
  } catch {
    __gltfPipeline = null;
  }
  return __gltfPipeline;
}

async function optimizeGltfIfPossible(buffer, absoluteFrom) {
  const ext = path.extname(absoluteFrom).toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') return buffer;
  const gp = await getGltfPipeline();
  if (!gp) return buffer; // optimizer not installed; skip silently
  try {
    // Favor Draco compression; falls back gracefully if draco3d is missing.
    const options = {
      dracoOptions: { compressionLevel: 7 },
      // quantize is enabled by default in gltf-pipeline for some stages;
      // we rely on sensible defaults here to keep configuration minimal.
    };
    if (ext === '.glb') {
      const result = await gp.processGlb(buffer, options);
      if (result?.glb) return Buffer.from(result.glb);
    } else {
      const json = JSON.parse(buffer.toString('utf-8'));
      const result = await gp.processGltf(json, options);
      if (result?.glb) return Buffer.from(result.glb);
      if (result?.gltf) return Buffer.from(JSON.stringify(result.gltf));
    }
  } catch {
    // On any error, just return the original asset to keep build robust.
  }
  return buffer;
}

async function generateComponentPresets() {
  const projectRoot = path.resolve(__dirname, '..');
  const runtimeDir = path.resolve(projectRoot, 'src/runtime');
  const outputDir = path.resolve(projectRoot, 'src/blender/component-data');
  try { fs.mkdirSync(outputDir, { recursive: true }); } catch {}

  // Find files that register components
  const filesToImport = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!st.isFile() || !p.endsWith('.js')) continue;
      try {
        const src = fs.readFileSync(p, 'utf-8');
        if (src.includes('ComponentRegistry.register(')) {
          filesToImport.push(p);
        }
      } catch {}
    }
  };
  walk(runtimeDir);

  // Import modules to trigger registration side-effects
  for (const f of filesToImport) {
    try {
      await import(url.pathToFileURL(f).href);
    } catch {}
  }

  // Build presets from registry
  const normalize = (s) => String(s || "").replace(/[\s\-_]/g, "").toLowerCase();
  const names = ComponentRegistry.list();
  /** @type {Map<string, {display:string, ctor:any}>} */
  const byCanon = new Map();
  for (const name of names) {
    const canon = normalize(name);
    if (byCanon.has(canon)) continue;
    const ctor = ComponentRegistry.get(name);
    byCanon.set(canon, { display: name, ctor });
  }
  for (const [canon, { display, ctor }] of byCanon.entries()) {
    let params = {};
    let paramDescriptions = [];
    try {
      if (ctor && typeof ctor.getDefaultParams === 'function') {
        const d = ctor.getDefaultParams();
        if (d && typeof d === 'object') params = d;
      } else if (ctor && ctor.defaultParams && typeof ctor.defaultParams === 'object') {
        params = ctor.defaultParams;
      }
      if (ctor && typeof ctor.getParamDescriptions === 'function') {
        const desc = ctor.getParamDescriptions();
        if (Array.isArray(desc)) paramDescriptions = desc;
      }
    } catch {}
    const out = { type: display, params: params || {}, paramDescriptions };
    const outPath = path.join(outputDir, `${canon}.json`);
    try {
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
    } catch {}
  }
}

function collectAssetFiles() {
  const projectRoot = path.resolve(__dirname, '..');
  const assetsDir = path.resolve(projectRoot, 'src/assets');
  const modelsDir = path.resolve(assetsDir, 'models');
  const texturesDir = path.resolve(assetsDir, 'textures');
  const manifestPath = path.resolve(assetsDir, 'config/scene-manifest.json');

  /** @type {Set<string>} */
  const files = new Set();
  const addIfExists = (p) => { if (fs.existsSync(p)) files.add(p); };

  // Always include default/fallback assets
  addIfExists(path.join(modelsDir, 'default-scene.glb'));
  addIfExists(path.join(texturesDir, 'default-particle.png'));

  // Include assets referenced by scene-manifest.json (URLs are resolved at runtime)
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      // no-op: scenes load assets by URL; tree-shake via source scan below
    }
  } catch {}

  // Regex scan in runtime for references
  const scanRegexes = [
    /['"`]models\/([A-Za-z0-9_\-\/\.]+?\.glb)['"`]/g,
    /['"`]textures\/([A-Za-z0-9_\-\/\.]+\.(?:png|jpg|jpeg))['"`]/g,
  ];
  const scanFilesIn = (dir) => {
    if (!fs.existsSync(dir)) return;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d)) {
        const p = path.join(d, entry);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (st.isFile() && p.endsWith('.js')) {
          try {
            const src = fs.readFileSync(p, 'utf-8');
            for (const rx of scanRegexes) {
              let m;
              while ((m = rx.exec(src)) !== null) {
                const rel = m[0].slice(1, -1);
                const full =
                  rel.startsWith('models/') ? path.join(modelsDir, rel.substring('models/'.length)) :
                  rel.startsWith('textures/') ? path.join(texturesDir, rel.substring('textures/'.length)) :
                  null;
                if (full) addIfExists(full);
              }
            }
          } catch {}
        }
      }
    };
    walk(dir);
  };
  scanFilesIn(path.resolve(projectRoot, 'src/runtime'));

  const patterns = [];
  for (const f of files) {
    const relFromAssets = path.relative(assetsDir, f).replace(/\\/g, '/');
    const dest = path.resolve(projectRoot, 'public/build/assets', path.dirname(relFromAssets));
    const isGltfLike = /\.glb$/i.test(f) || /\.gltf$/i.test(f);
    patterns.push(
      isGltfLike
        ? {
            from: f,
            to: dest,
            noErrorOnMissing: true,
            transform: async (content, absoluteFrom) => {
              return await optimizeGltfIfPossible(content, absoluteFrom);
            },
          }
        : {
            from: f,
            to: dest,
            noErrorOnMissing: true,
          }
    );
  }
  return patterns;
}

const config = {
  // Enable tree-shaking and minification by default
  mode,
  context: __dirname,
  target: 'web',
  entry: './runtime/engine.js',
  output: {
    path: path.resolve(__dirname, '../public/build'),
    filename: 'runtime.js',
    chunkFilename: '[name].[contenthash].js',
  },
  resolve: {
    extensions: ['.js'],
    fallback: {
      fs: false,
      path: false,
    },
  },
  optimization: {
    usedExports: true,            // mark unused exports for pruning
    sideEffects: true,            // respect package sideEffects flags
    concatenateModules: true,     // scope hoisting
    minimize: mode !== 'development', // no minify in dev for faster rebuilds
    // enable async chunks for dynamic imports
    splitChunks: {
      chunks: 'async'
    },
  },
  module: {
    rules: [
      {
        test: /\.(glb|gltf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/models/[name][ext]'
        }
      },
      {
        test: /\.(png|jpg|jpeg|webp)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/textures/[name][ext]'
        }
      }
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        // Assets
        // In development, copy entire asset folders and watch for changes to enable hot reload without restarts.
        // In production, only copy tree-shaken assets discovered via source scans.
        ...(isDev
          ? [
              {
                from: path.resolve(__dirname, '../src/assets/models'),
                to: path.resolve(__dirname, '../public/build/assets/models'),
                noErrorOnMissing: true,
              },
              {
                from: path.resolve(__dirname, '../src/assets/textures'),
                to: path.resolve(__dirname, '../public/build/assets/textures'),
                noErrorOnMissing: true,
              },
            ]
          : collectAssetFiles()),
        // Scene scripts (copied under build so runtime can dynamic import)
        // Config
        {
          from: path.resolve(__dirname, '../src/assets/config'),
          to: path.resolve(__dirname, '../public/build/assets/config'),
          noErrorOnMissing: true,
        },
        // Component presets for Blender/tooling and runtime fallback
        {
          from: path.resolve(__dirname, '../src/blender/component-data'),
          to: path.resolve(__dirname, '../public/build/assets/component-data'),
          noErrorOnMissing: true,
        },
        // Ammo.js is bundled into runtime.js; no vendor copy needed
      ],
    }),
  ],
  devtool: 'source-map',
  stats: 'minimal',
};

async function run() {
  // Generate component preset JSONs prior to bundling
  await generateComponentPresets().catch(() => {});
  const compiler = webpack(config);
  if (isWatch) {
    // Watch mode for development: incremental rebuilds
    const watching = compiler.watch({ ignored: /node_modules/ }, (err, stats) => {
      if (err) {
        console.error(err);
        return;
      }
      const info = stats.toJson();
      if (stats.hasErrors()) {
        console.error(info.errors);
      }
      if (stats.hasWarnings()) {
        console.warn(info.warnings);
      }
      const outFile = path.relative(process.cwd(), path.join(config.output.path, config.output.filename));
      console.log(`[${new Date().toLocaleTimeString()}] Rebuilt: ${outFile}`);
    });
    const shutdown = () => {
      watching.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    compiler.run((err, stats) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      const info = stats.toJson();
      if (stats.hasErrors()) {
        console.error(info.errors);
        process.exit(1);
      }
      if (stats.hasWarnings()) {
        console.warn(info.warnings);
      }
      console.log('Built:', path.relative(process.cwd(), path.join(config.output.path, config.output.filename)));
      compiler.close((closeErr) => {
        if (closeErr) {
          console.error(closeErr);
          process.exit(1);
        }
      });
    });
  }
}

run();


