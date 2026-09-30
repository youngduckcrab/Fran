const fs = require('fs');
const path = require('path');

/**
 * 서버 주소. 빌드할 때 EXPO_PUBLIC_SERVER_URL 로 바꿀 수 있다.
 * 앱은 이 주소의 서버와만 이야기한다 — 로그인, 메시지, 통화 신호 전부.
 */
const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL || 'https://fran-g4j5.onrender.com';

/**
 * 푸시 알림에 쓰는 Firebase 설정 파일. 저장소에 올리지 않는다(.gitignore).
 * 없으면 알림 없이 빌드된다 — 앱이 켜져 있을 때의 알림은 그래도 된다.
 */
const googleServices = path.join(__dirname, 'google-services.json');
const hasFirebase = fs.existsSync(googleServices);

module.exports = {
  expo: {
    name: 'Fran',
    slug: 'fran',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/icon.png',
    scheme: 'fran',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#17121f',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#17121f',
    },
    extra: { serverUrl },
    android: {
      package: 'com.youngduckcrab.fran',
      // 앱을 올릴 때마다 커져야 한다. Actions 가 실행 번호로 덮어쓴다.
      versionCode: Number(process.env.FRAN_VERSION_CODE || 1),
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundColor: '#e79ad6',
      },
      permissions: [
        'android.permission.INTERNET',
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
      ],
      softwareKeyboardLayoutMode: 'resize',
      ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.youngduckcrab.fran',
      infoPlist: {
        NSCameraUsageDescription: '영상통화와 사진을 보내려면 카메라가 필요해요.',
        NSMicrophoneUsageDescription: '통화와 음성 메시지를 보내려면 마이크가 필요해요.',
        NSSpeechRecognitionUsageDescription: '통화 중 말을 자막으로 옮기려면 음성 인식이 필요해요.',
        NSPhotoLibraryUsageDescription: '사진을 보내고 배경으로 쓰려면 사진 보관함이 필요해요.',
        UIBackgroundModes: ['audio', 'voip'],
      },
    },
    plugins: [
      [
        'expo-build-properties',
        {
          android: {
            // react-native-webrtc 가 요구하는 최소 버전.
            minSdkVersion: 24,
            // https 서버만 쓴다. 평문 통신은 막아 둔다.
            usesCleartextTraffic: false,
          },
        },
      ],
      [
        '@config-plugins/react-native-webrtc',
        {
          cameraPermission: '영상통화와 사진을 보내려면 카메라가 필요해요.',
          microphonePermission: '통화와 음성 메시지를 보내려면 마이크가 필요해요.',
        },
      ],
      [
        'expo-speech-recognition',
        {
          microphonePermission: '통화와 음성 메시지를 보내려면 마이크가 필요해요.',
          speechRecognitionPermission: '통화 중 말을 자막으로 옮기려면 음성 인식이 필요해요.',
        },
      ],
      'expo-secure-store',
      [
        'expo-notifications',
        { icon: './assets/favicon.png', color: '#e79ad6' },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: '사진을 보내고 배경으로 쓰려면 사진 보관함이 필요해요.',
          cameraPermission: '사진을 찍어 보내려면 카메라가 필요해요.',
        },
      ],
      [
        'expo-audio',
        { microphonePermission: '음성 메시지를 녹음하려면 마이크가 필요해요.' },
      ],
    ],
  },
};
