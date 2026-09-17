import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientEvent,
  GlossaryEntry,
  LangCode,
  ServerEvent,
  UserProfile,
} from '@fran/shared';
import { isTokenValid, websocketUrl } from './api';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface ChatState {
  connection: ConnectionState;
  me: UserProfile | null;
  peer: UserProfile | null;
  messages: ChatMessage[];
  /** 사람 id -> 어디까지 읽었는지(시각). */
  readAt: Record<string, number>;
  peerOnline: boolean;
  peerTyping: boolean;
  error: string | null;
  glossary: GlossaryEntry[];
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
/** 이 횟수만큼 hello 없이 실패하면 토큰이 죽은 건지 서버에 확인해 본다. */
const VERIFY_AFTER_ATTEMPTS = 2;

/**
 * 내가 보낸 메시지를 서버 응답과 맞춰보기 위한 임시 식별자.
 *
 * crypto.randomUUID 는 보안 컨텍스트(https 또는 localhost)에서만 존재한다.
 * 폰에서 http://<컴퓨터IP>:5173 으로 열면 없어서 전송 자체가 터진다.
 * 보안 용도가 아니라 화면에서 짝만 맞추면 되는 값이라 대체 경로로 충분하다.
 */
function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useChat(token: string | null, onUnauthorized: () => void) {
  const socketRef = useRef<WebSocket | null>(null);
  /** hello 를 한 번이라도 받았는지. 토큰 만료와 단순 네트워크 끊김을 구분한다. */
  const authenticated = useRef(false);
  /** 연속 실패 횟수. hello 를 받으면 0 으로 돌아간다. */
  const attempts = useRef(0);

  const [state, setState] = useState<ChatState>({
    connection: 'connecting',
    me: null,
    peer: null,
    messages: [],
    readAt: {},
    peerOnline: false,
    peerTyping: false,
    error: null,
    glossary: [],
  });

  const applyEvent = useCallback((event: ServerEvent) => {
    setState((previous) => {
      switch (event.type) {
        case 'hello':
          // 다시 이어졌으니 "연결하지 못했습니다" 는 치운다.
          return {
            ...previous,
            me: event.me,
            peer: event.peer,
            messages: event.messages,
            readAt: event.readAt,
            error: previous.error === 'disconnected' ? null : previous.error,
          };
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
        case 'read':
          // 읽은 자리는 뒤로 가지 않는다.
          return (previous.readAt[event.userId] ?? 0) >= event.at
            ? previous
            : { ...previous, readAt: { ...previous.readAt, [event.userId]: event.at } };
        case 'glossary':
          return { ...previous, glossary: event.entries };
        case 'error':
          return { ...previous, error: event.message };
      }
    });
  }, []);

  useEffect(() => {
    if (!token) return;

    // StrictMode 는 개발 모드에서 effect 를 두 번 실행한다. 첫 소켓의 close 이벤트가
    // 두 번째 연결이 시작된 뒤에 도착하므로, 이 effect 인스턴스가 아직 살아 있는지와
    // 지금 보는 소켓이 최신인지를 함께 확인해야 한다.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setState((previous) => ({ ...previous, connection: 'connecting' }));

      const socket = new WebSocket(websocketUrl(token));
      socketRef.current = socket;

      const isCurrent = () => !cancelled && socketRef.current === socket;

      socket.onopen = () => {
        if (!isCurrent()) return;
        setState((previous) => ({ ...previous, connection: 'open' }));
      };

      socket.onmessage = (raw) => {
        if (!isCurrent()) return;
        const event = JSON.parse(raw.data as string) as ServerEvent;
        if (event.type === 'hello') {
          authenticated.current = true;
          attempts.current = 0;
        }
        applyEvent(event);
      };

      socket.onclose = () => {
        // 정리됐거나 이미 더 최신 연결이 있으면 이 이벤트는 남은 소켓의 것이다.
        if (!isCurrent()) return;
        setState((previous) => ({ ...previous, connection: 'closed' }));
        void scheduleReconnect();
      };
    };

    const scheduleReconnect = async () => {
      if (cancelled) return;
      attempts.current += 1;

      if (attempts.current >= VERIFY_AFTER_ATTEMPTS) {
        // 한 번도 연결된 적이 없다면 토큰이 죽은 것일 수 있다. 소켓만 봐서는
        // 401 과 네트워크 장애를 구분할 수 없으므로 서버에 직접 물어본다.
        if (!authenticated.current) {
          const valid = await isTokenValid(token);
          if (cancelled) return;
          if (!valid) {
            onUnauthorized();
            return;
          }
        }
        // 연결된 적이 있든 없든, 계속 실패하고 있다면 그 사실을 알려야 한다.
        // 헤더의 "다시 연결하는 중…"만 조용히 도는 것으로는 뭐가 문제인지 알 수 없다.
        // 문구는 화면에서 각자의 언어로 붙인다. 여기서는 사유만 남긴다.
        setState((previous) => ({ ...previous, error: previous.error ?? 'disconnected' }));
      }

      const delay = Math.min(RECONNECT_BASE_MS * attempts.current, RECONNECT_MAX_MS);
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, applyEvent, onUnauthorized]);

  const emit = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  const sendMessage = useCallback(
    (
      text: string,
      options: {
        translationNote?: string;
        sourceLang?: LangCode;
        attachmentId?: string;
        replyTo?: string;
      } = {},
    ) => {
      emit({
        type: 'send',
        clientId: newClientId(),
        text,
        sourceLang: options.sourceLang,
        translationNote: options.translationNote,
        attachmentId: options.attachmentId,
        replyTo: options.replyTo,
      });
    },
    [emit],
  );

  /**
   * 여기까지 읽었다고 알린다.
   *
   * 이미 그만큼 읽은 것으로 돼 있으면 보내지 않는다. 말풍선이 새로 그려질 때마다
   * 같은 값을 계속 보내면 서버와 상대 화면이 쓸데없이 바빠진다.
   */
  const markRead = useCallback(
    (at: number) => {
      const mine = state.me?.id;
      if (!mine || (state.readAt[mine] ?? 0) >= at) return;
      emit({ type: 'read', at });
      setState((previous) =>
        (previous.readAt[mine] ?? 0) >= at
          ? previous
          : { ...previous, readAt: { ...previous.readAt, [mine]: at } },
      );
    },
    [emit, state.me?.id, state.readAt],
  );

  /** 말풍선에 이모지 하나. 같은 걸 다시 누르면 지워진다. */
  const react = useCallback(
    (messageId: string, emoji: string | null) => emit({ type: 'react', messageId, emoji }),
    [emit],
  );

  const retranslate = useCallback(
    (messageId: string, translationNote?: string) =>
      emit({ type: 'retranslate', messageId, translationNote }),
    [emit],
  );

  const setGlossary = useCallback(
    (entries: GlossaryEntry[]) => setState((previous) => ({ ...previous, glossary: entries })),
    [],
  );
  const setTyping = useCallback((isTyping: boolean) => emit({ type: 'typing', isTyping }), [emit]);
  const setProfile = useCallback(
    (profile: UserProfile) => setState((previous) => ({ ...previous, me: profile })),
    [],
  );
  const dismissError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);

  return {
    ...state,
    sendMessage,
    markRead,
    react,
    retranslate,
    setTyping,
    setProfile,
    setGlossary,
    dismissError,
  };
}

/** 화면들이 주고받는 대화 상태. Shell 이 한 번 만들어 아래로 내려준다. */
export type Chat = ReturnType<typeof useChat>;
