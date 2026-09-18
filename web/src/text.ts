/**
 * 문장을 견주기 좋게 다듬는다.
 *
 * 저장한 문장은 대화에서 온 것도 있고 단어장 예문에서 온 것도 있다. 같은 문장인지
 * 알아보려면 대소문자와 문장부호 차이는 없는 것으로 봐야 한다.
 */
export function plainText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
