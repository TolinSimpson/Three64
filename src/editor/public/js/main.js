/**
 * main.js - Bootstrap for the Three64 Scene Editor.
 * Creates all modules and wires them together.
 */
import { Viewport }      from './viewport.js';
import { AssetLibrary }  from './assetLibrary.js';
import { Hierarchy }     from './hierarchy.js';
import { Inspector }     from './inspector.js';
import { Toolbar }       from './toolbar.js';

// --- Initialise Viewport ---
const canvas = document.getElementById('viewport-canvas');
const viewport = new Viewport(canvas);

// --- Initialise Inspector ---
const inspectorEl = document.getElementById('inspector-content');
const inspector = new Inspector(inspectorEl, viewport);

// --- Initialise Hierarchy ---
const treeEl = document.getElementById('hierarchy-tree');
const contextEl = document.getElementById('context-menu');
const hierarchy = new Hierarchy(treeEl, contextEl, viewport);

// Rebuild hierarchy when structural changes occur
hierarchy.onChanged(() => inspector.refresh());

// --- Initialise Asset Library ---
const assetListEl = document.getElementById('asset-list');
const assetLibrary = new AssetLibrary(assetListEl, viewport, (placed) => {
  hierarchy.rebuild();
  inspector.inspect(placed);
});

// --- Initialise Toolbar ---
const toolbar = new Toolbar(viewport, hierarchy, inspector, assetLibrary);
toolbar.setStatus('Ready');

// --- Right-panel divider resize ---
const divider = document.getElementById('right-panel-divider');
const hierSection = document.getElementById('hierarchy-section');
const inspSection = document.getElementById('inspector-section');

if (divider && hierSection && inspSection) {
  let dragging = false;
  let startY = 0;
  let startH = 0;

  divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = hierSection.getBoundingClientRect().height;
    divider.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const newH = Math.max(80, startH + delta);
    hierSection.style.flex = `0 0 ${newH}px`;
  });

  divider.addEventListener('pointerup', () => { dragging = false; });
  divider.addEventListener('pointercancel', () => { dragging = false; });
}

// --- Global key: Escape to deselect or exit placement ---
// (Handled in toolbar.js keyboard bindings)

console.log('Three64 Editor initialised');
