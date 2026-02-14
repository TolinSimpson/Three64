'use strict';
import { config } from "./engine.js";
import { ComponentRegistry } from "./component.js";

export const Debug = {
  config: null,
  enabled: false,
  overlayEl: null,
  selection: {
    object: null,
    path: null,
    source: null, // 'find' | 'path' | 'name' | 'prop' | 'uuid'
  },
  lastFind: [],
  cli: {
    inputEl: null,
    logEl: null,
  },
  toggles: {
    showHUD: true,
    wireframe: false,
    budgetOverlay: true,
    collidersLime: false,
    navmesh: false,
  },
  profiler: {
    fpsEl: null,
    msEl: null,
    trisEl: null,
    tilesEl: null,
    ramEl: null,
    voicesEl: null,
    particlesEl: null,
    fpsBadgeEl: null,
    frames: 0,
    accumMs: 0,
    frameStart: 0,
    beginFrame() { this.frameStart = performance.now(); },
    endFrame({ tris, tiles, ramBytes, voices, particles }) {
      const now = performance.now();
      const dt = now - this.frameStart;
      if (this.fpsEl) {
        this.frames += 1;
        this.accumMs += dt;
        if (this.accumMs >= 1000) {
          const fps = Math.round((this.frames * 1000) / this.accumMs);
          this.fpsEl.textContent = `FPS: ${fps}`;
          if (this.fpsBadgeEl) this.fpsBadgeEl.textContent = `${fps} fps`;
          this.frames = 0;
          this.accumMs = 0;
        }
        if (this.msEl) this.msEl.textContent = `ms: ${dt.toFixed(2)}`;
        if (this.trisEl) this.trisEl.textContent = `tris: ${tris ?? 0}`;
        if (this.tilesEl) this.tilesEl.textContent = `tiles: ${tiles ?? 0}`;
        if (this.ramEl) this.ramEl.textContent = `RAM: ${formatBytes(ramBytes ?? 0)}`;
        if (this.voicesEl) this.voicesEl.textContent = `voices: ${voices ?? 0}`;
        if (this.particlesEl) this.particlesEl.textContent = `particles: ${particles ?? 0}`;
      }
    },
  },
  errors: {
    el: null,
    ensure() {
      if (!this.el) {
        this.el = document.createElement('div');
        this.el.id = 'error-overlay';
        this.el.style.position = 'absolute';
        this.el.style.bottom = '0';
        this.el.style.left = '0';
        this.el.style.right = '0';
        this.el.style.maxHeight = '40vh';
        this.el.style.overflow = 'auto';
        this.el.style.background = 'rgba(128,0,0,0.6)';
        this.el.style.color = '#fff';
        this.el.style.fontFamily = 'monospace';
        this.el.style.fontSize = '12px';
        this.el.style.padding = '6px 8px';
        this.el.style.display = 'none';
        document.getElementById('app-root')?.appendChild(this.el);
      }
    },
    show(messages) {
      this.ensure();
      const list = Array.isArray(messages) ? messages : [messages];
      this.el.innerHTML = list.map(m => `<div>• ${escapeHtml(m)}</div>`).join('');
      this.el.style.display = list.length ? 'block' : 'none';
    },
    hide() { this.ensure(); this.el.style.display = 'none'; }
  }
};

export async function initDebugOverlay(game) {
  Debug.config = config;
  applyURLFlags();
  installKeyHandlers(game);
  if (!Debug.config?.devMode) return;
  await ensureOverlayHTMLInline(game);
  wireElements();
  setHUDVisible(Debug.toggles.showHUD);
}

function applyURLFlags() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("hud")) Debug.toggles.showHUD = params.get("hud") !== "0";
  if (params.has("wire")) Debug.toggles.wireframe = params.get("wire") === "1";
  if (params.has("budget")) Debug.toggles.budgetOverlay = params.get("budget") !== "0";
}

function wireElements() {
  const root = document.getElementById('debug-overlay');
  Debug.overlayEl = root;
  Debug.profiler.fpsEl = document.getElementById('hud-fps');
  Debug.profiler.msEl = document.getElementById('hud-ms');
  Debug.profiler.trisEl = document.getElementById('hud-tris');
  Debug.profiler.tilesEl = document.getElementById('hud-tiles');
  Debug.profiler.ramEl = document.getElementById('hud-ram');
  Debug.profiler.voicesEl = document.getElementById('hud-voices');
  Debug.profiler.particlesEl = document.getElementById('hud-particles');
  Debug.profiler.fpsBadgeEl = document.getElementById('hud-fps-badge');
  Debug.cli.inputEl = document.getElementById('debug-cli-input');
  Debug.cli.logEl = document.getElementById('debug-cli-log');
  const navBtn = document.getElementById('toggle-navmesh-btn');
  if (navBtn) {
    navBtn.addEventListener('click', (e) => {
      e.preventDefault();
      Debug.toggles.navmesh = !Debug.toggles.navmesh;
      applyNavMesh(window.__game, Debug.toggles.navmesh);
      log(`[navmesh] ${Debug.toggles.navmesh ? 'on' : 'off'}`);
    });
  }
  if (Debug.cli.inputEl) {
    Debug.cli.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const line = Debug.cli.inputEl.value.trim();
        Debug.cli.inputEl.value = '';
        if (line) handleCommand(line);
      }
    });
  }
}

function installKeyHandlers(game) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1' || e.code === 'Backquote' || e.key === '`' || e.key === '~') {
      toggleOverlay(game);
      e.preventDefault();
    } else if (e.code === 'F2') {
      Debug.toggles.wireframe = !Debug.toggles.wireframe;
      game?.setWireframe?.(Debug.toggles.wireframe);
      log(`[wireframe] ${Debug.toggles.wireframe ? 'on' : 'off'}`);
      e.preventDefault();
    } else if (e.code === 'F3') {
      Debug.toggles.budgetOverlay = !Debug.toggles.budgetOverlay;
      log(`[budget overlay] ${Debug.toggles.budgetOverlay ? 'on' : 'off'}`);
      e.preventDefault();
    } else if (e.code === 'F4') {
      Debug.toggles.collidersLime = !Debug.toggles.collidersLime;
      applyColliders(game, Debug.toggles.collidersLime);
      log(`[colliders lime] ${Debug.toggles.collidersLime ? 'on' : 'off'}`);
      e.preventDefault();
    }
  });
}

async function toggleOverlay(game) {
  Debug.enabled = !Debug.enabled;
  // Ensure overlay exists even if devMode is off
  await ensureOverlayHTMLInline(game || window.__game);
  wireElements();
  if (Debug.overlayEl) Debug.overlayEl.style.display = Debug.enabled ? 'block' : 'none';
  setHUDVisible(Debug.enabled && Debug.toggles.showHUD);
}

function setHUDVisible(visible) {
  const el = document.getElementById('hud-overlay');
  if (el) el.style.display = visible ? 'block' : 'none';
}

function applyColliders(game, enabled) {
  try {
    const group = game?.physics?.colliderGroup;
    if (!group) return;
    for (let i = 0; i < group.children.length; i++) {
      const mesh = group.children[i];
      if (!mesh || !mesh.material) continue;
      const mat = mesh.material;
      if (typeof mat.color?.set === 'function') mat.color.set(0x32cd32);
      mat.wireframe = true;
      mat.transparent = true;
      if (enabled) mat.opacity = 0.6;
      mat.needsUpdate = true;
      mesh.visible = !!enabled;
    }
  } catch {}
}

function applyNavMesh(game, enabled) {
  try {
    const g = game || window.__game;
    const nav = g?.navMesh;
    if (!nav || typeof nav.setDebugVisible !== 'function') return;
    nav.setDebugVisible(!!enabled);
  } catch {}
}

async function ensureOverlayHTMLInline(game) {
  if (document.getElementById('debug-overlay')) return;
  const ui = game?.ui || window.__game?.ui;
  if (ui && typeof ui.loadStylesheet === 'function' && typeof ui.loadPageIntoLayer === 'function') {
    try {
      await ui.loadStylesheet('debug.css');
      await ui.loadPageIntoLayer('debug', 'debug-overlay.html');
      setTimeout(() => {
        const docsBtn = document.getElementById('open-docs-btn');
        if (docsBtn) {
          docsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            try {
              const target = 'docs/help.html';
              window.open(target, '_blank', 'noopener,noreferrer');
            } catch {
              window.open('docs/help.html', '_blank', 'noopener,noreferrer');
            }
          });
        }
        const navBtn = document.getElementById('toggle-navmesh-btn');
        if (navBtn) {
          navBtn.addEventListener('click', (e) => {
            e.preventDefault();
            Debug.toggles.navmesh = !Debug.toggles.navmesh;
            applyNavMesh(window.__game, Debug.toggles.navmesh);
            log(`[navmesh] ${Debug.toggles.navmesh ? 'on' : 'off'}`);
          });
        }
      }, 0);
      return;
    } catch {}
  }
  // Fallback if UISystem is unavailable
  const wrapper = document.createElement('div');
  wrapper.id = 'debug-overlay';
  wrapper.style.position = 'absolute';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.right = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '1000';
  wrapper.style.display = 'none';
  const hud = document.createElement('div');
  hud.id = 'hud-overlay';
  hud.style.pointerEvents = 'auto';
  hud.style.position = 'absolute';
  hud.style.top = '8px';
  hud.style.left = '8px';
  hud.style.background = 'rgba(0,0,0,0.5)';
  hud.style.color = '#9cf';
  hud.style.fontFamily = 'monospace';
  hud.style.fontSize = '12px';
  hud.style.padding = '6px 8px';
  const row = document.createElement('div');
  row.className = 'hud-row';
  const spans = [
    ['hud-fps', 'FPS: --'],
    ['hud-ms', 'ms: --'],
    ['hud-tris', 'tris: --'],
    ['hud-tiles', 'tiles: --'],
    ['hud-ram', 'RAM: --'],
    ['hud-voices', 'voices: --'],
    ['hud-particles', 'particles: --'],
  ];
  spans.forEach(([id, text], i) => {
    const s = document.createElement('span');
    s.id = id;
    if (i > 0) s.style.marginLeft = '8px';
    s.textContent = text;
    row.appendChild(s);
  });
  hud.appendChild(row);
  const controls = document.createElement('div');
  controls.className = 'hud-controls';
  const navBtn = document.createElement('button');
  navBtn.id = 'toggle-navmesh-btn';
  navBtn.textContent = 'Toggle NavMesh';
  navBtn.style.pointerEvents = 'auto';
  navBtn.style.background = '#1e1e1e';
  navBtn.style.color = '#9cf';
  navBtn.style.border = '1px solid #334';
  navBtn.style.padding = '4px 8px';
  navBtn.style.cursor = 'pointer';
  controls.appendChild(navBtn);
  hud.appendChild(controls);
  const cli = document.createElement('div');
  cli.id = 'debug-cli';
  cli.style.pointerEvents = 'auto';
  cli.style.position = 'absolute';
  cli.style.left = '8px';
  cli.style.bottom = '8px';
  cli.style.width = '360px';
  cli.style.background = 'rgba(0,0,0,0.6)';
  cli.style.color = '#fff';
  cli.style.fontFamily = 'monospace';
  cli.style.fontSize = '12px';
  cli.style.padding = '6px 8px';
  const tip = document.createElement('div');
  tip.style.opacity = '0.8';
  tip.style.marginBottom = '4px';
  tip.textContent = "F1 or ` to toggle • type 'help'";
  const log = document.createElement('div');
  log.id = 'debug-cli-log';
  log.style.maxHeight = '140px';
  log.style.overflow = 'auto';
  log.style.background = 'rgba(255,255,255,0.05)';
  log.style.padding = '4px';
  const input = document.createElement('input');
  input.id = 'debug-cli-input';
  input.placeholder = ': command';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.marginTop = '6px';
  input.style.background = '#111';
  input.style.color = '#9cf';
  input.style.border = '1px solid #334';
  input.style.padding = '4px';
  cli.appendChild(tip);
  cli.appendChild(log);
  cli.appendChild(input);
  wrapper.appendChild(hud);
  wrapper.appendChild(cli);
  document.body.appendChild(wrapper);
}

export class BudgetTracker {
  constructor() {
    this.resetFrame();
    this.cumulativeBytes = 0;
  }
  resetFrame() {
    this.frameTriangles = 0;
    this.frameTilesUsed = 0;
    this.frameVoices = 0;
    this.frameParticles = 0;
    this.frameUITiles = 0;
  }
  addTriangles(count) { this.frameTriangles += count; }
  addTiles(count) { this.frameTilesUsed += count; }
  addVoices(count) { this.frameVoices += count; }
  addParticles(count) { this.frameParticles += count; }
  addUITiles(count) { this.frameUITiles += count; }
  withinTriangleBudget() { return this.frameTriangles <= (config.budgets.trisPerFrame || Infinity); }
  withinParticleBudget() {
    const p = config.budgets.particles;
    const cap = p.maxActive;
    return this.frameParticles <= (cap || Infinity);
  }
  withinUITilesBudget() {
    const ui = config.budgets.ui;
    const cap = ui.perFrameTiles;
    return this.frameUITiles <= (cap || Infinity);
  }
  withinRAMBudget() {
    const cap = config.budgets.ramBytes;
    return this.cumulativeBytes <= (cap || Infinity);
  }
}

function handleCommand(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  switch ((cmd || '').toLowerCase()) {
    case 'help':
      log('commands: help, clear, wire on|off, hud on|off, budget on|off, colliders on|off');
      log('scene: find <name>, select|sel <idx|name|path|prop:ID|uuid:...>, where, tree [depth], ls');
      log('gltf: gltf (list roots), info (selected), comps [filter]');
      log('components: addcomp <Type> [json], rmcomp <Type>, setcomp <Type> <path> <value>');
      log('invoke: call <Type> <method> [jsonArgs]');
      break;
    case 'clear':
      if (Debug.cli.logEl) Debug.cli.logEl.innerHTML = '';
      break;
    case 'wire':
      setToggle('wireframe', parseOnOff(rest[0]));
      break;
    case 'hud':
      setToggle('showHUD', parseOnOff(rest[0]));
      break;
    case 'budget':
      setToggle('budgetOverlay', parseOnOff(rest[0]));
      break;
    case 'colliders':
      setToggle('collidersLime', parseOnOff(rest[0]));
      break;
    // ---- Scene + GLTF inspection ----
    case 'find':
      cmdFind(rest.join(' '));
      break;
    case 'select':
    case 'sel':
      cmdSelect(rest.join(' '));
      break;
    case 'where':
      cmdWhere();
      break;
    case 'tree':
      cmdTree(rest[0]);
      break;
    case 'ls':
      cmdListChildren();
      break;
    case 'gltf':
      cmdListGLTFs();
      break;
    case 'info':
      cmdInfo();
      break;
    case 'comps':
    case 'components':
      cmdListComponents(rest.join(' '));
      break;
    // ---- Component modifications ----
    case 'addcomp':
      cmdAddComponent(rest);
      break;
    case 'rmcomp':
      cmdRemoveComponent(rest);
      break;
    case 'setcomp':
      cmdSetComponent(rest);
      break;
    case 'call':
      cmdCallComponent(rest);
      break;
    default:
      log(`unknown: ${cmd}`);
  }
}

function setToggle(name, value) {
  if (typeof value === 'boolean') Debug.toggles[name] = value; else Debug.toggles[name] = !Debug.toggles[name];
  if (name === 'showHUD') setHUDVisible(Debug.enabled && Debug.toggles.showHUD);
  if (name === 'wireframe') window.__game?.setWireframe?.(Debug.toggles.wireframe);
  if (name === 'collidersLime') applyColliders(window.__game, Debug.toggles.collidersLime);
  log(`[${name}] ${Debug.toggles[name] ? 'on' : 'off'}`);
}

function parseOnOff(token) {
  if (!token) return undefined;
  const t = token.toLowerCase();
  if (t === 'on' || t === '1' || t === 'true') return true;
  if (t === 'off' || t === '0' || t === 'false') return false;
  return undefined;
}

function log(msg) {
  if (Debug.cli.logEl) {
    const line = document.createElement('div');
    line.textContent = String(msg);
    Debug.cli.logEl.appendChild(line);
    Debug.cli.logEl.scrollTop = Debug.cli.logEl.scrollHeight;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// -----------------------------
// CLI helpers for GLTF nodes and components
// -----------------------------
function getGame() { return window.__game; }
function getRoot() { return getGame()?.rendererCore?.scene || null; }

function printLines(lines) {
  if (!Array.isArray(lines)) { log(lines); return; }
  for (let i = 0; i < lines.length; i++) log(lines[i]);
}

function humanPathFor(obj) {
  if (!obj) return '(none)';
  const segs = [];
  let cur = obj;
  while (cur) {
    segs.push(cur.name || cur.type || '(unnamed)');
    cur = cur.parent;
    if (cur && cur.isScene) break;
  }
  return '/' + segs.reverse().join('/');
}

function traverse(root, fn) {
  if (!root) return;
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o) continue;
    try { fn(o); } catch {}
    if (o.children && o.children.length) {
      for (let i = o.children.length - 1; i >= 0; i--) stack.push(o.children[i]);
    }
  }
}

function findByNameSubstring(nameSubstr) {
  const root = getRoot();
  const needle = String(nameSubstr || '').toLowerCase();
  const out = [];
  if (!root || !needle) return out;
  traverse(root, (o) => {
    const n = String(o.name || '').toLowerCase();
    if (n.includes(needle)) out.push(o);
  });
  return out;
}

function findByPath(path) {
  const root = getRoot();
  if (!root || !path) return null;
  const segs = String(path).split('/').filter(Boolean);
  let cur = root;
  for (const seg of segs) {
    if (!cur || !cur.children) return null;
    // support numeric index
    if (/^\d+$/.test(seg)) {
      const idx = parseInt(seg, 10);
      cur = cur.children[idx] || null;
      continue;
    }
    // name match
    let next = null;
    for (let i = 0; i < cur.children.length; i++) {
      const ch = cur.children[i];
      if (String(ch.name || '') === seg) { next = ch; break; }
    }
    cur = next;
  }
  return cur;
}

function findByPropId(token) {
  // prop:<ID> uses sceneProperties map created by SceneLoader
  const id = String(token || '').trim();
  const arr = getGame()?.sceneProperties?.[id] || getGame()?.sceneIds?.[id] || [];
  return Array.isArray(arr) ? arr.slice() : [];
}

function findByUUID(uuid) {
  let found = null;
  traverse(getRoot(), (o) => {
    if (found) return;
    if (o.uuid === uuid) found = o;
  });
  return found ? [found] : [];
}

function cmdFind(query) {
  const q = String(query || '').trim();
  if (!q) { log('find: provide a substring or selector'); return; }
  let results = [];
  if (q.startsWith('prop:')) {
    results = findByPropId(q.substring(5));
  } else if (q.startsWith('uuid:')) {
    results = findByUUID(q.substring(5));
  } else {
    results = findByNameSubstring(q);
  }
  Debug.lastFind = results;
  if (!results.length) { log('find: no matches'); return; }
  printLines(results.map((o, i) => `[${i}] ${o.name || '(unnamed)'}  ${o.type}  ${humanPathFor(o)}`));
  // Do not auto-select; prompt
}

function cmdSelect(token) {
  const arg = String(token || '').trim();
  if (!arg) { log('select: provide index, name, path, prop:ID or uuid:...'); return; }
  let target = null;
  let source = null;
  if (/^\d+$/.test(arg)) {
    const idx = parseInt(arg, 10);
    target = Debug.lastFind?.[idx] || null;
    source = 'find';
  } else if (arg.startsWith('/')) {
    target = findByPath(arg);
    source = 'path';
  } else if (arg.startsWith('prop:')) {
    const list = findByPropId(arg.substring(5));
    target = list[0] || null;
    source = 'prop';
  } else if (arg.startsWith('uuid:')) {
    const list = findByUUID(arg.substring(5));
    target = list[0] || null;
    source = 'uuid';
  } else {
    // plain name: first exact match, else first substring
    const all = findByNameSubstring(arg);
    target = (all.find(o => (o.name || '') === arg) || all[0]) || null;
    source = 'name';
  }
  if (!target) { log('select: not found'); return; }
  Debug.selection.object = target;
  Debug.selection.path = humanPathFor(target);
  Debug.selection.source = source;
  log(`selected: ${target.name || '(unnamed)'}  ${target.type}  ${Debug.selection.path}`);
}

function cmdWhere() {
  const o = Debug.selection.object;
  if (!o) { log('where: nothing selected'); return; }
  log(Debug.selection.path || humanPathFor(o));
}

function cmdTree(depthToken) {
  const o = Debug.selection.object || getRoot();
  if (!o) { log('tree: no scene'); return; }
  let maxDepth = Number.isFinite(parseInt(depthToken, 10)) ? (parseInt(depthToken, 10) | 0) : 2;
  if (String(depthToken || '').toLowerCase() === 'all') maxDepth = 9999;
  const lines = [];
  const walk = (node, depth) => {
    const prefix = '  '.repeat(depth);
    lines.push(`${prefix}- ${node.name || '(unnamed)'}  ${node.type}  [${node.children?.length || 0}]`);
    if (depth >= maxDepth) return;
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
  };
  walk(o, 0);
  printLines(lines.slice(0, 200));
  if (lines.length > 200) log(`... ${lines.length - 200} more lines truncated ...`);
}

function cmdListChildren() {
  const o = Debug.selection.object || getRoot();
  if (!o) { log('ls: no scene'); return; }
  const kids = o.children || [];
  if (!kids.length) { log('ls: (no children)'); return; }
  printLines(kids.map((c, i) => `[${i}] ${c.name || '(unnamed)'}  ${c.type}  (${c.children?.length || 0})`));
}

function cmdListGLTFs() {
  const list = getGame()?.loadedGLTFs || [];
  if (!list.length) { log('gltf: none loaded'); return; }
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const p = humanPathFor(entry.object);
    log(`[${i}] ${entry.url}  root=${entry.object?.name || '(unnamed)'}  ${p}`);
  }
}

function cmdInfo() {
  const o = Debug.selection.object;
  if (!o) { log('info: select a node first'); return; }
  log(`name=${o.name || '(unnamed)'} type=${o.type} visible=${!!o.visible} children=${o.children?.length || 0}`);
  try {
    if (o.position && typeof o.position.x === 'number') {
      log(`localPos=(${Number(o.position.x).toFixed(2)}, ${Number(o.position.y).toFixed(2)}, ${Number(o.position.z).toFixed(2)})`);
    }
  } catch {}
  const udKeys = Object.keys(o.userData || {});
  if (udKeys.length) log(`userData keys: ${udKeys.join(', ')}`);
  const comps = Array.isArray(o.__components) ? o.__components : [];
  if (comps.length) {
    log(`components (${comps.length}): ${comps.map(c => c?.propName || c?.__typeName || c?.constructor?.name).join(', ')}`);
  } else {
    log('components: (none)');
  }
}

function cmdListComponents(filterToken) {
  const o = Debug.selection.object;
  if (!o) { log('components: select a node first'); return; }
  let comps = Array.isArray(o.__components) ? o.__components.slice() : [];
  if (filterToken) {
    const needle = String(filterToken).replace(/[\s\-_]/g, '').toLowerCase();
    comps = comps.filter((c) => {
      const n = (c?.propName || c?.__typeName || c?.constructor?.name || '').toString().replace(/[\s\-_]/g, '').toLowerCase();
      return n.includes(needle);
    });
  }
  if (!comps.length) { log('components: (none)'); return; }
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const name = c?.propName || c?.__typeName || c?.constructor?.name || 'Component';
    log(`[${i}] ${name}`);
  }
}

function parseJSONLoose(text) {
  if (text == null) return undefined;
  const s = String(text).trim();
  if (!s) return undefined;
  try { return JSON.parse(s); } catch {}
  // fallbacks: number, boolean, null, undefined, strings without quotes
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^null$/i.test(s)) return null;
  if (/^undefined$/i.test(s)) return undefined;
  return s;
}

function setDeep(obj, path, value) {
  if (!obj || !path) return false;
  const segs = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i];
    const isIndex = /^\d+$/.test(key);
    if (isIndex) {
      const idx = parseInt(key, 10);
      if (!Array.isArray(cur)) cur = (cur[key] = []);
      if (!cur[idx]) cur[idx] = {};
      cur = cur[idx];
    } else {
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
  }
  const last = segs[segs.length - 1];
  if (/^\d+$/.test(last) && Array.isArray(cur)) {
    cur[parseInt(last, 10)] = value;
  } else {
    cur[last] = value;
  }
  return true;
}

function resolveComponentOnSelected(name) {
  const o = Debug.selection.object;
  if (!o) return null;
  const comps = Array.isArray(o.__components) ? o.__components : [];
  const norm = (s) => String(s || '').replace(/[\s\-_]/g, '').toLowerCase();
  const want = norm(name);
  for (const c of comps) {
    const cn = norm(c?.propName || c?.__typeName || c?.constructor?.name);
    if (cn === want) return c;
  }
  return null;
}

function cmdAddComponent(args) {
  const o = Debug.selection.object;
  if (!o) { log('addcomp: select a node first'); return; }
  if (!args || args.length < 1) { log('addcomp: usage addcomp <Type> [json]'); return; }
  const typeName = args[0];
  const ctor = ComponentRegistry.get(typeName);
  if (!ctor) { log(`addcomp: component not found '${typeName}'`); return; }
  const paramsText = args.slice(1).join(' ');
  const params = parseJSONLoose(paramsText);
  try {
    const instance = new ctor({ game: getGame(), object: o, options: params, propName: typeName });
    if (!instance) { log('addcomp: failed to construct'); return; }
    o.__components = o.__components || [];
    o.__components.push(instance);
    getGame().addComponent(instance);
    if (typeof instance.Initialize === "function") Promise.resolve(instance.Initialize()).catch(() => {});
    log(`addcomp: attached ${typeName}`);
  } catch (e) {
    log(`addcomp: error ${e?.message || e}`);
  }
}

function cmdRemoveComponent(args) {
  const o = Debug.selection.object;
  if (!o) { log('rmcomp: select a node first'); return; }
  if (!args || args.length < 1) { log('rmcomp: usage rmcomp <Type>'); return; }
  const typeName = args[0];
  const inst = resolveComponentOnSelected(typeName);
  if (!inst) { log(`rmcomp: not found '${typeName}' on selection`); return; }
  try { if (typeof inst.Dispose === "function") inst.Dispose(); } catch {}
  log(`rmcomp: removed ${typeName}`);
}

function cmdSetComponent(args) {
  if (!args || args.length < 3) { log('setcomp: usage setcomp <Type> <path> <value>'); return; }
  const [typeName, path, ...rest] = args;
  const inst = resolveComponentOnSelected(typeName);
  if (!inst) { log(`setcomp: component '${typeName}' not found on selection`); return; }
  const valText = rest.join(' ');
  const value = parseJSONLoose(valText);
  const ok = setDeep(inst, path, value);
  if (!ok) { log('setcomp: failed to set path'); return; }
  // If component exposes Deserialize to rehydrate, try to call lightweight update hook
  try {
    const maybeApply = inst?.applyDeserializedState || inst?.Deserialize || null;
    if (typeof maybeApply === 'function') maybeApply.call(inst, {});
  } catch {}
  log(`setcomp: ${typeName}.${path} = ${String(value)}`);
}

function cmdCallComponent(args) {
  if (!args || args.length < 2) { log('call: usage call <Type> <method> [jsonArgs]'); return; }
  const [typeName, method, ...rest] = args;
  const inst = resolveComponentOnSelected(typeName);
  if (!inst) { log(`call: component '${typeName}' not found on selection`); return; }
  const argText = rest.join(' ').trim();
  let callArgs = [];
  if (argText) {
    const parsed = parseJSONLoose(argText);
    if (Array.isArray(parsed)) callArgs = parsed;
    else callArgs = [parsed];
  }
  const fn = inst?.[method];
  if (typeof fn !== 'function') { log(`call: method '${method}' not found`); return; }
  try {
    const result = fn.apply(inst, callArgs);
    if (result && typeof result.then === 'function') {
      result.then((r) => log(`call -> ${String(r)}`)).catch((e) => log(`call err: ${e?.message || e}`));
    } else {
      log(`call -> ${String(result)}`);
    }
  } catch (e) {
    log(`call err: ${e?.message || e}`);
  }
}

// --- Editor launcher ---
// Editor launch functionality removed
