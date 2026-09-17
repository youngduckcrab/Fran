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
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // 이미 열려 있는 창이 있으면 그걸 띄운다. 누를 때마다 새 창이 생기면 곤란하다.
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch (error) {
              /* 다른 출처로 옮겨간 창이면 그냥 띄우기만 한다 */
            }
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
