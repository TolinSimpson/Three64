# Three64 Engine

A lightweight Three.js-based engine with Ammo.js physics and a Blender-driven authoring workflow.

This README is a quick-start. Full docs live in `src/docs/pages/` and render directly on GitHub.

## Requirements
- Node.js 18+

## Install
```bash
npm install
```

## Develop (watch + live reload)
```bash
npm run dev
# open http://localhost:5173
```

## Build (outputs to public/build)
```bash
npm run build
```

## Serve static (no watch)
```bash
npm run serve
# then open http://localhost:5173/
```

Notes:
- Production builds disable dev mode and do not include `/public/docs`.
- Entry: `src/runtime/engine.js` → Output: `public/build/runtime.js`.

## Documentation (browse these on GitHub)
- Getting Started:
  - Setup & Build: `src/docs/pages/setup-build.md`
  - Scene Conventions: `src/docs/pages/scene-conventions.md`
- Asset Authoring (Blender):
  - Add-on & Export: `src/docs/pages/asset-authoring.md`
  - Blender add-on README: `src/blender/README.md`
- API:
  - Architecture Overview: `src/docs/pages/api-architecture.md`
  - Runtime Modules & APIs: `src/docs/pages/api-runtime.md`

In development, press F1 for the debug overlay. An “Open Docs” button appears there (dev-only). Production builds keep dev features disabled.
*** End Patch*** }```}/>

