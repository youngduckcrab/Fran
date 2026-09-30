import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

/**
 * 이 빌드가 언제 만들어진 것인지.
 *
 * 화면에 보여 두면 "고쳤다는데 왜 그대로냐" 를 한 번에 가릴 수 있다 —
 * 날짜가 옛것이면 아직 안 받은 것이고, 새것이면 다른 데 문제가 있는 것이다.
 */
const BUILT_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: {
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  plugins: [
    react(),
    VitePWA({
      /*
       * 갱신은 앱이 직접 다룬다(web/src/update.ts).
       *
       * autoUpdate 로 두면 새 워커가 조용히 자리를 잡지만, 이미 떠 있는 화면은
       * 옛 코드를 그대로 붙들고 있다. 홈 화면 앱은 껐다 켜도 새로 불러오지 않고
       * 되살아나기만 해서, 새 기능이 며칠이 지나도 안 보이는 일이 생긴다.
       * 통화 중에 멋대로 새로고침하면 전화가 끊기므로 그 시점도 우리가 정해야 한다.
       */
      registerType: 'prompt',
      // 등록도 우리가 한다. 자동으로 끼워 넣는 조각은 첫 로드 때 한 번만 돈다.
      injectRegister: null,
      // 알림 처리는 우리가 쓴다. 생성된 서비스 워커가 이 파일을 불러오게 한다.
      workbox: { importScripts: ['push-sw.js'] },
      manifest: {
        name: 'Fran',
        short_name: 'Fran',
        description: '둘만 쓰는 번역 메신저',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#17121f',
        theme_color: '#17121f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // 안드로이드는 아이콘을 동그랗게 잘라낸다. 잘려도 되는 여백을 둔 것을 따로 준다.
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
