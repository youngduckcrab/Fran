import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as Application from 'expo-application';

/**
 * 새 앱이 나왔는지.
 *
 * 앱은 웹처럼 저절로 새로 받아지지 않는다. Actions 가 APK 를 릴리스 android-latest 에 올릴 때
 * 릴리스 설명에 빌드 번호를 적어 두고, 앱이 열릴 때 그 번호가 지금 깐 것보다 크면 알려 준다.
 * 누르면 APK 를 받는 주소를 연다(설치는 폰이 한다).
 */
const RELEASE_API = 'https://api.github.com/repos/youngduckcrab/Fran/releases/tags/android-latest';
const APK_URL = 'https://github.com/youngduckcrab/Fran/releases/download/android-latest/fran.apk';

export function useAppUpdate(): { available: boolean; open: () => void } {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = Number(Application.nativeBuildVersion ?? '0');
        const response = await fetch(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
        if (!response.ok) return;
        const body = (await response.json()) as { body?: string };
        // 릴리스 설명에 "build: 12" 처럼 적혀 있다.
        const latest = Number(/build:\s*(\d+)/.exec(body.body ?? '')?.[1] ?? '0');
        if (!cancelled && latest > mine) setAvailable(true);
      } catch {
        // 확인하지 못해도 앱을 쓰는 데는 아무 문제가 없다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { available, open: () => void Linking.openURL(APK_URL) };
}
