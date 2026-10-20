// 把 @mediapipe/tasks-vision 的 WASM 运行时复制到 public/wasm/，
// 使 FilesetResolver 完全本地自托管，不依赖 CDN。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
