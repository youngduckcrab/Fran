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
  /** 대화방 배경. 기본 배경 id 이거나 `photo:<첨부 id>`. */
  wallpaper?: string;
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

/**
 * 번역 실패 사유. 문구 대신 코드를 보내서 읽는 사람의 언어로 보여준다.
 * 서버 문구를 그대로 띄우면 한쪽은 못 읽는다.
 */
export type TranslationErrorCode =
  | 'noApiKey'
  | 'invalidApiKey'
  | 'quotaMinute'
  | 'quotaDay'
  | 'overloaded'
  | 'network'
  | 'modelNotFound'
  | 'refused'
  | 'unknown';

/* ---------- 첨부 (사진 / 음성) ---------- */

export type AttachmentKind = 'image' | 'audio';

/** 메시지에 딸린 사진이나 음성. 파일 자체는 DB 에 있고 여기엔 설명만 담는다. */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  mime: string;
  /** 바이트 수. 화면에 크기를 보여주거나 너무 큰 것을 막는 데 쓴다. */
  size: number;
  /** 사진일 때. 받기 전에 자리를 잡아 두면 화면이 덜 튄다. */
  width?: number;
  height?: number;
  /** 음성일 때, 길이(밀리초). */
  durationMs?: number;
  /** 음성을 받아쓴 글. 모델이 들은 그대로. */
  transcript?: string;
  /** 받아쓴 글의 언어. 보낸 사람의 모국어와 다를 수도 있다(공부 삼아 말해 본 경우). */
  transcriptLang?: LangCode;
  /** 받아쓰기 진행 상태. 음성 첨부에만 있다. */
  transcriptStatus?: TranslationStatus;
  createdAt: number;
}

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
  /** 위 문구의 사유 코드. 화면은 이걸 보고 각자의 언어로 보여준다. */
  translationErrorCode?: TranslationErrorCode;
  /**
   * 보낸 사람이 이 메시지에만 붙인 번역 지시. 예: "이번엔 amor 로 해줘"
   * 받는 사람에게는 전달하지 않는다. 서버가 보낸 사람에게만 실어 보낸다.
   */
  translationNote?: string;
  /** 언어 코드 -> 번역. 원문 언어는 여기 포함되지 않는다. */
  translations: Partial<Record<LangCode, Translation>>;
  /** 사진이나 음성. 글 없이 첨부만 보낼 수도 있다. */
  attachment?: Attachment;
  /** 이 메시지가 답하고 있는 메시지의 id. */
  replyTo?: string;
  /** 사람 id -> 이모지. 한 사람당 하나만 남는다. */
  reactions?: Record<string, string>;
}

/** 말풍선에 달 수 있는 반응. 고르는 게 빨라야 해서 몇 개로 줄여 둔다. */
export const REACTIONS = ['❤️', '😂', '👍', '😮', '🥺', '🔥'] as const;
export type Reaction = (typeof REACTIONS)[number];

/**
 * 이 메시지의 "글". 직접 쓴 문장이 있으면 그것이고, 없으면 음성을 받아쓴 글이다.
 *
 * 번역·설명·알림·미리보기가 모두 이걸 본다. 음성 메시지는 사람이 아무것도 타이핑하지
 * 않았어도 받아쓴 글이 원문 노릇을 한다.
 */
export function messageText(message: ChatMessage): string {
  const typed = message.sourceText.trim();
  if (typed) return typed;
  return message.attachment?.transcript?.trim() ?? '';
}

/* ---------- 문장 설명 (학습용) ---------- */

/** 문장을 의미 단위로 자른 조각 하나. */
export interface ExplanationChunk {
  /** 원문에서 잘라낸 그대로. 예: "fui al mercado" */
  text: string;
  /** 읽는 법. 한글·한자처럼 읽는 사람이 못 읽는 문자일 때만 채운다. */
  reading?: string;
  /** 이 조각의 뜻. */
  meaning: string;
  /** 문법·용법 설명. 배울 게 있을 때만. */
  note?: string;
}

export interface MessageExplanation {
  /** 설명 대상 문장의 언어. */
  targetLang: LangCode;
  /** 설명을 어느 언어로 썼는지(읽는 사람의 언어). */
  explainLang: LangCode;
  /** 설명한 문장 그대로. 원문일 수도 번역문일 수도 있다. */
  text: string;
  /** 이 문장이 결국 무슨 말인지 한 줄로. */
  summary: string;
  chunks: ExplanationChunk[];
  /** 문법·뉘앙스 포인트. */
  points: string[];
  /** 이럴 때 이렇게 답하면 자연스럽다. */
  replies: string[];
  model: string;
  createdAt: number;
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

/* ---------- 모아 보기 (저장한 문장 / 단어장) ---------- */

/**
 * 나중에 다시 보려고 저장해 둔 문장.
 *
 * 메시지를 가리키기만 하면 번역을 다시 돌렸을 때 저장해 둔 문장이 바뀌어 버린다.
 * 그때 그 문장 그대로를 함께 적어 둔다.
 */
export interface SavedSentence {
  id: string;
  /** 저장한 사람. 각자의 보관함이다. */
  userId: string;
  messageId: string;
  /** 저장한 문장의 언어. */
  lang: LangCode;
  text: string;
  /** 짝이 되는 내 언어 문장(있으면). 보관함에서 뜻을 같이 보기 위해. */
  pairLang?: LangCode;
  pairText?: string;
  note?: string;
  createdAt: number;
}

export type SavedSentenceDraft = Omit<SavedSentence, 'id' | 'userId' | 'createdAt'>;

/** 단어장 한 줄. 설명 화면에서 조각을 그대로 담아 온다. */
export interface VocabEntry {
  id: string;
  userId: string;
  /** 표제어. 기호(¿ ? , …)는 떼고 담는다. */
  term: string;
  lang: LangCode;
  /** 읽는 법(한자·한글처럼 읽기 어려운 문자일 때). */
  reading?: string;
  meaning: string;
  note?: string;
  /** 외웠다고 표시했는지. 외운 것과 아직인 것을 갈라 보기 위해. */
  learned: boolean;
  /** 이 단어가 실제로 쓰인 예문. 눌러서 만들면 그대로 저장된다. */
  example?: string;
  /** 위 예문의 뜻(내 언어로). */
  exampleTranslation?: string;
  /** 어느 메시지에서 담았는지. 되짚어 보기 위해. */
  messageId?: string;
  createdAt: number;
}

export type VocabDraft = Omit<
  VocabEntry,
  'id' | 'userId' | 'createdAt' | 'learned' | 'example' | 'exampleTranslation'
>;

/**
 * 표제어에서 문장부호를 떼어낸다. "¿Dormiste" → "Dormiste"
 * 설명은 문장을 잘라서 주기 때문에 조각 끝에 물음표나 쉼표가 붙어 온다.
 * 그대로 단어장에 담으면 같은 단어가 여러 줄로 쌓인다.
 */
export function cleanTerm(raw: string): string {
  return raw
    .replace(/[¿?¡!.,;:…"“”'‘’()\[\]{}<>«»。、！？「」『』・]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- 배경화면 ---------- */

/** 기본으로 고를 수 있는 배경. 'custom' 은 직접 올린 사진이라 여기 없다. */
export const WALLPAPERS = ['default', 'night', 'dawn', 'forest', 'sand', 'rose', 'mono'] as const;
export type WallpaperId = (typeof WALLPAPERS)[number];

/**
 * 배경화면 설정값. 기본 배경은 그 id 를, 직접 올린 사진은 `photo:<첨부 id>` 를 쓴다.
 */
export function isWallpaperId(value: unknown): value is WallpaperId {
  return typeof value === 'string' && (WALLPAPERS as readonly string[]).includes(value);
}

/* ---------- WebSocket 프로토콜 ---------- */

export type ClientEvent =
  | {
      type: 'send';
      clientId: string;
      text: string;
      sourceLang?: LangCode;
      /** 먼저 올려 둔 사진·음성의 id. 글 없이 이것만 보낼 수도 있다. */
      attachmentId?: string;
      /** 이 메시지에만 적용할 번역 지시. 상대에게는 보이지 않는다. */
      translationNote?: string;
      /** 답하고 있는 메시지의 id. */
      replyTo?: string;
    }
  | { type: 'typing'; isTyping: boolean }
  /** 지시를 바꿔서 다시 번역할 수 있다. 생략하면 기존 지시를 그대로 쓴다. */
  | { type: 'retranslate'; messageId: string; translationNote?: string }
  | { type: 'read'; messageId: string }
  /** 이모지 반응. 같은 이모지를 다시 누르거나 null 을 보내면 지운다. */
  | { type: 'react'; messageId: string; emoji: string | null };

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
