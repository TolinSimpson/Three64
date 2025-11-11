'use strict';
import { config } from "./engine.js";

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.activeVoices = new Set();
  }

  async init() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: config.budgets.audio.maxRateHz });
    }
  }

  get maxVoices() {
    return config.budgets.audio.maxVoices;
  }

  async loadBufferFromUrl(url) {
    await this.init();
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(arr);
    return decoded;
  }

  playOneShot(buffer, { volume = 1.0 } = {}) {
    if (this.activeVoices.size >= this.maxVoices) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    const voice = { src, gain };
    this.activeVoices.add(voice);
    src.onended = () => this.activeVoices.delete(voice);
    return voice;
  }

  // Beep generator to demonstrate audio without external assets
  playBeep({ frequency = 880, durationMs = 120, volume = 0.3 } = {}) {
    if (!this.ctx) return null;
    if (this.activeVoices.size >= this.maxVoices) return null;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    const voice = { src: osc, gain };
    this.activeVoices.add(voice);
    setTimeout(() => {
      try { osc.stop(); } catch {}
      this.activeVoices.delete(voice);
    }, durationMs);
    return voice;
  }
}


