/**
 * 웹 코드가 기대하는 브라우저 환경을 폰에서 흉내 낸다.
 *
 * src/web/ 의 코드는 웹과 같은 파일이다. localStorage, location, document,
 * fetch('/api/…') 같은 브라우저 전용 이름을 그대로 쓰므로, 앱은 그 이름들을 먼저
 * 채워 둬야 한다. 이 파일을 다른 어떤 것보다 먼저 불러온다.
 *
 * 폰과 상관없는 부분은 shimCore.ts 에 있고, 여기서는 폰의 저장소·앱 상태·WebRTC 를 꽂는다.
 */
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { registerGlobals } from 'react-native-webrtc';
import { createStorage, installGlobals } from './shimCore';

/** 이 앱이 이야기하는 서버. app.config.js 의 extra.serverUrl. */
export const SERVER_URL: string = (
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ??
  'https://fran-g4j5.onrender.com'
).replace(/\/+$/, '');

/** 로그인 토큰은 일반 저장소가 아니라 보안 저장소(키스토어)에 둔다. */
const SECURE_PREFIX = 'fran.token';
const INDEX_KEY = 'fran.secureKeys';
const secureKeys = new Set<string>();
const isSecure = (key: string) => key === SECURE_PREFIX || key.startsWith(`${SECURE_PREFIX}.`);

function persist(key: string, value: string | null): void {
  if (isSecure(key)) {
    if (value === null) {
      secureKeys.delete(key);
      void SecureStore.deleteItemAsync(key).catch(() => {});
    } else {
      secureKeys.add(key);
      void SecureStore.setItemAsync(key, value).catch(() => {});
    }
    void AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...secureKeys])).catch(() => {});
    return;
  }
  if (value === null) void AsyncStorage.removeItem(key).catch(() => {});
  else void AsyncStorage.setItem(key, value).catch(() => {});
}

const { storage, memory } = createStorage(persist);

/** 저장해 둔 것을 전부 메모리로 올린다. 앱을 그리기 전에 한 번. */
export async function preloadStorage(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith('fran.') && key !== INDEX_KEY);
    for (const [key, value] of await AsyncStorage.multiGet(keys)) if (value !== null) memory.set(key, value);

    const indexed = JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? '[]') as string[];
    for (const key of indexed) {
      const value = await SecureStore.getItemAsync(key).catch(() => null);
      if (value !== null) {
        memory.set(key, value);
        secureKeys.add(key);
      }
    }
  } catch {
    // 못 읽으면 처음 쓰는 것처럼 시작한다. 다시 로그인하면 된다.
  }
}

const { setVisible } = installGlobals({
  serverUrl: SERVER_URL,
  storage,
  visible: AppState.currentState === 'active',
});
AppState.addEventListener('change', (next) => setVisible(next === 'active'));

// RTCPeerConnection, MediaStream, navigator.mediaDevices 를 채운다.
registerGlobals();
