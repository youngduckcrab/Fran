/**
 * 말풍선에서 무엇을 볼지.
 *
 * 공부하는 날에는 원문부터 읽고 싶고, 바쁠 때는 뜻만 알면 된다. 매번 말풍선을 눌러
 * 펴는 대신 한 번 골라 두게 한다. 어느 쪽을 골라도 말풍선을 누르면 나머지가 보인다.
 */
export const BUBBLE_VIEWS = ['translation', 'both', 'source'] as const;
export type BubbleView = (typeof BUBBLE_VIEWS)[number];

const KEY = 'fran.bubbleView';
/** 예전에 쓰던 "원문 항상 보기" 켬/끔. 골라 둔 것을 잃지 않으려고 한 번만 읽는다. */
const OLD_KEY = 'fran.alwaysShowSource';

export function isBubbleView(value: unknown): value is BubbleView {
  return typeof value === 'string' && (BUBBLE_VIEWS as readonly string[]).includes(value);
}

export function loadBubbleView(): BubbleView {
  try {
    const saved = localStorage.getItem(KEY);
    if (isBubbleView(saved)) return saved;
    return localStorage.getItem(OLD_KEY) === '1' ? 'both' : 'translation';
  } catch {
    return 'translation'; // 시크릿 모드나 저장소 차단
  }
}

export function saveBubbleView(view: BubbleView): void {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // 저장하지 못해도 이번 세션은 그대로 쓸 수 있다
  }
}
