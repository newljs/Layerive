// Size and ratio resolution: the picker may send a fixed size, a ratio token,
// or `original` (keep the source image's shape). Every result must already
// satisfy the provider's pixel, step and aspect limits, because the providers
// reject anything else instead of clamping it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGINAL_SIZE,
  RATIO_PRESETS,
  fitSizeForRatio,
  isOriginalSizeToken,
  isRatioToken,
  limitsForProtocol,
  originalSizeFor,
  parseSizeValue,
  ratioOf,
  ratioToken,
  sizeForRatio,
} from './size-options.mjs';

test('size strings parse into integers and reject malformed input', () => {
  assert.deepEqual(parseSizeValue('2048x1152'), { width: 2048, height: 1152 });
  assert.deepEqual(parseSizeValue(' 1024X768 '), { width: 1024, height: 768 });
  assert.equal(parseSizeValue('2048'), null);
  assert.equal(parseSizeValue('axb'), null);
  assert.equal(parseSizeValue(''), null);
  assert.equal(parseSizeValue(null), null);
});

test('ratios are reduced to their simplest form', () => {
  assert.equal(ratioOf(2048, 2048), '1:1');
  assert.equal(ratioOf(2048, 1536), '4:3');
  assert.equal(ratioOf(1536, 2048), '3:4');
  assert.equal(ratioOf(2560, 1440), '16:9');
});

test('a ratio token or a size string both resolve to the same ratio', () => {
  assert.equal(ratioToken('16:9'), '16:9');
  assert.equal(ratioToken('2752x1536'), '43:24');
  assert.equal(ratioToken('2048x2048'), '1:1');
  assert.equal(isRatioToken('9:21'), true);
  assert.equal(isRatioToken('2048x2048'), false);
  assert.equal(isRatioToken('original'), false);
});

test('the original-ratio token is recognised in every accepted spelling', () => {
  for (const value of ['original', 'source', 'original-ratio', 'auto-ratio', 'ORIGINAL']) {
    assert.equal(isOriginalSizeToken(value), true, value);
  }
  assert.equal(isOriginalSizeToken('1:1'), false);
  assert.equal(isOriginalSizeToken('2048x2048'), false);
});

test('every ratio preset declares a usable width and height', () => {
  assert.ok(RATIO_PRESETS.length >= 9);
  for (const preset of RATIO_PRESETS) {
    assert.ok(preset.width > 0 && preset.height > 0, preset.ratio);
    // 21:9 reduces to 7:3, so compare the value rather than the spelling.
    assert.equal(preset.width / preset.height, ratioValue(preset.ratio), preset.ratio);
  }
});

test('fitted sizes honour step, side and aspect limits for every protocol', () => {
  const protocols = ['openai_images', 'seedream_images', 'qwen_images', 'bfl_flux', 'gemini_interactions', 'grok_images'];
  for (const protocol of protocols) {
    const limits = limitsForProtocol(protocol);
    for (const preset of RATIO_PRESETS) {
      const fitted = fitSizeForRatio(preset.width, preset.height, protocol);
      assert.ok(fitted, `${protocol} ${preset.ratio}`);
      const { width, height } = fitted;
      assert.ok(width >= 64 && height >= 64, `${protocol} ${preset.ratio} too small`);
      if (limits.maxSide) assert.ok(width <= limits.maxSide && height <= limits.maxSide, `${protocol} ${preset.ratio} too large`);
      if (limits.step > 1) {
        assert.equal(width % limits.step, 0, `${protocol} ${preset.ratio} width step`);
        assert.equal(height % limits.step, 0, `${protocol} ${preset.ratio} height step`);
      }
      if (limits.minSide) assert.ok(width >= limits.minSide && height >= limits.minSide, `${protocol} ${preset.ratio} min side`);
      const pixels = width * height;
      if (limits.minPixels) assert.ok(pixels >= limits.minPixels, `${protocol} ${preset.ratio} below min pixels`);
      if (limits.maxPixels) assert.ok(pixels <= limits.maxPixels, `${protocol} ${preset.ratio} above max pixels`);
      if (limits.maxRatio) {
        const ratio = Math.max(width / height, height / width);
        assert.ok(ratio <= limits.maxRatio + 1e-9, `${protocol} ${preset.ratio} aspect ${ratio}`);
      }
    }
  }
});

test('a requested ratio survives fitting, within rounding', () => {
  for (const preset of RATIO_PRESETS) {
    const fitted = fitSizeForRatio(preset.width, preset.height, 'openai_images');
    const wanted = preset.width / preset.height;
    const got = fitted.width / fitted.height;
    // Integer stepping and pixel budgets shift the ratio slightly; a few percent
    // is the acceptable rounding budget for the extreme ratios.
    assert.ok(Math.abs(got - wanted) / wanted < 0.05, `${preset.ratio} drifted to ${got.toFixed(3)}`);
  }
});

test('sizeForRatio accepts a ratio token and refuses nonsense', () => {
  assert.match(sizeForRatio('16:9', 'openai_images'), /^\d+x\d+$/);
  assert.match(sizeForRatio('1:1', 'seedream_images'), /^\d+x\d+$/);
  assert.equal(sizeForRatio('banana', 'openai_images'), null);
  assert.equal(sizeForRatio('', 'openai_images'), null);
});

test('originalSizeFor keeps the source shape instead of snapping to a preset', () => {
  const model = { imageApiFormat: 'openai_images' };
  // A 3:2 photograph must not come back as a 1:1 canvas.
  const wide = originalSizeFor(model, 3000, 2000);
  assert.ok(wide);
  const wideParsed = parseSizeValue(wide);
  assert.ok(Math.abs(wideParsed.width / wideParsed.height - 1.5) < 0.02, `got ${wide}`);
  // Portraits stay portraits.
  const tall = parseSizeValue(originalSizeFor(model, 1200, 1800));
  assert.ok(tall.height > tall.width);
  // Degenerate input has no usable ratio.
  assert.equal(originalSizeFor(model, 0, 0), null);
  assert.equal(originalSizeFor(model, null, 100), null);
});

test('original sizing respects a protocol with a hard pixel floor', () => {
  // Seedream rejects anything under 921600 pixels, so a small source must be
  // scaled up rather than passed through.
  const size = originalSizeFor({ imageApiFormat: 'seedream_images' }, 800, 600);
  const parsed = parseSizeValue(size);
  assert.ok(parsed.width * parsed.height >= 921600, `got ${size}`);
  assert.ok(Math.abs(parsed.width / parsed.height - 4 / 3) < 0.02, `got ${size}`);
});

test('an extreme source ratio is clamped to what the protocol allows', () => {
  const limits = limitsForProtocol('qwen_images');
  const size = parseSizeValue(originalSizeFor({ imageApiFormat: 'qwen_images' }, 4000, 500));
  const ratio = Math.max(size.width / size.height, size.height / size.width);
  assert.ok(ratio <= limits.maxRatio + 1e-9, `got ${size.width}x${size.height}`);
});

function ratioValue(token) {
  const [width, height] = token.split(':').map(Number);
  return width / height;
}

test('ORIGINAL_SIZE is the token the server and the picker share', () => {
  assert.equal(ORIGINAL_SIZE, 'original');
  assert.equal(isOriginalSizeToken(ORIGINAL_SIZE), true);
});
