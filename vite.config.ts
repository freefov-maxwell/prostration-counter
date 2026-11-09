import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (args: string) => {
  try {
    // CST-8 即北京时间，POSIX 写法 Linux 与 Windows 版 git 都认
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TZ: 'CST-8' } })
      .toString()
      .trim();
  } catch {
    return '';
  }
};
// 版本号 = package.json 的 主.次 + 提交日期 + 当日第几个提交。日期段 = 年份差(相对 2026，为 0 省略) + 月日：
// 2026-11-09 第 2 个提交 → 0.1.1109.2，2027-01-05 → 0.1.10105.1，数值随时间单调递增。
// 浅克隆看不到当天更早的提交，序号不准，退化为只到日期
const [major, minor] = JSON.parse(readFileSync('package.json', 'utf-8')).version.split('.');
const commitDays = git('log --format=%cd --date=format-local:%Y%m%d').split('\n').filter(Boolean);
const shallow = git('rev-parse --is-shallow-repository') !== 'false';
const daySeq = commitDays.filter((d) => d === commitDays[0]).length;
const dateSeg = commitDays[0] && Number(commitDays[0]) - 20260000;
const appVersion = [major, minor, dateSeg, !shallow && dateSeg && daySeq].filter(Boolean).join('.');

export default defineConfig({
  define: {
    // 设置页「关于」显示，用来确认手机上跑的是不是新版
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      output: {
        // TF.js 单独成包：不引用主包，文件名只随 TF.js 版本变；否则主包哈希一变，约 1.2MB 的
        // movenet 分包文件名跟着变，每次发版用户都要重下。名字须以 movenet- 开头，命中 SW 运行时缓存规则
        // CommonJS 辅助函数主包也用，单独拆出，否则会被并进 TF.js 包，导致首屏静态引用它
        manualChunks: (id) =>
          id.includes('node_modules/@tensorflow/')
            ? 'movenet-tfjs'
            : id.includes('commonjsHelpers')
              ? 'cjs-helpers'
              : undefined,
      },
    },
  },
  server: {
    // 允许局域网访问（手机真机调试）
    host: true,
    // 允许 cloudflared 临时隧道（iOS 真机需要 HTTPS 才能开摄像头）
    allowedHosts: ['.trycloudflare.com'],
  },
  plugins: [
    react(),
    VitePWA({
      // 新版就绪后由首页横幅提示、用户点了才切换：练习中不会被刷新，新旧 SW 交接也不会和模型加载撞在一起
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '归元瑜伽计数',
        short_name: '归元瑜伽',
        description: '前置摄像头自动为归元瑜伽计数，附《道德经》逐字同行。',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f1e8',
        theme_color: '#f5f1e8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 模型 + 推理引擎共约 17MB，不做预缓存（否则首屏要背约 39MB），
        // 改为运行时 CacheFirst：运动页首次带进度下载后，离线可用
        globPatterns: ['**/*.{js,css,html,png,svg,json,mp3}'],
        // MoveNet（默认引擎）的 TF.js 分包与模型同样按需下载，不进预缓存。
        // 适配层小包（movenet-xxxx.js，约 2KB）引用主包，每次发版文件名都变，须随新版预缓存，否则发版后首次使用要联网取
        globIgnores: ['**/models/**', '**/assets/movenet-tfjs-*.js'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /\/(models|wasm)\/|\/assets\/movenet-/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-engine',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
