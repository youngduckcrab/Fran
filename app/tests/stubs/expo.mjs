/**
 * 노드에는 폰의 네이티브 모듈이 없다. 통역 음성 모듈(FranAudio)만 가짜로 둔다.
 *
 * 테스트는 globalThis.__franAudio 로 들여다보고 마이크 소리를 흘려 넣는다.
 * require 와 import 로 두 번 불려도 같은 것을 보도록 전역에 둔다.
 */
const audio = (globalThis.__franAudio ??= {
  tapping: false,
  /** 튼 소리. */
  played: [],
  stopped: 0,
  listeners: new Set(),
  /** 마이크에서 소리 한 토막이 떼어진 것처럼. */
  emit(pcm, level) {
    for (const listener of audio.listeners) listener({ pcm, level });
  },
});

class FakeFranAudio {
  isTapReady() {
    return true;
  }
  startTap() {
    audio.tapping = true;
  }
  stopTap() {
    audio.tapping = false;
  }
  play(pcm, rate) {
    audio.played.push({ pcm, rate });
    return 0.3;
  }
  stopPlayback() {
    audio.stopped += 1;
  }
  addListener(_name, listener) {
    audio.listeners.add(listener);
    return { remove: () => audio.listeners.delete(listener) };
  }
}

export class NativeModule {}
export function requireOptionalNativeModule(name) {
  return name === 'FranAudio' ? new FakeFranAudio() : null;
}
