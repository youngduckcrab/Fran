import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { useT, type Translate } from '../i18n';

export type View = 'home' | 'chat' | 'saved' | 'vocab' | 'album';

interface Props {
  me: UserProfile | null;
  peer: UserProfile | null;
  connecting: boolean;
  peerOnline: boolean;
  lastMessage: ChatMessage | undefined;
  primaryLang: LangCode;
  unread: number;
  counts: { saved: number; vocab: number; photos: number };
  onOpen: (view: View) => void;
  onSettings: () => void;
}

/** 채팅 칸에 보여줄 마지막 한 줄. 내가 읽는 언어로. */
function preview(
  message: ChatMessage | undefined,
  primaryLang: LangCode,
  t: Translate,
): string | null {
  if (!message) return null;

  const text =
    message.sourceLang === primaryLang
      ? message.sourceText
      : (message.translations[primaryLang]?.text ?? message.sourceText);

  // 글 없이 사진이나 음성만 보낸 메시지도 있다. 빈 줄로 두면 대화가 없는 것처럼 보인다.
  const label = message.attachment
    ? message.attachment.kind === 'image'
      ? t('bubble.photo')
      : t('bubble.voice')
    : '';
  return [label, text.trim()].filter(Boolean).join(' · ') || null;
}

export default function Home({
  me,
  peer,
  connecting,
  peerOnline,
  lastMessage,
  primaryLang,
  unread,
  counts,
  onOpen,
  onSettings,
}: Props) {
  const t = useT();
  const last = preview(lastMessage, primaryLang, t);

  return (
    <div className="home">
      <header className="home__header">
        <div>
          <h1 className="home__peer">{peer?.name ?? t('chat.connecting')}</h1>
          <p className="home__status">
            {connecting ? t('chat.reconnectingShort') : peerOnline ? t('chat.online') : t('chat.offline')}
          </p>
        </div>
        <button type="button" className="chat__settings" onClick={onSettings} disabled={!me}>
          {t('chat.settings')}
        </button>
      </header>

      <button type="button" className="tile tile--chat" onClick={() => onOpen('chat')}>
        <span className="tile__icon" aria-hidden="true">💬</span>
        <span className="tile__body">
          <span className="tile__title">{t('home.chat')}</span>
          <span className="tile__line">{last ?? t('home.chatEmpty')}</span>
        </span>
        {unread > 0 && (
          <span className="tile__badge" aria-label={t('home.unread', { count: String(unread) })}>
            {unread}
          </span>
        )}
      </button>

      <div className="home__grid">
        <button type="button" className="tile" onClick={() => onOpen('saved')}>
          <span className="tile__icon" aria-hidden="true">⭐</span>
          <span className="tile__title">{t('home.saved')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.saved) })}</span>
        </button>

        <button type="button" className="tile" onClick={() => onOpen('vocab')}>
          <span className="tile__icon" aria-hidden="true">📓</span>
          <span className="tile__title">{t('home.vocab')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.vocab) })}</span>
        </button>

        <button type="button" className="tile" onClick={() => onOpen('album')}>
          <span className="tile__icon" aria-hidden="true">🖼</span>
          <span className="tile__title">{t('home.album')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.photos) })}</span>
        </button>
      </div>
    </div>
  );
}
