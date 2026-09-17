import type {
  Attachment,
  GlossaryDraft,
  GlossaryEntry,
  LangCode,
  MessageExplanation,
  SavedSentence,
  SavedSentenceDraft,
  UserProfile,
  VocabDraft,
  VocabEntry,
} from '@fran/shared';

const LAST_USER_KEY = 'fran.lastUser';

/**
 * 토큰은 사람마다 따로 저장한다. 같은 브라우저에서 두 사람이 각자의 주소로 들어가는 일이
 * 있는데(한 컴퓨터에서 둘이 쓰거나, 테스트할 때), 키가 하나면 나중에 로그인한 쪽이
 * 상대의 토큰을 덮어써서 두 탭 모두 같은 사람으로 로그인된다.
 */
let activeUserId: string | null = null;

function tokenKey(userId: string | null): string {
  return userId ? `fran.token.${userId}` : 'fran.token';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 시크릿 모드나 저장소 차단
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 이번 세션은 그대로 쓸 수 있다
  }
}

/** 이 탭이 누구의 앱인지 정한다. 이후의 토큰 읽기·쓰기가 이 사람 것을 가리킨다. */
export function setActiveUser(userId: string | null): void {
  activeUserId = userId;
  if (userId) writeStorage(LAST_USER_KEY, userId);
}

/** 주소에 ?u= 가 없을 때 쓸, 마지막으로 로그인했던 사람. */
export function rememberedUser(): string | null {
  return readStorage(LAST_USER_KEY);
}

export function getToken(userId: string | null = activeUserId): string | null {
  return readStorage(tokenKey(userId));
}

export function setToken(token: string | null, userId: string | null = activeUserId): void {
  writeStorage(tokenKey(userId), token);
}

async function parseError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `요청이 실패했습니다 (${response.status}).`);
}

export interface LoginOption {
  id: string;
  name: string;
  /** 이 사람이 화면을 어느 언어로 볼지. 로그인 전에도 문구를 맞추기 위해 쓴다. */
  uiLang: LangCode;
}

export async function fetchUsers(): Promise<LoginOption[]> {
  const response = await fetch('/api/users');
  if (!response.ok) await parseError(response);
  return (await response.json()) as LoginOption[];
}

export async function login(userId: string, passcode: string): Promise<string> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, passcode }),
  });
  if (!response.ok) await parseError(response);
  const body = (await response.json()) as { token: string };
  return body.token;
}

export async function saveSettings(
  nativeLang: LangCode,
  displayLangs: LangCode[],
): Promise<UserProfile> {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: JSON.stringify({ nativeLang, displayLangs }),
  });
  if (!response.ok) await parseError(response);
  const body = (await response.json()) as { profile: UserProfile };
  return body.profile;
}

function authHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${getToken() ?? ''}`,
  };
}

export async function explainMessage(
  messageId: string,
  targetLang: LangCode,
): Promise<MessageExplanation> {
  const response = await fetch(`/api/messages/${messageId}/explain`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ targetLang }),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { explanation: MessageExplanation }).explanation;
}

export async function fetchGlossary(): Promise<GlossaryEntry[]> {
  const response = await fetch('/api/glossary', { headers: authHeaders() });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entries: GlossaryEntry[] }).entries;
}

/** id 를 주면 수정, 주지 않으면 새로 만든다. */
export async function saveGlossaryEntry(draft: GlossaryDraft, id?: string): Promise<GlossaryEntry> {
  const response = await fetch(id ? `/api/glossary/${id}` : '/api/glossary', {
    method: id ? 'PUT' : 'POST',
    headers: authHeaders(),
    body: JSON.stringify(draft),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entry: GlossaryEntry }).entry;
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  const response = await fetch(`/api/glossary/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!response.ok) await parseError(response);
}

/**
 * WebSocket 이 끊긴 이유가 토큰 때문인지 확인한다.
 * 소켓의 close 이벤트만으로는 401 과 네트워크 장애를 구분할 수 없어서,
 * 인증이 필요한 엔드포인트에 한 번 물어본다.
 */
export async function isTokenValid(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/messages?limit=1', {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status !== 401;
  } catch {
    // 네트워크가 죽은 것이라면 토큰 탓이 아니다. 로그아웃시키지 않는다.
    return true;
  }
}

export function websocketUrl(token: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}

/* ---------------------- 저장한 문장 / 단어장 ---------------------- */

export async function fetchSaved(): Promise<{ items: SavedSentence[]; keys: string[] }> {
  const response = await fetch('/api/saved', { headers: authHeaders() });
  if (!response.ok) await parseError(response);
  return (await response.json()) as { items: SavedSentence[]; keys: string[] };
}

export async function saveSentence(draft: SavedSentenceDraft): Promise<SavedSentence> {
  const response = await fetch('/api/saved', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(draft),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { item: SavedSentence }).item;
}

export async function deleteSaved(id: string): Promise<void> {
  const response = await fetch(`/api/saved/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!response.ok) await parseError(response);
}

export async function fetchVocab(): Promise<VocabEntry[]> {
  const response = await fetch('/api/vocab', { headers: authHeaders() });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entries: VocabEntry[] }).entries;
}

export async function saveVocab(draft: VocabDraft): Promise<VocabEntry> {
  const response = await fetch('/api/vocab', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(draft),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entry: VocabEntry }).entry;
}

export async function deleteVocab(id: string): Promise<void> {
  const response = await fetch(`/api/vocab/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!response.ok) await parseError(response);
}

/* ---------------------------- 사진첩 ---------------------------- */

export type Photo = Attachment & { messageId: string; senderId: string };

export async function fetchPhotos(): Promise<Photo[]> {
  const response = await fetch('/api/photos', { headers: authHeaders() });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { photos: Photo[] }).photos;
}

/* --------------------------- 배경화면 --------------------------- */

export async function saveWallpaper(wallpaper: string): Promise<UserProfile> {
  const response = await fetch('/api/wallpaper', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ wallpaper }),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { profile: UserProfile }).profile;
}

/** 외웠다 / 아직이다. */
export async function setVocabLearned(id: string, learned: boolean): Promise<VocabEntry> {
  const response = await fetch(`/api/vocab/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ learned }),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entry: VocabEntry }).entry;
}

/** 이 단어가 쓰인 예문. 이미 있으면 그대로 돌려주고, refresh 를 주면 새로 만든다. */
export async function makeVocabExample(id: string, refresh = false): Promise<VocabEntry> {
  const response = await fetch(`/api/vocab/${id}/example`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) await parseError(response);
  return ((await response.json()) as { entry: VocabEntry }).entry;
}
