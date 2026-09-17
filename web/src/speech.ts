import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LangCode } from '@fran/shared';

/**
 * 어떤 목소리로 읽을지. 앞에 적힌 것부터 찾는다.
 *
 * 스페인어는 중남미 쪽을 먼저 본다. Fran 이 칠레 사람이라, 스페인 억양으로
 * 배워 두면 정작 들을 일이 있는 발음과 어긋난다.
 */
const VOICE_PREFERENCE: Record<LangCode, string[]> = {
  ko: ['ko-KR', 'ko'],
  es: ['es-CL', 'es-419', 'es-MX', 'es-AR', 'es-US', 'es-ES', 'es'],
  en: ['en-US', 'en-GB', 'en'],
  zh: ['zh-CN', 'zh-Hans', 'zh-TW', 'zh'],
};

/** 공부하려고 듣는 거라 평소 속도보다 조금 느리게. */
const RATE = 0.92;

function synth(): SpeechSynthesis | null {
  // 오래된 인앱 브라우저에는 없다. 없으면 버튼 자체를 띄우지 않는다.
  // 이름만 있고 알맹이가 없는 경우도 있어서 speak 까지 확인한다.
  if (typeof window === 'undefined') return null;
  const speech = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return speech && typeof speech.speak === 'function' ? speech : null;
}

export function speechSupported(): boolean {
  return synth() !== null;
}

function normalize(tag: string): string {
  return tag.replace('_', '-').toLowerCase();
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: LangCode): SpeechSynthesisVoice | undefined {
  for (const wanted of VOICE_PREFERENCE[lang]) {
    const exact = voices.find((voice) => normalize(voice.lang) === normalize(wanted));
    if (exact) return exact;
  }
  // 정확히 맞는 지역이 없으면 같은 언어면 된다.
  return voices.find((voice) => normalize(voice.lang).startsWith(lang));
}

export interface Speaker {
  supported: boolean;
  /** 지금 소리를 내고 있는 대상. 없으면 null. */
  speakingKey: string | null;
  /** 그 언어 목소리가 이 기기에 없어서 실패한 대상. */
  failedKey: string | null;
  /** 같은 대상을 다시 누르면 멈춘다. */
  toggle: (key: string, text: string, lang: LangCode) => void;
}

export function useSpeaker(): Speaker {
  const supported = useMemo(speechSupported, []);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  /** 눌린 순간에 최신 값이 필요해서 state 와 따로 둔다. */
  const speakingRef = useRef<string | null>(null);

  useEffect(() => {
    const speech = synth();
    if (!speech) return;
    // 목소리 목록은 늦게 채워진다. 미리 받아 두면 누를 때 기다릴 일이 없다.
    const load = () => {
      voicesRef.current = speech.getVoices();
    };
    load();
    speech.addEventListener('voiceschanged', load);
    return () => {
      speech.removeEventListener('voiceschanged', load);
      speech.cancel();
    };
  }, []);

  const toggle = useCallback((key: string, text: string, lang: LangCode) => {
    const speech = synth();
    if (!speech) return;

    const again = speakingRef.current === key;
    // 누를 때마다 이전 소리는 무조건 끊는다. 두 개가 겹쳐 나오면 알아들을 수 없다.
    speakingRef.current = null;
    setSpeakingKey(null);
    speech.cancel();
    if (again) return;

    setFailedKey(null);
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voicesRef.current, lang);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? VOICE_PREFERENCE[lang][0] ?? lang;
    utterance.rate = RATE;
    const done = () => {
      if (speakingRef.current !== key) return;
      speakingRef.current = null;
      setSpeakingKey(null);
    };
    utterance.onend = done;
    utterance.onerror = (event) => {
      // 우리가 끊은 건 실패가 아니다.
      if (event.error !== 'canceled' && event.error !== 'interrupted') setFailedKey(key);
      done();
    };

    speakingRef.current = key;
    setSpeakingKey(key);
    // iOS 는 사용자가 누른 그 순간에 speak() 가 불려야 소리를 내준다. 기다리지 않는다.
    speech.speak(utterance);
  }, []);

  return { supported, speakingKey, failedKey, toggle };
}
