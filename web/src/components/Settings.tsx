import { useEffect, useRef, useState } from 'react';
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  GENDERS,
  THEMES,
  WALLPAPERS,
  type Gender,
  type LangCode,
  type ThemeId,
  type UserProfile,
} from '@fran/shared';
import { changePasscode, saveSettings, saveTheme, saveWallpaper } from '../api';
import { useT, type StringKey } from '../i18n';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../push';
import { applyTheme } from '../theme';
import Icon from './Icon';
import { attachmentUrl, prepareImage, uploadAttachment } from '../media';
import { photoWallpaper, wallpaperPhotoId } from '../wallpaper';
import { BUBBLE_VIEWS, type BubbleView } from '../view';

interface Props {
  profile: UserProfile;
  /** 말풍선에서 원문·번역 중 무엇을 크게 볼지. */
  view: BubbleView;
  onChangeView: (value: BubbleView) => void;
  onSaved: (profile: UserProfile) => void;
  onClose: () => void;
  onLogout: () => void;
  /** 비밀번호를 바꾸면 새 토큰이 나온다. 위로 올려 보낸다. */
  onToken: (token: string) => void;
}

export default function Settings({
  profile,
  view,
  onChangeView,
  onSaved,
  onClose,
  onLogout,
  onToken,
}: Props) {
  const t = useT();
  const [nativeLang, setNativeLang] = useState<LangCode>(profile.nativeLang);
  const [displayLangs, setDisplayLangs] = useState<LangCode[]>(profile.displayLangs);
  /* ---- 번역이 참고하는 나에 대한 정보 ---- */
  const [gender, setGender] = useState<Gender>(profile.gender ?? 'unspecified');
  const [region, setRegion] = useState(profile.region ?? '');
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

  /* ---- 앱 색 ---- */
  const [theme, setTheme] = useState<ThemeId>(profile.theme ?? 'rose');

  const chooseTheme = async (value: ThemeId) => {
    const previous = theme;
    // 누르자마자 앱 전체가 그 색으로 바뀌는 게 보여야 고르는 맛이 있다.
    setTheme(value);
    applyTheme(value);
    try {
      onSaved(await saveTheme(value));
    } catch (cause) {
      setTheme(previous);
      applyTheme(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /* ---- 배경화면 ---- */
  const [wallpaper, setWallpaper] = useState<string>(profile.wallpaper ?? 'default');
  const photoWall = wallpaperPhotoId(profile.wallpaper);

  const photoInput = useRef<HTMLInputElement | null>(null);
  const [wallBusy, setWallBusy] = useState(false);

  /** 폰 갤러리에서 고른 사진을 배경으로. 올리기 전에 화면에서 줄인다. */
  const pickWallpaper = async (file: File) => {
    setWallBusy(true);
    setError(null);
    try {
      const { blob, width, height } = await prepareImage(file);
      const attachment = await uploadAttachment(blob, 'image', { width, height });
      await chooseWallpaper(photoWallpaper(attachment.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWallBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  const chooseWallpaper = async (value: string) => {
    const previous = wallpaper;
    setWallpaper(value); // 누르자마자 바뀌는 게 보여야 고르는 맛이 있다
    try {
      onSaved(await saveWallpaper(value));
    } catch (cause) {
      setWallpaper(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /* ---- 비밀번호 ---- */
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  /** 새 비밀번호를 한 번 더. 오타가 그대로 잠금이 되면 둘 다 못 들어온다. */
  const [again, setAgain] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [passDone, setPassDone] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  /** 두 번 적은 새 비밀번호가 서로 다른지. 다 적기 전에는 잔소리하지 않는다. */
  const mismatch = again.length > 0 && next !== again;

  const submitPasscode = async () => {
    if (next !== again) {
      setPassError(t('settings.passcodeMismatch'));
      return;
    }
    setPassBusy(true);
    setPassError(null);
    setPassDone(false);
    try {
      onToken(await changePasscode(current, next));
      setCurrent('');
      setNext('');
      setAgain('');
      setPassDone(true);
    } catch (cause) {
      // 사유는 코드로 온다. 문구는 읽는 사람의 언어로 여기서 붙인다.
      const code = (cause as { code?: string }).code;
      setPassError(
        code === 'wrongCurrent'
          ? t('settings.passcodeWrong')
          : code === 'tooShort'
            ? t('settings.passcodeShort')
            : code === 'same'
              ? t('settings.passcodeSame')
              : cause instanceof Error
                ? cause.message
                : String(cause),
      );
    } finally {
      setPassBusy(false);
    }
  };

  /* ---- 알림 ---- */
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const togglePush = async (want: boolean) => {
    setPushBusy(true);
    setError(null);
    setTested(null);
    try {
      setPush(want ? await enablePush() : await disablePush());
    } catch {
      setError(t('settings.notifyFailed'));
    } finally {
      setPushBusy(false);
    }
  };

  /** 시험 알림 결과. 몇 대로 갔는지, 아니면 어디가 막혔는지. */
  const [tested, setTested] = useState<string | null>(null);

  const tryPush = async () => {
    setPushBusy(true);
    setTested(null);
    try {
      const sent = await testPush();
      // 등록된 기기가 없으면 보낼 곳이 없다. 켜 두었는데도 0 이면 등록이 만료된 것이다.
      setTested(sent > 0 ? t('settings.notifyTestSent', { count: String(sent) }) : t('settings.notifyTestNone'));
    } catch {
      setTested(t('settings.notifyFailed'));
    } finally {
      setPushBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveSettings(nativeLang, displayLangs, { gender, region: region.trim() }));
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
            <Icon name="close" size={16} />
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
          <h3>{t('settings.view')}</h3>
          <p className="sheet__hint">{t('settings.viewHint')}</p>
          <div className="chips">
            {BUBBLE_VIEWS.map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${view === item ? 'is-on' : ''}`}
                onClick={() => onChangeView(item)}
              >
                {t(`view.${item}` as StringKey)}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet__section">
          <h3>{t('settings.about')}</h3>
          <p className="sheet__hint">{t('settings.aboutHint')}</p>
          <div className="chips">
            {GENDERS.map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${gender === item ? 'is-on' : ''}`}
                onClick={() => setGender(item)}
              >
                {t(`gender.${item}` as StringKey)}
              </button>
            ))}
          </div>
          <input
            className="login__input"
            value={region}
            placeholder={t('settings.regionPlaceholder')}
            onChange={(event) => setRegion(event.target.value)}
          />
        </section>

        <section className="sheet__section">
          <h3>{t('settings.theme')}</h3>
          <p className="sheet__hint">{t('settings.themeHint')}</p>
          <div className="themes">
            {THEMES.map((id) => (
              <button
                key={id}
                type="button"
                className={`themes__item ${theme === id ? 'is-on' : ''}`}
                data-theme={id}
                onClick={() => void chooseTheme(id)}
                aria-label={t(`theme.${id}` as StringKey)}
                title={t(`theme.${id}` as StringKey)}
              >
                <span className="themes__dot" />
              </button>
            ))}
          </div>
        </section>

        <section className="sheet__section">
          <h3>{t('settings.wallpaper')}</h3>
          <p className="sheet__hint">{t('settings.wallpaperHint')}</p>
          <div className="walls">
            {WALLPAPERS.map((id) => (
              <button
                key={id}
                type="button"
                className={`walls__item wall wall--${id} ${wallpaper === id ? 'is-on' : ''}`}
                onClick={() => void chooseWallpaper(id)}
              >
                <span>{t(`wall.${id}` as StringKey)}</span>
              </button>
            ))}
            {photoWall && (
              <button
                type="button"
                className={`walls__item walls__item--photo ${wallpaper === profile.wallpaper ? 'is-on' : ''}`}
                style={{ backgroundImage: `url("${attachmentUrl(photoWall)}")` }}
                onClick={() => void chooseWallpaper(profile.wallpaper as string)}
              >
                <span>{t('wall.photo')}</span>
              </button>
            )}
          </div>

          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="composer__file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pickWallpaper(file);
            }}
          />
          <button
            type="button"
            className="sheet__pick"
            onClick={() => photoInput.current?.click()}
            disabled={wallBusy}
          >
            <Icon name="image" size={18} />
            {wallBusy ? t('composer.uploading') : t('settings.wallpaperPick')}
          </button>
        </section>

        <section className="sheet__section">
          <h3>{t('settings.passcode')}</h3>
          <p className="sheet__hint">{t('settings.passcodeHint')}</p>
          <div className="passcode">
            <input
              className="login__input"
              type="password"
              autoComplete="current-password"
              placeholder={t('settings.passcodeCurrent')}
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <input
              className="login__input"
              type="password"
              autoComplete="new-password"
              placeholder={t('settings.passcodeNew')}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <input
              className={`login__input ${mismatch ? 'is-wrong' : ''}`}
              type="password"
              autoComplete="new-password"
              placeholder={t('settings.passcodeConfirm')}
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
            <button
              type="button"
              className="sheet__save"
              onClick={() => void submitPasscode()}
              disabled={passBusy || !current || !next || !again || mismatch}
            >
              {passBusy ? t('settings.saving') : t('settings.passcodeChange')}
            </button>
          </div>
          {mismatch && <p className="sheet__error">{t('settings.passcodeMismatch')}</p>}
          {passError && !mismatch && <p className="sheet__error">{passError}</p>}
          {passDone && <p className="sheet__done">{t('settings.passcodeChanged')}</p>}
        </section>

        <section className="sheet__section">
          <h3>{t('settings.notify')}</h3>
          {push === 'unsupported' ? (
            <p className="sheet__hint">{t('settings.notifyUnsupported')}</p>
          ) : push === 'denied' ? (
            <p className="sheet__hint">{t('settings.notifyDenied')}</p>
          ) : (
            <>
              <label className="sheet__toggle">
                <input
                  type="checkbox"
                  checked={push === 'on'}
                  disabled={pushBusy}
                  onChange={(event) => void togglePush(event.target.checked)}
                />
                {t('settings.notifyOn')}
              </label>
              <p className="sheet__hint">{t('settings.notifyHint')}</p>
              <p className="sheet__hint">{t('settings.notifyBadge')}</p>

              {/* 말로 따지는 것보다 한 번 받아 보는 쪽이 빠르다. */}
              {push === 'on' && (
                <>
                  <button
                    type="button"
                    className="card__delete"
                    disabled={pushBusy}
                    onClick={() => void tryPush()}
                  >
                    {t('settings.notifyTest')}
                  </button>
                  {tested && <p className="sheet__hint">{tested}</p>}
                </>
              )}
            </>
          )}
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
