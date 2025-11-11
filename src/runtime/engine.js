'use strict';
export const config = {
  expansionPak: true,
  targetFPS: 30,
  renderer: {
    internalWidthBase: 320,
    internalHeightBase: 240,
    internalWidthExpansion: 640,
    internalHeightExpansion: 480,
  },
  budgets: {
    trisPerFrame: 5333,
    ramBytesBase: 4 * 1024 * 1024,
    ramBytesExpansion: 8 * 1024 * 1024,
    tmemBytes: 4096,
    maxBonesPerMesh: 40,
    audio: {
      maxVoices: 24,
      maxRateHz: 44100,
    },
    particles: {
      maxActiveBase: 256,
      maxActiveExpansion: 512,
      trisPerQuad: 2,
    },
    ui: {
      allowedFormats: ["PNG8", "PNG_RGBA_SMALL"],
      maxSpriteSizeBase: 64,
      maxSpriteSizeExpansion: 96,
      maxAtlasSizeBase: { w: 256, h: 256 },
      maxAtlasSizeExpansion: { w: 512, h: 256 },
      perFrameTilesBase: 8,
      perFrameTilesExpansion: 12,
      requireTileMultiple: 8,
    },
  },
  devMode: true,
};

// EngineLimits removed; prefer reading from config directly

export function tmemBytesForTexture({ width, height, bpp, paletteBytes = 0 }) {
  return (width * height * bpp) / 8 + paletteBytes;
}

export function fitsInTMEM({ width, height, bpp, paletteBytes = 0 }) {
  return tmemBytesForTexture({ width, height, bpp, paletteBytes }) <= (config.budgets.tmemBytes || 0);
}

export function getInternalResolution() {
  const w = config.expansionPak ? config.renderer.internalWidthExpansion : config.renderer.internalWidthBase;
  const h = config.expansionPak ? config.renderer.internalHeightExpansion : config.renderer.internalHeightBase;
  return { width: w, height: h };
}

export function uiSpriteWithinBudget({ width, height, format, paletteBytes = 0 }) {
  const ui = config.budgets.ui;
  const maxSprite = config.expansionPak ? ui.maxSpriteSizeExpansion : ui.maxSpriteSizeBase;
  if (width > maxSprite || height > maxSprite) return false;
  if (!ui.allowedFormats?.includes(format)) return false;
  if (format === 'PNG_RGBA_SMALL') {
    if (width > 32 || height > 32) return false;
    return fitsInTMEM({ width, height, bpp: 32, paletteBytes: 0 });
  }
  const bpp = 8;
  return fitsInTMEM({ width, height, bpp, paletteBytes });
}

export function uiAtlasWithinBudget({ width, height }) {
  const ui = config.budgets.ui;
  const limit = config.expansionPak ? ui.maxAtlasSizeExpansion : ui.maxAtlasSizeBase;
  return width <= (limit?.w || 0) && height <= (limit?.h || 0);
}
