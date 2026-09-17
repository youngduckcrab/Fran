import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage, LangCode } from '@fran/shared';
import type { Chat } from '../useChat';
import { useT } from '../i18n';
import Icon from './Icon';
import { useBackClose } from '../backstack';
import { useSpeaker } from '../speech';
import { wallpaperProps } from '../wallpaper';
import Explanation from './Explanation';
import MessageActions from './MessageActions';
import MessageBubble from './MessageBubble';
import SaveSheet from './SaveSheet';
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
  /** 지금 답하고 있는 메시지. 밀거나 메뉴에서 고른다. */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** 저장할 문장을 고르는 창. 어떤 메시지를 놓고 고르는 중인지. */
  const [saving, setSaving] = useState<ChatMessage | null>(null);
  const speaker = useSpeaker();

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages, chat.peerTyping]);

  /** 상대가 실제로 읽는 언어. 내 메시지가 어떻게 갔는지 보여줄 때 쓴다. */
  const peerLang: LangCode = chat.peer?.displayLangs[0] ?? chat.peer?.nativeLang ?? 'es';

  const byId = new Map(chat.messages.map((message) => [message.id, message]));
  useBackClose(Boolean(picked), () => setPicked(null));
  useBackClose(Boolean(saving), () => setSaving(null));
  useBackClose(Boolean(explaining), () => setExplaining(null));
  useBackClose(Boolean(replyTo), () => setReplyTo(null));

  const wall = wallpaperProps(chat.me?.wallpaper);

  return (
    <div className={`chat ${wall.className}`} style={wall.style}>
      <header className="chat__header">
        <button type="button" className="chat__back" onClick={onBack} aria-label={t('home.back')}>
          <Icon name="back" size={22} />
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
            onReply={setReplyTo}
            {...(message.replyTo && byId.has(message.replyTo)
              ? { repliedTo: byId.get(message.replyTo) as ChatMessage }
              : {})}
            myId={chat.me?.id ?? ''}
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
        onSend={(text, options) => {
          chat.sendMessage(text, {
            ...options,
            ...(replyTo ? { replyTo: replyTo.id } : {}),
          });
          setReplyTo(null);
        }}
        onTyping={chat.setTyping}
        replyTo={replyTo}
        replyName={
          replyTo ? (replyTo.senderId === chat.me?.id ? (chat.me?.name ?? '') : (chat.peer?.name ?? '')) : ''
        }
        onCancelReply={() => setReplyTo(null)}
      />

      {picked && (
        <MessageActions
          canRetranslate={picked.senderId === chat.me?.id || picked.translationStatus === 'failed'}
          myReaction={picked.reactions?.[chat.me?.id ?? ''] ?? null}
          onReact={(emoji) => {
            chat.react(picked.id, emoji);
            setPicked(null);
          }}
          onReply={() => {
            setReplyTo(picked);
            setPicked(null);
          }}
          onExplain={() => {
            setExplaining(picked);
            setPicked(null);
          }}
          onSave={() => {
            setSaving(picked);
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

      {saving && (
        <SaveSheet
          message={saving}
          primaryLang={primaryLang}
          savedKeys={savedKeys}
          onSaved={(key) => {
            onSaved(key);
            setToast(t('actions.saved'));
            setTimeout(() => setToast(null), 1600);
          }}
          onClose={() => setSaving(null)}
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
