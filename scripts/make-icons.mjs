// Render the vector master directly, without a white matte or baked-in shadow.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, process.argv[2] || 'public/app-icon.svg');
const output = path.resolve(root, process.argv[3] || 'public/icons');
const svg = await readFile(source);
await mkdir(output, { recursive: true });

async function render(size) {
  return sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
}

for (const size of [16, 32, 180, 192, 512]) {
  await writeFile(path.join(output, `icon-${size}.png`), await render(size));
}

// Maskable launchers need an opaque full-bleed background; keep this separate
// from desktop icons, whose corners must remain transparent.
const maskableSvg = svg.toString().replace(
  '<rect x="16" y="16" width="480" height="480" rx="100"',
  '<rect x="0" y="0" width="512" height="512"',
);
await writeFile(path.join(output, 'icon-maskable-512.png'),
  await sharp(Buffer.from(maskableSvg), { density: 384 }).resize(512, 512).png().toBuffer());

// ICO directory followed by RGBA PNG payloads (Windows Vista and later).
// Render each frame at its actual display size for desktop/taskbar clarity.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(render));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  directory[entry] = directory[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frames[i].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frames[i].length;
}
await writeFile(path.join(output, 'icon.ico'), Buffer.concat([directory, ...frames]));
console.log(`Rendered transparent PNG icons and ${sizes.length}-frame Windows ICO from ${source}`);
