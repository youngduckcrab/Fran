import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { LANGUAGES, isLangCode, type GlossaryEntry, type LangCode, type UserProfile } from '@fran/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 개발(server/src)이든 빌드(server/dist)든 두 단계 위가 저장소 루트다. */
export const repoRoot = path.resolve(here, '../..');

// npm run dev / npm start 는 cwd 를 server/ 로 잡는다. .env 와 web/dist 는 저장소 루트에
// 있으므로 cwd 에 기대지 않고 루트를 기준으로 찾는다.
dotenv.config({ path: path.join(repoRoot, '.env') });

/** 상대 경로는 cwd 가 아니라 저장소 루트를 기준으로 푼다. */
function fromRoot(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
}

/**
 * 없으면 앱이 성립하지 않는 값만 여기서 막는다. 서명 비밀키나 두 사람의 정보처럼
 * 적당히 기본값을 골라 줄 수 없는 것들이다.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 참고해 .env 를 채워주세요.`);
  }
  return value;
}

/**
 * 조절용 설정이 잘못돼 있다고 앱 전체를 세우지는 않는다. 쓰지도 않는 provider 의
 * 설정 한 줄 때문에 대화가 멈추는 편이, 기본값으로 도는 것보다 훨씬 나쁘다.
 * 대신 무엇이 무시됐는지 시작할 때 분명히 알린다.
 */
function ignored<T>(name: string, value: string, fallback: T, expected: string): T {
  console.warn(
    `⚠️  환경변수 ${name} 의 값 "${value}" 을 알아볼 수 없어 무시합니다. ` +
      `(가능한 값: ${expected}) 기본값 "${String(fallback)}" 으로 계속합니다.`,
  );
  return fallback;
}

function lang(name: string, fallback: LangCode): LangCode {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return isLangCode(value) ? value : ignored(name, value, fallback, LANGUAGES.join(' | '));
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : ignored(name, raw, fallback, '숫자');
}

/** 정해진 값 중 하나여야 하는 설정. 아니면 기본값으로 넘어간다. */
function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase() as T;
  return allowed.includes(value) ? value : ignored(name, raw, fallback, allowed.join(' | '));
}

export interface UserSecret {
  profile: UserProfile;
  passcode: string;
}

/**
 * 이 앱은 두 사람만 쓴다. 회원가입 대신 .env 에 두 명을 적어두고,
 * 표시 언어 같은 취향은 앱에서 바꾸면 DB 에 저장된다(여기 값은 최초 기본값).
 */
function buildUser(slot: 'A' | 'B', fallbackLang: LangCode): UserSecret {
  const nativeLang = lang(`USER_${slot}_NATIVE_LANG`, fallbackLang);
  return {
    profile: {
      id: required(`USER_${slot}_ID`),
      name: required(`USER_${slot}_NAME`),
      nativeLang,
      displayLangs: [nativeLang],
    },
    passcode: required(`USER_${slot}_PASSCODE`),
  };
}

function loadGlossary(): GlossaryEntry[] {
  // 빌드 후에는 dist/ 에서 실행되므로 패키지 루트를 기준으로 찾는다.
  const candidates = [
    path.resolve(here, '../glossary.json'),
    path.resolve(here, '../../glossary.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')) as GlossaryEntry[];
    }
  }
  return [];
}

const PROVIDERS = ['gemini', 'claude'] as const;
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'off'] as const;

export const config = {
  port: int('PORT', 8787),
  /** Postgres 연결 문자열. 호스팅 업체가 DATABASE_URL 로 넣어 주는 것이 표준이다. */
  databaseUrl: required('DATABASE_URL'),
  /** on(기본) | no-verify(자체 서명 인증서) | off(로컬) */
  databaseSsl: oneOf('DATABASE_SSL', ['on', 'no-verify', 'off'] as const, 'on'),
  /** 빌드된 웹. 있으면 서버가 같이 서빙한다. */
  webDist: fromRoot(process.env.WEB_DIST ?? './web/dist'),
  authSecret: required('AUTH_SECRET'),
  /** 로그인 토큰 유효기간. 둘만 쓰는 앱이라 길게 잡는다. */
  tokenTtlMs: 1000 * 60 * 60 * 24 * 90,
  translation: {
    provider: oneOf('TRANSLATION_PROVIDER', PROVIDERS, 'gemini'),
    /** 번역할 때 참고할 직전 메시지 수. */
    contextSize: int('TRANSLATION_CONTEXT_SIZE', 12),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest',
      /** 0 = 사고 끄기. -1 = 자동. 무료 티어에서는 꺼두는 편이 빠르고 할당량도 아낀다. */
      thinkingBudget: int('GEMINI_THINKING_BUDGET', 0),
      safetyThreshold: process.env.GEMINI_SAFETY_THRESHOLD,
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5',
      effort: oneOf('CLAUDE_EFFORT', CLAUDE_EFFORTS, 'low'),
    },
  },
  users: [buildUser('A', 'ko'), buildUser('B', 'es')] as const,
  glossary: loadGlossary(),
};

export function findUserById(id: string): UserSecret | undefined {
  return config.users.find((user) => user.profile.id === id);
}

export function peerOf(id: string): UserSecret {
  const peer = config.users.find((user) => user.profile.id !== id);
  if (!peer) throw new Error('상대방 사용자를 찾을 수 없습니다. USER_A_* / USER_B_* 설정을 확인하세요.');
  return peer;
}
