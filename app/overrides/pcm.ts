import { Platform } from 'react-native';
import { FranAudio } from '../../modules/fran-audio';

/**
 * 통역 음성에 쓰는 날소리 — 앱 판.
 *
 * 웹 판(web/src/pcm.ts)은 브라우저의 AudioContext 로 마이크 소리를 떼어 내고 틀었다.
 * 폰에서는 통화(react-native-webrtc)가 잡은 마이크를 우리 모듈(modules/fran-audio)이
 * 곁에서 받아 넘기고, 옮겨 온 소리는 통화 소리와 같은 길로 튼다.
 *
 * call.ts 가 부르는 이름과 모양은 웹 판과 같게 둔다.
 */

/** 이 기기에서 통역 음성을 쓸 수 있는지. 안드로이드에서 모듈이 있어야 한다. */
export function canInterpret(): boolean {
  return Platform.OS === 'android' && FranAudio !== null;
}

/** 웹 판은 여기서 브라우저의 소리 문을 연다. 폰은 그럴 필요가 없다. */
export function unlockAudio(): void {}

export interface MicTap {
  stop: () => void;
}

/**
 * 통화 마이크 소리를 100ms 씩 onChunk 로 넘긴다.
 * 폰은 통화가 잡은 마이크를 곁에서 듣는 것이라 스트림이 필요 없다.
 */
export function tapMic(_stream: MediaStream | null, onChunk: (pcm: string, level: number) => void): MicTap {
  const audio = FranAudio;
  if (!audio) return { stop: () => {} };
  const subscription = audio.addListener('onMicChunk', (event) => onChunk(event.pcm, event.level));
  audio.startTap();
  return {
    stop: () => {
      subscription.remove();
      audio.stopTap();
    },
  };
}

export interface VoicePlayer {
  /** 소리 한 토막을 앞 토막 뒤에 이어 붙인다. 지금부터 다 틀기까지 남은 초를 돌려준다. */
  play: (pcm: string, rate: number) => number;
  /** 틀던 것과 기다리던 것을 모두 버린다. */
  close: () => void;
}

export function createPlayer(): VoicePlayer {
  const audio = FranAudio;
  if (!audio) return { play: () => 0, close: () => {} };
  return {
    play: (pcm, rate) => audio.play(pcm, rate),
    close: () => audio.stopPlayback(),
  };
}
