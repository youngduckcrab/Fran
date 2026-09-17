import { useState } from 'react';
import { LANGUAGES, LANGUAGE_NAMES, type LangCode, type UserProfile } from '@fran/shared';
import { saveSettings } from '../api';
import { useT } from '../i18n';

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
  const t = useT();
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
    <div className="sheet" role="dialog" aria-label={t('settings.title')}>
      <div className="sheet__panel">
        <header className="sheet__header">
          <h2>{t('settings.title')}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label={t('actions.close')}>
            ✕
          </button>
        </header>

        <section className="sheet__section">
          <h3>{t('settings.myLang')}</h3>
          <p className="sheet__hint">{t('settings.myLangHint')}</p>
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
          <h3>{t('settings.readLang')}</h3>
          <p className="sheet__hint">
            {t('settings.readLangHint')}
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
            {t('settings.showSource')}
          </label>
        </section>

        {error && <p className="sheet__error">{error}</p>}

        <div className="sheet__actions">
          <button type="button" className="sheet__logout" onClick={onLogout}>
            {t('settings.logout')}
          </button>
          <button
            type="button"
            className="sheet__save"
            onClick={submit}
            disabled={busy || displayLangs.length === 0}
          >
            {busy ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
