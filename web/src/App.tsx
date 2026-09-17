import { useCallback, useMemo, useState } from 'react';
import { getToken, setToken } from './api';
import ChatRoom from './components/ChatRoom';
import Login from './components/Login';
import { TranslateContext, browserUiLang, createTranslate, type UiLang } from './i18n';

/** 주소가 누구 것인지 알려준다. 예: ?u=fran → Fran 의 앱으로 열린다. */
function presetUserId(): string | undefined {
  return new URLSearchParams(location.search).get('u') ?? undefined;
}

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [uiLang, setUiLang] = useState<UiLang>(browserUiLang);
  const t = useMemo(() => createTranslate(uiLang), [uiLang]);

  const handleLogin = useCallback((next: string) => {
    setToken(next);
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
          presetUserId={presetUserId()}
          uiLang={uiLang}
          onUiLang={setUiLang}
        />
      )}
    </TranslateContext.Provider>
  );
}
