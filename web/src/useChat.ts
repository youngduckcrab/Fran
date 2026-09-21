import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ClientEvent,
  GlossaryEntry,
  LangCode,
  ServerEvent,
  UserProfile,
} from '@fran/shared';
import { activeUser, fetchAround, fetchMessages, fetchNewer, isTokenValid, websocketUrl } from './api';
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
  /**
   * 지금 보고 있는 것이 대화의 끝(최신)인지.
   *
   * 보관함에서 찾아가면 몇 달 전 한 토막만 보고 있게 된다. 그동안 새 메시지를 그
   * 아래에 붙이면 사이가 뚝 끊긴 채로 이어 붙는다. 끝을 보고 있지 않을 때는 붙이지
   * 않고, 아래로 내려오거나 "최근 대화로" 를 누르면 다시 끝으로 돌아온다.
   */
  atTail: boolean;
  /** 아래로 더 내려갈 것이 남아 있는지. 끝을 보고 있으면 false. */
  hasNewer: boolean;
}

/** 보고 있다고 서버에 다시 알리는 주기. 서버가 믿어 주는 기간(45초)보다 넉넉히 짧게. */
const ATTENTION_EVERY_MS = 15_000;

/** 위로 올렸을 때 한 번에 가져오는 개수. hello 가 주는 것과 같게 둔다. */
const OLDER_PAGE = 50;

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
  const fetchingNewer = useRef(false);
  /**
   * "최근 대화로" 를 누른 횟수.
   *
   * 끝으로 돌아가는 사이에 아래쪽을 받아오던 것이 늦게 도착하면, 애써 갈아 끼운 최신
   * 목록 뒤에 옛 토막이 다시 이어 붙는다. 번호가 달라졌으면 늦게 온 것을 버린다.
   */
  const tailGen = useRef(0);

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
      atTail: true,
      hasNewer: false,
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
           * 과거 한 토막을 찾아가 보고 있는 중이라면 그대로 둔다. 여기에 최신 50통을
           * 이어 붙이면 사이가 끊긴 목록이 된다. 끝으로 돌아올 때 새로 받아온다.
           */
          if (!previous.atTail) {
            return {
              ...previous,
              me: event.me,
              peer: event.peer,
              readAt: event.readAt,
              error: previous.error === 'disconnected' ? null : previous.error,
            };
          }

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
          // 과거를 보고 있으면 붙이지 않는다. 사이가 끊긴 목록이 되기 때문이다.
          if (!previous.atTail) return { ...previous, hasNewer: true, peerTyping: false };
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
    // 과거 한 토막을 보고 있을 때 적어 두면, 다음에 열었을 때 그 토막이 뜬다.
    if (!state.me || !state.peer || !state.atTail) return;
    const { me, peer, messages, readAt } = state;
    const timer = setTimeout(() => saveChat(activeUser(), { me, peer, messages, readAt }), 800);
    return () => clearTimeout(timer);
  }, [state.me, state.peer, state.messages, state.readAt, state.atTail]);

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
   * 그 말풍선이 있는 자리로 간다.
   *
   * 거슬러 올라가지 않는다 — 그 둘레만 받아서 통째로 갈아 끼운다. 몇 달 전 것이든,
   * 그 사이에 몇 통이 쌓여 있든 한 번이면 되고 화면에도 그만큼만 그린다.
   * 돌려주는 값은 찾았는지다.
   */
  const jumpTo = useCallback(async (messageId: string): Promise<boolean> => {
    const window = await fetchAround(messageId).catch(() => null);
    if (!window) return false;
    setState((previous) => ({
      ...previous,
      messages: window.messages,
      hasOlder: window.hasOlder,
      // 더 새로운 것이 없다면 여기가 곧 대화의 끝이다.
      hasNewer: window.hasNewer,
      atTail: !window.hasNewer,
      loadingOlder: false,
    }));
    return true;
  }, []);

  /** 찾아간 자리에서 아래로 내려올 때. 끝까지 오면 다시 실시간이 된다. */
  const loadNewer = useCallback(async () => {
    const { messages, hasNewer, atTail } = stateRef.current;
    if (fetchingNewer.current || atTail || !hasNewer) return;
    const last = messages[messages.length - 1];
    if (!last) return;

    fetchingNewer.current = true;
    const gen = tailGen.current;
    try {
      const newer = await fetchNewer(last.createdAt, last.id, OLDER_PAGE);
      if (gen !== tailGen.current) return; // 그 사이 끝으로 돌아갔다
      setState((previous) => {
        if (previous.atTail) return previous;
        const known = new Set(previous.messages.map((m) => m.id));
        const fresh = newer.filter((m) => !known.has(m.id));
        const reachedEnd = newer.length < OLDER_PAGE;
        return {
          ...previous,
          messages: [...previous.messages, ...fresh],
          hasNewer: !reachedEnd,
          atTail: reachedEnd,
        };
      });
    } catch {
      // 못 가져와도 보던 자리는 그대로다.
    } finally {
      fetchingNewer.current = false;
    }
  }, []);

  /** 한 번에 대화의 끝으로. 과거를 헤매다 돌아올 때. */
  const backToTail = useCallback(async () => {
    // 아래쪽을 받아오던 것이 있으면 버린다. 늦게 도착해서 최신 목록을 흐리지 않게.
    tailGen.current += 1;
    const latest = await fetchMessages(undefined, OLDER_PAGE).catch(() => null);
    if (!latest) return;
    setState((previous) => ({
      ...previous,
      messages: latest,
      hasOlder: latest.length >= OLDER_PAGE,
      hasNewer: false,
      atTail: true,
    }));
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
    loadNewer,
    jumpTo,
    backToTail,
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
