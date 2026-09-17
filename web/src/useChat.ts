import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientEvent, LangCode, ServerEvent, UserProfile } from '@fran/shared';
import { websocketUrl } from './api';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface ChatState {
  connection: ConnectionState;
  me: UserProfile | null;
  peer: UserProfile | null;
  messages: ChatMessage[];
  peerOnline: boolean;
  peerTyping: boolean;
  error: string | null;
}

const RECONNECT_DELAY_MS = 2000;

export function useChat(token: string | null, onUnauthorized: () => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);
  /** hello 를 한 번이라도 받았는지. 토큰 만료와 단순 네트워크 끊김을 구분한다. */
  const authenticated = useRef(false);

  const [state, setState] = useState<ChatState>({
    connection: 'connecting',
    me: null,
    peer: null,
    messages: [],
    peerOnline: false,
    peerTyping: false,
    error: null,
  });

  const applyEvent = useCallback((event: ServerEvent) => {
    setState((previous) => {
      switch (event.type) {
        case 'hello':
          return { ...previous, me: event.me, peer: event.peer, messages: event.messages };
        case 'message':
          if (previous.messages.some((m) => m.id === event.message.id)) return previous;
          return { ...previous, messages: [...previous.messages, event.message], peerTyping: false };
        case 'message_updated':
          return {
            ...previous,
            messages: previous.messages.map((m) => (m.id === event.message.id ? event.message : m)),
          };
        case 'presence':
          return previous.peer && event.userId === previous.peer.id
            ? { ...previous, peerOnline: event.online, peerTyping: event.online && previous.peerTyping }
            : previous;
        case 'typing':
          return previous.peer && event.userId === previous.peer.id
            ? { ...previous, peerTyping: event.isTyping }
            : previous;
        case 'error':
          return { ...previous, error: event.message };
      }
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    closedByUs.current = false;

    const connect = () => {
      setState((previous) => ({ ...previous, connection: 'connecting' }));
      const socket = new WebSocket(websocketUrl(token));
      socketRef.current = socket;

      socket.onopen = () => setState((previous) => ({ ...previous, connection: 'open', error: null }));
      socket.onmessage = (raw) => {
        const event = JSON.parse(raw.data as string) as ServerEvent;
        if (event.type === 'hello') authenticated.current = true;
        applyEvent(event);
      };
      socket.onclose = () => {
        setState((previous) => ({ ...previous, connection: 'closed' }));
        if (closedByUs.current) return;
        // hello 를 한 번도 못 받고 끊겼다면 업그레이드 단계에서 401 을 맞은 것이다.
        if (!authenticated.current) {
          onUnauthorized();
          return;
        }
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
    };
  }, [token, applyEvent, onUnauthorized]);

  const emit = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  const sendMessage = useCallback(
    (text: string, sourceLang?: LangCode) => {
      emit({ type: 'send', clientId: crypto.randomUUID(), text, sourceLang });
    },
    [emit],
  );

  const retranslate = useCallback((messageId: string) => emit({ type: 'retranslate', messageId }), [emit]);
  const setTyping = useCallback((isTyping: boolean) => emit({ type: 'typing', isTyping }), [emit]);
  const setProfile = useCallback(
    (profile: UserProfile) => setState((previous) => ({ ...previous, me: profile })),
    [],
  );
  const dismissError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);

  return { ...state, sendMessage, retranslate, setTyping, setProfile, dismissError };
}
