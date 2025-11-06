export default class LoadingScreen {
  constructor() {
    this.el = null;
    this.progressEl = null;
    this.messageEl = null;
    this._ensure();
  }

  _ensure() {
    if (this.el) return;
    const wrap = document.createElement("div");
    wrap.style.position = "fixed";
    wrap.style.left = "0";
    wrap.style.top = "0";
    wrap.style.right = "0";
    wrap.style.bottom = "0";
    wrap.style.display = "none";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.background = "rgba(0,0,0,0.85)";
    wrap.style.zIndex = "9999";
    wrap.style.color = "#fff";
    wrap.style.fontFamily = "monospace";

    const box = document.createElement("div");
    box.style.minWidth = "240px";
    box.style.maxWidth = "80vw";
    box.style.padding = "16px";
    box.style.background = "rgba(20,20,20,0.9)";
    box.style.border = "1px solid #444";
    box.style.borderRadius = "6px";
    box.style.boxShadow = "0 2px 18px rgba(0,0,0,0.5)";

    const msg = document.createElement("div");
    msg.textContent = "Loading...";
    msg.style.marginBottom = "10px";
    this.messageEl = msg;

    const barWrap = document.createElement("div");
    barWrap.style.width = "100%";
    barWrap.style.height = "10px";
    barWrap.style.background = "#222";
    barWrap.style.border = "1px solid #555";
    barWrap.style.borderRadius = "4px";
    barWrap.style.overflow = "hidden";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = "0%";
    bar.style.background = "#2ecc71";
    bar.style.transition = "width 0.1s linear";
    this.progressEl = bar;

    barWrap.appendChild(bar);
    box.appendChild(msg);
    box.appendChild(barWrap);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    this.el = wrap;
  }

  show(message) {
    this._ensure();
    if (typeof message === "string") this.setMessage(message);
    this.setProgress(0);
    this.el.style.display = "flex";
  }

  hide() {
    if (!this.el) return;
    this.el.style.display = "none";
  }

  setMessage(message) {
    if (!this.messageEl) return;
    this.messageEl.textContent = message || "Loading...";
  }

  setProgress(fraction) {
    if (!this.progressEl) return;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    this.progressEl.style.width = `${Math.round(clamped * 100)}%`;
  }
}


