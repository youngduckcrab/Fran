// 노드에는 폰용 모듈이 없다. 테스트에서 쓰이는 몇 개를 가짜로 갈아 끼운다.
// 웹 코드는 CJS 로 불려 오기도 해서 require 쪽(_resolveFilename)도 함께 바꾼다.
import Module, { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./hooks.mjs', import.meta.url);

const stub = (name) => fileURLToPath(new URL(`./stubs/${name}.mjs`, import.meta.url));
const STUBS = {
  'react-native': stub('react-native'),
  'expo-speech-recognition': stub('expo-speech-recognition'),
  'expo-speech': stub('expo-speech'),
};

const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return STUBS[request] ?? original.call(this, request, ...rest);
};
