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

/**
 * 문법적 성. 스페인어는 자기 얘기를 할 때도("cansado/cansada") 상대를 부를 때도
 * 성에 따라 말이 달라진다. 모르면 번역이 반은 틀린다.
 */
export const GENDERS = ['female', 'male', 'unspecified'] as const;
export type Gender = (typeof GENDERS)[number];

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value);
}

/** 두 사용자 중 한 명. 가입 절차 없이 설정 파일로 고정된다. */
export interface UserProfile {
  id: string;
  name: string;
  /** 메시지를 작성할 때 기본으로 쓰는 언어. */
  nativeLang: LangCode;
  /** 상대 메시지를 어떤 언어로 받아볼지. 첫 번째가 주 언어. */
  displayLangs: LangCode[];
  /** 문법적 성. 스페인어 형용사·호칭이 이걸 따라간다. 안 고르면 'unspecified'. */
  gender?: Gender;
  /** 사는 곳. 같은 스페인어라도 칠레에서 쓰는 말과 스페인에서 쓰는 말이 다르다. */
  region?: string;
  /** 대화방 배경. 기본 배경 id 이거나 `photo:<첨부 id>`. */
  wallpaper?: string;
  /** 앱 색. 고르지 않았으면 기본(rose). */
  theme?: ThemeId;
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
  /** 보낸 뒤 글을 고쳤다면 그 시각. 상대에게 "수정됨" 으로 보인다. */
  editedAt?: number;
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

/* ---------- 단어 하나만 풀어보기 ---------- */

/**
 * 문장에서 한 단어만 눌러 봤을 때 돌아오는 것.
 *
 * 설명(MessageExplanation)은 문장 전체를 뜯어보는 것이라 무겁다. 모르는 단어 하나가
 * 걸렸을 뿐일 때는 그 단어만 짧게 알면 된다. 그래서 따로 둔다.
 */
export interface WordLookup {
  /** 문장에서 누른 그대로. 예: "fui" */
  word: string;
  /** 사전에 실리는 형태. 예: "ir". 활용하지 않는 말이면 word 와 같다. */
  base: string;
  /** 그 단어의 언어. */
  lang: LangCode;
  /** 읽는 법. 한자·한글처럼 읽는 사람이 못 읽는 문자일 때만. */
  reading?: string;
  /** 품사. "동사", "verbo" 처럼 읽는 사람의 말로. */
  pos?: string;
  /** 사전에 실릴 법한 뜻. 단어장에 담을 때 이게 뜻이 된다. */
  meaning: string;
  /** 이 문장 안에서는 무슨 뜻으로 쓰였는지 한 줄. */
  inSentence: string;
  /** 활용·용법에서 짚을 것이 있을 때만. */
  note?: string;
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
  /** 대화에서 저장했다면 그 메시지. 단어장 예문에서 저장한 것에는 없다. */
  messageId?: string;
  /** 단어장 예문에서 저장했다면 그 단어. 어디서 온 문장인지 보여주는 데 쓴다. */
  vocabTerm?: string;
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

/** 단어장의 예문 한 줄. */
export interface VocabExample {
  sentence: string;
  /** 그 문장의 뜻(담은 사람의 언어로). */
  translation: string;
  createdAt: number;
}

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
  /**
   * 이 단어가 쓰인 예문들. 눌러서 만들 때마다 하나씩 쌓인다.
   * 앞의 것을 지우지 않는다 — 같은 단어가 여러 상황에서 어떻게 쓰이는지가 배울 거리다.
   */
  examples: VocabExample[];
  /** 어느 메시지에서 담았는지. 되짚어 보기 위해. */
  messageId?: string;
  createdAt: number;
}

export type VocabDraft = Omit<VocabEntry, 'id' | 'userId' | 'createdAt' | 'learned' | 'examples'>;

/**
 * 예문이 겹치는지 견줄 때 쓰는 모양.
 * 대소문자와 문장부호만 다른 것은 같은 문장으로 본다.
 */
export function sameSentence(a: string, b: string): boolean {
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return plain(a) === plain(b);
}

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

/* ---------- 앱 색 ---------- */

/** 고를 수 있는 색 테마. 두 색만 바꾸면 앱 전체가 따라온다. */
export const THEMES = ['rose', 'ocean', 'forest', 'sunset', 'lilac', 'mono'] as const;
export type ThemeId = (typeof THEMES)[number];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
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

/**
 * 통화가 끝난 이유. 화면에 뭐라고 적을지가 이걸로 갈린다.
 * 'declined' 는 상대가 거절, 'missed' 는 울리다 시간이 다 된 것.
 */
/** 통화 중에 오간 말 한 줄. 통화 기록에서 쓴다. */
export interface CallLine {
  id: string;
  speakerId: string;
  lang: LangCode;
  text: string;
  /** 언어 코드 -> 번역문. */
  translations: Record<string, string>;
  createdAt: number;
}

/** 통화 한 건. 자막을 켜고 말을 나눈 통화만 남는다. */
export interface CallRecord {
  id: string;
  callerId: string;
  startedAt: number;
  endedAt: number | null;
  /** 오간 말이 몇 줄인지. 목록에서 미리 보여 준다. */
  lines: number;
}

export const CALL_END_REASONS = ['hangup', 'declined', 'missed', 'failed'] as const;
export type CallEndReason = (typeof CALL_END_REASONS)[number];

export function isCallEndReason(value: unknown): value is CallEndReason {
  return typeof value === 'string' && (CALL_END_REASONS as readonly string[]).includes(value);
}

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
  /** 보낸 글을 고친다. 자기가 보낸 것만. 고치면 번역도 다시 돌린다. */
  | { type: 'edit'; messageId: string; text: string }
  /** 여기까지 읽었다. 값은 읽은 마지막 메시지의 시각. */
  | { type: 'read'; at: number }
  /** 이모지 반응. 같은 이모지를 다시 누르거나 null 을 보내면 지운다. */
  | { type: 'react'; messageId: string; emoji: string | null }
  /**
   * 지금 이 앱을 보고 있는지. 화면이 가려지면 false.
   * 서버는 이걸 보고 폰 알림을 보낼지 정한다 — 보고 있는 사람에게는 앱 안에서 알린다.
   */
  | { type: 'attention'; visible: boolean }
  /* --- 통화 --- */
  /**
   * 통화 신호. 서버는 내용을 들여다보지 않고 상대에게 그대로 넘긴다.
   *
   * 목소리는 서버를 거치지 않고 폰끼리 직접 간다. 서버가 하는 일은 "내 주소는
   * 이거야" 를 대신 전해 주는 것뿐이다. 둘만 쓰는 앱이라 방 개념이 필요 없고,
   * callId 하나로 지난 통화의 신호가 새 통화에 섞이는 것만 막으면 된다.
   */
  | { type: 'call'; callId: string; offer: string }
  | { type: 'call_answer'; callId: string; answer: string }
  | { type: 'call_ice'; callId: string; candidate: string }
  /** 거절·끊기·못 받음. 어느 쪽이 보내도 통화는 거기서 끝난다. */
  | { type: 'call_end'; callId: string; reason: CallEndReason }
  /**
   * 통화 자막. 내 폰이 내 말을 받아쓴 것을 보낸다.
   *
   * 말하는 도중에는 계속 고쳐지므로(final=false) 그때는 화면에만 띄우고 흘려보낸다.
   * 다 말한 줄(final=true)만 번역하고 기록에 남긴다.
   */
  | { type: 'caption'; callId: string; id: string; text: string; final: boolean };

export type ServerEvent =
  /** 접속 직후 1회. 내 프로필, 상대 프로필, 최근 대화. */
  | {
      type: 'hello';
      me: UserProfile;
      peer: UserProfile;
      messages: ChatMessage[];
      /** 사람 id -> 그 사람이 어디까지 읽었는지(시각). */
      readAt: Record<string, number>;
    }
  /** 새 메시지. 원문만 담겨 도착하고, 번역은 뒤이어 update 로 온다. */
  | { type: 'message'; message: ChatMessage; clientId?: string }
  | { type: 'message_updated'; message: ChatMessage }
  | { type: 'typing'; userId: string; isTyping: boolean }
  | { type: 'presence'; userId: string; online: boolean }
  /** 상대가 여기까지 읽었다. */
  | { type: 'read'; userId: string; at: number }
  | { type: 'error'; message: string }
  /** 용어집이 바뀌었다. 양쪽 화면을 맞춘다. */
  | { type: 'glossary'; entries: GlossaryEntry[] }
  /* --- 통화 --- */
  /** 상대가 건 전화. */
  | { type: 'call'; callId: string; from: string; offer: string }
  | { type: 'call_answer'; callId: string; answer: string }
  | { type: 'call_ice'; callId: string; candidate: string }
  | { type: 'call_end'; callId: string; reason: CallEndReason }
  /**
   * 내 다른 기기가 먼저 받았다. 이 기기는 그만 울리면 된다.
   * 폰과 노트북에 같이 로그인해 두면 양쪽이 다 울리기 때문에 필요하다.
   */
  | { type: 'call_taken'; callId: string }
  /** 통화 자막 한 줄. translated 는 받는 사람이 읽는 말로 옮긴 것이다. */
  | {
      type: 'caption';
      callId: string;
      id: string;
      from: string;
      lang: LangCode;
      text: string;
      final: boolean;
      /** 번역은 늦게 따라온다. 없으면 아직 오는 중이다. */
      translated?: string;
    };
