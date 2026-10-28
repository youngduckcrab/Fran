/**
 * 읽어 달라고 한 것. 테스트가 들여다본다. 다 읽은 것으로 치기까지 조금 기다린다.
 * require 와 import 로 두 번 불려도 같은 목록을 보도록 전역에 둔다.
 */
export const spoken = (globalThis.__franSpoken ??= []);
export const speak = (text, options = {}) => {
  spoken.push({ text, language: options.language });
  setTimeout(() => options.onDone?.(), 150);
};
export const stop = async () => {};
export const getAvailableVoicesAsync = async () => [];
