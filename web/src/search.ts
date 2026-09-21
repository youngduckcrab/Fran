import { messageText, type ChatMessage } from '@fran/shared';

/** 찾은 말이 들어 있는 한 도막. 앞뒤를 조금 붙여서 어떤 맥락인지 보이게 한다. */
export interface Snippet {
  before: string;
  match: string;
  after: string;
  /** 앞이 잘렸는지. 화면에서 … 를 붙인다. */
  clipped: boolean;
}

/** 도막 앞뒤로 붙여 보여줄 글자 수. 한 줄에 들어갈 만큼만. */
const LEAD = 24;
const TRAIL = 70;

/**
 * 이 메시지의 어느 글에서 찾았는지 골라 그 도막을 돌려준다.
 *
 * 한 메시지에는 원문·번역문·받아쓴 글이 함께 있다. 한국어로 친 말을 스페인어로 기억해
 * 찾았다면 스페인어 쪽을 보여줘야 "이거다" 싶다. 찾은 말이 들어 있는 글을 고른다.
 */
export function snippetOf(message: ChatMessage, query: string): Snippet | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const texts = [
    messageText(message),
    ...Object.values(message.translations)
      .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation))
      .map((translation) => translation.text),
  ].filter(Boolean);

  for (const text of texts) {
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const from = Math.max(0, at - LEAD);
    return {
      before: text.slice(from, at),
      match: text.slice(at, at + needle.length),
      after: text.slice(at + needle.length, at + needle.length + TRAIL),
      clipped: from > 0,
    };
  }

  // 찾은 말이 어디에도 없으면(사진 설명 등) 그냥 첫 줄을 보여준다.
  const fallback = texts[0];
  return fallback ? { before: '', match: '', after: fallback.slice(0, TRAIL), clipped: false } : null;
}
