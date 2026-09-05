import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function seedFrom(text) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function makeDemoPng(prompt, width = 1024, height = 1024, variant = 0) {
  const seed = seedFrom(`${prompt}:${variant}`);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const colors = [
    [(seed >> 16) & 255, (seed >> 8) & 255, seed & 255],
    [(seed * 3) & 255, (seed * 7) & 255, (seed * 11) & 255],
    [(seed * 13) & 255, (seed * 17) & 255, (seed * 19) & 255],
  ];
  const cx = width * (0.28 + ((seed % 30) / 100));
  const cy = height * (0.3 + (((seed >> 8) % 30) / 100));
  const radius = Math.min(width, height) * (0.18 + (variant % 3) * 0.06);

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = row + 1 + x * 4;
      const tx = x / Math.max(1, width - 1);
      const ty = y / Math.max(1, height - 1);
      const distance = Math.hypot(x - cx, y - cy);
      const orb = Math.max(0, 1 - distance / radius);
      const wave = (Math.sin((tx * 6 + ty * 4 + variant) * Math.PI) + 1) / 2;
      for (let c = 0; c < 3; c += 1) {
        const gradient = colors[0][c] * (1 - tx) + colors[1][c] * tx;
        const vertical = gradient * (1 - ty * 0.35) + colors[2][c] * ty * 0.35;
        raw[p + c] = Math.max(0, Math.min(255, vertical + orb * 72 + wave * 14));
      }
      raw[p + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function encodeRgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Read intrinsic image dimensions without decoding pixels. Uploads accept
// PNG, JPEG, and WebP, while thumbnail generation only needs PNG decoding.
// Keeping this lightweight parser here avoids an extra image-processing
// dependency merely to preserve the source aspect ratio for image edits.
export function readImageDimensions(buffer, mimeType = '') {
  try {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return width && height ? { width, height } : null;
    }

    if ((mimeType === 'image/jpeg' || (buffer[0] === 0xff && buffer[1] === 0xd8)) && buffer.length >= 4) {
      let position = 2;
      while (position + 9 < buffer.length) {
        while (buffer[position] === 0xff) position += 1;
        const marker = buffer[position++];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (position + 1 >= buffer.length) return null;
        const length = buffer.readUInt16BE(position);
        if (length < 2 || position + length > buffer.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          const height = buffer.readUInt16BE(position + 3);
          const width = buffer.readUInt16BE(position + 5);
          return width && height ? { width, height } : null;
        }
        position += length;
      }
    }

    if ((mimeType === 'image/webp' || buffer.toString('ascii', 0, 4) === 'RIFF') && buffer.length >= 16 && buffer.toString('ascii', 8, 12) === 'WEBP') {
      let position = 12;
      while (position + 8 <= buffer.length) {
        const type = buffer.toString('ascii', position, position + 4);
        const length = buffer.readUInt32LE(position + 4);
        const data = position + 8;
        if (data + length > buffer.length) return null;
        if (type === 'VP8X' && length >= 10) {
          const width = 1 + buffer.readUIntLE(data + 4, 3);
          const height = 1 + buffer.readUIntLE(data + 7, 3);
          return { width, height };
        }
        if (type === 'VP8 ' && length >= 10 && buffer[data + 3] === 0x9d && buffer[data + 4] === 0x01 && buffer[data + 5] === 0x2a) {
          const width = buffer.readUInt16LE(data + 6) & 0x3fff;
          const height = buffer.readUInt16LE(data + 8) & 0x3fff;
          return width && height ? { width, height } : null;
        }
        if (type === 'VP8L' && length >= 5 && buffer[data] === 0x2f) {
          const bits = buffer.readUInt32LE(data + 1);
          const width = 1 + (bits & 0x3fff);
          const height = 1 + ((bits >>> 14) & 0x3fff);
          return { width, height };
        }
        position = data + length + (length % 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

// Decode an 8-bit, non-interlaced PNG (color types 0/2/3/4/6) into raw RGBA.
// Screenshots and generated images almost always match; anything else returns
// null and callers fall back to serving the original file.
export function decodePngRgba(buffer) {
  try {
    if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
    let position = 8;
    let width = 0;
    let height = 0;
    let colorType = 0;
    let interlace = 0;
    let palette = null;
    let transparency = null;
    const idat = [];
    while (position + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(position);
      const type = buffer.toString('ascii', position + 4, position + 8);
      const data = buffer.subarray(position + 8, position + 8 + length);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        if (data[8] !== 8 || data[10] !== 0) return null;
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'PLTE') {
        palette = Buffer.from(data);
      } else if (type === 'tRNS') {
        transparency = Buffer.from(data);
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      position += 12 + length;
    }
    if (!width || !height || interlace !== 0) return null;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels || (colorType === 3 && !palette)) return null;
    const stride = width * channels;
    const raw = inflateSync(Buffer.concat(idat));
    if (raw.length < (stride + 1) * height) return null;
    const decoded = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
      const filter = raw[y * (stride + 1)];
      const rowStart = y * (stride + 1) + 1;
      const outStart = y * stride;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= channels ? decoded[outStart + x - channels] : 0;
        const up = y > 0 ? decoded[outStart + x - stride] : 0;
        const upLeft = y > 0 && x >= channels ? decoded[outStart + x - stride - channels] : 0;
        let value = raw[rowStart + x];
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        decoded[outStart + x] = value & 255;
      }
    }
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const o = i * 4;
      const s = i * channels;
      if (colorType === 0) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = decoded[s];
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = decoded[s];
        rgba[o + 3] = decoded[s + 1];
      } else if (colorType === 2) {
        rgba[o] = decoded[s];
        rgba[o + 1] = decoded[s + 1];
        rgba[o + 2] = decoded[s + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 6) {
        decoded.copy(rgba, o, s, s + 4);
      } else {
        const index = decoded[s];
        rgba[o] = palette[index * 3];
        rgba[o + 1] = palette[index * 3 + 1];
        rgba[o + 2] = palette[index * 3 + 2];
        rgba[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      }
    }
    return { width, height, rgba };
  } catch {
    return null;
  }
}

// Box-filter downscale. Only shrinks; a target width at or above the source
// width returns null so the caller can serve the original file instead.
export function makeThumbnailPng(source, targetWidth) {
  const image = decodePngRgba(source);
  if (!image || targetWidth >= image.width) return null;
  const scale = image.width / targetWidth;
  const targetHeight = Math.max(1, Math.round(image.height / scale));
  const rgba = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const o = (sy * image.width + sx) * 4;
          const alpha = image.rgba[o + 3] / 255;
          r += image.rgba[o] * alpha;
          g += image.rgba[o + 1] * alpha;
          b += image.rgba[o + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }
      const o = (y * targetWidth + x) * 4;
      const alpha = a > 0 ? a : 1;
      rgba[o] = Math.round(r / alpha);
      rgba[o + 1] = Math.round(g / alpha);
      rgba[o + 2] = Math.round(b / alpha);
      rgba[o + 3] = Math.round((a / count) * 255);
    }
  }
  return encodeRgbaPng(targetWidth, targetHeight, rgba);
}
