/**
 * 웹 코드가 기대하는 브라우저 환경을 폰에서 흉내 낸다.
 *
 * src/web/ 의 코드는 웹과 같은 파일이다. localStorage, location, document,
 * fetch('/api/…') 같은 브라우저 전용 이름을 그대로 쓰므로, 앱은 그 이름들을 먼저
 * 채워 둬야 한다. 이 파일을 다른 어떤 것보다 먼저 불러온다.
 */
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { registerGlobals } from 'react-native-webrtc';

/** 이 앱이 이야기하는 서버. app.config.js 의 extra.serverUrl. */
export const SERVER_URL: string = (
  (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl ??
  'https://fran-g4j5.onrender.com'
).replace(/\/+$/, '');

/* ----------------------------- localStorage ----------------------------- */

/*
 * 웹 코드는 localStorage 를 "바로 읽는" 것으로 쓴다. 폰의 저장소는 비동기라서, 앱을
 * 그리기 전에 전부 메모리로 올려 두고(preloadStorage) 그 뒤로는 메모리에서 읽는다.
 * 쓰기는 메모리에 먼저 하고 뒤에서 저장소에 적는다.
 */
const memory = new Map<string, string>();
/** 로그인 토큰은 일반 저장소가 아니라 보안 저장소(키스토어)에 둔다. */
const SECURE_PREFIX = 'fran.token';
const INDEX_KEY = 'fran.secureKeys';
const secureKeys = new Set<string>();

const isSecure = (key: string) => key === SECURE_PREFIX || key.startsWith(`${SECURE_PREFIX}.`);

async function persistIndex(): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...secureKeys])).catch(() => {});
}

function persist(key: string, value: string | null): void {
  if (isSecure(key)) {
    if (value === null) {
      secureKeys.delete(key);
      void SecureStore.deleteItemAsync(key).catch(() => {});
    } else {
      secureKeys.add(key);
      void SecureStore.setItemAsync(key, value).catch(() => {});
    }
    void persistIndex();
    return;
  }
  if (value === null) void AsyncStorage.removeItem(key).catch(() => {});
  else void AsyncStorage.setItem(key, value).catch(() => {});
}

/** 저장해 둔 것을 전부 메모리로 올린다. 앱을 그리기 전에 한 번. */
export async function preloadStorage(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith('fran.') && key !== INDEX_KEY);
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, value] of pairs) if (value !== null) memory.set(key, value);

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

const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, String(value));
    persist(key, String(value));
  },
  removeItem: (key: string) => {
    memory.delete(key);
    persist(key, null);
  },
  clear: () => {
    for (const key of [...memory.keys()]) storage.removeItem(key);
  },
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

/* ------------------------------ 주소·요청 ------------------------------ */

/*
 * 폰의 URL 은 host·hostname 같은 것을 읽으려 하면 "구현되지 않았다" 며 터진다.
 * 주소 하나만 나눌 것이라 직접 나눈다.
 */
const parts = /^(https?:)\/\/([^/]+)/.exec(SERVER_URL);
const server = {
  protocol: parts?.[1] ?? 'https:',
  host: parts?.[2] ?? 'localhost',
  hostname: (parts?.[2] ?? 'localhost').split(':')[0] ?? 'localhost',
};

/*
 * 웹은 같은 주소의 서버와만 이야기해서 fetch('/api/…') 처럼 경로만 쓴다.
 * 앱에서는 그 앞에 서버 주소를 붙여 준다.
 */
const nativeFetch = globalThis.fetch.bind(globalThis);
const appFetch: typeof fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('/')) return nativeFetch(`${SERVER_URL}${input}`, init);
  return nativeFetch(input, init);
};

/**
 * 폰의 URLSearchParams 는 set·delete 같은 것을 못 쓰는 경우가 있다.
 * 웹 코드가 쓰는 만큼만 직접 만든다.
 */
class SimpleParams {
  private readonly items: [string, string][] = [];
  constructor(init?: string | Record<string, string> | [string, string][]) {
    if (typeof init === 'string') {
      for (const part of init.replace(/^\?/, '').split('&')) {
        if (!part) continue;
        const [k = '', v = ''] = part.split('=');
        this.items.push([decodeURIComponent(k), decodeURIComponent(v)]);
      }
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) this.items.push([k, v]);
    } else if (init) {
      for (const [k, v] of Object.entries(init)) this.items.push([k, v]);
    }
  }
  append(key: string, value: string) {
    this.items.push([key, String(value)]);
  }
  set(key: string, value: string) {
    this.delete(key);
    this.append(key, value);
  }
  get(key: string) {
    return this.items.find(([k]) => k === key)?.[1] ?? null;
  }
  has(key: string) {
    return this.items.some(([k]) => k === key);
  }
  delete(key: string) {
    for (let i = this.items.length - 1; i >= 0; i -= 1) if (this.items[i]?.[0] === key) this.items.splice(i, 1);
  }
  toString() {
    return this.items.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
}

/* ------------------------- 화면이 보이는지·포커스 ------------------------- */

type Listener = () => void;
const documentListeners = new Map<string, Set<Listener>>();
const windowListeners = new Map<string, Set<Listener>>();

function on(table: Map<string, Set<Listener>>, type: string, fn: Listener) {
  const set = table.get(type) ?? new Set<Listener>();
  set.add(fn);
  table.set(type, set);
}
function off(table: Map<string, Set<Listener>>, type: string, fn: Listener) {
  table.get(type)?.delete(fn);
}
function fire(table: Map<string, Set<Listener>>, type: string) {
  for (const fn of [...(table.get(type) ?? [])]) fn();
}

const fakeDocument = {
  visibilityState: AppState.currentState === 'active' ? 'visible' : 'hidden',
  documentElement: { dataset: {} as Record<string, string> },
  addEventListener: (type: string, fn: Listener) => on(documentListeners, type, fn),
  removeEventListener: (type: string, fn: Listener) => off(documentListeners, type, fn),
};

const fakeWindowEvents = {
  addEventListener: (type: string, fn: Listener) => on(windowListeners, type, fn),
  removeEventListener: (type: string, fn: Listener) => off(windowListeners, type, fn),
};

AppState.addEventListener('change', (next) => {
  const visible = next === 'active';
  fakeDocument.visibilityState = visible ? 'visible' : 'hidden';
  fire(documentListeners, 'visibilitychange');
  if (visible) fire(windowListeners, 'focus');
});

/* ------------------------------ 설치 ------------------------------ */

function uuid(): string {
  // 보안 용도가 아니라 화면에서 짝만 맞추는 값이다.
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

const g = globalThis as unknown as Record<string, unknown>;

g.localStorage = storage;
g.fetch = appFetch;
g.URLSearchParams = SimpleParams;
g.location = {
  protocol: server.protocol,
  host: server.host,
  hostname: server.hostname,
  origin: `${server.protocol}//${server.host}`,
  href: SERVER_URL,
};
g.document = fakeDocument;
g.addEventListener = fakeWindowEvents.addEventListener;
g.removeEventListener = fakeWindowEvents.removeEventListener;

const existing = (g.crypto ?? {}) as Record<string, unknown>;
if (typeof existing.randomUUID !== 'function') {
  g.crypto = Object.assign(existing, { randomUUID: uuid });
}

// RTCPeerConnection, MediaStream, navigator.mediaDevices 를 채운다.
registerGlobals();
