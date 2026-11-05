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

/** 다시 켜 봐야 소용없는 오류. 권한이 막혔거나 이 언어를 못 알아듣는 기기다. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);

/** 진짜 오류가 이만큼 잇달면 그만둔다. 끝없이 켰다 꺼지며 배터리와 마이크만 잡아먹는다. */
const GIVE_UP_AFTER = 8;

/** 받아쓰기가 오류로 끝났을 때 다시 켜기까지의 기다림. 잇달수록 길어진다. */
function retryDelay(failures: number): number {
  return Math.min(250 * 2 ** failures, 8000);
}

/**
 * 받아쓰기를 시작한다. 돌려주는 것으로 멈춘다.
 *
 * 인식기는 조용하면 스스로 끝난다. 통화가 이어지는 동안에는 곧바로 다시 켠다.
 *
 * 인식기는 폰에 하나뿐이다. 앞서 멈춘 받아쓰기(번역을 읽느라 잠깐 쉬었다가 다시 켠 것)의 "끝" 이
 * 새 받아쓰기의 귀에 늦게 들어온다. 그걸 내 것으로 알고 다시 켜면, 막 켠 인식기를 또 켜려다
 * 오류가 나고, 그 오류가 다시 끝을 부르며 빙글빙글 돈다. 내가 켠 뒤 "시작" 을 받기 전에 온 끝은 무시한다.
 */
export function listen({ lang, onLine, onError }: ListenOptions): Listener {
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** starting: 켜 달라고 했고 아직 "시작" 을 못 받았다. running: 듣는 중. failed: 켜다가 오류가 났다. */
  let phase: 'idle' | 'starting' | 'running' | 'failed' = 'idle';
  /** 결과 없이 오류로 끝난 횟수. 무엇이든 알아들으면 0 으로. */
  let failures = 0;

  const onResult = (event: ExpoSpeechRecognitionResultEvent) => {
    const text = event.results[0]?.transcript?.trim();
    if (!text) return;
    failures = 0;
    onLine(text, event.isFinal);
  };

  const onStart = () => {
    if (phase === 'starting') phase = 'running';
  };

  const onErrorEvent = (event: ExpoSpeechRecognitionErrorEvent) => {
    // 조용했거나 우리가 멈춘 것은 알릴 일이 아니다. 조용했다는 건 듣고 있었다는 뜻이기도 하다.
    if (event.error === 'no-speech' || event.error === 'speech-timeout') {
      if (phase === 'starting') phase = 'running';
      return;
    }
    if (event.error === 'aborted' || phase === 'idle') return;
    if (phase === 'starting') phase = 'failed';
    failures += 1;
    // 마이크나 인식 권한이 막힌 것이면 다시 켜 봐야 같은 일이 반복된다.
    if (FATAL.has(event.error)) {
      stopped = true;
      onError?.(event.error);
      return;
    }
    if (failures >= GIVE_UP_AFTER) {
      stopped = true;
      onError?.('gave-up');
    }
  };

  const onEnd = () => {
    if (stopped) return;
    // 앞선 받아쓰기의 끝이 늦게 온 것. 지금 켜고 있는 것은 아직 살아 있다.
    // 혹시 이번 것의 끝이었는데 "시작" 이 빠졌던 거라면, 조금 뒤에도 시작하지 않은 채일 테니 다시 켠다.
    if (phase === 'starting') {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (phase === 'starting') begin();
      }, 4000);
      return;
    }
    if (phase === 'idle') return;
    const delay = phase === 'failed' || failures > 0 ? retryDelay(failures) : 250;
    phase = 'idle';
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(begin, delay);
  };

  const subscriptions = [
    ExpoSpeechRecognitionModule.addListener('start', onStart),
    ExpoSpeechRecognitionModule.addListener('result', onResult),
    ExpoSpeechRecognitionModule.addListener('error', onErrorEvent),
    ExpoSpeechRecognitionModule.addListener('end', onEnd),
  ];

  function begin() {
    restartTimer = null;
    if (stopped) return;
    phase = 'starting';
    try {
      ExpoSpeechRecognitionModule.start({
        lang: DIALECT[lang],
        interimResults: true,
        // 안드로이드 12 이하에서는 지원되지 않아도 끝나면 위에서 다시 켠다.
        continuous: true,
        maxAlternatives: 1,
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'free_form' },
      });
    } catch {
      // 켜지도 못했다. 끝 소식도 오지 않으므로 여기서 다시 잡는다.
      phase = 'idle';
      failures += 1;
      if (failures >= GIVE_UP_AFTER) {
        stopped = true;
        onError?.('gave-up');
        return;
      }
      restartTimer = setTimeout(begin, retryDelay(failures));
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
