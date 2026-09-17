import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage, LangCode } from '@fran/shared';
import { useChat } from '../useChat';
import Explanation from './Explanation';
import Glossary from './Glossary';
import MessageActions from './MessageActions';
import MessageBubble from './MessageBubble';
import Settings from './Settings';
import { toUiLang, useT, type UiLang } from '../i18n';

interface Props {
  token: string;
  onLogout: () => void;
  /** 내 표시 언어가 정해지면 화면 문구도 그 언어로 맞춘다. */
  onUiLang: (lang: UiLang) => void;
}

const SOURCE_PREF_KEY = 'fran.alwaysShowSource';
const TYPING_IDLE_MS = 1500;

export default function ChatRoom({ token, onLogout, onUiLang }: Props) {
  const t = useT();
  const chat = useChat(token, onLogout);
  const [draft, setDraft] = useState('');
  /** 이번 메시지에만 붙일 번역 지시. 보낸 뒤 비워진다. */
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  /** 길게 눌러 고른 메시지. 메뉴와 설명 패널이 이걸 본다. */
  const [picked, setPicked] = useState<ChatMessage | null>(null);
  const [explaining, setExplaining] = useState<ChatMessage | null>(null);
  const [alwaysShowSource, setAlwaysShowSource] = useState(
    () => localStorage.getItem(SOURCE_PREF_KEY) === '1',
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages, chat.peerTyping]);

  useEffect(() => {
    localStorage.setItem(SOURCE_PREF_KEY, alwaysShowSource ? '1' : '0');
  }, [alwaysShowSource]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    chat.setTyping(value.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => chat.setTyping(false), TYPING_IDLE_MS);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    chat.sendMessage(text, note.trim() || undefined);
    setDraft('');
    setNote('');
    setNoteOpen(false);
    chat.setTyping(false);
  };

  const primaryLang: LangCode = chat.me?.displayLangs[0] ?? chat.me?.nativeLang ?? 'ko';

  useEffect(() => {
    if (chat.me) onUiLang(toUiLang(primaryLang));
  }, [chat.me, primaryLang, onUiLang]);
  const extraLangs = chat.me?.displayLangs.slice(1) ?? [];

  return (
    <div className="chat">
      <header className="chat__header">
        <div>
          <h1 className="chat__peer">{chat.peer?.name ?? t('chat.connecting')}</h1>
          <p className="chat__status">
            {chat.connection !== 'open'
              ? t('chat.reconnecting')
              : chat.peerTyping
                ? t('chat.typing')
                : chat.peerOnline
                  ? t('chat.online')
                  : t('chat.offline')}
          </p>
        </div>
        <div className="chat__actions">
          <button type="button" className="chat__settings" onClick={() => setGlossaryOpen(true)}>
            {t('chat.glossary')}
          </button>
          <button type="button" className="chat__settings" onClick={() => setSettingsOpen(true)}>
            {t('chat.settings')}
          </button>
        </div>
      </header>

      {chat.error && (
        <div className="chat__banner" onClick={chat.dismissError}>
          {chat.error === 'disconnected' ? t('chat.disconnected') : chat.error}
        </div>
      )}

      <ul className="chat__messages">
        {chat.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            mine={message.senderId === chat.me?.id}
            primaryLang={message.senderId === chat.me?.id ? message.sourceLang : primaryLang}
            extraLangs={extraLangs}
            alwaysShowSource={alwaysShowSource}
            onRetranslate={chat.retranslate}
            onLongPress={setPicked}
          />
        ))}
        <div ref={bottomRef} />
      </ul>

      {noteOpen && (
        <div className="note">
          <input
            className="note__input"
            value={note}
            autoFocus
            placeholder={t('note.placeholder')}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="note__hint">{t('note.hint')}</p>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className={`composer__note ${noteOpen || note ? 'is-on' : ''}`}
          onClick={() => setNoteOpen((open) => !open)}
          aria-label={t('note.button')}
          title={t('note.button')}
        >
          ✎
        </button>
        <textarea
          className="composer__input"
          rows={1}
          value={draft}
          placeholder={t('chat.sendTo', { name: chat.peer?.name ?? '' })}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
        />
        <button className="composer__send" type="submit" disabled={!draft.trim()}>
          {t('chat.send')}
        </button>
      </form>

      {picked && (
        <MessageActions
          canRetranslate={picked.senderId === chat.me?.id || picked.translationStatus === 'failed'}
          onExplain={() => {
            setExplaining(picked);
            setPicked(null);
          }}
          onCopy={() => {
            void navigator.clipboard?.writeText(picked.sourceText).catch(() => undefined);
            setPicked(null);
          }}
          onRetranslate={() => {
            chat.retranslate(picked.id);
            setPicked(null);
          }}
          onClose={() => setPicked(null)}
        />
      )}

      {explaining && (
        <Explanation
          message={explaining}
          initialLang={
            // 내가 공부하는 언어 쪽 문장을 먼저 보여준다.
            explaining.sourceLang !== primaryLang ? explaining.sourceLang : (extraLangs[0] ?? primaryLang)
          }
          onClose={() => setExplaining(null)}
        />
      )}

      {glossaryOpen && (
        <Glossary
          entries={chat.glossary}
          onChanged={chat.setGlossary}
          onClose={() => setGlossaryOpen(false)}
        />
      )}

      {settingsOpen && chat.me && (
        <Settings
          profile={chat.me}
          alwaysShowSource={alwaysShowSource}
          onToggleSource={setAlwaysShowSource}
          onSaved={chat.setProfile}
          onClose={() => setSettingsOpen(false)}
          onLogout={onLogout}
        />
      )}
    </div>
  );
}
