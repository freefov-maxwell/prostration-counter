import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Cloudflare 使用根路径；GitHub Pages 在构建命令中通过 --base 指定子路径。
export default defineConfig({
  server: {
    // 允许局域网访问（手机真机调试）
    host: true,
    // 允许 cloudflared 临时隧道（iOS 真机需要 HTTPS 才能开摄像头）
    allowedHosts: ['.trycloudflare.com'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        // MoveNet（默认引擎）的 TF.js 分包与模型同样按需下载，不进预缓存
        globIgnores: ['**/models/**', '**/assets/movenet-*.js'],
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
