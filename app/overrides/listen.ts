import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import type { LangCode } from '@fran/shared';

/**
 * 내 말을 받아쓴다 — 앱 판.
 *
 * 웹 판(web/src/listen.ts)은 브라우저의 SpeechRecognition 을 썼다. 앱에서는 폰 자체의
 * 음성인식(안드로이드 SpeechRecognizer, iOS SFSpeechRecognizer)을 쓴다. 웹처럼
 * "애플에서는 기본으로 끈다" 같은 제한이 없다.
 *
 * call.ts 가 부르는 이름과 모양은 웹 판과 같게 둔다.
 */

/** 애플 기기인지. call.ts 가 "왜 안 되는지" 문구를 고르는 데 쓴다. */
export function isApple(): boolean {
  return Platform.OS === 'ios';
}

/** 웹에서 "애플에서 그래도 켜 보기" 스위치였던 것. 앱에서는 늘 켜져 있다. */
export function tryingOnApple(): boolean {
  return true;
}

export function setTryOnApple(_on: boolean): void {
  // 앱에서는 고를 것이 없다.
}

/** 앱은 폰의 음성인식을 직접 쓰므로 어디서나 시도한다. 안 되면 통화 화면이 알려 준다. */
export function canListen(): boolean {
  return true;
}

/** 지역까지 붙여야 알아듣는 확률이 올라간다. Fran 은 칠레 사람이라 es-CL. */
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
 * 인식기는 조용하면 스스로 끝난다. 통화가 이어지는 동안에는 곧바로 다시 켠다.
 */
export function listen({ lang, onLine, onError }: ListenOptions): Listener {
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const onResult = (event: ExpoSpeechRecognitionResultEvent) => {
    const text = event.results[0]?.transcript?.trim();
    if (text) onLine(text, event.isFinal);
  };

  const onErrorEvent = (event: ExpoSpeechRecognitionErrorEvent) => {
    // 조용했거나 우리가 멈춘 것은 알릴 일이 아니다.
    if (event.error === 'no-speech' || event.error === 'speech-timeout' || event.error === 'aborted') return;
    onError?.(event.error);
    // 마이크나 인식 권한이 막힌 것이면 다시 켜 봐야 같은 일이 반복된다.
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') stopped = true;
  };

  const onEnd = () => {
    if (stopped) return;
    restartTimer = setTimeout(begin, 250);
  };

  const subscriptions = [
    ExpoSpeechRecognitionModule.addListener('result', onResult),
    ExpoSpeechRecognitionModule.addListener('error', onErrorEvent),
    ExpoSpeechRecognitionModule.addListener('end', onEnd),
  ];

  function begin() {
    if (stopped) return;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: DIALECT[lang],
        interimResults: true,
        // 안드로이드 12 이하에서는 지원되지 않아도 끝나면 위에서 다시 켠다.
        continuous: true,
        maxAlternatives: 1,
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'free_form' },
      });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'unknown');
    }
  }

  void (async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null);
    if (stopped) return;
    if (!permission?.granted) {
      stopped = true;
      onError?.('not-allowed');
      return;
    }
    begin();
  })();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      for (const subscription of subscriptions) subscription.remove();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // 이미 끝난 뒤. 할 일이 없다.
      }
    },
  };
}
