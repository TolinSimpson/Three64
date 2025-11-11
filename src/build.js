'use strict';

// Webpack-based build script to bundle the runtime into public/runtime.js
// Requires devDependencies: webpack, webpack-cli
import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';
import url from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    patterns.push({
      from: f,
      to: dest,
      noErrorOnMissing: true,
    });
  }
  return patterns;
}

const config = {
  // Enable tree-shaking and minification by default
  mode: process.env.NODE_ENV || 'production',
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
    minimize: true,               // terser in production
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
        // Assets (tree-shaken by scanning references)
        ...collectAssetFiles(),
        // Scene scripts (copied under build so runtime can dynamic import)
        // Config
        {
          from: path.resolve(__dirname, '../src/assets/config'),
          to: path.resolve(__dirname, '../public/build/assets/config'),
          noErrorOnMissing: true,
        },
        // Ammo.js is bundled into runtime.js; no vendor copy needed
      ],
    }),
  ],
  devtool: 'source-map',
  stats: 'minimal',
};

function run() {
  const compiler = webpack(config);
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

run();


