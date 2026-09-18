import type { LangCode } from '@fran/shared';

/** 문장을 잘라 놓은 조각 하나. */
export interface Token {
  text: string;
  /** 눌러서 뜻을 볼 수 있는 말인지. 공백과 문장부호는 아니다. */
  word: boolean;
}

/**
 * 어느 글자까지가 한 단어인지 알려 주는 브라우저 기능.
 *
 * 중국어에는 띄어쓰기가 없어서 공백으로 자르면 문장이 통째로 한 덩어리가 된다.
 * Intl.Segmenter 는 그런 언어도 단어 단위로 잘라 준다. 없는 브라우저에서는
 * 글자 종류가 바뀌는 자리를 단어 경계로 친다.
 */
type SegmenterCtor = new (
  locale: string,
  options: { granularity: 'word' },
) => { segment: (text: string) => Iterable<{ segment: string; isWordLike?: boolean }> };

function segmenter(lang: LangCode): InstanceType<SegmenterCtor> | null {
  const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!ctor) return null;
  try {
    return new ctor(lang, { granularity: 'word' });
  } catch {
    return null;
  }
}

/** 글자·숫자로 이루어진 덩어리를 단어로 본다. 스페인어의 아포스트로피와 붙임표는 안에 둔다. */
const WORD_RUN = /[\p{L}\p{N}]+(?:[''’-][\p{L}\p{N}]+)*/gu;

function fallbackSplit(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RUN)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: text.slice(last, at), word: false });
    tokens.push({ text: match[0], word: true });
    last = at + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), word: false });
  return tokens;
}

/**
 * 문장을 눌러볼 수 있는 조각으로 자른다.
 *
 * 자른 조각을 이어 붙이면 원래 문장이 그대로 나온다 — 화면에 보이는 글이 달라지면
 * 읽는 사람이 헷갈리고, 서버에서 "이 문장에 있는 말인지" 확인하는 것도 어긋난다.
 */
export function splitWords(text: string, lang: LangCode): Token[] {
  const seg = segmenter(lang);
  if (!seg) return fallbackSplit(text);

  const tokens: Token[] = [];
  for (const part of seg.segment(text)) {
    tokens.push({ text: part.segment, word: Boolean(part.isWordLike) });
  }
  return tokens;
}
