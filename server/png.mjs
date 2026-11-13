import { deflateSync } from 'node:zlib';

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

// Read intrinsic image dimensions without decoding pixels. Uploads accept
// PNG, JPEG, and WebP. Keeping this lightweight parser here avoids decoding
// whole pictures merely to preserve the source aspect ratio for image edits.
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
