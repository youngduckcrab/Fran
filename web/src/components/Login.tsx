import { useEffect, useState } from 'react';
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

        <input
          className="login__input"
          type="password"
          inputMode="text"
          autoComplete="current-password"
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
