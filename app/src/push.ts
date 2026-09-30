import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getToken } from './web/api';

/**
 * 폰 알림 — 앱 판 (웹 판: web/src/push.ts).
 *
 * 웹은 서비스 워커와 웹 푸시를 썼다. 앱은 FCM 이 주는 기기 토큰을 서버에 등록해 두고,
 * 서버가 그 토큰으로 보낸다. 쓰는 쪽이 보는 모양(pushState/enablePush/…)은 웹과 같다.
 *
 * FCM 을 쓰려면 앱을 만들 때 google-services.json 이 들어 있어야 한다. 없이 만든
 * 앱은 'unsupported' 로 나오고, 앱이 켜져 있을 때의 알림만 된다.
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

const TOKEN_KEY = 'fran.pushToken';

/** 앱을 보고 있을 때 서버는 푸시를 보내지 않는다. 혹시 와도 띄우지 않는다. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: '메시지',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
  });
  await Notifications.setNotificationChannelAsync('calls', {
    name: '전화',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 900, 600, 900],
  });
}

export async function pushState(): Promise<PushState> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'denied' && !permission.canAskAgain) return 'denied';
  return localStorage.getItem(TOKEN_KEY) && permission.granted ? 'on' : 'off';
}

function authed(): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}` };
}

export async function enablePush(): Promise<PushState> {
  await ensureChannels();
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return permission.canAskAgain ? 'off' : 'denied';

  let token: string;
  try {
    // Firebase 설정 없이 만든 앱에서는 여기서 오류가 난다.
    token = String((await Notifications.getDevicePushTokenAsync()).data);
  } catch {
    return 'unsupported';
  }

  const saved = await fetch('/api/push/native', {
    method: 'POST',
    headers: authed(),
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
  if (!saved.ok) throw new Error('알림 등록에 실패했습니다.');
  localStorage.setItem(TOKEN_KEY, token);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    await fetch('/api/push/native/remove', {
      method: 'POST',
      headers: authed(),
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
  }
  return 'off';
}

/** 지금 이 기기로 시험 알림을 한 통 받아 본다. 돌려주는 값은 실제로 보낸 기기 수. */
export async function testPush(): Promise<number> {
  const response = await fetch('/api/push/test', { method: 'POST', headers: authed() });
  if (!response.ok) throw new Error('시험 알림을 보내지 못했습니다.');
  return ((await response.json()) as { sent: number }).sent;
}

/**
 * 로그인해 있는 동안 토큰을 서버에 다시 알린다.
 * FCM 토큰은 바뀔 수 있다. 서버가 옛 토큰으로 보내면 알림이 조용히 사라진다.
 */
export function useKeepPushFresh(): void {
  useEffect(() => {
    const subscription = Notifications.addPushTokenListener((next) => {
      if (!localStorage.getItem(TOKEN_KEY)) return;
      const token = String(next.data);
      localStorage.setItem(TOKEN_KEY, token);
      void fetch('/api/push/native', {
        method: 'POST',
        headers: authed(),
        body: JSON.stringify({ token, platform: Platform.OS }),
      }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);
}

/** 알림을 눌렀을 때. 앱이 꺼져 있다가 그 알림으로 켜진 경우도 포함한다. */
export function useNotificationOpen(onOpen: () => void): void {
  useEffect(() => {
    const last = Notifications.getLastNotificationResponse();
    if (last) onOpen();
    const subscription = Notifications.addNotificationResponseReceivedListener(() => onOpen());
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * 폰에 쌓인 알림 치우기.
 *
 * 앱을 여는 것만으로는 치우지 않는다. 홈에서 단어장만 보다 나갈 수도 있고, 그때
 * 알림이 사라지면 메시지는 안 읽은 채로 남는다. 채팅을 열어 실제로 읽었을 때만 치운다.
 */
export async function clearDelivered(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // 알림을 못 치워도 대화에는 아무 지장이 없다.
  }
}
