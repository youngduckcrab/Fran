/**
 * 브라우저 환경 흉내 — 폰에 묶이지 않은 부분.
 *
 * shims.ts 는 여기에 폰의 저장소(AsyncStorage)와 앱 상태(AppState)를 꽂아서 쓴다.
 * 이렇게 나눠 두면 같은 코드를 노드에서도 돌려 볼 수 있다(tests/).
 */

/** 저장할 곳에 알리는 함수. value 가 null 이면 지운다. */
export type Persist = (key: string, value: string | null) => void;

/**
 * 웹 코드는 localStorage 를 "바로 읽는" 것으로 쓴다. 폰의 저장소는 비동기라서, 앱을
 * 그리기 전에 전부 메모리로 올려 두고 그 뒤로는 메모리에서 읽는다. 쓰기는 메모리에
 * 먼저 하고 뒤에서 저장소에 적는다.
 */
export function createStorage(persist: Persist) {
  const memory = new Map<string, string>();
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
  return { storage, memory };
}

/**
 * 폰의 URLSearchParams 는 set·delete 같은 것을 못 쓰는 경우가 있다.
 * 웹 코드가 쓰는 만큼만 직접 만든다.
 */
export class SimpleParams {
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

/**
 * 폰의 URL 은 host·hostname 같은 것을 읽으려 하면 "구현되지 않았다" 며 터진다.
 * 주소 하나만 나눌 것이라 직접 나눈다.
 */
export function parseServer(serverUrl: string) {
  const parts = /^(https?:)\/\/([^/]+)/.exec(serverUrl);
  const host = parts?.[2] ?? 'localhost';
  return { protocol: parts?.[1] ?? 'https:', host, hostname: host.split(':')[0] ?? 'localhost' };
}

function uuid(): string {
  // 보안 용도가 아니라 화면에서 짝만 맞추는 값이다.
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

type Listener = () => void;

class Emitter {
  private readonly table = new Map<string, Set<Listener>>();
  on = (type: string, fn: Listener) => {
    const set = this.table.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.table.set(type, set);
  };
  off = (type: string, fn: Listener) => {
    this.table.get(type)?.delete(fn);
  };
  fire = (type: string) => {
    for (const fn of [...(this.table.get(type) ?? [])]) fn();
  };
}

export interface InstallOptions {
  serverUrl: string;
  storage: ReturnType<typeof createStorage>['storage'];
  /** 지금 화면이 보이는지(앱이 앞에 있는지). */
  visible: boolean;
}

/**
 * 브라우저 이름들을 전역에 채운다. 돌려주는 setVisible 로 앱이 앞으로 나오고 들어가는
 * 것을 알리면, document.visibilityState 와 visibilitychange·focus 이벤트가 따라 움직인다.
 */
export function installGlobals({ serverUrl, storage, visible }: InstallOptions): { setVisible: (visible: boolean) => void } {
  const g = globalThis as unknown as Record<string, unknown>;
  const base = serverUrl.replace(/\/+$/, '');
  const server = parseServer(base);

  const nativeFetch = globalThis.fetch.bind(globalThis);
  // 웹은 같은 주소의 서버와만 이야기해서 fetch('/api/…') 처럼 경로만 쓴다. 앞에 서버 주소를 붙여 준다.
  const appFetch: typeof fetch = (input, init) =>
    typeof input === 'string' && input.startsWith('/') ? nativeFetch(`${base}${input}`, init) : nativeFetch(input, init);

  const documentEvents = new Emitter();
  const windowEvents = new Emitter();
  const fakeDocument = {
    visibilityState: visible ? 'visible' : 'hidden',
    documentElement: { dataset: {} as Record<string, string> },
    addEventListener: documentEvents.on,
    removeEventListener: documentEvents.off,
  };

  // 폰에서는 이미 window 가 전역 자신이다. 노드처럼 없는 곳에서만 채운다.
  if (g.window === undefined) g.window = globalThis;
  g.localStorage = storage;
  g.fetch = appFetch;
  g.URLSearchParams = SimpleParams;
  g.location = { ...server, origin: `${server.protocol}//${server.host}`, href: base };
  g.document = fakeDocument;
  g.addEventListener = windowEvents.on;
  g.removeEventListener = windowEvents.off;

  const existing = (g.crypto ?? {}) as Record<string, unknown>;
  if (typeof existing.randomUUID !== 'function') g.crypto = Object.assign(existing, { randomUUID: uuid });

  return {
    setVisible(next: boolean) {
      fakeDocument.visibilityState = next ? 'visible' : 'hidden';
      documentEvents.fire('visibilitychange');
      if (next) windowEvents.fire('focus');
    },
  };
}
