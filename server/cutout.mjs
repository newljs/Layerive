// Local cut-out (alpha matting) backend.
//
// The configured image models cannot return a real alpha channel, so a picture
// that has to float on top of other content is cut out locally instead: the
// subject keeps its pixels and everything else becomes transparent. The service
// is optional — with LAYERIVE_CUTOUT_URL empty every caller falls back to the
// previous behaviour, which keeps offline installs and the test suite working.
import sharp from 'sharp';

// A result that is almost entirely opaque means the matte found no background;
// one that is almost entirely transparent means it erased the subject instead.
export const CUTOUT_MIN_TRANSPARENT = 0.005;
export const CUTOUT_MIN_VISIBLE = 0.005;

export function cutoutUrl() {
  return String(process.env.LAYERIVE_CUTOUT_URL ?? '').trim().replace(/\/+$/, '');
}

export function cutoutEnabled() {
  return Boolean(cutoutUrl());
}

function cutoutError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

// Counts how much of the picture survived, at whatever size it arrived in.
export async function alphaStats(bytes) {
  const raw = await sharp(bytes, { failOn: 'error' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { channels, width, height } = raw.info;
  const pixels = width * height;
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let offset = channels - 1; offset < raw.data.length; offset += channels) {
    const alpha = raw.data[offset];
    if (alpha < 250) transparentPixels += 1;
    if (alpha > 5) visiblePixels += 1;
  }
  const transparentRatio = pixels ? transparentPixels / pixels : 0;
  const visibleRatio = pixels ? visiblePixels / pixels : 0;
  return {
    width,
    height,
    channels,
    transparentRatio,
    visibleRatio,
    usable: transparentRatio >= CUTOUT_MIN_TRANSPARENT && visibleRatio >= CUTOUT_MIN_VISIBLE,
  };
}

// Asks the matting service for an RGBA PNG. `rect` (percentages) restricts the
// matte to one subject when the picture holds several.
export async function cutoutLocal(bytes, { signal = null, timeoutMs = 60000, rect = null, feather = null } = {}) {
  const base = cutoutUrl();
  if (!base) throw cutoutError(503, 'cutout.disabled', '本地抠图服务未启用');
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), 'source.png');
  if (rect) form.append('rect', `${rect.x},${rect.y},${rect.width},${rect.height}`);
  if (feather) form.append('feather', String(feather));
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(`${base}/cutout`, { method: 'POST', body: form, signal: combined });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw cutoutError(502, 'cutout.unreachable', `本地抠图服务不可达：${error.message}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw cutoutError(502, 'cutout.failed', `本地抠图服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }
  const result = Buffer.from(await response.arrayBuffer());
  if (!result.length) throw cutoutError(502, 'cutout.failed', '本地抠图服务返回了空结果');
  return result;
}
