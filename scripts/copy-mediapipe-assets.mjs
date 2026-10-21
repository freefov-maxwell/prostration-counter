// 把 @mediapipe/tasks-vision 的 WASM 运行时复制到 public/wasm/，
// 使 FilesetResolver 完全本地自托管，不依赖 CDN。
// 同时生成 public/pose-assets.json 记录各资源的解压后字节数：
// 服务器启用 gzip/brotli 时 Content-Length 是压缩后大小，而 fetch 流读到的是
// 解压后字节，两者不一致会导致进度条失真，故以此清单作为进度总量的口径。
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
];
const sizes = {};
for (const f of files) {
  const p = join(root, 'public', f);
  if (existsSync(p)) {
    sizes[f] = statSync(p).size;
  } else {
    console.warn('[copy-mediapipe-assets] missing asset, excluded from manifest:', f);
  }
}
const manifestPath = join(root, 'public', 'pose-assets.json');
writeFileSync(manifestPath, JSON.stringify(sizes, null, 2) + '\n');
console.log('[copy-mediapipe-assets] wrote size manifest ->', manifestPath);
