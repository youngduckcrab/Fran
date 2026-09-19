import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { messageText, type ChatMessage, type LangCode, type SavedSentence } from '@fran/shared';
import type { Chat } from '../useChat';
import { useT } from '../i18n';
import Icon from './Icon';
import { useBackClose } from '../backstack';
import { clearDelivered } from '../notifications';
import { useSpeaker } from '../speech';
import { wallpaperProps } from '../wallpaper';
import type { BubbleView } from '../view';
import Explanation from './Explanation';
import MessageActions from './MessageActions';
import MessageBubble from './MessageBubble';
import PhotoViewer from './PhotoViewer';
import SaveSheet from './SaveSheet';
import WordPicker from './WordPicker';
import Composer from './Composer';

interface Props {
  chat: Chat;
  primaryLang: LangCode;
  extraLangs: LangCode[];
  view: BubbleView;
  /** 이미 저장한 문장들. `<메시지 id>:<언어>` → 저장 항목 id. */
  savedIds: Map<string, string>;
  onSaved: (item: SavedSentence) => void;
  onUnsaved: (id: string) => void;
  onVocabAdded: () => void;
  onBack: () => void;
  onGlossary: () => void;
  onSettings: () => void;
}

export default function ChatRoom({
  chat,
  primaryLang,
  extraLangs,
  view,
  savedIds,
  onSaved,
  onUnsaved,
  onVocabAdded,
  onBack,
  onGlossary,
  onSettings,
}: Props) {
  const t = useT();
  /** 길게 눌러 고른 메시지. 메뉴와 설명 패널이 이걸 본다. */
  const [picked, setPicked] = useState<ChatMessage | null>(null);
  const [explaining, setExplaining] = useState<ChatMessage | null>(null);
  /** 단어를 하나씩 눌러 보고 있는 메시지. */
  const [picking, setPicking] = useState<ChatMessage | null>(null);
  /**
   * 잠깐 떴다 사라지는 한 줄. 값과 함께 시각을 들고 있어야 같은 문구가 연달아 떠도
   * 다시 보이고, 앞의 것이 남긴 타이머가 뒤의 것을 지우지 않는다.
   */
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const say = (text: string) => setToast({ text, at: Date.now() });
  /** 지금 답하고 있는 메시지. 밀거나 메뉴에서 고른다. */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** 저장할 문장을 고르는 창. 어떤 메시지를 놓고 고르는 중인지. */
  const [saving, setSaving] = useState<ChatMessage | null>(null);
  /** 크게 보고 있는 사진. */
  const [photo, setPhoto] = useState<string | null>(null);
  /** 고치고 있는 내 메시지. */
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const speaker = useSpeaker();

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  /**
   * 옛 대화를 위에 붙이기 직전의 스크롤 자리.
   *
   * 위에 말풍선이 더 생기면 보고 있던 것이 아래로 밀려난다. 붙인 만큼 내려 줘야
   * 읽던 자리에 그대로 남는다.
   */
  const pinned = useRef<{ height: number; top: number } | null>(null);
  /** 맨 아래를 보고 있는지. 옛 대화를 읽는 중이면 새 메시지가 와도 끌어내리지 않는다. */
  const atBottom = useRef(true);
  /** 직전에 맨 위·맨 아래에 있던 말풍선. 어느 쪽이 늘었는지로 무엇을 할지 정한다. */
  const edges = useRef<{ first: string | null; last: string | null }>({ first: null, last: null });

  const firstId = chat.messages[0]?.id ?? null;
  const lastId = chat.messages[chat.messages.length - 1]?.id ?? null;
  const lastIsMine = chat.messages[chat.messages.length - 1]?.senderId === chat.me?.id;

  useLayoutEffect(() => {
    const list = listRef.current;
    const grewAtTop = firstId !== edges.current.first;
    const grewAtBottom = lastId !== edges.current.last;
    const firstRender = edges.current.last === null;
    edges.current = { first: firstId, last: lastId };

    // 위에만 늘었다 = 옛 대화를 붙였다. 보던 말풍선이 제자리에 남도록 그만큼 내린다.
    if (grewAtTop && !grewAtBottom && pinned.current && list) {
      const { top, height } = pinned.current;
      pinned.current = null;
      const keepPlace = () => {
        list.scrollTop = top + (list.scrollHeight - height);
      };
      keepPlace();
      // 사진과 음성은 한 박자 늦게 자리를 잡는다. 다음 프레임에 한 번 더 맞춘다.
      requestAnimationFrame(keepPlace);
      return;
    }
    pinned.current = null;

    // 옛 대화를 읽는 중인데 새 메시지가 왔다고 끌어내리지 않는다. 내가 보낸 것은 예외다.
    if (firstRender || atBottom.current || (grewAtBottom && lastIsMine)) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      atBottom.current = true;
    }
  }, [chat.messages, chat.peerTyping, firstId, lastId, lastIsMine]);

  /*
   * 맨 위 가까이 올라가면 그보다 옛날 대화를 가져온다.
   * 끝에 닿고 나서가 아니라 조금 못 미쳤을 때 부른다 — 도착했을 때 이미 와 있어야
   * 스크롤이 끊기지 않는다.
   */
  const { loadOlder, hasOlder } = chat;
  const showOlder = () => {
    const list = listRef.current;
    // 이미 잡아 둔 자리가 있으면 가져오는 중이다. 덮어쓰면 붙인 뒤 엉뚱한 데로 간다.
    if (!list || pinned.current || !hasOlder) return;
    pinned.current = { height: list.scrollHeight, top: list.scrollTop };
    void loadOlder();
  };

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (list.scrollTop <= 300) showOlder();
  };

  /**
   * 대화를 보고 있으면 읽은 것으로 친다.
   *
   * 화면이 떠 있어도 폰을 주머니에 넣어 둔 상태(가려진 탭)에서는 읽었다고 하지 않는다.
   * 다시 앱으로 돌아오면 그때 표시한다.
   */
  const newest = chat.messages[chat.messages.length - 1]?.createdAt ?? 0;
  const { markRead } = chat;

  useEffect(() => {
    if (!newest) return;
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      markRead(newest);
      // 여기까지 읽었으니 폰에 쌓여 있던 알림도 치운다. 채팅을 연 지금이 그 순간이다.
      void clearDelivered();
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [newest, markRead]);

  /** 상대가 실제로 읽는 언어. 내 메시지가 어떻게 갔는지 보여줄 때 쓴다. */
  const peerLang: LangCode = chat.peer?.displayLangs[0] ?? chat.peer?.nativeLang ?? 'es';

  /** 공부하는 언어 쪽 문장을 먼저 펴 준다. 내 언어로 쓴 글이면 배우는 언어의 번역을. */
  const studyLangOf = (message: ChatMessage): LangCode =>
    message.sourceLang !== primaryLang ? message.sourceLang : (extraLangs[0] ?? primaryLang);

  const byId = new Map(chat.messages.map((message) => [message.id, message]));
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useBackClose(Boolean(picked), () => setPicked(null));
  useBackClose(Boolean(saving), () => setSaving(null));
  useBackClose(Boolean(explaining), () => setExplaining(null));
  useBackClose(Boolean(replyTo), () => setReplyTo(null));
  useBackClose(Boolean(editing), () => setEditing(null));

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

      <ul className="chat__messages" ref={listRef} onScroll={onScroll}>
        {/* 맨 위. 더 있으면 가져오는 중이라고, 없으면 여기가 처음이라고 알려준다. */}
        {chat.messages.length > 0 && (
          <li className="chat__older">
            {chat.loadingOlder ? (
              t('chat.loadingOlder')
            ) : chat.hasOlder ? (
              <button type="button" className="chat__olderButton" onClick={() => void loadOlder()}>
                {t('chat.loadOlder')}
              </button>
            ) : (
              t('chat.beginning')
            )}
          </li>
        )}

        {chat.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            mine={message.senderId === chat.me?.id}
            primaryLang={message.senderId === chat.me?.id ? message.sourceLang : primaryLang}
            extraLangs={extraLangs}
            peerLang={peerLang}
            peerName={chat.peer?.name ?? ''}
            view={view}
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
            readByPeer={(chat.readAt[chat.peer?.id ?? ''] ?? 0) >= message.createdAt}
            onOpenPhoto={setPhoto}
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
      {toast && <p className="chat__toast chat__toast--ok">{toast.text}</p>}

      <Composer
        peerName={chat.peer?.name ?? ''}
        editing={editing}
        onEdit={(messageId, text) => {
          chat.editMessage(messageId, text);
          say(t('edit.saved'));
        }}
        onCancelEdit={() => setEditing(null)}
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
          canPickWord={Boolean(messageText(picked))}
          canEdit={picked.senderId === chat.me?.id && Boolean(messageText(picked))}
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
          onPickWord={() => {
            setPicking(picked);
            setPicked(null);
          }}
          onEdit={() => {
            setEditing(picked);
            setReplyTo(null);
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

      {photo && (
        <PhotoViewer attachmentId={photo} onClose={() => setPhoto(null)} />
      )}

      {saving && (
        <SaveSheet
          message={saving}
          primaryLang={primaryLang}
          savedIds={savedIds}
          onSaved={(item) => {
            onSaved(item);
            say(t('actions.saved'));
          }}
          onUnsaved={(id) => {
            onUnsaved(id);
            say(t('save.removed'));
          }}
          onClose={() => setSaving(null)}
        />
      )}

      {picking && (
        <WordPicker
          message={picking}
          initialLang={studyLangOf(picking)}
          extraLangs={extraLangs}
          onAdded={onVocabAdded}
          onClose={() => setPicking(null)}
        />
      )}

      {explaining && (
        <Explanation
          message={explaining}
          initialLang={studyLangOf(explaining)}
          onAdded={onVocabAdded}
          onClose={() => setExplaining(null)}
        />
      )}
    </div>
  );
}
