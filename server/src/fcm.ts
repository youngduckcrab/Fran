import { createSign } from 'node:crypto';
import { deleteNativePushToken, listNativePushTokens } from './db.js';

/**
 * 앱(안드로이드)으로 보내는 알림 — FCM.
 *
 * 웹 푸시(push.ts)와 나란히 쓴다. 웹은 브라우저가 주는 구독 정보로, 앱은 FCM 이 주는
 * 기기 토큰으로 보낸다. 한 사람이 둘 다 켜 둘 수도 있다.
 *
 * FCM 은 프로젝트 소유자의 서비스 계정으로 서명한 짧은 표(액세스 토큰)를 요구한다.
 * 그 계정 키는 환경변수 FIREBASE_SERVICE_ACCOUNT 에 JSON 그대로(또는 base64 로) 넣는다.
 * 없으면 이 기능은 꺼진 채로 조용히 넘어간다 — 웹 알림에는 영향이 없다.
 *
 * 라이브러리 없이 직접 한다. 하는 일이 "JWT 를 서명해서 토큰으로 바꾸고, 그 토큰으로
 * 한 번 POST" 뿐이라 의존성을 하나 늘릴 이유가 없다.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function readAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as Partial<ServiceAccount>;
    if (parsed.client_email && parsed.private_key && parsed.project_id) {
      // 환경변수에 넣으면 줄바꿈이 글자 \n 으로 오기도 한다.
      return { ...(parsed as ServiceAccount), private_key: parsed.private_key.replace(/\\n/g, '\n') };
    }
  } catch {
    // 아래에서 안내한다.
  }
  console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT 를 읽지 못했습니다. 앱 알림은 꺼 둡니다.');
  return null;
}

const account = readAccount();

/** 시험할 때 가짜 서버로 돌릴 수 있게 열어 둔다. 평소에는 구글 주소를 쓴다. */
const TOKEN_URL = process.env.FCM_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const sendUrl = (project: string) =>
  process.env.FCM_SEND_URL ?? `https://fcm.googleapis.com/v1/projects/${project}/messages:send`;

export function fcmEnabled(): boolean {
  return account !== null;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (!account) throw new Error('FCM 이 꺼져 있습니다.');
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', // 구글이 정한 값. 시험용 주소로 바꿔도 이건 그대로다.
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${claim}`;
  const signature = base64url(createSign('RSA-SHA256').update(unsigned).sign(account.private_key));

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`FCM 토큰을 받지 못했습니다 (${response.status}).`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export interface FcmPayload {
  title: string;
  body: string;
  /** 같은 것끼리는 알림 하나로 합쳐진다. 메시지 id, 또는 `call:<보낸 사람>`. */
  tag: string;
  unread?: number;
  /** 전화는 다른 채널(더 크게 울리는)로 보낸다. */
  call?: boolean;
}

/** 한 사람의 앱 기기들로 보낸다. 돌려주는 값은 실제로 보낸 기기 수. */
export async function sendFcm(userId: string, payload: FcmPayload): Promise<number> {
  if (!account) return 0;
  const tokens = await listNativePushTokens(userId);
  if (tokens.length === 0) return 0;

  let bearer: string;
  try {
    bearer = await accessToken();
  } catch (error) {
    console.warn('[fcm]', (error as Error).message);
    return 0;
  }

  let sent = 0;
  await Promise.all(
    tokens.map(async (token) => {
      const response = await fetch(sendUrl(account.project_id), {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: { tag: payload.tag, kind: payload.call ? 'call' : 'message' },
            android: {
              priority: 'HIGH',
              ttl: payload.call ? '45s' : '86400s',
              notification: {
                channel_id: payload.call ? 'calls' : 'messages',
                tag: payload.tag,
                ...(payload.unread ? { notification_count: payload.unread } : {}),
              },
            },
          },
        }),
      });
      if (response.ok) {
        sent += 1;
        return;
      }
      // 앱을 지웠거나 토큰이 바뀌면 FCM 이 404/UNREGISTERED 로 알려 준다. 그때 지운다.
      const text = await response.text().catch(() => '');
      if (response.status === 404 || text.includes('UNREGISTERED')) {
        await deleteNativePushToken(token);
        return;
      }
      console.warn(`[fcm] 알림을 보내지 못했습니다 (${response.status}): ${text.slice(0, 200)}`);
    }),
  );
  return sent;
}
