import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { ThemeId } from '@fran/shared';
import { preloadStorage } from './shims';
import { getToken, rememberedUser, setActiveUser, setToken } from './web/api';
import { clearChat } from './web/cache';
import { clearCollections } from './web/collections';
import { LangContext, TranslateContext, createTranslate, type UiLang } from './web/i18n';
import { applyTheme, remembered } from './web/theme';
import { PaletteProvider, makePalette } from './theme';
import Login from './screens/Login';
import Shell from './screens/Shell';

/** 로그인 전에는 사용자를 모르므로 폰 설정의 언어를 본다. */
function phoneUiLang(): UiLang {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase();
    if (tag === 'ko' || tag === 'es' || tag === 'en') return tag;
  } catch {
    // Intl 을 못 쓰는 환경. 영어로.
  }
  return 'en';
}

export default function App() {
  // 저장해 둔 것(토큰, 마지막 대화)을 메모리로 올린 뒤에야 그린다.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void preloadStorage().then(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      {ready ? (
        <Root />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: makePalette('rose', true).bg }}>
          <ActivityIndicator color={makePalette('rose', true).accent} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

function Root() {
  // 토큰이 사람마다 따로 저장되므로 누구의 앱인지부터 정한다.
  const [userId] = useState<string | null>(() => {
    const chosen = rememberedUser();
    setActiveUser(chosen);
    return chosen;
  });
  const [token, setTokenState] = useState<string | null>(() => getToken(userId));
  const [uiLang, setUiLang] = useState<UiLang>(phoneUiLang);
  const [theme, setTheme] = useState<ThemeId>(remembered);
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

  const chooseTheme = useCallback((next: ThemeId | undefined) => {
    applyTheme(next);
    setTheme(next ?? remembered());
  }, []);

  return (
    <PaletteProvider theme={theme}>
      <LangContext.Provider value={uiLang}>
        <TranslateContext.Provider value={t}>
          <StatusBar style="auto" />
          {token ? (
            <Shell
              token={token}
              onLogout={handleLogout}
              onUiLang={setUiLang}
              onTheme={chooseTheme}
              onToken={(next) => {
                // 비밀번호를 바꾸면 서버가 새 토큰을 준다. 갈아 끼워야 로그인이 유지된다.
                setToken(next, userId);
                setTokenState(next);
              }}
            />
          ) : (
            <Login onLogin={handleLogin} presetUserId={userId ?? undefined} uiLang={uiLang} onUiLang={setUiLang} />
          )}
        </TranslateContext.Provider>
      </LangContext.Provider>
    </PaletteProvider>
  );
}
