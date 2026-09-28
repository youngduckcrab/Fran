import type { LangCode } from '@fran/shared';

/**
 * 내 말을 받아쓴다.
 *
 * 브라우저에 들어 있는 음성인식을 쓴다. 공짜이고, 안드로이드 크롬에서 잘 돈다.
 * 아이폰(사파리 엔진)은 통화로 마이크를 이미 잡고 있으면 잘 붙지 않는다고 알려져
 * 있어서, 거기서는 켜지지 않는 편이 낫다 — 안 되는 채로 켜져 있으면 말은 안 잡히고
 * 마이크만 흔들린다.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 이 기기에서 받아쓰기를 쓸 수 있는지.
 *
 * API 가 있다고 되는 것은 아니다. iOS 는 있다고 해 놓고 통화 중에는 동작하지 않아서,
 * 여기서 미리 걸러 낸다.
 */
export function canListen(): boolean {
  if (!ctor()) return false;
  const ua = navigator.userAgent;
  const isApple = /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  return !isApple;
}

/**
 * 어느 말로 들을지.
 *
 * 지역까지 붙여야 알아듣는 확률이 올라간다. Fran 은 칠레 사람이라 es-CL 로 들어야
 * 스페인 억양 기준으로 잘못 받아쓰는 일이 준다.
 */
const DIALECT: Record<LangCode, string> = {
  ko: 'ko-KR',
  es: 'es-CL',
  en: 'en-US',
  zh: 'zh-CN',
};

export interface Listener {
  stop: () => void;
}

export interface ListenOptions {
  lang: LangCode;
  /** 말하는 도중에도, 다 말한 뒤에도 부른다. final 이면 그 줄은 끝난 것이다. */
  onLine: (text: string, final: boolean) => void;
  onError?: (reason: string) => void;
}

/**
 * 받아쓰기를 시작한다. 돌려주는 것으로 멈춘다.
 *
 * 인식기는 조용하면 스스로 끝나 버린다. 통화가 끝날 때까지 계속 들어야 하므로
 * 끝나면 곧바로 다시 켠다.
 */
export function listen({ lang, onLine, onError }: ListenOptions): Listener {
  const Recognition = ctor();
  if (!Recognition) {
    onError?.('unsupported');
    return { stop: () => {} };
  }

  let stopped = false;
  let current: SpeechRecognitionLike | null = null;
  /** 이번에 켠 인식기가 넘겨준 확정 줄 수. 다시 켜면 0 부터 센다. */
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const begin = () => {
    if (stopped) return;
    const recognition = new Recognition();
    current = recognition;
    recognition.lang = DIALECT[lang];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      // 이번에 새로 들어온 것만 본다. results 는 처음부터 다 들고 있다.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0].transcript.trim();
        if (text) onLine(text, result.isFinal);
      }
    };

    recognition.onerror = (event) => {
      // no-speech 는 그냥 조용했다는 뜻이다. 알릴 일이 아니다.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      onError?.(event.error);
      // 마이크를 못 쓰게 된 경우라면 다시 켜 봐야 같은 일이 반복된다.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') stopped = true;
    };

    recognition.onend = () => {
      if (stopped) return;
      // 조용하면 스스로 끝난다. 통화가 이어지는 동안에는 다시 켠다.
      restartTimer = setTimeout(begin, 250);
    };

    try {
      recognition.start();
    } catch {
      // 이미 돌고 있는데 또 부른 경우. 그대로 두면 된다.
    }
  };

  begin();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      try {
        current?.abort();
      } catch {
        // 이미 끝난 뒤. 할 일이 없다.
      }
      current = null;
    },
  };
}
