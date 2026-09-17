import { useCallback, useMemo, useState } from 'react';
import { getToken, rememberedUser, setActiveUser, setToken } from './api';
import ChatRoom from './components/ChatRoom';
import Login from './components/Login';
import { TranslateContext, browserUiLang, createTranslate, type UiLang } from './i18n';

/** 주소가 누구 것인지 알려준다. 예: ?u=fran → Fran 의 앱으로 열린다. */
function presetUserId(): string | undefined {
  return new URLSearchParams(location.search).get('u') ?? undefined;
}

export default function App() {
  // 이 탭이 누구의 앱인지 먼저 정한다. 토큰이 사람마다 따로 저장되기 때문이다.
  const [userId] = useState<string | null>(() => {
    const chosen = presetUserId() ?? rememberedUser();
    setActiveUser(chosen);
    return chosen;
  });
  const [token, setTokenState] = useState<string | null>(() => getToken(userId));
  const [uiLang, setUiLang] = useState<UiLang>(browserUiLang);
  const t = useMemo(() => createTranslate(uiLang), [uiLang]);

  const handleLogin = useCallback((next: string, who: string) => {
    setActiveUser(who);
    setToken(next, who);
    setTokenState(next);
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setTokenState(null);
  }, []);

  return (
    <TranslateContext.Provider value={t}>
      {token ? (
        <ChatRoom token={token} onLogout={handleLogout} onUiLang={setUiLang} />
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
