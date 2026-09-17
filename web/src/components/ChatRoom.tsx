import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LangCode } from '@fran/shared';
import { useChat } from '../useChat';
import Glossary from './Glossary';
import MessageBubble from './MessageBubble';
import Settings from './Settings';

interface Props {
  token: string;
  onLogout: () => void;
}

const SOURCE_PREF_KEY = 'fran.alwaysShowSource';
const TYPING_IDLE_MS = 1500;

export default function ChatRoom({ token, onLogout }: Props) {
  const chat = useChat(token, onLogout);
  const [draft, setDraft] = useState('');
  /** 이번 메시지에만 붙일 번역 지시. 보낸 뒤 비워진다. */
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
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
  const extraLangs = chat.me?.displayLangs.slice(1) ?? [];

  return (
    <div className="chat">
      <header className="chat__header">
        <div>
          <h1 className="chat__peer">{chat.peer?.name ?? '연결 중'}</h1>
          <p className="chat__status">
            {chat.connection !== 'open'
              ? '다시 연결하는 중…'
              : chat.peerTyping
                ? '입력 중…'
                : chat.peerOnline
                  ? '접속 중'
                  : '오프라인'}
          </p>
        </div>
        <div className="chat__actions">
          <button type="button" className="chat__settings" onClick={() => setGlossaryOpen(true)}>
            용어집
          </button>
          <button type="button" className="chat__settings" onClick={() => setSettingsOpen(true)}>
            설정
          </button>
        </div>
      </header>

      {chat.error && (
        <div className="chat__banner" onClick={chat.dismissError}>
          {chat.error}
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
            placeholder="이 메시지만: 어떻게 번역할지 (예: amor 로 해줘)"
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="note__hint">상대에게는 보이지 않습니다. 보내고 나면 지워집니다.</p>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className={`composer__note ${noteOpen || note ? 'is-on' : ''}`}
          onClick={() => setNoteOpen((open) => !open)}
          aria-label="번역 지시"
          title="이 메시지만 번역 지시"
        >
          ✎
        </button>
        <textarea
          className="composer__input"
          rows={1}
          value={draft}
          placeholder={`${chat.peer?.name ?? '상대'}에게 보내기`}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
        />
        <button className="composer__send" type="submit" disabled={!draft.trim()}>
          보내기
        </button>
      </form>

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
