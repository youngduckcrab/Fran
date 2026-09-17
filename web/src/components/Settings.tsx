import { useState } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, type LangCode, type UserProfile } from '@fran/shared';
import { saveSettings } from '../api';

interface Props {
  profile: UserProfile;
  alwaysShowSource: boolean;
  onToggleSource: (value: boolean) => void;
  onSaved: (profile: UserProfile) => void;
  onClose: () => void;
  onLogout: () => void;
}

export default function Settings({
  profile,
  alwaysShowSource,
  onToggleSource,
  onSaved,
  onClose,
  onLogout,
}: Props) {
  const [nativeLang, setNativeLang] = useState<LangCode>(profile.nativeLang);
  const [displayLangs, setDisplayLangs] = useState<LangCode[]>(profile.displayLangs);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleDisplay = (lang: LangCode) => {
    setDisplayLangs((current) =>
      current.includes(lang) ? current.filter((item) => item !== lang) : [...current, lang],
    );
  };

  /** 목록의 첫 번째가 주 언어. 순서를 바꿔 어떤 번역을 크게 볼지 정한다. */
  const promote = (lang: LangCode) => {
    setDisplayLangs((current) => [lang, ...current.filter((item) => item !== lang)]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveSettings(nativeLang, displayLangs));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label="설정">
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>설정</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <section className="sheet__section">
          <h3>내가 쓰는 언어</h3>
          <p className="sheet__hint">입력한 문장이 이 언어라고 가정하고 번역합니다.</p>
          <div className="chips">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`chip ${nativeLang === lang ? 'is-on' : ''}`}
                onClick={() => setNativeLang(lang)}
              >
                {LANGUAGE_NAMES[lang]}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet__section">
          <h3>내가 받아볼 언어</h3>
          <p className="sheet__hint">
            맨 위 언어가 크게 표시됩니다. 공부 중인 언어를 추가하면 말풍선을 눌렀을 때 함께 보입니다.
          </p>
          <div className="chips">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`chip ${displayLangs.includes(lang) ? 'is-on' : ''}`}
                onClick={() => toggleDisplay(lang)}
              >
                {LANGUAGE_NAMES[lang]}
              </button>
            ))}
          </div>
          {displayLangs.length > 1 && (
            <ol className="sheet__order">
              {displayLangs.map((lang, index) => (
                <li key={lang}>
                  <button type="button" onClick={() => promote(lang)}>
                    {index === 0 ? '★ ' : ''}
                    {LANGUAGE_NAMES[lang]}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="sheet__section">
          <label className="sheet__toggle">
            <input
              type="checkbox"
              checked={alwaysShowSource}
              onChange={(event) => onToggleSource(event.target.checked)}
            />
            원문을 항상 함께 보기
          </label>
        </section>

        {error && <p className="sheet__error">{error}</p>}

        <div className="sheet__actions">
          <button type="button" className="sheet__logout" onClick={onLogout}>
            로그아웃
          </button>
          <button
            type="button"
            className="sheet__save"
            onClick={submit}
            disabled={busy || displayLangs.length === 0}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
