import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { useT } from '../i18n';
import { previewOf } from '../preview';
import Icon from './Icon';
import NotifyPrompt from './NotifyPrompt';

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
  const last = previewOf(lastMessage, primaryLang, t);

  return (
    <div className="home">
      <header className="home__header">
        <div>
          <h1 className="home__peer">
            {peer?.name ?? t('chat.connecting')}
            <Icon name="heart" size={18} className="home__heart" />
          </h1>
          <p className="home__status">
            {connecting ? t('chat.reconnectingShort') : peerOnline ? t('chat.online') : t('chat.offline')}
          </p>
        </div>
        <button type="button" className="chat__settings" onClick={onSettings} disabled={!me}>
          {t('chat.settings')}
        </button>
      </header>

      {me && <NotifyPrompt userId={me.id} />}

      <button type="button" className="tile tile--chat" onClick={() => onOpen('chat')}>
        <span className="tile__icon"><Icon name="chat" size={26} /></span>
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
          <span className="tile__icon"><Icon name="bookmark" size={24} /></span>
          <span className="tile__title">{t('home.saved')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.saved) })}</span>
        </button>

        <button type="button" className="tile" onClick={() => onOpen('vocab')}>
          <span className="tile__icon"><Icon name="book" size={24} /></span>
          <span className="tile__title">{t('home.vocab')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.vocab) })}</span>
        </button>

        <button type="button" className="tile" onClick={() => onOpen('album')}>
          <span className="tile__icon"><Icon name="image" size={24} /></span>
          <span className="tile__title">{t('home.album')}</span>
          <span className="tile__count">{t('home.items', { count: String(counts.photos) })}</span>
        </button>
      </div>
    </div>
  );
}
