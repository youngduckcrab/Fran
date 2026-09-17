import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { isLangCode, type GlossaryEntry, type LangCode, type UserProfile } from '@fran/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다. .env.example 을 참고해 .env 를 채워주세요.`);
  }
  return value;
}

function lang(name: string, fallback: LangCode): LangCode {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!isLangCode(value)) {
    throw new Error(`환경변수 ${name} 의 값 "${value}" 은 지원하지 않는 언어입니다.`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`환경변수 ${name} 은 숫자여야 합니다.`);
  }
  return parsed;
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

function provider(): 'gemini' | 'claude' {
  const value = (process.env.TRANSLATION_PROVIDER ?? 'gemini').toLowerCase();
  if (value !== 'gemini' && value !== 'claude') {
    throw new Error(`TRANSLATION_PROVIDER 는 gemini 또는 claude 여야 합니다 (받은 값: ${value}).`);
  }
  return value;
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'off'] as const;
type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];

function claudeEffort(): ClaudeEffort {
  const value = (process.env.CLAUDE_EFFORT ?? 'low').toLowerCase();
  if (!(CLAUDE_EFFORTS as readonly string[]).includes(value)) {
    throw new Error(`CLAUDE_EFFORT 는 ${CLAUDE_EFFORTS.join(' | ')} 중 하나여야 합니다.`);
  }
  return value as ClaudeEffort;
}

export const config = {
  port: int('PORT', 8787),
  databasePath: process.env.DATABASE_PATH ?? './data/fran.sqlite',
  authSecret: required('AUTH_SECRET'),
  /** 로그인 토큰 유효기간. 둘만 쓰는 앱이라 길게 잡는다. */
  tokenTtlMs: 1000 * 60 * 60 * 24 * 90,
  translation: {
    provider: provider(),
    /** 번역할 때 참고할 직전 메시지 수. */
    contextSize: int('TRANSLATION_CONTEXT_SIZE', 12),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      /** 0 = 사고 끄기. -1 = 자동. 무료 티어에서는 꺼두는 편이 빠르고 할당량도 아낀다. */
      thinkingBudget: int('GEMINI_THINKING_BUDGET', 0),
      safetyThreshold: process.env.GEMINI_SAFETY_THRESHOLD,
    },
    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5',
      effort: claudeEffort(),
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
