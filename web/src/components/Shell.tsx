import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LangCode } from '@fran/shared';
import { useChat } from '../useChat';
import { fetchPhotos, fetchSaved, fetchVocab } from '../api';
import { toUiLang, type UiLang } from '../i18n';
import { useBackClose } from '../backstack';
import { applyTheme } from '../theme';
import Album from './Album';
import ChatRoom from './ChatRoom';
import Glossary from './Glossary';
import Home, { type View } from './Home';
import SavedList from './SavedList';
import Settings from './Settings';
import VocabList from './VocabList';

interface Props {
  token: string;
  onLogout: () => void;
  onUiLang: (lang: UiLang) => void;
  /** 비밀번호를 바꾸면 서버가 새 토큰을 준다. */
  onToken: (token: string) => void;
}

const SOURCE_PREF_KEY = 'fran.alwaysShowSource';

/**
 * 로그인한 뒤의 모든 화면. 대화 연결(useChat)은 여기서 한 번만 잡는다.
 *
 * 화면마다 연결을 새로 잡으면 홈에 다녀올 때마다 대화를 다시 받아오고, 그 사이에
 * 온 메시지를 놓친다. 연결은 위에 두고 화면만 갈아 끼운다.
 */
export default function Shell({ token, onLogout, onUiLang, onToken }: Props) {
  const chat = useChat(token, onLogout);
  const [view, setView] = useState<View>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [alwaysShowSource, setAlwaysShowSource] = useState(
    () => localStorage.getItem(SOURCE_PREF_KEY) === '1',
  );

  /** 모아 보기 화면들의 개수. 홈에 숫자를 띄우고, 저장할 때마다 다시 센다. */
  const [counts, setCounts] = useState({ saved: 0, vocab: 0, photos: 0 });
  /** 이미 저장해 둔 문장. `<메시지 id>:<언어>` 형태. */
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const refreshCounts = useCallback(async () => {
    try {
      const [saved, vocab, photos] = await Promise.all([fetchSaved(), fetchVocab(), fetchPhotos()]);
      setCounts({ saved: saved.items.length, vocab: vocab.length, photos: photos.length });
      setSavedKeys(new Set(saved.keys));
    } catch {
      // 숫자는 있으면 좋은 것일 뿐이다. 실패해도 대화에는 영향이 없다.
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    localStorage.setItem(SOURCE_PREF_KEY, alwaysShowSource ? '1' : '0');
  }, [alwaysShowSource]);

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

  const markSaved = useCallback((key: string) => {
    setSavedKeys((previous) => new Set(previous).add(key));
    setCounts((previous) => ({ ...previous, saved: previous.saved + 1 }));
  }, []);

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
          alwaysShowSource={alwaysShowSource}
          savedKeys={savedKeys}
          onSaved={markSaved}
          onVocabAdded={() => setCounts((p) => ({ ...p, vocab: p.vocab + 1 }))}
          onBack={backHome}
          onGlossary={() => setGlossaryOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}

      {view === 'saved' && <SavedList onBack={backHome} />}
      {view === 'vocab' && <VocabList onBack={backHome} />}
      {view === 'album' && (
        <Album
          onBack={backHome}
          me={chat.me}
          peer={chat.peer}
          onWallpaper={chat.setProfile}
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
          onToken={onToken}
        />
      )}
    </>
  );
}
