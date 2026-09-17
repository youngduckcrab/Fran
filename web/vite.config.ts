import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 알림 처리는 우리가 쓴다. 생성된 서비스 워커가 이 파일을 불러오게 한다.
      workbox: { importScripts: ['push-sw.js'] },
      manifest: {
        name: 'Fran',
        short_name: 'Fran',
        description: '둘만 쓰는 번역 메신저',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#12121a',
        theme_color: '#12121a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // 포트가 막혔을 때 조용히 다른 번호로 옮겨가면, 전달된 주소가 바뀌어
    // 어느 쪽을 열어야 하는지 헷갈린다. 차라리 실패시키고 정리하게 한다.
    strictPort: true,
    // 같은 네트워크의 폰·태블릿에서 접속할 수 있도록 모든 인터페이스에 바인딩한다.
    // (기본값은 127.0.0.1 이라 다른 기기에서 보이지 않는다.)
    host: true,
    // 터널링 도구로 https 주소를 붙일 때는 그 도메인을 넣어야 Vite 가 막지 않는다.
    // 예: VITE_ALLOWED_HOSTS=abc-123.ngrok-free.app
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true },
    },
  },
});
