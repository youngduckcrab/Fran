import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LangCode } from '@fran/shared';
import { useChat } from '../useChat';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    chat.sendMessage(text);
    setDraft('');
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
        <button type="button" className="chat__settings" onClick={() => setSettingsOpen(true)}>
          설정
        </button>
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

      <form className="composer" onSubmit={submit}>
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
