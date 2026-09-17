import type { LangCode, UserProfile } from '@fran/shared';

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

export function websocketUrl(token: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}
