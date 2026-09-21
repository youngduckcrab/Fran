import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientEvent,
  GlossaryEntry,
  LangCode,
  ServerEvent,
  UserProfile,
} from '@fran/shared';
import { activeUser, fetchMessages, isTokenValid, websocketUrl } from './api';
import { loadChat, saveChat } from './cache';

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
  /** 더 위에 옛 대화가 남아 있는지. 끝까지 올라가면 false. */
  hasOlder: boolean;
  /** 지금 옛 대화를 가져오는 중인지. */
  loadingOlder: boolean;
}

/** 보고 있다고 서버에 다시 알리는 주기. 서버가 믿어 주는 기간(45초)보다 넉넉히 짧게. */
const ATTENTION_EVERY_MS = 15_000;

/** 위로 올렸을 때 한 번에 가져오는 개수. hello 가 주는 것과 같게 둔다. */
const OLDER_PAGE = 50;

/**
 * 찾는 말풍선까지 거슬러 올라갈 때는 한 번에 많이 가져온다.
 * 손으로 올릴 때와 달리 중간 것들을 보려는 게 아니라 목적지가 정해져 있어서,
 * 오가는 횟수를 줄이는 편이 낫다. (서버가 한 번에 주는 최대치)
 */
const UNTIL_PAGE = 200;
/** 그래도 못 찾으면 멈춘다. 없는 것을 끝까지 뒤지느라 앱이 굳으면 안 된다. */
const UNTIL_MAX_PAGES = 10;

const RECONNECT_BASE_MS = 1000;
/**
 * 기다리는 시간의 상한.
 *
 * 예전에는 15초였다. 그런데 무료 호스팅의 서버는 한동안 쓰지 않으면 잠들고, 깨어나는 데
 * 30초쯤 걸린다. 그 사이 몇 번 실패하면 대기 시간이 상한까지 올라가서, 서버가 이미
 * 일어난 뒤에도 최대 15초를 더 기다리게 된다. 실패해서 버리는 요청 하나보다
 * 사람을 빈 화면 앞에 세워 두는 쪽이 훨씬 비싸다.
 */
const RECONNECT_MAX_MS = 5000;
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
  /** 기다리는 타이머를 건너뛰고 지금 다시 연결한다. 연결 effect 가 채워 넣는다. */
  const reconnectNow = useRef<(() => void) | null>(null);
  /** 옛 대화를 가져오는 중인지. 스크롤이 여러 번 울려도 한 번만 부르게 막는다. */
  const fetchingOlder = useRef(false);

  /*
   * 마지막으로 본 대화를 먼저 그린다. 서버가 잠들어 있었다면 hello 가 오기까지
   * 30초가 걸리는데, 그동안 빈 화면을 보여 줄 이유가 없다. hello 가 오면 통째로 덮인다.
   */
  const [state, setState] = useState<ChatState>(() => {
    const cached = loadChat(activeUser());
    return {
      connection: 'connecting',
      me: cached?.me ?? null,
      peer: cached?.peer ?? null,
      messages: cached?.messages ?? [],
      readAt: cached?.readAt ?? {},
      peerOnline: false,
      peerTyping: false,
      error: null,
      glossary: [],
      // 서버에 물어보기 전에는 있다고 본다. 없으면 한 번 올라가 봤을 때 알게 된다.
      hasOlder: true,
      loadingOlder: false,
    };
  });

  /** 콜백 안에서 지금 상태를 읽기 위한 거울. setState 갱신 함수는 나중에 돌기 때문이다. */
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyEvent = useCallback((event: ServerEvent) => {
    setState((previous) => {
      switch (event.type) {
        case 'hello': {
          /*
           * hello 는 마지막 50통만 준다. 끊겼다 이어진 것이라면 그 사이에 위로 올려서
           * 불러온 옛 대화가 이미 화면에 있을 수 있는데, 그걸 버리면 읽던 자리가 날아간다.
           * hello 가 준 것만 갈아 끼우고 그보다 오래된 것은 그대로 둔다.
           */
          const fresh = new Set(event.messages.map((m) => m.id));
          const oldest = event.messages[0]?.createdAt ?? 0;
          const kept = previous.messages.filter((m) => !fresh.has(m.id) && m.createdAt < oldest);
          return {
            ...previous,
            me: event.me,
            peer: event.peer,
            messages: [...kept, ...event.messages],
            readAt: event.readAt,
            error: previous.error === 'disconnected' ? null : previous.error,
          };
        }
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

    reconnectNow.current = () => {
      if (cancelled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      // 실패 횟수는 그대로 둔다. 토큰이 죽었는지 확인하는 일이 이 숫자를 보고 돈다.
      connect();
    };

    connect();

    return () => {
      cancelled = true;
      reconnectNow.current = null;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, applyEvent, onUnauthorized]);

  /**
   * 다시 돌아오면 기다리지 않고 바로 잇는다.
   *
   * 폰은 앱을 내려 두면 얼마 뒤 연결을 끊는다. 그때 재연결 대기가 상한까지 올라가 있으면,
   * 앱을 다시 열어도 다음 시도가 올 때까지 멍하니 기다리게 된다. 사람이 화면을 보고 있는
   * 그 순간이 가장 급한 때이므로 타이머를 무시하고 지금 시도한다.
   */
  useEffect(() => {
    if (!token) return;
    const wakeUp = () => {
      if (document.visibilityState !== 'visible') return;
      const socket = socketRef.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      reconnectNow.current?.();
    };
    document.addEventListener('visibilitychange', wakeUp);
    window.addEventListener('focus', wakeUp);
    window.addEventListener('online', wakeUp);
    return () => {
      document.removeEventListener('visibilitychange', wakeUp);
      window.removeEventListener('focus', wakeUp);
      window.removeEventListener('online', wakeUp);
    };
  }, [token]);

  /**
   * 본 것을 적어 둔다. 다음에 열 때 이걸 먼저 그린다.
   *
   * 말풍선이 하나 오갈 때마다 적으면 잦다. 잠깐 모았다가 한 번에 적는다 —
   * 어차피 이 기록은 "다음에 열 때"만 쓰인다.
   */
  useEffect(() => {
    if (!state.me || !state.peer) return;
    const { me, peer, messages, readAt } = state;
    const timer = setTimeout(() => saveChat(activeUser(), { me, peer, messages, readAt }), 800);
    return () => clearTimeout(timer);
  }, [state.me, state.peer, state.messages, state.readAt]);

  const emit = useCallback((event: ClientEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }, []);

  /**
   * 지금 앱을 보고 있는지 서버에 알린다.
   *
   * 서버는 이걸 보고 폰 알림을 보낼지 정한다. 연결돼 있다고 보고 있는 것은 아니다 —
   * 다른 앱을 보는 동안에도 연결은 한동안 살아 있어서, 그때 알림이 안 가면 아무도 모른다.
   */
  useEffect(() => {
    if (!token) return;
    const tell = () => emit({ type: 'attention', visible: document.visibilityState === 'visible' });
    tell();
    document.addEventListener('visibilitychange', tell);
    window.addEventListener('focus', tell);
    /*
     * 보고 있는 동안에는 계속 다시 알린다.
     *
     * 폰이 잠기거나 지하철에 들어가면 "안 보고 있다"는 말을 보낼 새도 없이 멈춘다.
     * 서버 쪽에는 멀쩡한 연결이 남아서 보고 있는 사람으로 여겨지고, 그동안 폰 알림이
     * 막힌다. 소식이 끊기면 서버가 알아서 아니라고 보도록, 살아 있는 동안 계속 말한다.
     */
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tell();
    }, ATTENTION_EVERY_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tell);
      window.removeEventListener('focus', tell);
    };
  }, [token, emit, state.connection]);

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

  /**
   * 지금 보이는 것보다 오래된 대화를 가져와 위에 붙인다.
   *
   * 대화를 열면 마지막 50통만 온다. 그보다 옛날 이야기를 찾아 올라가면 그때 가져온다 —
   * 몇 달치를 미리 내려받아 두면 열 때마다 느려지고, 대개는 보지도 않는다.
   */
  const loadOlder = useCallback(async () => {
    /*
     * 지금 무엇을 갖고 있는지는 ref 로 본다. setState 의 갱신 함수는 나중에 돌기 때문에
     * 그 안에서 값을 꺼내려 하면 여기서는 아직 비어 있다.
     */
    const { messages, hasOlder } = stateRef.current;
    if (fetchingOlder.current || !hasOlder) return;
    fetchingOlder.current = true;
    const oldest = messages[0]?.createdAt;
    setState((previous) => ({ ...previous, loadingOlder: true }));

    try {
      const older = await fetchMessages(oldest, OLDER_PAGE);
      setState((previous) => {
        const known = new Set(previous.messages.map((m) => m.id));
        const fresh = older.filter((m) => !known.has(m.id));
        return {
          ...previous,
          messages: [...fresh, ...previous.messages],
          // 달라고 한 만큼 오지 않았다면 그 위로는 없다.
          hasOlder: older.length >= OLDER_PAGE,
          loadingOlder: false,
        };
      });
    } catch {
      // 못 가져와도 보던 대화는 그대로다. 다시 올리면 또 시도한다.
      setState((previous) => ({ ...previous, loadingOlder: false }));
    } finally {
      fetchingOlder.current = false;
    }
  }, []);

  /**
   * 찾는 말풍선이 나올 때까지 거슬러 올라간다.
   *
   * 저장해 둔 문장에서 "대화에서 보기" 를 누르면 그 말이 오간 자리로 가야 하는데,
   * 몇 달 전 것이면 화면에 올라와 있지 않다. 나올 때까지 옛 대화를 끌어온다.
   * 한 번에 많이 가져와서 오가는 횟수를 줄이고, 끝까지 없으면 없는 대로 멈춘다.
   */
  const loadUntil = useCallback(async (messageId: string): Promise<boolean> => {
    for (let page = 0; page < UNTIL_MAX_PAGES; page += 1) {
      const { messages, hasOlder } = stateRef.current;
      if (messages.some((message) => message.id === messageId)) return true;
      if (!hasOlder) return false;

      const oldest = messages[0]?.createdAt;
      const older = await fetchMessages(oldest, UNTIL_PAGE).catch(() => null);
      if (!older) return false;

      // setState 의 갱신 함수는 나중에 돌기 때문에, 다음 바퀴에서 보려면 여기서도 기다린다.
      await new Promise<void>((done) => {
        setState((previous) => {
          const known = new Set(previous.messages.map((m) => m.id));
          const fresh = older.filter((m) => !known.has(m.id));
          queueMicrotask(done);
          return {
            ...previous,
            messages: [...fresh, ...previous.messages],
            hasOlder: older.length >= UNTIL_PAGE,
          };
        });
      });
    }
    return stateRef.current.messages.some((message) => message.id === messageId);
  }, []);

  /** 보낸 글을 고친다. 서버가 번역을 다시 돌려서 update 로 돌려준다. */
  const editMessage = useCallback(
    (messageId: string, text: string) => emit({ type: 'edit', messageId, text }),
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
    loadOlder,
    loadUntil,
    editMessage,
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
