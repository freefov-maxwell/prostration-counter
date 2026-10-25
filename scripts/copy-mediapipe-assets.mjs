// 把 @mediapipe/tasks-vision 的 WASM 运行时复制到 public/wasm/，
// 使 FilesetResolver 完全本地自托管，不依赖 CDN。
// 同时生成 public/pose-assets.json 记录各资源的原始字节（raw）与 gzip 后字节（gz）：
// fetch 流读到的是解压后字节，进度按 gz/raw 折算成压缩后口径，与界面提示的下载大小一致。
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'wasm');

if (!existsSync(src)) {
  console.warn('[copy-mediapipe-assets] wasm source not found, skip:', src);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[copy-mediapipe-assets] copied wasm ->', dest);

const files = [
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'models/pose_landmarker_lite.task',
  // 默认的轻量引擎 MoveNet（模型随仓库提交，这里只统计大小）
  'models/movenet/model.json',
  'models/movenet/group1-shard1of2.bin',
  'models/movenet/group1-shard2of2.bin',
];
const sizes = {};
for (const f of files) {
  const p = join(root, 'public', f);
  if (existsSync(p)) {
    const buf = readFileSync(p);
    sizes[f] = { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
  } else {
    console.warn('[copy-mediapipe-assets] missing asset, excluded from manifest:', f);
  }
}
const manifestPath = join(root, 'public', 'pose-assets.json');
writeFileSync(manifestPath, JSON.stringify(sizes, null, 2) + '\n');
console.log('[copy-mediapipe-assets] wrote size manifest ->', manifestPath);
