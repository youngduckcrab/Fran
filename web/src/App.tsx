import { useCallback, useState } from 'react';
import { getToken, setToken } from './api';
import ChatRoom from './components/ChatRoom';
import Login from './components/Login';

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const handleLogin = useCallback((next: string) => {
    setToken(next);
    setTokenState(next);
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setTokenState(null);
  }, []);

  if (!token) return <Login onLogin={handleLogin} />;
  return <ChatRoom token={token} onLogout={handleLogout} />;
}
