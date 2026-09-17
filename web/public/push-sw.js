/* eslint-env serviceworker */
/**
 * 알림 처리. vite-plugin-pwa 가 만든 서비스 워커가 이 파일을 불러온다.
 * (workbox.importScripts 설정 — vite.config.ts 참고)
 *
 * 서버는 상대가 앱을 열어 두지 않았을 때만 알림을 보낸다. 그래서 여기서는
 * 조건을 따지지 않고 그대로 띄운다. 웹 푸시는 "받았으면 반드시 보여줘야" 하는
 * 규칙이 있어서, 받고도 안 띄우면 브라우저가 대신 엉뚱한 알림을 띄운다.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : '' };
  }

  // 앱 아이콘에 안 읽은 수를 붙인다. 지원하지 않는 기기에서는 조용히 넘어간다.
  if (typeof data.unread === 'number' && self.navigator && self.navigator.setAppBadge) {
    if (data.unread > 0) self.navigator.setAppBadge(data.unread).catch(() => undefined);
    else self.navigator.clearAppBadge().catch(() => undefined);
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Fran', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 태그로 덮어써서 알림이 줄줄이 쌓이지 않게 한다.
      tag: 'fran-message',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target = new URL(data.url || '/', self.location.origin);
  // 사람마다 주소가 다르다(?u=me / ?u=fran). 같은 사람의 창을 찾을 때 이걸로 견준다.
  const who = target.search;

  event.waitUntil(
    (async () => {
      let windows = [];
      try {
        windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      } catch (error) {
        windows = [];
      }

      const sameOrigin = windows.filter((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch (error) {
          return false;
        }
      });

      const samePerson = sameOrigin.find((client) => {
        try {
          return new URL(client.url).search === who;
        } catch (error) {
          return false;
        }
      });

      const existing = samePerson || sameOrigin[0];

      if (existing) {
        try {
          // 띄우는 것이 먼저다. navigate() 를 먼저 부르면 창 손잡이가 갈려서
          // 뒤이은 focus() 가 아무 일도 하지 않는다 — 눌러도 안 열리는 이유였다.
          const focused = (await existing.focus()) || existing;

          if (samePerson) {
            // 이미 그 사람의 창이다. 새로 고치지 말고 채팅만 열게 알려 준다.
            focused.postMessage({ type: 'open-chat' });
          } else if (typeof focused.navigate === 'function') {
            await focused.navigate(target.href);
          }
          return;
        } catch (error) {
          /* 띄우지 못했으면 아래에서 새로 연다 */
        }
      }

      try {
        await self.clients.openWindow(target.href);
      } catch (error) {
        /* 더 할 수 있는 것이 없다 */
      }
    })(),
  );
});
