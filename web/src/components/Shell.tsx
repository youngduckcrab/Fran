import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LangCode, SavedSentence, VocabEntry } from '@fran/shared';
import { useChat } from '../useChat';
import { activeUser, fetchPhotos, fetchSaved, fetchVocab } from '../api';
import { toUiLang, useT, type UiLang } from '../i18n';
import { previewOf } from '../preview';
import { plainText } from '../text';
import { useBackClose } from '../backstack';
import { applyTheme } from '../theme';
import Album from './Album';
import ChatRoom from './ChatRoom';
import Glossary from './Glossary';
import Home, { type View } from './Home';
import SavedList from './SavedList';
import Settings from './Settings';
import Library from './Library';
import { EMPTY, loadCollections, saveCollections, type Collections } from '../collections';
import { loadBubbleView, saveBubbleView, type BubbleView } from '../view';
import VocabList from './VocabList';

interface Props {
  token: string;
  onLogout: () => void;
  onUiLang: (lang: UiLang) => void;
  /** 비밀번호를 바꾸면 서버가 새 토큰을 준다. */
  onToken: (token: string) => void;
}

/**
 * 로그인한 뒤의 모든 화면. 대화 연결(useChat)은 여기서 한 번만 잡는다.
 *
 * 화면마다 연결을 새로 잡으면 홈에 다녀올 때마다 대화를 다시 받아오고, 그 사이에
 * 온 메시지를 놓친다. 연결은 위에 두고 화면만 갈아 끼운다.
 */
export default function Shell({ token, onLogout, onUiLang, onToken }: Props) {
  const t = useT();
  const chat = useChat(token, onLogout);
  const [view, setView] = useState<View>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  /** 대화를 보면서 여는 보관함. 채팅에서만 연다. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** 보관함에서 "대화에서 보기" 로 고른 메시지. 채팅이 그 자리로 데려다 준다. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** 말풍선에서 원문·번역 중 무엇을 크게 볼지. 화면 전환(view)과는 다른 것이다. */
  const [bubbleView, setBubbleView] = useState<BubbleView>(loadBubbleView);

  /*
   * 저장한 문장 · 단어장 · 사진첩.
   *
   * 예전에는 화면마다 자기 것을 따로 받아왔다. 그래서 단어장을 열면 빈 화면이 잠깐
   * 있다가 목록이 나타났고, 홈의 숫자도 늦게 붙었다. 여기서 한 번 받아 나눠 주고,
   * 받은 것은 이 기기에 적어 둔다 — 다음에 열면 기다릴 것 없이 바로 그려진다.
   */
  const [items, setItems] = useState<Collections>(() => loadCollections(activeUser()) ?? EMPTY);
  const counts = useMemo(
    () => ({ saved: items.saved.length, vocab: items.vocab.length, photos: items.photos.length }),
    [items],
  );

  const refresh = useCallback(async () => {
    try {
      const [saved, vocab, photos] = await Promise.all([fetchSaved(), fetchVocab(), fetchPhotos()]);
      setItems({ saved, vocab, photos });
    } catch {
      // 못 받아와도 적어 둔 것이 그대로 보인다. 다음 연결 때 다시 받는다.
    }
  }, []);

  /** 바뀐 것을 적어 둔다. 지우거나 담을 때마다 화면과 기록이 함께 움직인다. */
  const update = useCallback((next: Collections | ((previous: Collections) => Collections)) => {
    setItems((previous) => {
      const value = typeof next === 'function' ? next(previous) : next;
      saveCollections(activeUser(), value);
      return value;
    });
  }, []);

  useEffect(() => saveCollections(activeUser(), items), [items]);

  /*
   * 연결될 때마다 다시 받아온다.
   *
   * 화면이 뜨자마자 한 번 물어보는데, 서버가 자고 있었다면 그 요청은 그냥 실패한다.
   * 연결이 이어진 순간이 서버가 깨어난 순간이다.
   */
  useEffect(() => {
    if (chat.connection !== 'open') return;
    void refresh();
  }, [chat.connection, refresh]);

  useEffect(() => saveBubbleView(bubbleView), [bubbleView]);

  const primaryLang: LangCode = chat.me?.displayLangs[0] ?? chat.me?.nativeLang ?? 'ko';

  useEffect(() => {
    if (chat.me) onUiLang(toUiLang(primaryLang));
  }, [chat.me, primaryLang, onUiLang]);

  // 고른 색을 화면에 입힌다. 서버에서 오기 전까지는 마지막으로 쓰던 색이 이미 입혀져 있다.
  useEffect(() => {
    applyTheme(chat.me?.theme);
  }, [chat.me?.theme]);

  // iOS 는 홈 화면에 추가할 때 문서 제목을 쓴다. 상대 이름으로 두면 아이콘이 그 사람이 된다.
  useEffect(() => {
    if (chat.peer) document.title = chat.peer.name;
  }, [chat.peer]);

  /* ---- 안 읽은 메시지 ---- */

  /**
   * 내가 어디까지 읽었는지는 서버가 기억한다. 화면에서 세던 때는 앱을 껐다 켜면
   * 숫자가 사라졌고, 폰과 컴퓨터에서 각각 다르게 셌다.
   */
  const myReadAt = chat.readAt[chat.me?.id ?? ''] ?? 0;
  const unread = chat.messages.filter(
    (message) => message.senderId !== chat.me?.id && message.createdAt > myReadAt,
  ).length;

  /* ---- 화면 안 알림 ---- */

  /**
   * 채팅을 보고 있지 않을 때 메시지가 오면 위에 한 줄 띄운다.
   *
   * 앱이 켜져 있으면 폰 알림은 가지 않는다(두 번 울릴 이유가 없다). 대신 여기서 알린다.
   * 번역이 늦게 붙으므로 메시지 자체가 아니라 id 만 들고 있다가 그때그때 다시 읽는다.
   */
  const [alertId, setAlertId] = useState<string | null>(null);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!last) return;

    const previous = lastSeen.current;
    lastSeen.current = last.id;
    // 처음 받아온 지난 대화는 새로 온 것이 아니다.
    if (previous === null || previous === last.id) return;
    if (last.senderId === chat.me?.id) return;
    if (view === 'chat' && document.visibilityState === 'visible') return;

    setAlertId(last.id);
    // 안드로이드는 짧게 떨어 준다. 지원하지 않으면 아무 일도 없다.
    navigator.vibrate?.(20);
  }, [chat.messages, chat.me?.id, view]);

  useEffect(() => {
    if (!alertId) return;
    const timer = setTimeout(() => setAlertId(null), 5000);
    return () => clearTimeout(timer);
  }, [alertId]);

  const alerted = alertId ? chat.messages.find((message) => message.id === alertId) : undefined;

  /**
   * 알림을 눌렀을 때. 앱이 이미 그 사람으로 열려 있으면 새로 고치지 않고
   * 서비스 워커가 여기로 알려 준다. 그 말을 듣고 채팅으로 넘어간다.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'open-chat') setView('chat');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // 홈 화면 아이콘에도 숫자를 붙인다(지원하는 기기에서만).
  useEffect(() => {
    const badge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!badge.setAppBadge) return;
    const done =
      unread > 0 ? badge.setAppBadge(unread) : (badge.clearAppBadge?.() ?? Promise.resolve());
    void done.catch(() => undefined);
  }, [unread]);

  const lastMessage = chat.messages[chat.messages.length - 1];
  const extraLangs = useMemo(() => chat.me?.displayLangs.slice(1) ?? [], [chat.me]);

  const markSaved = useCallback(
    (item: SavedSentence) => update((previous) => ({ ...previous, saved: [item, ...previous.saved] })),
    [update],
  );

  const unmarkSaved = useCallback(
    (id: string) =>
      update((previous) => ({ ...previous, saved: previous.saved.filter((item) => item.id !== id) })),
    [update],
  );

  /** 단어장이 바뀌었을 때(외움 표시, 예문, 지우기). 화면과 적어 둔 것이 함께 움직인다. */
  const setVocab = useCallback(
    (vocab: VocabEntry[]) => update((previous) => ({ ...previous, vocab })),
    [update],
  );

  const setSaved = useCallback(
    (saved: SavedSentence[]) => update((previous) => ({ ...previous, saved })),
    [update],
  );

  /** 대화의 말풍선용 색인: `<메시지 id>:<언어>` → 저장 항목 id. */
  const savedIds = useMemo(
    () =>
      new Map(
        items.saved
          .filter((item) => item.messageId)
          .map((item) => [`${item.messageId}:${item.lang}`, item.id]),
      ),
    [items.saved],
  );

  /** 단어장 예문용 색인: 문장 자체로 찾는다(예문에는 메시지가 없다). */
  const savedTexts = useMemo(
    () => new Map(items.saved.map((item) => [`${item.lang}:${plainText(item.text)}`, item.id])),
    [items.saved],
  );

  /**
   * 저장한 문장·단어·사진에서 그 말이 오간 자리로 간다.
   *
   * 어떤 얘기 끝에 나온 말인지, 언제 한 말인지는 보관함의 카드만 봐서는 알 수 없다.
   * 채팅으로 넘기고 그 말풍선을 찾아가게 한다. 보관함이 열려 있었으면 닫는다 —
   * 찾아간 자리를 가리고 있을 이유가 없다.
   */
  const jumpTo = useCallback((messageId: string) => {
    setLibraryOpen(false);
    setView('chat');
    setFocusId(messageId);
  }, []);

  const clearFocus = useCallback(() => setFocusId(null), []);

  const backHome = useCallback(() => {
    setView('home');
    void refresh();
  }, [refresh]);

  // 폰의 뒤로가기로 홈에 돌아오고, 열린 창을 닫는다. 앱이 그대로 꺼지지 않도록.
  useBackClose(view !== 'home', backHome);
  useBackClose(settingsOpen, () => setSettingsOpen(false));
  useBackClose(glossaryOpen, () => setGlossaryOpen(false));

  return (
    <>
      {alerted && (
        <button
          type="button"
          className="alert"
          onClick={() => {
            setAlertId(null);
            setView('chat');
          }}
        >
          <span className="alert__name">{chat.peer?.name}</span>
          <span className="alert__text">{previewOf(alerted, primaryLang, t) ?? ''}</span>
        </button>
      )}

      {view === 'home' && (
        <Home
          me={chat.me}
          peer={chat.peer}
          connecting={chat.connection !== 'open'}
          peerOnline={chat.peerOnline}
          lastMessage={lastMessage}
          primaryLang={primaryLang}
          unread={unread}
          counts={counts}
          onOpen={setView}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {view === 'chat' && (
        <ChatRoom
          chat={chat}
          primaryLang={primaryLang}
          extraLangs={extraLangs}
          view={bubbleView}
          savedIds={savedIds}
          onSaved={markSaved}
          onUnsaved={unmarkSaved}
          onVocabAdded={() => void refresh()}
          onBack={backHome}
          onGlossary={() => setGlossaryOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onLibrary={() => setLibraryOpen(true)}
          focusId={focusId}
          onFocused={clearFocus}
        />
      )}

      {view === 'saved' && (
        <SavedList items={items.saved} onChanged={setSaved} onJump={jumpTo} onBack={backHome} />
      )}
      {view === 'vocab' && (
        <VocabList
          onBack={backHome}
          entries={items.vocab}
          onChanged={setVocab}
          onJump={jumpTo}
          primaryLang={primaryLang}
          savedTexts={savedTexts}
          onSaved={markSaved}
          onUnsaved={unmarkSaved}
        />
      )}
      {view === 'album' && (
        <Album photos={items.photos} onJump={jumpTo} onBack={backHome} me={chat.me} peer={chat.peer} />
      )}

      {libraryOpen && (
        <Library
          saved={items.saved}
          vocab={items.vocab}
          photos={items.photos}
          onSavedChanged={setSaved}
          onVocabChanged={setVocab}
          onJump={jumpTo}
          primaryLang={primaryLang}
          savedTexts={savedTexts}
          onSaved={markSaved}
          onUnsaved={unmarkSaved}
          me={chat.me}
          peer={chat.peer}
          onClose={() => setLibraryOpen(false)}
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
          view={bubbleView}
          onChangeView={setBubbleView}
          onSaved={chat.setProfile}
          onClose={() => setSettingsOpen(false)}
          onLogout={onLogout}
          onToken={onToken}
        />
      )}
    </>
  );
}
