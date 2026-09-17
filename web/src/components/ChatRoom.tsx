import { useLayoutEffect, useRef, useState } from 'react';
import { messageText, type ChatMessage, type LangCode } from '@fran/shared';
import type { Chat } from '../useChat';
import { saveSentence } from '../api';
import { useT } from '../i18n';
import { useSpeaker } from '../speech';
import { wallpaperProps } from '../wallpaper';
import Explanation from './Explanation';
import MessageActions from './MessageActions';
import MessageBubble from './MessageBubble';
import Composer from './Composer';

interface Props {
  chat: Chat;
  primaryLang: LangCode;
  extraLangs: LangCode[];
  alwaysShowSource: boolean;
  /** 이미 저장한 문장들. `<메시지 id>:<언어>` */
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
  onVocabAdded: () => void;
  onBack: () => void;
  onGlossary: () => void;
  onSettings: () => void;
}

export default function ChatRoom({
  chat,
  primaryLang,
  extraLangs,
  alwaysShowSource,
  savedKeys,
  onSaved,
  onVocabAdded,
  onBack,
  onGlossary,
  onSettings,
}: Props) {
  const t = useT();
  /** 길게 눌러 고른 메시지. 메뉴와 설명 패널이 이걸 본다. */
  const [picked, setPicked] = useState<ChatMessage | null>(null);
  const [explaining, setExplaining] = useState<ChatMessage | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const speaker = useSpeaker();

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages, chat.peerTyping]);

  /** 상대가 실제로 읽는 언어. 내 메시지가 어떻게 갔는지 보여줄 때 쓴다. */
  const peerLang: LangCode = chat.peer?.displayLangs[0] ?? chat.peer?.nativeLang ?? 'es';

  /** 지금 화면에 보이는 문장을 저장한다. 번역을 다시 돌려도 저장본은 그대로 남는다. */
  const save = async (message: ChatMessage) => {
    const mine = message.senderId === chat.me?.id;
    const lang = mine ? message.sourceLang : primaryLang;
    const own = messageText(message);
    const text = lang === message.sourceLang ? own : message.translations[lang]?.text;
    if (!text) return;

    const pairLang = lang === message.sourceLang ? peerLang : message.sourceLang;
    const pairText = pairLang === message.sourceLang ? own : message.translations[pairLang]?.text;

    try {
      await saveSentence({
        messageId: message.id,
        lang,
        text,
        ...(pairText ? { pairLang, pairText } : {}),
      });
      onSaved(`${message.id}:${lang}`);
      setToast(t('actions.saved'));
      setTimeout(() => setToast(null), 1800);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : String(cause));
      setTimeout(() => setToast(null), 2500);
    }
  };

  const wall = wallpaperProps(chat.me?.wallpaper);

  return (
    <div className={`chat ${wall.className}`} style={wall.style}>
      <header className="chat__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          ‹
        </button>
        <div className="chat__who">
          <h1 className="chat__peer">{chat.peer?.name ?? t('chat.connecting')}</h1>
          <p className="chat__status">
            {chat.connection !== 'open'
              ? t('chat.reconnectingShort')
              : chat.peerTyping
                ? t('chat.typing')
                : chat.peerOnline
                  ? t('chat.online')
                  : t('chat.offline')}
          </p>
        </div>
        <div className="chat__actions">
          <button type="button" className="chat__settings" onClick={onGlossary}>
            {t('chat.glossary')}
          </button>
          <button type="button" className="chat__settings" onClick={onSettings}>
            {t('chat.settings')}
          </button>
        </div>
      </header>

      <ul className="chat__messages">
        {chat.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            mine={message.senderId === chat.me?.id}
            primaryLang={message.senderId === chat.me?.id ? message.sourceLang : primaryLang}
            extraLangs={extraLangs}
            peerLang={peerLang}
            peerName={chat.peer?.name ?? ''}
            alwaysShowSource={alwaysShowSource}
            speechSupported={speaker.supported}
            speakingKey={speaker.speakingKey}
            failedSpeechKey={speaker.failedKey}
            onSpeak={speaker.toggle}
            onRetranslate={chat.retranslate}
            onLongPress={setPicked}
          />
        ))}
        <div ref={bottomRef} />
      </ul>

      {/* 연결이 끊겼을 때. 화면을 가리지 않게 한 줄로 띄우고, 이어지면 알아서 사라진다. */}
      {chat.connection !== 'open' && chat.error === 'disconnected' && (
        <p className="chat__toast chat__toast--muted">{t('chat.disconnected')}</p>
      )}
      {chat.error && chat.error !== 'disconnected' && (
        <p className="chat__toast" onClick={chat.dismissError}>
          {chat.error}
        </p>
      )}
      {toast && <p className="chat__toast chat__toast--ok">{toast}</p>}

      <Composer
        peerName={chat.peer?.name ?? ''}
        onSend={(text, options) => chat.sendMessage(text, options)}
        onTyping={chat.setTyping}
      />

      {picked && (
        <MessageActions
          canRetranslate={picked.senderId === chat.me?.id || picked.translationStatus === 'failed'}
          alreadySaved={savedKeys.has(
            `${picked.id}:${picked.senderId === chat.me?.id ? picked.sourceLang : primaryLang}`,
          )}
          onExplain={() => {
            setExplaining(picked);
            setPicked(null);
          }}
          onSave={() => {
            void save(picked);
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
          onAdded={onVocabAdded}
          onClose={() => setExplaining(null)}
        />
      )}
    </div>
  );
}
