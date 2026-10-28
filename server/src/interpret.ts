import { GoogleGenAI, Modality, type LiveSendRealtimeInputParameters, type LiveServerMessage, type Session } from '@google/genai';
import type { InterpretStatus, LangCode, TranslationErrorCode } from '@fran/shared';
import { config } from './config.js';

/**
 * 통역 음성 — 통화 중에 말을 소리째 다른 말로 옮겨 들려준다(Gemini Live Translate).
 *
 * 자막 번역은 받아쓴 글을 옮기고, 읽어 주기는 그 글을 폰 목소리로 낸다. 이건 글을
 * 거치지 않는다. 말하는 쪽 폰이 마이크 소리를 조금씩 보내면 여기서 Gemini 와 세션을
 * 열어 흘려 넣고, 옮겨진 소리를 듣는 쪽에 그대로 넘긴다. 말이 끝나기를 기다리지
 * 않고 말하는 도중에 따라 옮긴다.
 *
 * 열쇠는 서버에만 있다. 폰이 Gemini 에 직접 붙지 않는 이유다.
 *
 * 둘만 쓰는 앱이라 길은 많아야 둘이다 — 내 말을 상대에게, 상대 말을 나에게.
 */

/** 듣는 쪽에 소리와 상태를 전하는 곳. 서버 본체가 소켓으로 이어 준다. */
export interface InterpretOutlet {
  /** 옮긴 소리 한 토막(모노 16비트 PCM, base64). */
  voice: (pcm: string, rate: number) => void;
  status: (status: InterpretStatus, code?: TranslationErrorCode) => void;
  /** 더 해 볼 수 없게 됐을 때, 말하는 쪽에게 마이크 소리를 그만 보내라고 한다. */
  stopSpeaker: () => void;
}

interface Route {
  callId: string;
  listenerId: string;
  targetLang: LangCode;
  outlet: InterpretOutlet;
  session: Session | null;
  /** 세션을 여는 중. 그 사이 들어온 소리는 pending 에 쌓아 둔다. */
  opening: boolean;
  /** 세션이 열리면 흘려 넣을 소리. 빈 글자는 "말이 끊겼다" 는 표시다. */
  pending: string[];
  /** 옮긴 소리를 처음 넘길 때 한 번 'live' 를 알린다. */
  announced: boolean;
  /** 최근에 실패한 시각들. 짧은 사이에 거듭 실패하면 그 통화에서는 그만둔다. */
  failures: number[];
  /** 이보다 이르면 세션을 다시 열지 않는다. 실패 직후 토막마다 두드리지 않게. */
  retryAt: number;
  /** 더는 해 볼 수 없는 길. 소리가 와도 버린다. */
  dead: boolean;
  /** 꺼진 길. 여는 중이던 세션이 뒤늦게 열려도 바로 닫는다. */
  closed: boolean;
  idleTimer: NodeJS.Timeout | null;
}

/** 폰이 보내는 소리. 브라우저와 폰 모두 이 모양으로 떼어 보낸다. */
const INPUT_MIME = 'audio/pcm;rate=16000';

/** 모델이 내놓는 소리의 기본 빠르기. 응답에 적혀 오면 그걸 쓴다. */
const OUTPUT_RATE = 24_000;

/** 세션이 열리는 동안 쌓아 둘 소리. 100ms 토막 30개 = 3초. 그보다 오래된 말은 버린다. */
const MAX_PENDING = 30;

/**
 * 이만큼 아무도 말하지 않으면 세션을 닫는다.
 * 열어 둔 세션은 Google 쪽 자원이고 무료 한도에도 잡힌다. 다시 말하면 곧 다시 연다.
 */
const IDLE_CLOSE_MS = 60_000;

/** 세션이 이 안에 안 열리면 실패로 친다. */
const CONNECT_TIMEOUT_MS = 10_000;

/** 이 사이에 세 번 실패하면 그 통화에서는 그만둔다. 계속 두드려 봐야 한도만 깎는다. */
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES = 3;

/** 실패 뒤 이만큼은 다시 열지 않는다. */
const RETRY_DELAY_MS = 1_500;

/** 곧 끊긴다는 예고(goAway)를 받은 세션을 이만큼 더 쓰고 닫는다. 나오던 말은 마저 나오게. */
const RETIRE_AFTER_MS = 5_000;

/** 다시 해 봐도 같은 결과일 실패. 바로 그만둔다. */
const FATAL: ReadonlySet<TranslationErrorCode> = new Set(['noApiKey', 'invalidApiKey', 'modelNotFound', 'quotaDay']);

/** 말하는 사람 id → 그 사람 말을 옮기는 길. */
const routes = new Map<string, Route>();

let gemini: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  // GOOGLE_GEMINI_BASE_URL 을 주면 그쪽으로 붙는다(검증용 가짜 모델).
  gemini ??= new GoogleGenAI({ apiKey: config.translation.gemini.apiKey ?? '' });
  return gemini;
}

/** 열쇠가 있어야 쓸 수 있다. 번역을 Claude 로 돌려도 이것은 Gemini 열쇠가 필요하다. */
export function interpretAvailable(): boolean {
  return Boolean(config.translation.gemini.apiKey);
}

/**
 * speakerId 의 말을 targetLang 으로 옮겨 outlet 으로 들려주기 시작한다.
 *
 * 세션은 아직 열지 않는다. 말하는 쪽이 실제로 소리를 보내 올 때 연다 — 켜 두고
 * 말없이 있는 동안까지 세션을 붙잡고 있을 이유가 없다.
 */
export function startInterpret(
  speakerId: string,
  listenerId: string,
  callId: string,
  targetLang: LangCode,
  outlet: InterpretOutlet,
): void {
  stopInterpret(speakerId);
  if (!interpretAvailable()) {
    outlet.status('failed', 'noApiKey');
    return;
  }
  routes.set(speakerId, {
    callId,
    listenerId,
    targetLang,
    outlet,
    session: null,
    opening: false,
    pending: [],
    announced: false,
    failures: [],
    retryAt: 0,
    dead: false,
    closed: false,
    idleTimer: null,
  });
  outlet.status('waiting');
}

export function stopInterpret(speakerId: string): void {
  const route = routes.get(speakerId);
  if (!route) return;
  routes.delete(speakerId);
  close(route);
}

/** 통화가 끝나면 그 통화의 길을 모두 닫는다. */
export function stopInterpretForCall(callId: string): void {
  for (const [speakerId, route] of routes) {
    if (route.callId === callId) stopInterpret(speakerId);
  }
}

/** 그 사람이 말하는 쪽이든 듣는 쪽이든 길을 닫는다. 접속이 다 끊겼을 때. */
export function stopInterpretForUser(userId: string): void {
  for (const [speakerId, route] of routes) {
    if (speakerId === userId || route.listenerId === userId) stopInterpret(speakerId);
  }
}

/**
 * 말하는 쪽이 보낸 소리 한 토막.
 *
 * 이 소리를 옮길 길이 없으면 false 를 돌려준다. 그러면 부른 쪽이 그만 보내라고 알린다.
 */
export function feedMic(speakerId: string, callId: string, pcm: string, end: boolean): boolean {
  const route = routes.get(speakerId);
  if (!route || route.callId !== callId || route.dead) return false;
  keepAlive(route);

  if (route.session) {
    push(route, end ? { audioStreamEnd: true } : { audio: { data: pcm, mimeType: INPUT_MIME } });
    return true;
  }

  // 아직 세션이 없다. 쌓아 두고 연다.
  route.pending.push(end ? '' : pcm);
  if (route.pending.length > MAX_PENDING) route.pending.shift();
  if (!route.opening && Date.now() >= route.retryAt) void open(route);
  return true;
}

function push(route: Route, input: LiveSendRealtimeInputParameters): void {
  try {
    route.session?.sendRealtimeInput(input);
  } catch (error) {
    route.session = null;
    fail(route, error);
  }
}

async function open(route: Route): Promise<void> {
  route.opening = true;
  let session: Session;
  try {
    session = await connect(route);
  } catch (error) {
    route.opening = false;
    fail(route, error);
    return;
  }
  route.opening = false;
  // 여는 사이에 통역이 꺼졌다.
  if (route.closed) {
    session.close();
    return;
  }
  route.session = session;
  for (const pcm of route.pending.splice(0)) {
    push(route, pcm ? { audio: { data: pcm, mimeType: INPUT_MIME } } : { audioStreamEnd: true });
  }
}

/**
 * Gemini 와 세션을 연다.
 *
 * SDK 는 설정을 보낸 뒤 "준비됐다" 는 답을 기다린다. 그 사이에 상대가 연결을 끊어
 * 버리면(열쇠가 틀렸거나 설정을 거부한 경우) 그 기다림이 끝나지 않는다. 끊긴 것과
 * 시간이 다 된 것을 따로 지켜보다가 먼저 오는 쪽으로 끝낸다.
 */
function connect(route: Route): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    let settled = false;
    let session: Session | null = null;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        session?.close();
        reject(error);
      } else if (session) {
        resolve(session);
      }
    };
    const timer = setTimeout(() => settle(new Error('통역 세션을 여는 데 너무 오래 걸립니다 (timeout).')), CONNECT_TIMEOUT_MS);

    client()
      .live.connect({
        model: config.interpret.model,
        config: {
          responseModalities: [Modality.AUDIO],
          // 듣는 사람의 말로. 이미 그 말로 한 말은 되풀이하지 않는다 — 원래 목소리가 그대로 들린다.
          translationConfig: { targetLanguageCode: route.targetLang, echoTargetLanguage: false },
        },
        callbacks: {
          onmessage: (message) => receive(route, message),
          onerror: (event) => settle(new Error(event.message || '통역 세션 오류')),
          onclose: (event) => {
            if (!settled) {
              settle(new CloseError(event.code, event.reason));
              return;
            }
            // 지금 쓰는 세션이 닫혔을 때만. 은퇴시킨 세션이 닫히는 것은 예정된 일이다.
            if (session && route.session === session) {
              route.session = null;
              if (event.code !== 1000 && event.code !== 1001) fail(route, new CloseError(event.code, event.reason));
            }
          },
        },
      })
      .then(
        (opened) => {
          session = opened;
          // 이미 시간이 다 됐거나 끊긴 뒤에 열렸다. 쓰지 않는다.
          if (settled) opened.close();
          else settle();
        },
        (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
      );
  });
}

/** 세션이 닫힌 까닭. 열쇠가 틀리거나 설정이 거부되면 이유가 여기 적혀 온다. */
class CloseError extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(`통역 세션이 닫혔습니다 (${code}${reason ? `: ${reason}` : ''})`);
  }
}

function receive(route: Route, message: LiveServerMessage): void {
  if (route.closed) return;
  for (const part of message.serverContent?.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data;
    const mime = part.inlineData?.mimeType ?? '';
    if (!data || !mime.startsWith('audio/')) continue;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? OUTPUT_RATE);
    route.outlet.voice(data, Number.isFinite(rate) && rate > 0 ? rate : OUTPUT_RATE);
    if (!route.announced) {
      route.announced = true;
      route.outlet.status('live');
    }
  }
  // 곧 끊긴다는 예고. 지금 세션은 나오던 말을 마저 내게 두고, 다음 소리부터는 새 세션을 연다.
  if (message.goAway && route.session) {
    const old = route.session;
    route.session = null;
    setTimeout(() => old.close(), RETIRE_AFTER_MS).unref();
  }
}

function keepAlive(route: Route): void {
  if (route.idleTimer) clearTimeout(route.idleTimer);
  route.idleTimer = setTimeout(() => {
    route.idleTimer = null;
    const session = route.session;
    route.session = null;
    session?.close();
  }, IDLE_CLOSE_MS);
  route.idleTimer.unref();
}

function close(route: Route): void {
  route.closed = true;
  if (route.idleTimer) clearTimeout(route.idleTimer);
  route.idleTimer = null;
  route.pending = [];
  const session = route.session;
  route.session = null;
  session?.close();
}

function fail(route: Route, error: unknown): void {
  if (route.closed) return;
  const message = error instanceof Error ? error.message : String(error);
  let code = classify(message);
  // 1007(잘못된 설정)·1008(정책 위반)은 같은 설정으로 다시 열어 봐야 또 거부된다.
  const refused = error instanceof CloseError && (error.code === 1007 || error.code === 1008);
  console.warn('통역 음성 실패:', message);

  const now = Date.now();
  route.failures = route.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
  route.failures.push(now);
  route.retryAt = now + RETRY_DELAY_MS;
  if (refused && code === 'unknown') code = 'modelNotFound';

  if (FATAL.has(code) || refused || route.failures.length >= MAX_FAILURES) {
    route.dead = true;
    route.pending = [];
    route.outlet.status('failed', code);
    route.outlet.stopSpeaker();
  }
}

/** 실패 문구를 화면이 알아듣는 코드로. 번역 실패와 같은 코드를 쓴다. */
export function classify(message: string): TranslationErrorCode {
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|unregistered callers|UNAUTHENTICATED/i.test(message)) {
    return 'invalidApiKey';
  }
  if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(message)) {
    return /PerDay|per day|daily/i.test(message) ? 'quotaDay' : 'quotaMinute';
  }
  if (/NOT_FOUND|not found|is not supported|not supported for/i.test(message)) return 'modelNotFound';
  if (/UNAVAILABLE|overloaded|high demand|\b50[0234]\b|INTERNAL/i.test(message)) return 'overloaded';
  if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout/i.test(message)) return 'network';
  return 'unknown';
}
