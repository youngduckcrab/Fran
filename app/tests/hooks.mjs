const STUBS = {
  'react-native': new URL('./stubs/react-native.mjs', import.meta.url).href,
  'expo-speech-recognition': new URL('./stubs/expo-speech-recognition.mjs', import.meta.url).href,
  'expo-speech': new URL('./stubs/expo-speech.mjs', import.meta.url).href,
};

export function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return next(specifier, context);
}
