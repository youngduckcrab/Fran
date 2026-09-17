import type {
  GlossaryDraft,
  GlossaryEntry,
  LangCode,
  MessageExplanation,
  UserProfile,
} from '@fran/shared';

const TOKEN_KEY = 'fran.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
