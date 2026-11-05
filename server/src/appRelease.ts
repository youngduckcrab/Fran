import { config } from './config.js';

/**
 * 안드로이드 앱의 새 판을 서버가 대신 알려 주고 내려준다.
 *
 * APK 는 GitHub Actions 가 저장소 릴리스(android-latest)에 올린다. 예전에는 앱이 GitHub 에 바로
 * 물어보고 받았는데, 그러면 저장소가 공개여야 한다. 이제는 앱이 이 서버에 묻고, 서버가 GitHub 에서
 * 받아 흘려준다. 저장소를 비공개로 돌려도 APP_RELEASE_TOKEN(읽기 전용 토큰)만 넣어 두면 그대로 된다.
 * 토큰이 없으면 공개 저장소로 보고 그냥 묻는다.
 */

const API = 'https://api.github.com';

/** GitHub 에 너무 자주 묻지 않는다. 토큰 없이는 한 시간에 60번까지다. */
const CACHE_MS = 60_000;

export interface AppRelease {
  /** 릴리스 설명의 "build: 19". 앱의 빌드 번호와 비교한다. */
  build: number;
  /** APK 크기(바이트). 받는 쪽이 진행률을 그린다. */
  size: number;
  assetId: number;
}

let cached: { release: AppRelease; at: number } | null = null;
let inflight: Promise<AppRelease | null> | null = null;

function headers(accept = 'application/vnd.github+json'): Record<string, string> {
  const { token } = config.appRelease;
  return {
    accept,
    'user-agent': 'fran-server',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** 지금 올라와 있는 새 판. 못 알아내면 마지막으로 알던 것, 그것도 없으면 null. */
export function latestAppRelease(): Promise<AppRelease | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.release);
  inflight ??= (async () => {
    const { repo, tag, asset } = config.appRelease;
    try {
      const response = await fetch(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
        headers: headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // 404 는 저장소가 비공개인데 토큰이 없거나 틀린 경우가 대부분이다.
        console.warn(`[app] 새 판을 확인하지 못했습니다 (${response.status}). APP_RELEASE_TOKEN 을 확인하세요.`);
        return cached?.release ?? null;
      }
      const body = (await response.json()) as {
        body?: string | null;
        assets?: { id: number; name: string; size: number }[];
      };
      const build = Number(/build:\s*(\d+)/.exec(body.body ?? '')?.[1] ?? '0');
      const file = body.assets?.find((item) => item.name === asset);
      if (!file || !build) return cached?.release ?? null;
      const release = { build, size: file.size, assetId: file.id };
      cached = { release, at: Date.now() };
      return release;
    } catch (error) {
      console.warn('[app] 새 판을 확인하지 못했습니다:', error);
      return cached?.release ?? null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * APK 를 GitHub 에서 받아 흘려줄 응답. 못 받으면 null.
 *
 * GitHub 는 진짜 파일 주소로 넘겨주는데(서명이 붙은 주소), 그쪽에는 우리 토큰을 실어 보내면 안 된다 —
 * 남의 서버에 토큰이 새고, 받는 쪽도 인증이 둘이라며 거절한다. 그래서 넘겨주는 주소를 직접 읽어
 * 토큰 없이 받는다.
 */
export async function openAppApk(): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const release = await latestAppRelease();
  if (!release) return null;
  const { repo } = config.appRelease;
  try {
    const first = await fetch(`${API}/repos/${repo}/releases/assets/${release.assetId}`, {
      headers: headers('application/octet-stream'),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    let file = first;
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      if (!location) return null;
      file = await fetch(location, { headers: { 'user-agent': 'fran-server' } });
    }
    if (!file.ok || !file.body) {
      console.warn(`[app] APK 를 받지 못했습니다 (${file.status}).`);
      return null;
    }
    const size = Number(file.headers.get('content-length') ?? release.size) || release.size;
    return { body: file.body, size };
  } catch (error) {
    console.warn('[app] APK 를 받지 못했습니다:', error);
    return null;
  }
}
