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

/** 악센트로 붙는 부호들. NFD 로 풀어헤치면 글자 뒤에 이것들이 떨어져 나온다. */
const MARKS = /[\u0300-\u036f]/g;

/**
 * 악센트를 떼고 소문자로 맞추되, 글자 자리를 기억해 둔다.
 *
 * 서버는 `extrano` 로 쳐도 `extraño` 를 찾아 준다. 그런데 화면에서 강조할 자리를 찾을 때
 * 민짜끼리 견주면 자리가 어긋난다 — `ñ` 를 풀면 두 글자가 되기 때문이다. 민짜 글자마다
 * 원래 몇 번째 글자에서 나왔는지를 함께 들고 있으면 원문의 자리로 되짚을 수 있다.
 */
function fold(text: string): { flat: string; at: number[] } {
  let flat = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const plain = (text[i] as string).normalize('NFD').replace(MARKS, '').toLowerCase();
    for (const _ of plain) at.push(i);
    flat += plain;
  }
  return { flat, at };
}

/**
 * 이 메시지의 어느 글에서 찾았는지 골라 그 도막을 돌려준다.
 *
 * 한 메시지에는 원문·번역문·받아쓴 글이 함께 있다. 한국어로 친 말을 스페인어로 기억해
 * 찾았다면 스페인어 쪽을 보여줘야 "이거다" 싶다. 찾은 말이 들어 있는 글을 고른다.
 */
export function snippetOf(message: ChatMessage, query: string): Snippet | null {
  const needle = fold(query.trim()).flat;
  if (!needle) return null;

  const texts = [
    messageText(message),
    ...Object.values(message.translations)
      .filter((translation): translation is NonNullable<typeof translation> => Boolean(translation))
      .map((translation) => translation.text),
  ].filter(Boolean);

  for (const text of texts) {
    const { flat, at } = fold(text);
    const hit = flat.indexOf(needle);
    if (hit === -1) continue;

    // 민짜에서 찾은 자리를 원문의 자리로 되짚는다. 강조는 원문 글자에 해야 한다.
    const start = at[hit] as number;
    const end = (at[hit + needle.length - 1] as number) + 1;
    const from = Math.max(0, start - LEAD);
    return {
      before: text.slice(from, start),
      match: text.slice(start, end),
      after: text.slice(end, end + TRAIL),
      clipped: from > 0,
    };
  }

  // 찾은 말이 어디에도 없으면(사진 설명 등) 그냥 첫 줄을 보여준다.
  const fallback = texts[0];
  return fallback ? { before: '', match: '', after: fallback.slice(0, TRAIL), clipped: false } : null;
}
