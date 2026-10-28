import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * 통역 음성에 쓰는 날소리 — 안드로이드 쪽 모듈(android/…/FranAudioModule.kt)을 부르는 이름들.
 *
 * 마이크는 통화(react-native-webrtc)가 이미 잡고 있다. 이 모듈은 마이크를 따로 열지 않고,
 * 통화 소리 장치가 읽은 소리를 곁에서 받아 넘긴다. 아이폰에는 아직 없다(null).
 */
type FranAudioEvents = {
  /** 통화 마이크 소리 100ms. pcm 은 16kHz 모노 16비트 base64, level 은 크기(RMS, 0~1). */
  onMicChunk: (event: { pcm: string; level: number }) => void;
};

declare class FranAudioModule extends NativeModule<FranAudioEvents> {
  /** WebRTC 에 소리 장치가 끼워졌는지. 앱이 켜질 때 끼운다. */
  isTapReady(): boolean;
  startTap(): void;
  stopTap(): void;
  /** 옮겨 온 소리를 이어 붙인다. 지금부터 다 틀기까지 남은 초를 돌려준다. */
  play(pcm: string, rate: number): number;
  stopPlayback(): void;
}

export const FranAudio = requireOptionalNativeModule<FranAudioModule>('FranAudio');
