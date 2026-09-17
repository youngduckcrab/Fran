import webpush from 'web-push';
import type { LangCode } from '@fran/shared';
import {
  deletePushSubscription,
  getSecret,
  listPushSubscriptions,
  savePushSubscription,
  setSecret,
} from './db.js';

/**
 * 폰으로 보내는 알림.
 *
 * 웹 푸시는 서버가 자기 키 쌍(VAPID)으로 서명해야 한다. 그 키를 환경변수로 받게 하면
 * 사람이 손으로 만들어 넣어야 하고, 매번 새로 만들면 이미 등록된 기기의 알림이 전부
 * 무효가 된다. 그래서 처음 한 번 만들어 DB 에 넣어 두고 계속 쓴다.
 */
let keys: { publicKey: string; privateKey: string } | null = null;

export async function initPush(): Promise<string> {
  if (keys) return keys.publicKey;

  const [storedPublic, storedPrivate] = await Promise.all([
    getSecret('vapid_public'),
    getSecret('vapid_private'),
  ]);

  let pair: { publicKey: string; privateKey: string };
  if (storedPublic && storedPrivate) {
    pair = { publicKey: storedPublic, privateKey: storedPrivate };
  } else {
    pair = webpush.generateVAPIDKeys();
    await setSecret('vapid_public', pair.publicKey);
    await setSecret('vapid_private', pair.privateKey);
    console.log('알림용 키를 새로 만들어 저장했습니다.');
  }

  // 푸시 서비스가 연락처를 요구한다. 실제로 메일이 오가지는 않는다.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:fran@localhost',
    pair.publicKey,
    pair.privateKey,
  );
  keys = pair;
  return pair.publicKey;
}

export function publicKey(): string | null {
  return keys?.publicKey ?? null;
}

/** 글자가 없는 메시지(사진·음성)의 알림 문구. 받는 사람의 언어로 적는다. */
const KIND_LABEL: Record<LangCode, { image: string; audio: string }> = {
  ko: { image: '사진', audio: '음성 메시지' },
  es: { image: 'Foto', audio: 'Mensaje de voz' },
  en: { image: 'Photo', audio: 'Voice message' },
  zh: { image: '照片', audio: '语音消息' },
};

export function kindLabel(lang: LangCode, kind: 'image' | 'audio'): string {
  return (KIND_LABEL[lang] ?? KIND_LABEL.en)[kind];
}

export interface PushPayload {
  title: string;
  body: string;
  /** 알림을 눌렀을 때 열 주소. 그 사람의 앱 주소. */
  url: string;
  messageId: string;
  /** 이 사람이 아직 안 읽은 메시지 수. 폰 아이콘에 숫자로 붙인다. */
  unread?: number;
}

/**
 * 한 사람의 모든 기기로 보낸다. 폰을 바꾸거나 알림을 끄면 그 등록은 죽는데,
 * 푸시 서비스가 404/410 으로 알려주므로 그때 지운다. 그대로 두면 보낼 때마다 실패한다.
 */
export async function notify(userId: string, payload: PushPayload): Promise<number> {
  if (!keys) return 0;
  const subscriptions = await listPushSubscriptions(userId);
  if (subscriptions.length === 0) return 0;

  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(sub.endpoint);
          return;
        }
        console.warn(`[push] 알림을 보내지 못했습니다 (${status ?? '?'}):`, (error as Error).message);
      }
    }),
  );
  return sent;
}

export async function subscribe(
  userId: string,
  subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
): Promise<boolean> {
  const endpoint = typeof subscription.endpoint === 'string' ? subscription.endpoint : '';
  const p256dh = typeof subscription.keys?.p256dh === 'string' ? subscription.keys.p256dh : '';
  const auth = typeof subscription.keys?.auth === 'string' ? subscription.keys.auth : '';
  if (!endpoint || !p256dh || !auth) return false;
  await savePushSubscription({ endpoint, userId, p256dh, auth });
  return true;
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await deletePushSubscription(endpoint);
}
