import { inflateRawSync, deflateRawSync } from 'node:zlib';

export const MAX_ZIP_ENTRIES = 10000;
export const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

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

// Minimal zip writer (deflate). Entries: { name: string, data: Buffer }.
// The UTF-8 flag (0x0800) is always set so Chinese entry names survive.
export function createZip(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ZIP_ENTRIES) throw Object.assign(new Error('压缩包条目过多'), { status: 413 });
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    if (!name.length || name.length > 4096 || data.length > MAX_ZIP_ENTRY_BYTES) throw Object.assign(new Error('压缩包条目无效或过大'), { status: 413 });
    totalBytes += data.length;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw Object.assign(new Error('压缩包解压后过大'), { status: 413 });
    const compressed = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// Minimal zip reader. Returns Map<entryName, Buffer>. Handles deflate and
// stored entries; zip64 archives are not supported (local backups stay small).
export function readZip(buffer, { maxEntries = MAX_ZIP_ENTRIES, maxEntryBytes = MAX_ZIP_ENTRY_BYTES, maxTotalBytes = MAX_ZIP_TOTAL_BYTES } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw Object.assign(new Error('压缩包格式无效或已损坏'), { status: 400 });
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  const scanStart = Math.max(0, buffer.length - 65558);
  for (let i = buffer.length - 22; i >= scanStart; i -= 1) {
    if (buffer.readUInt32LE(i) === eocdSignature) { eocd = i; break; }
  }
  if (eocd < 0) throw Object.assign(new Error('压缩包格式无效或已损坏'), { status: 400 });
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > maxEntries) throw Object.assign(new Error('压缩包条目过多'), { status: 413 });
  let position = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let totalBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (position < 0 || position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) throw Object.assign(new Error('压缩包目录已损坏'), { status: 400 });
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    if (nameLength > 4096 || compressedSize > maxEntryBytes || position + 46 + nameLength + extraLength + commentLength > buffer.length || localOffset + 30 > buffer.length) {
      throw Object.assign(new Error('压缩包条目无效或过大'), { status: 413 });
    }
    const name = buffer.toString('utf8', position + 46, position + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart > buffer.length || dataStart + compressedSize > buffer.length) throw Object.assign(new Error('压缩包数据已损坏'), { status: 400 });
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw Object.assign(new Error('压缩包使用了不支持的压缩方式'), { status: 400 });
    const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: maxEntryBytes }) : Buffer.from(raw);
    totalBytes += data.length;
    if (totalBytes > maxTotalBytes) throw Object.assign(new Error('压缩包解压后过大'), { status: 413 });
    entries.set(name, data);
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
