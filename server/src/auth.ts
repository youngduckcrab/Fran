import crypto from 'node:crypto';
import { config, findUserById } from './config.js';
import { loadCredentials, saveCredential, type Credential } from './db.js';

/**
 * 사용자가 둘뿐이라 세션 저장소 없이 HMAC 서명 토큰만 쓴다.
 * 형식: base64url(payload).base64url(hmac)
 */
interface TokenPayload {
  sub: string;
  exp: number;
  /** 토큰 세대. 비밀번호를 바꾸면 올라가고, 예전 세대의 토큰은 그때부터 통하지 않는다. */
  v?: number;
}

/**
 * 앱에서 바꾼 비밀번호.
 *
 * 매번 DB 를 보면 요청마다 왕복이 생긴다. 사람이 둘뿐이고 바뀌는 일도 드물어서,
 * 시작할 때 한 번 읽어 두고 바꿀 때 같이 고친다.
 */
let credentials = new Map<string, Credential>();

export async function initAuth(): Promise<void> {
  credentials = await loadCredentials();
}

function versionOf(userId: string): number {
  return credentials.get(userId)?.tokenVersion ?? 1;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', config.authSecret).update(data).digest('base64url');
}

export function issueToken(userId: string): string {
  const payload: TokenPayload = {
    sub: userId,
    exp: Date.now() + config.tokenTtlMs,
    v: versionOf(userId),
  };
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
    // 이 기능이 생기기 전에 받아 간 토큰에는 세대가 없다. 1 세대로 본다.
    if ((payload.v ?? 1) !== versionOf(payload.sub)) return null;
    return findUserById(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/* ------------------------------ 비밀번호 ------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(passcode: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passcode, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    // 기본 메모리 한도로는 위 N 을 감당하지 못해 던진다.
    maxmem: 64 * 1024 * 1024,
  });
}

/** 저장용 문자열. 소금과 함께 담아 둔다. */
function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scrypt(passcode, salt).toString('base64url')}`;
}

function matchesHash(passcode: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const actual = scrypt(passcode, Buffer.from(salt, 'base64url'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/**
 * 비밀번호 확인.
 *
 * 앱에서 바꾼 적이 있으면 그것과, 없으면 .env 에 적어 둔 처음 값과 견준다.
 * 길이가 달라도 타이밍이 새지 않도록 늘 같은 방식으로 비교한다.
 */
export function checkPasscode(userId: string, passcode: string): boolean {
  const user = findUserById(userId);
  if (!user) return false;

  const stored = credentials.get(userId);
  if (stored) return matchesHash(passcode, stored.hash);

  const a = crypto.createHash('sha256').update(user.passcode).digest();
  const b = crypto.createHash('sha256').update(passcode).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 이 사람이 앱에서 비밀번호를 바꾼 적이 있는지. 시작할 때 경고를 띄울지 정하는 데 쓴다. */
export function hasOwnPasscode(userId: string): boolean {
  return credentials.has(userId);
}

export const MIN_PASSCODE_LENGTH = 4;
export const MAX_PASSCODE_LENGTH = 64;

/** 새 비밀번호로 바꾼다. 바꾸는 순간 예전 토큰은 모두 무효가 된다. */
export async function changePasscode(userId: string, next: string): Promise<void> {
  const saved = await saveCredential(userId, hashPasscode(next));
  credentials.set(userId, saved);
}
