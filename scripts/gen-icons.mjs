// 零依赖生成 PWA 图标：米纸色底 + 墨色实心圆（禅意极简）。
// 手工编码 PNG：zlib deflate + CRC32。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAPER = [0xf5, 0xf1, 0xe8];
const INK = [0x2b, 0x26, 0x20];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, radiusScale) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const r = (size / 2) * radiusScale;
  const cx = (size - 1) / 2;
  const cy = cx;
  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const c = inside ? INK : PAPER;
      raw[o++] = c[0];
      raw[o++] = c[1];
      raw[o++] = c[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), png(192, 0.72));
writeFileSync(join(outDir, 'icon-512.png'), png(512, 0.72));
// maskable 需要更大安全边距，圆缩小
writeFileSync(join(outDir, 'icon-maskable-512.png'), png(512, 0.5));
console.log('[gen-icons] icons written to', outDir);
