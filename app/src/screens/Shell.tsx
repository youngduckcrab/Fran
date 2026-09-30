import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LangCode, SavedSentence, ThemeId, VocabEntry } from '@fran/shared';
import { useChat } from '../web/useChat';
import { activeUser, fetchPhotos, fetchSaved, fetchVocab } from '../web/api';
import { toUiLang, useT, type UiLang } from '../web/i18n';
import { useWaking } from '../web/waking';
import { useCall } from '../web/call';
import { previewOf } from '../web/preview';
import { plainText } from '../web/text';
import { EMPTY, loadCollections, saveCollections, type Collections } from '../web/collections';
import { loadBubbleView, saveBubbleView, type BubbleView } from '../web/view';
import { useBackClose } from '../backstack';
import { clearDelivered, useKeepPushFresh, useNotificationOpen } from '../push';
import { useAppUpdate } from '../update';
import { useStyles } from '../ui/kit';
import Album from './Album';
import CallLog from './CallLog';
import CallScreen from './CallScreen';
import ChatRoom from './ChatRoom';
import Glossary from './Glossary';
import Home, { type Page } from './Home';
import Library from './Library';
import SavedList from './SavedList';
import Search from './Search';
import Settings from './Settings';
import VocabList from './VocabList';

interface Props {
  token: string;
  onLogout: () => void;
  onUiLang: (lang: UiLang) => void;
  onTheme: (theme: ThemeId | undefined) => void;
  /** 비밀번호를 바꾸면 서버가 새 토큰을 준다. */
  onToken: (token: string) => void;
}

/**
 * 로그인한 뒤의 모든 화면. 대화 연결(useChat)은 여기서 한 번만 잡는다.
 *
 * 화면마다 연결을 새로 잡으면 홈에 다녀올 때마다 대화를 다시 받아오고, 그 사이에
 * 온 메시지를 놓친다. 연결은 위에 두고 화면만 갈아 끼운다.
 */
export default function Shell({ token, onLogout, onUiLang, onTheme, onToken }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const chat = useChat(token, onLogout);
  const waking = useWaking(chat.connection);
  const update = useAppUpdate();
  // 받아쓰기는 내가 실제로 입 밖에 내는 말로 들어야 한다. 화면 언어가 아니라 모국어다.
  const call = useCall(chat.emit, chat.onCallEvent, chat.me?.nativeLang ?? 'ko', chat.me?.id ?? '');
  const [page, setPage] = useState<Page>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  /** 대화를 보면서 여는 보관함. 채팅에서만 연다. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** 보관함에서 "대화에서 보기" 로 고른 메시지. 채팅이 그 자리로 데려다 준다. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** 말풍선에서 원문·번역 중 무엇을 크게 볼지. 화면 전환(page)과는 다른 것이다. */
  const [bubbleView, setBubbleView] = useState<BubbleView>(loadBubbleView);

  useKeepPushFresh();
  // 알림을 누르면 채팅으로. 앱이 꺼져 있다가 그 알림으로 켜진 경우도 여기로 온다.
  useNotificationOpen(useCallback(() => setPage('chat'), []));

  /*
   * 저장한 문장 · 단어장 · 사진첩.
   *
   * 여기서 한 번 받아 나눠 주고, 받은 것은 이 기기에 적어 둔다 — 다음에 열면 기다릴 것
   * 없이 바로 그려진다.
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
  const change = useCallback((next: Collections | ((previous: Collections) => Collections)) => {
    setItems((previous) => {
      const value = typeof next === 'function' ? next(previous) : next;
      saveCollections(activeUser(), value);
      return value;
    });
  }, []);

  useEffect(() => saveCollections(activeUser(), items), [items]);

  // 연결될 때마다 다시 받아온다. 서버가 자고 있었다면 첫 요청은 실패하고, 연결이 이어진 순간이 깨어난 순간이다.
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
    onTheme(chat.me?.theme);
  }, [chat.me?.theme, onTheme]);

  /* ---- 안 읽은 메시지 ---- */

  /** 내가 어디까지 읽었는지는 서버가 기억한다. 폰과 컴퓨터에서 각각 다르게 세지 않는다. */
  const myReadAt = chat.readAt[chat.me?.id ?? ''] ?? 0;
  const unread = chat.messages.filter((message) => message.senderId !== chat.me?.id && message.createdAt > myReadAt).length;

  // 아이콘 숫자는 서버 푸시가 붙여 준다. 앱을 열고 다 읽으면 치운다.
  useEffect(() => {
    if (unread === 0) void clearDelivered();
  }, [unread]);

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
    if (page === 'chat' && AppState.currentState === 'active') return;

    setAlertId(last.id);
    Vibration.vibrate(20);
  }, [chat.messages, chat.me?.id, page]);

  useEffect(() => {
    if (!alertId) return;
    const timer = setTimeout(() => setAlertId(null), 5000);
    return () => clearTimeout(timer);
  }, [alertId]);

  const alerted = alertId ? chat.messages.find((message) => message.id === alertId) : undefined;
  const lastMessage = chat.messages[chat.messages.length - 1];
  const extraLangs = useMemo(() => chat.me?.displayLangs.slice(1) ?? [], [chat.me]);

  const markSaved = useCallback(
    (item: SavedSentence) => change((previous) => ({ ...previous, saved: [item, ...previous.saved] })),
    [change],
  );
  const unmarkSaved = useCallback(
    (id: string) => change((previous) => ({ ...previous, saved: previous.saved.filter((item) => item.id !== id) })),
    [change],
  );
  /** 단어장이 바뀌었을 때(외움 표시, 예문, 지우기). 화면과 적어 둔 것이 함께 움직인다. */
  const setVocab = useCallback((vocab: VocabEntry[]) => change((previous) => ({ ...previous, vocab })), [change]);
  const setSaved = useCallback((saved: SavedSentence[]) => change((previous) => ({ ...previous, saved })), [change]);

  /** 대화의 말풍선용 색인: `<메시지 id>:<언어>` → 저장 항목 id. */
  const savedIds = useMemo(
    () => new Map(items.saved.filter((item) => item.messageId).map((item) => [`${item.messageId}:${item.lang}`, item.id])),
    [items.saved],
  );

  /** 단어장 예문용 색인: 문장 자체로 찾는다(예문에는 메시지가 없다). */
  const savedTexts = useMemo(
    () => new Map(items.saved.map((item) => [`${item.lang}:${plainText(item.text)}`, item.id])),
    [items.saved],
  );

  /**
   * 저장한 문장·단어·사진에서 그 말이 오간 자리로 간다.
   * 보관함이 열려 있었으면 닫는다 — 찾아간 자리를 가리고 있을 이유가 없다.
   */
  const jumpTo = useCallback((messageId: string) => {
    setLibraryOpen(false);
    setSearchOpen(false);
    setPage('chat');
    setFocusId(messageId);
  }, []);

  const clearFocus = useCallback(() => setFocusId(null), []);

  const backHome = useCallback(() => {
    setPage('home');
    void refresh();
  }, [refresh]);

  // 폰의 뒤로가기로 홈에 돌아오고, 열린 창을 닫는다. 앱이 그대로 꺼지지 않도록.
  useBackClose(page !== 'home', backHome);

  const st = useStyles((c) => ({
    banner: {
      position: 'absolute',
      left: 12,
      right: 12,
      zIndex: 30,
      elevation: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    name: { color: c.text, fontWeight: '800' },
    text: { color: c.textMuted },
  }));

  return (
    <View style={{ flex: 1 }}>
      {alerted && (
        <Pressable
          style={[st.banner, { top: insets.top + 8 }]}
          onPress={() => {
            setAlertId(null);
            setPage('chat');
          }}
        >
          <Text style={st.name}>{chat.peer?.name}</Text>
          <Text style={st.text} numberOfLines={2}>
            {previewOf(alerted, primaryLang, t) ?? ''}
          </Text>
        </Pressable>
      )}

      {/* 새 앱이 나왔을 때. 통화 중에는 띄우지 않는다 — 받으러 가면 전화가 끊긴다. */}
      {update.available && call.phase === 'idle' && (
        <Pressable style={[st.banner, { top: insets.top + (alerted ? 88 : 8) }]} onPress={update.open}>
          <Text style={st.name}>{t('update.ready')}</Text>
          <Text style={st.text}>{t('update.apply')}</Text>
        </Pressable>
      )}

      {page === 'home' && (
        <Home
          me={chat.me}
          peer={chat.peer}
          connecting={chat.connection !== 'open'}
          waking={waking}
          peerOnline={chat.peerOnline}
          lastMessage={lastMessage}
          primaryLang={primaryLang}
          unread={unread}
          counts={counts}
          onOpen={setPage}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {page === 'chat' && (
        <ChatRoom
          chat={chat}
          call={call}
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
          onSearch={() => setSearchOpen(true)}
          focusId={focusId}
          onFocused={clearFocus}
        />
      )}

      {page === 'calls' && (
        <CallLog myId={chat.me?.id ?? ''} myName={chat.me?.name ?? ''} peerName={chat.peer?.name ?? ''} onBack={backHome} />
      )}
      {page === 'saved' && <SavedList items={items.saved} onChanged={setSaved} onJump={jumpTo} onBack={backHome} />}
      {page === 'vocab' && (
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
      {page === 'album' && <Album photos={items.photos} onJump={jumpTo} onBack={backHome} me={chat.me} peer={chat.peer} />}

      {searchOpen && <Search me={chat.me} peer={chat.peer} onJump={jumpTo} onClose={() => setSearchOpen(false)} />}

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

      {glossaryOpen && <Glossary entries={chat.glossary} onChanged={chat.setGlossary} onClose={() => setGlossaryOpen(false)} />}

      {settingsOpen && chat.me && (
        <Settings
          profile={chat.me}
          view={bubbleView}
          onChangeView={setBubbleView}
          onSaved={chat.setProfile}
          onTheme={onTheme}
          onClose={() => setSettingsOpen(false)}
          onLogout={onLogout}
          onToken={onToken}
        />
      )}

      {/* 전화가 오면 어느 화면을 보고 있든 덮는다. 받을지 말지가 지금 할 일의 전부다. */}
      <CallScreen
        call={call}
        peerName={chat.peer?.name ?? ''}
        myId={chat.me?.id ?? ''}
        peerId={chat.peer?.id ?? ''}
        messages={chat.messages}
        readingLang={primaryLang}
        onSend={(text) => chat.sendMessage(text)}
      />
    </View>
  );
}
