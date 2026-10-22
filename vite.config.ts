import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  // GitHub Pages 部署在子路径 /prostration-counter/ 下；开发模式保持根路径
  const base = command === 'build' ? '/prostration-counter/' : '/';
  return {
  base,
  server: {
    // 允许局域网访问（手机真机调试）
    host: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '大礼拜计数',
        short_name: '大礼拜',
        description: '前置摄像头自动为大礼拜（磕大头）计数，附《道德经》逐字同行。',
        lang: 'zh-CN',
        start_url: base,
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
        // 改为运行时 CacheFirst：校准页首次带进度下载后，离线可用
        globPatterns: ['**/*.{js,css,html,png,svg,json,mp3}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /\/(models|wasm)\//,
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
  };
});
