import type { SavedSentence, VocabEntry } from '@fran/shared';
import type { Photo } from './api';

/**
 * 저장한 문장·단어장·사진첩을 이 기기에 적어 둔다.
 *
 * 대화와 같은 이유다. 앱을 열면 서버에 물어봐야 목록이 오는데, 서버가 자고 있었다면
 * 그동안 화면이 비어 있다. 적어 둔 것을 먼저 그리고, 답이 오면 조용히 바꿔 끼운다.
 *
 * 사진은 목록만 적는다(어떤 사진이 있는지). 사진 자체는 서비스 워커가 따로 들고 있고,
 * 여기에까지 넣으면 저장소가 금방 찬다.
 */
export interface Collections {
  saved: SavedSentence[];
  vocab: VocabEntry[];
  photos: Photo[];
}

export const EMPTY: Collections = { saved: [], vocab: [], photos: [] };

/** 모양이 바뀌면 번호를 올린다. 옛 기록은 읽히지 않고 버려진다. */
const VERSION = 1;

function keyFor(userId: string): string {
  return `fran.collections.v${VERSION}.${userId}`;
}

export function loadCollections(userId: string | null): Collections | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Collections;
    // 옛 모양이거나 남이 넣어 둔 것일 수 있다. 최소한만 확인하고 아니면 버린다.
    if (!Array.isArray(saved?.saved) || !Array.isArray(saved.vocab) || !Array.isArray(saved.photos)) {
      return null;
    }
    return saved;
  } catch {
    return null; // 시크릿 모드, 저장소 차단, 깨진 JSON
  }
}

export function saveCollections(userId: string | null, value: Collections): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(value));
  } catch {
    // 자리가 없으면 적지 않는다. 다음에 열 때 조금 더 기다릴 뿐이다.
  }
}

/** 로그아웃하면 지운다. 나간 사람의 단어장을 이 기기에 남겨 둘 이유가 없다. */
export function clearCollections(userId: string | null): void {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // 지우지 못해도 토큰이 없으면 앱은 열리지 않는다
  }
}
