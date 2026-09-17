import { useEffect, useState } from 'react';
import { fetchUsers, login, type LoginOption } from '../api';

interface Props {
  onLogin: (token: string) => void;
}

export default function Login({ onLogin }: Props) {
  const [users, setUsers] = useState<LoginOption[]>([]);
  const [userId, setUserId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchUsers()
      .then((list) => {
        setUsers(list);
        setUserId((current) => current || (list[0]?.id ?? ''));
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

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
        <p className="login__subtitle">둘만 쓰는 번역 메신저</p>

        <div className="login__people">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              className={`login__person ${userId === user.id ? 'is-selected' : ''}`}
              onClick={() => setUserId(user.id)}
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
          placeholder="패스코드"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
        />

        {error && <p className="login__error">{error}</p>}

        <button className="login__submit" type="submit" disabled={busy || !userId || !passcode}>
          {busy ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </main>
  );
}
