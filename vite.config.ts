import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['models/*.task', 'wasm/**/*', 'icons/*.png'],
      manifest: {
        name: '大礼拜计数',
        short_name: '大礼拜',
        description: '前置摄像头自动为大礼拜（磕大头）计数，附《道德经》逐字同行。',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f1e8',
        theme_color: '#f5f1e8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 模型 ~5.7MB + wasm（当前版本单文件 11.2MB），放宽单文件预缓存上限
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,task,wasm,data,json}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
