import { getToken } from './api';

/**
 * 폰 알림 켜고 끄기.
 *
 * 아이폰은 홈 화면에 설치한 앱에서만(iOS 16.4 이상) 알림을 받을 수 있다.
 * 브라우저 탭으로 열어 두면 아래 supported() 가 false 가 되어 버튼이 나오지 않는다.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function subscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await subscription()) ? 'on' : 'off';
}

/** base64url 로 온 서버 공개키를 푸시 API 가 받는 형태로 바꾼다. */
function toUint8Array(base64Url: string): Uint8Array {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  // 아이폰은 사용자가 누른 그 순간에 물어봐야 한다. 기다리는 사이에 부르면 무시된다.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const response = await fetch('/api/push/key');
  if (!response.ok) throw new Error('알림을 설정할 수 없습니다.');
  const { key } = (await response.json()) as { key: string };

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscribed =
    existing ??
    (await registration.pushManager.subscribe({
      // 받은 알림은 반드시 화면에 띄우겠다는 약속. 브라우저가 이걸 요구한다.
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(key) as BufferSource,
    }));

  const saved = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` },
    body: JSON.stringify({ subscription: subscribed.toJSON() }),
  });
  if (!saved.ok) throw new Error('알림 등록에 실패했습니다.');
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const current = await subscription();
  if (!current) return 'off';

  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` },
    body: JSON.stringify({ endpoint: current.endpoint }),
  }).catch(() => undefined);
  await current.unsubscribe().catch(() => undefined);
  return 'off';
}

/**
 * 지금 이 기기로 시험 알림을 한 통 받아 본다.
 *
 * "알림이 안 와요" 는 원인이 여럿이라(허용 안 함 / 홈 화면에 설치 안 함 / 등록 만료)
 * 말로 따지는 것보다 한 번 눌러 보는 쪽이 빠르다. 돌려주는 값은 실제로 보낸 기기 수.
 */
export async function testPush(): Promise<number> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` },
  });
  if (!response.ok) throw new Error('시험 알림을 보내지 못했습니다.');
  return ((await response.json()) as { sent: number }).sent;
}
