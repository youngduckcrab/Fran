import { useEffect, useRef, useState } from 'react';
import { fetchUsers, login, type LoginOption } from '../api';
import { createTranslate, toUiLang, type UiLang } from '../i18n';

interface Props {
  onLogin: (token: string) => void;
  /** 주소로 미리 정해진 사람이 있으면 그 사람으로 시작한다. */
  presetUserId?: string;
  uiLang: UiLang;
  onUiLang: (lang: UiLang) => void;
}

export default function Login({ onLogin, presetUserId, uiLang, onUiLang }: Props) {
  const t = createTranslate(uiLang);
  const [users, setUsers] = useState<LoginOption[]>([]);
  const [userId, setUserId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 주소가 사람을 지정했다면 고르는 화면을 띄우지 않는다. */
  const preset = users.find((user) => user.id === presetUserId);

  // 목록을 받아온 뒤에야 고를 게 없다는 걸 알게 되므로, 그때 입력칸으로 커서를 옮긴다.
  // (모바일에서는 키보드까지 올라오지는 않는다 — 브라우저가 막는다.)
  const passcodeRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (preset) passcodeRef.current?.focus();
  }, [preset]);

  useEffect(() => {
    fetchUsers()
      .then((list) => {
        setUsers(list);
        const chosen = list.find((user) => user.id === presetUserId) ?? list[0];
        if (chosen) {
          setUserId((current) => current || chosen.id);
          onUiLang(toUiLang(chosen.uiLang));
        }
      })
      .catch((cause: Error) => setError(cause.message));
  }, [presetUserId, onUiLang]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(userId, passcode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <h1 className="login__title">Fran</h1>
        <p className="login__subtitle">{t('login.subtitle')}</p>

        {preset ? (
          // 주소가 누구 것인지 말해 주므로 고르게 하지 않는다. 비밀번호만 받는다.
          <p className="login__as">{t('login.as', { name: preset.name })}</p>
        ) : (
          <div className="login__people">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`login__person ${userId === user.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setUserId(user.id);
                  onUiLang(toUiLang(user.uiLang));
                }}
              >
                {user.name}
              </button>
            ))}
          </div>
        )}

        <input
          className="login__input"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          ref={passcodeRef}
          placeholder={t('login.passcode')}
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
        />

        {error && <p className="login__error">{error}</p>}

        <button className="login__submit" type="submit" disabled={busy || !userId || !passcode}>
          {busy ? t('login.checking') : t('login.enter')}
        </button>
      </form>
    </main>
  );
}
