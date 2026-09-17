import { isThemeId, type ThemeId } from '@fran/shared';

const KEY = 'fran.theme';

/**
 * 고른 색을 문서에 입힌다.
 *
 * 색은 서버에 저장되지만, 로그인하기 전이나 접속하기 전에도 앱은 이미 화면에 떠 있다.
 * 마지막으로 쓰던 색을 브라우저에도 남겨 두고 먼저 입혀서, 열자마자 제 색으로 보이게 한다.
 */
export function applyTheme(theme: ThemeId | undefined): void {
  const chosen = theme ?? remembered();
  document.documentElement.dataset.theme = chosen;
  try {
    localStorage.setItem(KEY, chosen);
  } catch {
    // 저장하지 못해도 이번 세션은 그대로 쓴다
  }
}

export function remembered(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    // 시크릿 모드
  }
  return 'rose';
}
