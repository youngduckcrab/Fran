import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { getToken } from './web/api';
import { SERVER_URL } from './shims';

/**
 * 새 앱이 나왔는지, 그리고 앱 안에서 바로 바꾸기.
 *
 * 앱은 웹처럼 저절로 새로 받아지지 않는다. Actions 가 APK 를 릴리스 android-latest 에 올릴 때
 * 릴리스 설명에 빌드 번호를 적어 두고, 앱이 열릴 때 그 번호가 지금 깐 것보다 크면 알려 준다.
 *
 * 누르면 APK 를 앱이 직접 받아서(진행률을 보여 주며) 안드로이드 설치 화면을 연다. 브라우저로
 * 나가서 받고, 다운로드 폴더를 찾아 누르는 일이 없어진다. 설치 자체는 폰이 한다 — "설치" 를
 * 한 번 눌러야 하고, 처음 한 번은 "이 출처의 앱 설치 허용" 을 켜야 한다.
 *
 * 새 판이 있는지도, APK 도 우리 서버에 묻는다(server/src/appRelease.ts). 서버가 GitHub 에서 대신
 * 받아 주므로 저장소를 비공개로 돌려도 그대로 된다. 서버가 아직 모르는 곳(예전 서버)이면 예전처럼
 * 공개 저장소에 직접 묻는다.
 */
const GITHUB_RELEASE_API = 'https://api.github.com/repos/youngduckcrab/Fran/releases/tags/android-latest';
const GITHUB_APK_URL = 'https://github.com/youngduckcrab/Fran/releases/download/android-latest/fran.apk';

/** 새 판을 어디서 받을지. 확인할 때 답해 준 곳에서 받는다. */
interface Source {
  build: number;
  /** 받을 주소. 서버 것이면 헤더에 토큰을 싣는다. */
  url: string;
  headers: Record<string, string>;
  /** 받는 쪽이 크기를 알려 주지 않을 때 진행률을 그리는 데 쓴다. */
  size: number;
  /** 앱 안에서 못 받았을 때 브라우저로 열 주소. */
  browserUrl: string;
}

function parseBuild(text: string | null | undefined): number {
  return Number(/build:\s*(\d+)/.exec(text ?? '')?.[1] ?? '0');
}

async function fromServer(): Promise<Source | null> {
  const token = getToken();
  if (!token) return null;
  const response = await fetch(`${SERVER_URL}/api/app/latest`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const body = (await response.json()) as { build?: number; size?: number };
  if (!body.build) return null;
  return {
    build: body.build,
    url: `${SERVER_URL}/api/app/apk`,
    headers: { authorization: `Bearer ${token}` },
    size: body.size ?? 0,
    browserUrl: `${SERVER_URL}/api/app/apk?t=${encodeURIComponent(token)}`,
  };
}

async function fromGitHub(): Promise<Source | null> {
  const response = await fetch(GITHUB_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
  if (!response.ok) return null;
  const body = (await response.json()) as { body?: string; assets?: { name: string; size: number }[] };
  const build = parseBuild(body.body);
  if (!build) return null;
  return {
    build,
    url: GITHUB_APK_URL,
    headers: {},
    size: body.assets?.find((asset) => asset.name === 'fran.apk')?.size ?? 0,
    browserUrl: GITHUB_APK_URL,
  };
}

/** 설치 화면이 우리 캐시에 받아 둔 APK 를 읽어도 된다는 허락(Intent.FLAG_GRANT_READ_URI_PERMISSION). */
const GRANT_READ_URI = 1;

export type UpdatePhase = 'none' | 'available' | 'downloading' | 'installing' | 'failed';

export interface AppUpdate {
  phase: UpdatePhase;
  /** 받는 중일 때 0~1. */
  progress: number;
  /** 지금 상태에서 할 일. 받기 → 설치 화면 열기. 실패했으면 브라우저로 받는다. */
  start: () => void;
}

export function useAppUpdate(): AppUpdate {
  const [phase, setPhase] = useState<UpdatePhase>('none');
  const [progress, setProgress] = useState(0);
  /** 새 판과 받을 곳. 받은 파일 이름에 빌드 번호를 붙인다. */
  const latest = useRef<Source | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = Number(Application.nativeBuildVersion ?? '0');
        // 릴리스 설명에 "build: 12" 처럼 적혀 있다. 서버가 먼저, 안 되면 GitHub.
        const source = (await fromServer().catch(() => null)) ?? (await fromGitHub().catch(() => null));
        if (!cancelled && source && source.build > mine) {
          latest.current = source;
          setPhase('available');
        }
      } catch {
        // 확인하지 못해도 앱을 쓰는 데는 아무 문제가 없다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(() => {
    if (busy.current) return;

    const source = latest.current;
    if (!source) return;
    // 앱이 직접 설치 화면을 열 수 없는 곳이거나, 한 번 실패했으면 예전처럼 브라우저로 받는다.
    if (Platform.OS !== 'android' || !FileSystem.cacheDirectory || phase === 'failed') {
      void Linking.openURL(source.browserUrl);
      return;
    }

    busy.current = true;
    setProgress(0);
    setPhase('downloading');
    void (async () => {
      try {
        const target = `${FileSystem.cacheDirectory}fran-${source.build}.apk`;
        const task = FileSystem.createDownloadResumable(source.url, target, { headers: source.headers }, (event) => {
          // 서버를 거치면 크기가 안 실려 올 수도 있다. 그때는 확인할 때 들은 크기로 센다.
          const total = event.totalBytesExpectedToWrite > 0 ? event.totalBytesExpectedToWrite : source.size;
          if (total > 0) setProgress(Math.min(1, event.totalBytesWritten / total));
        });
        const result = await task.downloadAsync();
        if (!result || result.status !== 200) throw new Error(`APK 를 받지 못했습니다 (${result?.status ?? '?'})`);

        // 다른 앱(설치 화면)에 우리 파일을 넘기려면 file:// 가 아니라 content:// 주소여야 한다.
        const contentUri = await FileSystem.getContentUriAsync(result.uri);
        setPhase('installing');
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          type: 'application/vnd.android.package-archive',
          flags: GRANT_READ_URI,
        });
        // 설치가 되면 이 앱은 새 판으로 바뀌며 꺼지므로 여기까지 오지 않는다.
        // 여기로 돌아왔다면 설치 화면에서 취소한 것이다. 다시 누를 수 있게 둔다.
        setPhase('available');
      } catch {
        setPhase('failed');
      } finally {
        busy.current = false;
      }
    })();
  }, [phase]);

  return { phase, progress, start };
}
