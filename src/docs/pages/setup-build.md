# Setup & Build

## Prerequisites
- Node.js LTS (v18+ recommended)
- npm (comes with Node)

## Install dependencies
```bash
npm install
```

## Development (watch + live reload)
Starts the webpack build in watch mode and serves `public/` with live reload on port 5173.
```bash
npm run dev
```
This runs:
- `NODE_ENV=development node src/build.js --watch` (incremental rebuilds to `public/build/`)
- `live-server public --port=5173 --no-browser`

Open `http://localhost:5173`. Press F1 to toggle the debug overlay. In dev, a Docs button is available there.

## Simple static server
Serve the already-built `public/` directory without the watch build:
```bash
npm run serve
# then open http://localhost:5173/
```

## One‑off build
```bash
npm run build
# or explicitly set prod
cross-env NODE_ENV=production node src/build.js
```
Outputs to `public/build/`:
- `public/build/runtime.js` and async chunks
- `public/build/assets/...` (models, textures, config)

Docs are copied to `public/docs/`.

## Obfuscation and minification
- Production builds enable webpack optimizations and minification by default.
- Source maps are currently enabled; you can harden prod by disabling them in `src/build.js` (set `devtool` to `false` when `mode === 'production'`).
- For additional obfuscation, consider `webpack-obfuscator` as an optional plugin (not included by default).

## What to publish
Deploy the `public/` folder (static host or CDN):
- `public/index.html`
- `public/build/**` (compiled JS + assets)
- `public/docs/**` (this documentation)

You do NOT publish `src/**`. The build script copies/optimizes assets as needed.

## Project layout (relevant to build)
- `src/runtime/**`: Engine/runtime source (bundled)
- `src/assets/**`: Source assets (models, textures, config)
- `src/components/**`: Custom components for dynamic import
- `src/scenes/**`: Scene modules
- `src/blender/**`: Blender add-on and samples
- `public/**`: Static entry point and build output

In production, only assets referenced by the runtime and scene modules are copied (basic tree-shaken copy).


