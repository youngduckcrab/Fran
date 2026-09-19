import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LangCode, SavedSentence } from '@fran/shared';
import { useChat } from '../useChat';
import { fetchPhotos, fetchSaved, fetchVocab } from '../api';
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
  /** 말풍선에서 원문·번역 중 무엇을 크게 볼지. 화면 전환(view)과는 다른 것이다. */
  const [bubbleView, setBubbleView] = useState<BubbleView>(loadBubbleView);

  /** 모아 보기 화면들의 개수. 홈에 숫자를 띄우고, 저장할 때마다 다시 센다. */
  const [counts, setCounts] = useState({ saved: 0, vocab: 0, photos: 0 });
/** 저장한 문장 목록. 화면마다 필요한 색인은 여기서 만든다. */
  const [savedItems, setSavedItems] = useState<SavedSentence[]>([]);

  const refreshCounts = useCallback(async () => {
    try {
      const [saved, vocab, photos] = await Promise.all([fetchSaved(), fetchVocab(), fetchPhotos()]);
      setCounts({ saved: saved.length, vocab: vocab.length, photos: photos.length });
      setSavedItems(saved);
    } catch {
      // 숫자는 있으면 좋은 것일 뿐이다. 실패해도 대화에는 영향이 없다.
    }
  }, []);

  /*
   * 연결될 때마다 다시 센다.
   *
   * 화면이 뜨자마자 한 번 물어보는데, 서버가 자고 있었다면 그 요청은 그냥 실패한다.
   * 그러면 홈의 숫자가 0 인 채로 남는다. 연결이 이어진 순간이 서버가 깨어난 순간이다.
   */
  useEffect(() => {
    if (chat.connection !== 'open') return;
    void refreshCounts();
  }, [chat.connection, refreshCounts]);

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

  const markSaved = useCallback((item: SavedSentence) => {
    setSavedItems((previous) => [item, ...previous]);
    setCounts((previous) => ({ ...previous, saved: previous.saved + 1 }));
  }, []);

  const unmarkSaved = useCallback((id: string) => {
    setSavedItems((previous) => previous.filter((item) => item.id !== id));
    setCounts((previous) => ({ ...previous, saved: Math.max(0, previous.saved - 1) }));
  }, []);

  /** 대화의 말풍선용 색인: `<메시지 id>:<언어>` → 저장 항목 id. */
  const savedIds = useMemo(
    () =>
      new Map(
        savedItems
          .filter((item) => item.messageId)
          .map((item) => [`${item.messageId}:${item.lang}`, item.id]),
      ),
    [savedItems],
  );

  /** 단어장 예문용 색인: 문장 자체로 찾는다(예문에는 메시지가 없다). */
  const savedTexts = useMemo(
    () => new Map(savedItems.map((item) => [`${item.lang}:${plainText(item.text)}`, item.id])),
    [savedItems],
  );

  const backHome = useCallback(() => {
    setView('home');
    void refreshCounts();
  }, [refreshCounts]);

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
          onVocabAdded={() => setCounts((p) => ({ ...p, vocab: p.vocab + 1 }))}
          onBack={backHome}
          onGlossary={() => setGlossaryOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {view === 'saved' && <SavedList onBack={backHome} />}
      {view === 'vocab' && (
        <VocabList
          onBack={backHome}
          primaryLang={primaryLang}
          savedTexts={savedTexts}
          onSaved={markSaved}
          onUnsaved={unmarkSaved}
        />
      )}
      {view === 'album' && (
        <Album onBack={backHome} me={chat.me} peer={chat.peer} />
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
