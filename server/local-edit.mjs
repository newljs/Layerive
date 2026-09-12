import sharp from 'sharp';

const decodeOptions = { limitInputPixels: 40_000_000, failOn: 'error' };
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const SENSENOVA_MIN_SIDE = 512;
const SENSENOVA_MAX_SIDE = 4096;
const SENSENOVA_SIZE_STEP = 32;
const SENSENOVA_MAX_RATIO = 3;
const SENSENOVA_MAX_INPUT_BYTES = 10 * 1024 * 1024;

const roundUp = (value, step) => Math.ceil(value / step) * step;

function senseNovaCanvas(width, height, preferredSize) {
  const match = String(preferredSize || '').match(/^(\d{3,4})x(\d{3,4})$/);
  if (match) {
    const preferredWidth = Number(match[1]);
    const preferredHeight = Number(match[2]);
    const ratio = preferredWidth / preferredHeight;
    if (preferredWidth >= SENSENOVA_MIN_SIDE && preferredHeight >= SENSENOVA_MIN_SIDE
      && preferredWidth <= SENSENOVA_MAX_SIDE && preferredHeight <= SENSENOVA_MAX_SIDE
      && preferredWidth % SENSENOVA_SIZE_STEP === 0 && preferredHeight % SENSENOVA_SIZE_STEP === 0
      && ratio <= SENSENOVA_MAX_RATIO && ratio >= 1 / SENSENOVA_MAX_RATIO) {
      return { width: preferredWidth, height: preferredHeight };
    }
  }

  let scale = Math.min(1, SENSENOVA_MAX_SIDE / Math.max(width, height));
  let contentWidth = Math.max(1, Math.round(width * scale));
  let contentHeight = Math.max(1, Math.round(height * scale));
  const enlarge = Math.max(SENSENOVA_MIN_SIDE / contentWidth, SENSENOVA_MIN_SIDE / contentHeight, 1);
  if (contentWidth * enlarge <= SENSENOVA_MAX_SIDE && contentHeight * enlarge <= SENSENOVA_MAX_SIDE) {
    scale *= enlarge;
    contentWidth = Math.max(1, Math.round(width * scale));
    contentHeight = Math.max(1, Math.round(height * scale));
  }
  let canvasWidth = Math.max(SENSENOVA_MIN_SIDE, roundUp(contentWidth, SENSENOVA_SIZE_STEP));
  let canvasHeight = Math.max(SENSENOVA_MIN_SIDE, roundUp(contentHeight, SENSENOVA_SIZE_STEP));
  if (canvasWidth / canvasHeight > SENSENOVA_MAX_RATIO) canvasHeight = roundUp(canvasWidth / SENSENOVA_MAX_RATIO, SENSENOVA_SIZE_STEP);
  if (canvasHeight / canvasWidth > SENSENOVA_MAX_RATIO) canvasWidth = roundUp(canvasHeight / SENSENOVA_MAX_RATIO, SENSENOVA_SIZE_STEP);
  return { width: Math.min(SENSENOVA_MAX_SIDE, canvasWidth), height: Math.min(SENSENOVA_MAX_SIDE, canvasHeight) };
}

// SenseNova U1.5 Lite validates reference images more strictly than the local
// upload endpoint. Re-encode only the provider-bound copy: project originals
// stay untouched, while the request image uses a supported canvas and colour
// space. Edge-copy padding preserves the composition without cropping it.
export async function normalizeSenseNovaInput(bytes, preferredSize) {
  const metadata = await sharp(bytes, decodeOptions).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
    throw invalid('日日新参考图仅支持静态 PNG、JPEG、WebP 图片');
  }
  const orientedWidth = metadata.autoOrient?.width || metadata.width;
  const orientedHeight = metadata.autoOrient?.height || metadata.height;
  if (!orientedWidth || !orientedHeight) throw invalid('无法读取日日新参考图尺寸');
  const canvas = senseNovaCanvas(orientedWidth, orientedHeight, preferredSize);
  const scale = Math.min(canvas.width / orientedWidth, canvas.height / orientedHeight);
  const resizedWidth = Math.max(1, Math.min(canvas.width, Math.round(orientedWidth * scale)));
  const resizedHeight = Math.max(1, Math.min(canvas.height, Math.round(orientedHeight * scale)));
  const left = Math.floor((canvas.width - resizedWidth) / 2);
  const top = Math.floor((canvas.height - resizedHeight) / 2);
  const prepared = sharp(bytes, decodeOptions).autoOrient().toColourspace('srgb')
    .resize(resizedWidth, resizedHeight, { fit: 'fill' })
    .extend({
      left,
      right: canvas.width - resizedWidth - left,
      top,
      bottom: canvas.height - resizedHeight - top,
      extendWith: 'copy',
    });
  const png = await prepared.clone().png({ compressionLevel: 9 }).toBuffer();
  if (png.length <= SENSENOVA_MAX_INPUT_BYTES) {
    return { buffer: png, mime_type: 'image/png', width: canvas.width, height: canvas.height };
  }
  const jpeg = await prepared.clone().flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  if (jpeg.length > SENSENOVA_MAX_INPUT_BYTES) throw invalid('日日新参考图规范化后仍超过 10MB，请先缩小图片后重试');
  return { buffer: jpeg, mime_type: 'image/jpeg', width: canvas.width, height: canvas.height };
}

export function validateRect(value, label = '框选区域') {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    throw invalid(`${label}坐标无效，请重新框选或重试识别`);
  }
  const { x, y, width, height } = value;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100.001 || y + height > 100.001) {
    throw invalid(`${label}必须是图片内的 0–100% 坐标`);
  }
  return { x, y, width: Math.min(width, 100 - x), height: Math.min(height, 100 - y) };
}

export function pixelRect(rect, width, height) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(rect.x * width / 100)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(rect.y * height / 100)));
  const right = Math.min(width, Math.ceil((rect.x + rect.width) * width / 100));
  const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height / 100));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function referenceBytes(reference) {
  if (!reference || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType) || typeof reference.data !== 'string') {
    throw invalid('参考图仅支持 PNG、JPEG、WebP');
  }
  const encoded = reference.data.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
  if (!encoded || encoded.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw invalid('参考图数据无效或超过 10MB');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw invalid('参考图不能超过 10MB');
  return bytes;
}

// Normalize EXIF orientation before either vision or pixel coordinate calculations.
export async function normalizeLocalImage(bytes, reference = false) {
  const metadata = await sharp(bytes, decodeOptions).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
    throw invalid('局部修改仅支持静态 PNG、JPEG、WebP 图片');
  }
  let pipeline = sharp(bytes, decodeOptions).autoOrient().toColourspace('srgb');
  if (reference) pipeline = pipeline.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  return { buffer: data, mime_type: 'image/png', width: info.width, height: info.height };
}

export function validatePlacement(planned, selection) {
  const referenceRect = validateRect(planned.reference_rect, '参考图主体');
  const target = validateRect(planned.target_rect, '原图目标');
  const x = Math.max(selection.x, target.x);
  const y = Math.max(selection.y, target.y);
  const right = Math.min(selection.x + selection.width, target.x + target.width);
  const bottom = Math.min(selection.y + selection.height, target.y + target.height);
  // Reject a misplaced prediction instead of silently pasting a sliver at an edge.
  if (right <= x || bottom <= y || (right - x) * (bottom - y) < target.width * target.height * 0.8) {
    throw new Error('视觉模型定位的目标超出框选范围，请扩大选区或补充说明后重试');
  }
  if (typeof planned.intent !== 'string' || !planned.intent.trim() || typeof planned.edit_prompt !== 'string' || !planned.edit_prompt.trim()) {
    throw new Error('视觉模型未返回完整的替换意图和融合提示词，请重试');
  }
  return { referenceRect, targetRect: { x, y, width: right - x, height: bottom - y }, intent: planned.intent.trim(), editPrompt: planned.edit_prompt.trim() };
}

export async function composeLocalReference(source, reference, plan) {
  const crop = pixelRect(plan.referenceRect, reference.width, reference.height);
  const target = pixelRect(plan.targetRect, source.width, source.height);
  // Contain preserves the subject's proportions; transparent padding avoids
  // stretching a head or cropping ears to fit the target bounding box.
  const patch = await sharp(reference.buffer, decodeOptions).extract(crop)
    .resize(target.width, target.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const buffer = await sharp(source.buffer, decodeOptions)
    .composite([{ input: patch, left: target.left, top: target.top }]).png().toBuffer();
  return { buffer, mime_type: 'image/png', width: source.width, height: source.height, crop, target };
}

// Copy only the generated region into decoded source pixels. Blend inward at
// the boundary; pixels outside the selection remain exactly the original RGBA.
export async function preserveOutsideRegion(source, output, rect) {
  const { width, height } = source;
  const region = pixelRect(rect, width, height);
  const original = await sharp(source.buffer, decodeOptions).ensureAlpha().raw().toBuffer();
  const generated = await sharp(output.bytes, decodeOptions).autoOrient().toColourspace('srgb')
    .resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const feather = Math.max(1, Math.min(12, Math.round(Math.min(region.width, region.height) * 0.025)));
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const weight = Math.min(1, (Math.min(x, y, region.width - 1 - x, region.height - 1 - y) + 1) / feather);
      const offset = ((region.top + y) * width + region.left + x) * 4;
      for (let c = 0; c < 4; c++) original[offset + c] = Math.round(original[offset + c] * (1 - weight) + generated[offset + c] * weight);
    }
  }
  const bytes = await sharp(original, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { bytes, mimeType: 'image/png', width, height };
}
