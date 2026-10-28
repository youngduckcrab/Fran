/**
 * 받아쓰기를 몇 번 켜고 껐는지. 번역을 읽는 동안 쉬는지 테스트가 본다.
 * 이 파일은 require 와 import 로 두 번 불려 따로 살 수 있어서, 세는 곳은 전역에 하나만 둔다.
 */
export const recognition = (globalThis.__franRecognition ??= { starts: 0, aborts: 0 });
export const ExpoSpeechRecognitionModule = {
  addListener: () => ({ remove() {} }),
  start() {
    recognition.starts += 1;
  },
  abort() {
    recognition.aborts += 1;
  },
  requestPermissionsAsync: async () => ({ granted: true }),
};
