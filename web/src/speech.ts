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

/* ------------------------------ 읽을 것만 고르기 ------------------------------ */

/**
 * 소리로 읽을 수 없는 것들.
 *
 * 말풍선에는 이모지가 섞여 들어온다. 그대로 넘기면 합성기가 "빨간 하트", "웃는 얼굴"
 * 하고 이름을 읽어 버린다. 발음이 궁금해서 누른 건데 엉뚱한 말이 끼어드는 셈이다.
 *
 * 숫자 키캡(1️⃣)은 숫자 자체가 이모지가 아니라서 따로 먼저 걷어낸다. 뒤에 붙는 것들
 * (변이 선택자 · ZWJ · 피부색)이 남으면 이어 붙은 이모지가 쪼개져 나오므로 함께 지운다.
 */
const KEYCAP = /[#*0-9]️?⃣/g;

function buildPictographic(): RegExp {
  try {
    return new RegExp(
      '[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\p{Emoji_Modifier}\\p{Regional_Indicator}]' +
        '|[\\uFE0E\\uFE0F\\u200D]',
      'gu',
    );
  } catch {
    // 유니코드 속성을 모르는 낡은 브라우저. 이모지가 모여 있는 구간만 걷어낸다.
    return /[←-⇿⌀-➿⬀-⯿︎️‍]|[\uD83C-\uD83E][\uDC00-\uDFFF]/g;
  }
}

const PICTOGRAPHIC = buildPictographic();

/**
 * ㅋㅋ · ㅎㅎ · ㅠㅠ 처럼 낱자만 늘어놓은 것.
 *
 * 한국어 대화에서는 이게 곧 이모티콘이다. 합성기는 낱자 이름("키읔")을 읽으려 들어서
 * 웃음소리가 되지 않는다. 글자가 아니라 표정이므로 읽지 않는다.
 */
const JAMO_RUN = /[ㄱ-ㆎ]+/g;

/** 무언가 읽을 거리가 남았는지. 기호만 남았으면 읽을 게 없는 것이다. */
const HAS_LETTERS = /[\p{L}\p{N}]/u;

/**
 * 소리로 읽어 줄 글만 남긴다.
 *
 * 지운 자리는 공백으로 둔다 — "좋아❤️사랑해" 를 붙여 버리면 없던 한 단어가 된다.
 */
export function speakable(text: string): string {
  return text
    .replace(KEYCAP, ' ')
    .replace(PICTOGRAPHIC, ' ')
    .replace(JAMO_RUN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 읽어 줄 말이 있는지. 이모지만 있는 말풍선에는 소리 버튼을 띄우지 않는다. */
export function hasSpeech(text: string): boolean {
  return HAS_LETTERS.test(speakable(text));
}

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

    // 이모지는 이름이 읽혀 버린다. 읽을 수 있는 글만 넘긴다.
    const say = speakable(text);
    if (!HAS_LETTERS.test(say)) return;

    setFailedKey(null);
    const utterance = new SpeechSynthesisUtterance(say);
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
