import { config } from "./engine.js";

export const Debug = {
  config: null,
  enabled: false,
  overlayEl: null,
  cli: {
    inputEl: null,
    logEl: null,
  },
  toggles: {
    showHUD: true,
    wireframe: false,
    budgetOverlay: true,
  },
  profiler: {
    fpsEl: null,
    msEl: null,
    trisEl: null,
    tilesEl: null,
    ramEl: null,
    voicesEl: null,
    particlesEl: null,
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
  if (!Debug.config?.devMode) return;

  ensureOverlayHTMLInline();
  wireElements();
  applyURLFlags();
  installKeyHandlers(game);
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
  Debug.cli.inputEl = document.getElementById('debug-cli-input');
  Debug.cli.logEl = document.getElementById('debug-cli-log');
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
    if (e.code === 'F1' || e.key === '`') {
      toggleOverlay();
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
    }
  });
}

function toggleOverlay() {
  Debug.enabled = !Debug.enabled;
  if (Debug.overlayEl) Debug.overlayEl.style.display = Debug.enabled ? 'block' : 'none';
  setHUDVisible(Debug.enabled && Debug.toggles.showHUD);
}

function setHUDVisible(visible) {
  const el = document.getElementById('hud-overlay');
  if (el) el.style.display = visible ? 'block' : 'none';
}

function ensureOverlayHTMLInline() {
  if (document.getElementById('debug-overlay')) return;
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
    const cap = config.expansionPak ? p.maxActiveExpansion : p.maxActiveBase;
    return this.frameParticles <= (cap || Infinity);
  }
  withinUITilesBudget() {
    const ui = config.budgets.ui;
    const cap = config.expansionPak ? ui.perFrameTilesExpansion : ui.perFrameTilesBase;
    return this.frameUITiles <= (cap || Infinity);
  }
  withinRAMBudget() {
    const cap = config.expansionPak ? config.budgets.ramBytesExpansion : config.budgets.ramBytesBase;
    return this.cumulativeBytes <= (cap || Infinity);
  }
}

function handleCommand(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  switch ((cmd || '').toLowerCase()) {
    case 'help':
      log('commands: help, wire on|off, hud on|off, budget on|off, clear');
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
    default:
      log(`unknown: ${cmd}`);
  }
}

function setToggle(name, value) {
  if (typeof value === 'boolean') Debug.toggles[name] = value; else Debug.toggles[name] = !Debug.toggles[name];
  if (name === 'showHUD') setHUDVisible(Debug.enabled && Debug.toggles.showHUD);
  if (name === 'wireframe') window.__game?.setWireframe?.(Debug.toggles.wireframe);
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
