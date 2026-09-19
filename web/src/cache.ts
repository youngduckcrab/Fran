import type { ChatMessage, UserProfile } from '@fran/shared';

/**
 * 마지막으로 본 대화를 이 기기에 적어 둔다.
 *
 * 앱을 열면 서버에 연결해서 hello 를 받아야 대화가 보인다. 서버가 자고 있었다면
 * 그동안 화면은 비어 있고, 사람은 앱이 멈춘 줄 안다. 적어 둔 것을 먼저 그려 주면
 * 기다리는 동안에도 어제 나눈 말을 읽을 수 있고, hello 가 오면 조용히 최신으로 바뀐다.
 *
 * 서버가 원본이다. 여기 있는 것은 "보여줄 것이 아무것도 없는 순간"을 메우는 용도일 뿐이라,
 * 읽다가 실패하면 그냥 없는 셈 친다.
 */
export interface ChatSnapshot {
  me: UserProfile;
  peer: UserProfile;
  messages: ChatMessage[];
  /** 사람 id -> 어디까지 읽었는지(시각). */
  readAt: Record<string, number>;
}

/** 모양이 바뀌면 번호를 올린다. 옛 기록은 읽히지 않고 버려진다. */
const VERSION = 1;
/** 서버가 hello 로 주는 것과 같은 수. 더 들고 있어도 곧 덮인다. */
const KEEP = 50;

function keyFor(userId: string): string {
  return `fran.chat.v${VERSION}.${userId}`;
}

export function loadChat(userId: string | null): ChatSnapshot | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as ChatSnapshot;
    // 남이 넣어 둔 것이거나 옛 모양일 수 있다. 최소한만 확인하고 아니면 버린다.
    if (!snapshot?.me?.id || !snapshot?.peer?.id || !Array.isArray(snapshot.messages)) return null;
    return snapshot;
  } catch {
    return null; // 시크릿 모드, 저장소 차단, 깨진 JSON
  }
}

export function saveChat(userId: string | null, snapshot: ChatSnapshot): void {
  if (!userId) return;
  try {
    localStorage.setItem(
      keyFor(userId),
      JSON.stringify({ ...snapshot, messages: snapshot.messages.slice(-KEEP) }),
    );
  } catch {
    // 자리가 없거나 막혀 있으면 적지 않는다. 다음에 열 때 조금 더 기다릴 뿐이다.
  }
}

/** 로그아웃하면 지운다. 이 기기에 남의 대화를 남겨 둘 이유가 없다. */
export function clearChat(userId: string | null): void {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // 지우지 못해도 토큰이 없으면 앱은 열리지 않는다
  }
}
