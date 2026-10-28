import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import type { LangCode } from '@fran/shared';
import { HAS_LETTERS, hasSpeech, speakable } from './speakable';

/**
 * 말풍선의 소리 버튼 — 앱 판. 웹 판(web/src/speech.ts)은 브라우저의 speechSynthesis 를
 * 썼고, 앱에서는 폰의 음성 합성(TTS)을 쓴다. 쓰는 쪽이 보는 모양은 같다.
 */
export { hasSpeech, speakable };

/** 스페인어는 중남미 쪽을 먼저 본다. Fran 이 칠레 사람이라, 들을 일이 있는 발음과 맞춘다. */
const VOICE_PREFERENCE: Record<LangCode, string[]> = {
  ko: ['ko-KR', 'ko'],
  es: ['es-CL', 'es-419', 'es-MX', 'es-AR', 'es-US', 'es-ES', 'es'],
  en: ['en-US', 'en-GB', 'en'],
  zh: ['zh-CN', 'zh-Hans', 'zh-TW', 'zh'],
};

/** 공부하려고 듣는 거라 평소 속도보다 조금 느리게. */
const RATE = 0.92;

/** 통화 중에 번역을 읽어 줄 때. 말이 계속 이어지는 중이라 늦게 읽으면 밀린다. */
const CALL_RATE = 1.05;

export function speechSupported(): boolean {
  return true;
}

const norm = (tag: string) => tag.replace('_', '-').toLowerCase();

function pickVoice(voices: Speech.Voice[], lang: LangCode): Speech.Voice | undefined {
  for (const wanted of VOICE_PREFERENCE[lang]) {
    const exact = voices.find((voice) => norm(voice.language) === norm(wanted));
    if (exact) return exact;
  }
  return voices.find((voice) => norm(voice.language).startsWith(lang));
}

export interface Speaker {
  supported: boolean;
  speakingKey: string | null;
  failedKey: string | null;
  toggle: (key: string, text: string, lang: LangCode) => void;
}

export function useSpeaker(): Speaker {
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const voices = useRef<Speech.Voice[]>([]);
  const speaking = useRef<string | null>(null);

  useEffect(() => {
    void Speech.getAvailableVoicesAsync()
      .then((list) => {
        voices.current = list;
      })
      .catch(() => {});
    return () => {
      void Speech.stop();
    };
  }, []);

  const toggle = useCallback((key: string, text: string, lang: LangCode) => {
    const again = speaking.current === key;
    // 누를 때마다 이전 소리는 끊는다. 두 개가 겹쳐 나오면 알아들을 수 없다.
    speaking.current = null;
    setSpeakingKey(null);
    void Speech.stop();
    if (again) return;

    const say = speakable(text);
    if (!HAS_LETTERS.test(say)) return;

    setFailedKey(null);
    const voice = pickVoice(voices.current, lang);
    const done = () => {
      if (speaking.current !== key) return;
      speaking.current = null;
      setSpeakingKey(null);
    };
    speaking.current = key;
    setSpeakingKey(key);
    Speech.speak(say, {
      language: voice?.language ?? VOICE_PREFERENCE[lang][0] ?? lang,
      ...(voice ? { voice: voice.identifier } : {}),
      rate: RATE,
      onDone: done,
      onStopped: done,
      onError: () => {
        setFailedKey(key);
        done();
      },
    });
  }, []);

  return { supported: true, speakingKey, failedKey, toggle };
}

/** 통화 중에 쓸 목소리 목록. 한 번만 받아 둔다. */
let callVoices: Speech.Voice[] = [];
let callVoicesAsked = false;

function loadCallVoices(): void {
  if (callVoicesAsked) return;
  callVoicesAsked = true;
  void Speech.getAvailableVoicesAsync()
    .then((list) => {
      callVoices = list;
    })
    .catch(() => {});
}

/**
 * 한 줄을 끝까지 읽고 onDone 을 부른다 — 앱 판. 통화 중 번역 읽어 주기가 쓴다.
 * 돌려준 함수로 멈추면 onDone 은 불리지 않는다.
 */
export function speakLine(text: string, lang: LangCode, onDone: () => void): () => void {
  loadCallVoices();
  const say = speakable(text);
  if (!HAS_LETTERS.test(say)) {
    const timer = setTimeout(onDone, 0);
    return () => clearTimeout(timer);
  }

  let live = true;
  const finish = () => {
    if (!live) return;
    live = false;
    onDone();
  };
  const voice = pickVoice(callVoices, lang);
  Speech.speak(say, {
    language: voice?.language ?? VOICE_PREFERENCE[lang][0] ?? lang,
    ...(voice ? { voice: voice.identifier } : {}),
    rate: CALL_RATE,
    onDone: finish,
    // 말풍선의 소리 버튼이 끊은 경우. 다음 줄로 넘어가면 된다.
    onStopped: finish,
    onError: finish,
  });
  return () => {
    if (!live) return;
    live = false;
    void Speech.stop();
  };
}

/** 웹 판은 여기서 iOS 의 소리 문을 연다. 폰은 그럴 필요가 없고, 목소리 목록만 미리 받는다. */
export function primeSpeech(): void {
  loadCallVoices();
}
