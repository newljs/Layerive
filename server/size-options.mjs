// Size and aspect-ratio helpers shared by the request path, the tests and the
// settings page.
//
// Two things live here:
//   1. the provider pixel budgets, so "original aspect ratio" can be honoured
//      without stepping outside what the platform accepts;
//   2. the ratio vocabulary (`1:1`, `3:4`, `16:9` …) used by the size picker.
//
// The `original` size token means: derive the canvas from the source image's
// aspect ratio instead of snapping to a declared preset.

export const ORIGINAL_SIZE = 'original';

// Ratios offered as a first-class choice. Values are exact, not rounded, so the
// server can map a ratio back to a canvas without guessing.
export const RATIO_PRESETS = [
  { ratio: '1:1', label: '方形', width: 1, height: 1 },
  { ratio: '4:3', label: '横版', width: 4, height: 3 },
  { ratio: '3:4', label: '竖版', width: 3, height: 4 },
  { ratio: '3:2', label: '横版', width: 3, height: 2 },
  { ratio: '2:3', label: '竖版', width: 2, height: 3 },
  { ratio: '16:9', label: '宽屏', width: 16, height: 9 },
  { ratio: '9:16', label: '竖屏', width: 9, height: 16 },
  { ratio: '21:9', label: '超宽', width: 21, height: 9 },
  { ratio: '9:21', label: '超长', width: 9, height: 21 },
];

const RATIO_BY_TOKEN = new Map(RATIO_PRESETS.map((item) => [item.ratio, item]));

export function parseSizeValue(value) {
  const match = String(value ?? '').trim().match(/^(\d{2,4})x(\d{2,4})$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return { width, height };
}

export function gcd(left, right) {
  return right ? gcd(right, left % right) : left;
}

/** The reduced ratio of a canvas, e.g. `2048x1536` → `4:3`. */
export function ratioOf(width, height) {
  if (!width || !height) return '';
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function ratioToken(value) {
  const text = String(value ?? '').trim();
  if (RATIO_BY_TOKEN.has(text)) return text;
  const parsed = parseSizeValue(text);
  return parsed ? ratioOf(parsed.width, parsed.height) : '';
}

/** True only for a named ratio (`16:9`), not for a size string. */
export function isRatioToken(value) {
  return RATIO_BY_TOKEN.has(String(value ?? '').trim());
}

export function ratioPreset(value) {
  return RATIO_BY_TOKEN.get(ratioToken(value)) || null;
}

// Provider pixel budgets. These mirror `dimensions()` in image-providers.mjs
// (which stays the authority for rejecting a request) and the SenseNova canvas
// rules in local-edit.mjs; keeping one copy here lets the UI offer sizes that
// will actually be accepted instead of letting the platform refuse them.
export function limitsForProtocol(protocol) {
  if (protocol === 'seedream_images') return { minPixels: 921600, maxPixels: 4624220, maxRatio: 16, minSide: 512, step: 8 };
  if (protocol === 'qwen_images') return { minPixels: 512 * 512, maxPixels: 2048 * 2048, maxRatio: 8, minSide: 512, step: 8 };
  if (protocol === 'gemini_interactions' || protocol === 'grok_images') return { minPixels: 0, maxPixels: 0, maxRatio: 0, minSide: 0, step: 1 };
  // `openai_images` is shared by several platforms, and the strictest of them
  // (SenseNova) refuses any canvas whose sides are not multiples of 32, whose
  // side falls outside [512, 4096], or whose ratio passes 3:1. Synthesising to
  // the loosest rule produced canvases the platform then rejected, so follow
  // the strictest: every declared preset (1024, 1536, 2048 …) satisfies it.
  return { minPixels: 0, maxPixels: 4 * 1024 * 1024, maxRatio: 3, minSide: 512, maxSide: 4096, step: 32 };
}

function roundTo(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * Fit a source aspect ratio into a provider's accepted canvas.
 *
 * `targetPixels` defaults to the larger of the provider minimum and a 2K-ish
 * canvas, so a small source image is still generated at a usable resolution.
 */
export function fitSizeForRatio(ratioWidth, ratioHeight, protocol, { targetPixels = 2048 * 2048, maxSide = 4096 } = {}) {
  if (!(ratioWidth > 0) || !(ratioHeight > 0)) return null;
  const limits = limitsForProtocol(protocol);
  const ratio = ratioWidth / ratioHeight;
  const floorPixels = Math.max(limits.minPixels, 512 * 512);
  const ceilingPixels = limits.maxPixels || targetPixels;
  const pixels = Math.min(ceilingPixels, Math.max(floorPixels, targetPixels));
  let width = Math.sqrt(pixels * ratio);
  let height = width / ratio;
  const longest = Math.max(width, height);
  if (longest > maxSide) {
    width = width * maxSide / longest;
    height = height * maxSide / longest;
  }
  width = roundTo(width, limits.step);
  height = roundTo(height, limits.step);
  width = Math.max(limits.minSide, Math.min(maxSide, width));
  height = Math.max(limits.minSide, Math.min(maxSide, height));
  if (limits.maxRatio) {
    if (width / height > limits.maxRatio) width = roundTo(height * limits.maxRatio, limits.step);
    if (height / width > limits.maxRatio) height = roundTo(width * limits.maxRatio, limits.step);
  }
  // Stepping and the aspect clamp can push the canvas just past a hard pixel
  // budget, and the providers reject rather than clamp. Walk the longest side
  // back until the budget holds again.
  if (limits.maxPixels) {
    for (let guard = 0; guard < 64 && width * height > limits.maxPixels; guard += 1) {
      if (width >= height) width = Math.max(limits.minSide || limits.step, width - limits.step);
      else height = Math.max(limits.minSide || limits.step, height - limits.step);
    }
  }
  return { width, height };
}

/** The size string for a named ratio (`3:4`) on a given protocol. */
export function sizeForRatio(ratio, protocol, options = {}) {
  const preset = ratioPreset(ratio);
  if (!preset) return null;
  const fitted = fitSizeForRatio(preset.width, preset.height, protocol, options);
  return fitted ? `${fitted.width}x${fitted.height}` : null;
}

/**
 * The canvas that keeps a source image's aspect ratio.
 * Returns `null` when the dimensions are unknown, so callers can fall back to
 * the declared preset list.
 */
export function originalSizeFor(model, width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const protocol = model?.imageApiFormat || 'openai_images';
  const fitted = fitSizeForRatio(width, height, protocol);
  return fitted ? `${fitted.width}x${fitted.height}` : null;
}

/** True when a value asks for the source image's own aspect ratio. */
export function isOriginalSizeToken(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === ORIGINAL_SIZE || text === 'source' || text === 'original-ratio' || text === 'auto-ratio';
}
