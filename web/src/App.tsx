import { useCallback, useEffect, useMemo, useState } from 'react';
import { getToken, rememberedUser, setActiveUser, setToken } from './api';
import { clearChat } from './cache';
import { clearCollections } from './collections';
import Shell from './components/Shell';
import Login from './components/Login';
import { TranslateContext, browserUiLang, createTranslate, type UiLang } from './i18n';

/** 주소가 누구 것인지 알려준다. 예: ?u=fran → Fran 의 앱으로 열린다. */
function presetUserId(): string | undefined {
  return new URLSearchParams(location.search).get('u') ?? undefined;
}

/**
 * 설치할 때 쓰는 매니페스트를 이 사람 것으로 바꾼다. 그래야 홈 화면의 아이콘이
 * 자기 주소로 열리고, 이름도 상대 이름으로 붙는다.
 */
function useOwnManifest(userId: string | null): void {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = userId ? `/manifest.webmanifest?u=${encodeURIComponent(userId)}` : '/manifest.webmanifest';
  }, [userId]);
}

export default function App() {
  // 이 탭이 누구의 앱인지 먼저 정한다. 토큰이 사람마다 따로 저장되기 때문이다.
  const [userId] = useState<string | null>(() => {
    const chosen = presetUserId() ?? rememberedUser();
    setActiveUser(chosen);
    return chosen;
  });
  const [token, setTokenState] = useState<string | null>(() => getToken(userId));
  useOwnManifest(userId);
  const [uiLang, setUiLang] = useState<UiLang>(browserUiLang);
  const t = useMemo(() => createTranslate(uiLang), [uiLang]);

  const handleLogin = useCallback((next: string, who: string) => {
    setActiveUser(who);
    setToken(next, who);
    setTokenState(next);
  }, []);

  const handleLogout = useCallback(() => {
    // 적어 둔 대화와 보관함도 함께 지운다. 나간 사람의 것을 남겨 둘 이유가 없다.
    clearChat(userId);
    clearCollections(userId);
    setToken(null);
    setTokenState(null);
  }, [userId]);

  return (
    <TranslateContext.Provider value={t}>
      {token ? (
        <Shell
          token={token}
          onLogout={handleLogout}
          onUiLang={setUiLang}
          onToken={(next) => {
            // 비밀번호를 바꾸면 서버가 새 토큰을 준다. 갈아 끼워야 이 기기가 로그인을 유지한다.
            setToken(next, userId);
            setTokenState(next);
          }}
        />
      ) : (
        <Login
          onLogin={handleLogin}
          presetUserId={userId ?? undefined}
          uiLang={uiLang}
          onUiLang={setUiLang}
        />
      )}
    </TranslateContext.Provider>
  );
}
