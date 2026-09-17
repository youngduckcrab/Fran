import crypto from 'node:crypto';
import { config, findUserById } from './config.js';

/**
 * 사용자가 둘뿐이라 세션 저장소 없이 HMAC 서명 토큰만 쓴다.
 * 형식: base64url(payload).base64url(hmac)
 */
interface TokenPayload {
  sub: string;
  exp: number;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
}

export function issueToken(userId: string): string {
  const payload: TokenPayload = { sub: userId, exp: Date.now() + config.tokenTtlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return findUserById(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 패스코드 비교. 길이가 달라도 타이밍이 새지 않도록 해시를 비교한다. */
export function checkPasscode(userId: string, passcode: string): boolean {
  const user = findUserById(userId);
  if (!user) return false;
  const a = crypto.createHash('sha256').update(user.passcode).digest();
  const b = crypto.createHash('sha256').update(passcode).digest();
  return crypto.timingSafeEqual(a, b);
}
