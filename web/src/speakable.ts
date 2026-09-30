/**
 * 소리로 읽어 줄 글을 고르는 규칙. 화면에 묶이지 않아서 웹과 앱이 같이 쓴다.
 * (읽어 주는 쪽은 브라우저와 폰이 서로 다르다 — speech.ts)
 */

/* ------------------------------ 읽을 것만 고르기 ------------------------------ */

/**
 * 소리로 읽을 수 없는 것들.
 *
 * 말풍선에는 이모지가 섞여 들어온다. 그대로 넘기면 합성기가 "빨간 하트", "웃는 얼굴"
 * 하고 이름을 읽어 버린다. 발음이 궁금해서 누른 건데 엉뚱한 말이 끼어드는 셈이다.
 *
 * 숫자 키캡(1️⃣)은 숫자 자체가 이모지가 아니라서 따로 먼저 걷어낸다. 뒤에 붙는 것들
 * (변이 선택자 · ZWJ · 피부색)이 남으면 이어 붙은 이모지가 쪼개져 나오므로 함께 지운다.
 */
const KEYCAP = /[#*0-9]️?⃣/g;

function buildPictographic(): RegExp {
  try {
    return new RegExp(
      '[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\p{Emoji_Modifier}\\p{Regional_Indicator}]' +
        '|[\\uFE0E\\uFE0F\\u200D]',
      'gu',
    );
  } catch {
    // 유니코드 속성을 모르는 낡은 브라우저. 이모지가 모여 있는 구간만 걷어낸다.
    return /[←-⇿⌀-➿⬀-⯿︎️‍]|[\uD83C-\uD83E][\uDC00-\uDFFF]/g;
  }
}

const PICTOGRAPHIC = buildPictographic();

/**
 * ㅋㅋ · ㅎㅎ · ㅠㅠ 처럼 낱자만 늘어놓은 것.
 *
 * 한국어 대화에서는 이게 곧 이모티콘이다. 합성기는 낱자 이름("키읔")을 읽으려 들어서
 * 웃음소리가 되지 않는다. 글자가 아니라 표정이므로 읽지 않는다.
 */
const JAMO_RUN = /[ㄱ-ㆎ]+/g;

/** 무언가 읽을 거리가 남았는지. 기호만 남았으면 읽을 게 없는 것이다. */
export const HAS_LETTERS = /[\p{L}\p{N}]/u;

/**
 * 소리로 읽어 줄 글만 남긴다.
 *
 * 지운 자리는 공백으로 둔다 — "좋아❤️사랑해" 를 붙여 버리면 없던 한 단어가 된다.
 */
export function speakable(text: string): string {
  return text
    .replace(KEYCAP, ' ')
    .replace(PICTOGRAPHIC, ' ')
    .replace(JAMO_RUN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 읽어 줄 말이 있는지. 이모지만 있는 말풍선에는 소리 버튼을 띄우지 않는다. */
export function hasSpeech(text: string): boolean {
  return HAS_LETTERS.test(speakable(text));
}
