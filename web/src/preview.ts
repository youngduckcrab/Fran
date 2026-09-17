import { messageText, type ChatMessage, type LangCode } from '@fran/shared';
import type { Translate } from './i18n';

/**
 * 메시지 한 줄 미리보기. 내가 읽는 언어로, 없으면 원문으로.
 *
 * 홈의 채팅 칸과 화면 안 알림이 같은 규칙을 써야 한다. 한쪽만 원문을 띄우면
 * 같은 메시지가 자리마다 다른 말로 보인다.
 */
export function previewOf(
  message: ChatMessage | undefined,
  primaryLang: LangCode,
  t: Translate,
): string | null {
  if (!message) return null;

  const own = messageText(message);
  const text =
    message.sourceLang === primaryLang ? own : (message.translations[primaryLang]?.text ?? own);

  // 글 없이 사진이나 음성만 보낸 메시지도 있다. 빈 줄로 두면 아무것도 없는 것처럼 보인다.
  const label = message.attachment
    ? message.attachment.kind === 'image'
      ? t('bubble.photo')
      : t('bubble.voice')
    : '';
  return [label, text.trim()].filter(Boolean).join(' · ') || null;
}
