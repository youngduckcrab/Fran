/**
 * 웹과 서버가 함께 쓰는 타입 정의.
 * 두 워크스페이스 모두 소스를 직접 참조하므로 런타임 의존성은 없다.
 */

/** 이 앱이 다루는 언어. 두 사람의 모국어 + 서로 공부 중인 언어. */
export const LANGUAGES = ['ko', 'es', 'en', 'zh'] as const;
export type LangCode = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<LangCode, string> = {
  ko: '한국어',
  es: 'Español',
  en: 'English',
  zh: '中文',
};

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** 두 사용자 중 한 명. 가입 절차 없이 설정 파일로 고정된다. */
export interface UserProfile {
  id: string;
  name: string;
  /** 메시지를 작성할 때 기본으로 쓰는 언어. */
  nativeLang: LangCode;
  /** 상대 메시지를 어떤 언어로 받아볼지. 첫 번째가 주 언어. */
  displayLangs: LangCode[];
}

/** 번역문에 딸려오는 짧은 표현 설명. 학습용. */
export interface TranslationNote {
  /** 원문에 등장한 표현. */
  term: string;
  /** 왜 그렇게 옮겼는지 / 무슨 뜻인지. 읽는 사람의 언어로 쓴다. */
  meaning: string;
}

export interface Translation {
  lang: LangCode;
  text: string;
  notes: TranslationNote[];
  model: string;
  createdAt: number;
}

export type TranslationStatus = 'pending' | 'done' | 'failed';

export interface ChatMessage {
  id: string;
  senderId: string;
  /** 보낸 사람이 실제로 입력한 문장. 절대 덮어쓰지 않는다. */
  sourceText: string;
  sourceLang: LangCode;
  createdAt: number;
  translationStatus: TranslationStatus;
  /** 번역이 실패한 이유. 상대는 서버 로그를 볼 수 없으므로 화면에 띄운다. */
  translationError?: string;
  /**
   * 보낸 사람이 이 메시지에만 붙인 번역 지시. 예: "이번엔 amor 로 해줘"
   * 받는 사람에게는 전달하지 않는다. 서버가 보낸 사람에게만 실어 보낸다.
   */
  translationNote?: string;
  /** 언어 코드 -> 번역. 원문 언어는 여기 포함되지 않는다. */
  translations: Partial<Record<LangCode, Translation>>;
}

/** 애칭·고유명사·둘만 아는 표현. 번역할 때 그대로 두거나 지정한 대로 옮긴다. */
export interface GlossaryEntry {
  id: string;
  /** 원문에 등장하는 표현. 예: "애기" */
  term: string;
  /** 이렇게 옮겨 달라는 것. 비워두면 "번역하지 말고 그대로" 라는 뜻. */
  translations?: Partial<Record<LangCode, string>>;
  /** 이렇게는 옮기지 말아 달라는 것. 예: ["amor", "cariño"] */
  avoid?: string[];
  note?: string;
  updatedAt: number;
}

/** 저장할 때 쓰는 형태. id 와 updatedAt 은 서버가 매긴다. */
export type GlossaryDraft = Omit<GlossaryEntry, 'id' | 'updatedAt'>;

/* ---------- WebSocket 프로토콜 ---------- */

export type ClientEvent =
  | {
      type: 'send';
      clientId: string;
      text: string;
      sourceLang?: LangCode;
      /** 이 메시지에만 적용할 번역 지시. 상대에게는 보이지 않는다. */
      translationNote?: string;
    }
  | { type: 'typing'; isTyping: boolean }
  /** 지시를 바꿔서 다시 번역할 수 있다. 생략하면 기존 지시를 그대로 쓴다. */
  | { type: 'retranslate'; messageId: string; translationNote?: string }
  | { type: 'read'; messageId: string };

export type ServerEvent =
  /** 접속 직후 1회. 내 프로필, 상대 프로필, 최근 대화. */
  | { type: 'hello'; me: UserProfile; peer: UserProfile; messages: ChatMessage[] }
  /** 새 메시지. 원문만 담겨 도착하고, 번역은 뒤이어 update 로 온다. */
  | { type: 'message'; message: ChatMessage; clientId?: string }
  | { type: 'message_updated'; message: ChatMessage }
  | { type: 'typing'; userId: string; isTyping: boolean }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'error'; message: string }
  /** 용어집이 바뀌었다. 양쪽 화면을 맞춘다. */
  | { type: 'glossary'; entries: GlossaryEntry[] };
