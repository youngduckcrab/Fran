# Fran 앱 (안드로이드)

웹을 감싼 것이 아니라 네이티브로 다시 만든 앱이다. 서버는 웹과 같은 것을 쓴다.
React Native(Expo) + TypeScript.

## 받아서 설치하기

폰에서 <https://github.com/youngduckcrab/Fran/releases/tag/android-latest> 를 열어 `fran.apk` 를 받는다.
"출처를 알 수 없는 앱 설치" 를 한 번 허용해야 한다. 코드가 바뀔 때마다 Actions 가 새로 만들어 같은 자리에
덮어쓴다. 앱이 열릴 때 더 새로운 것이 있으면 위에 알려 준다.

> 서명은 개발용 키다. 같은 키로 만들기 때문에 새 APK 를 그 위에 그대로 덮어 깔 수 있다.
> 스토어에 올릴 앱이 아니다.

## 웹과 어떻게 코드를 나누는가

서버와 주고받는 규칙(로그인, 소켓, 재연결, 캐시, 통화 신호, 번역 문구)은 웹과 앱이 **같아야** 한다.
두 벌을 따로 두면 한쪽만 고쳐서 어긋난다. 그래서:

```
web/src/*.ts            ← 원본. 여기를 고친다
   │  scripts/sync-web.mjs 가 복사 (npm install 때 자동, 수동은 npm run sync)
   ▼
app/src/web/*.ts        ← 복사본(git 에 올리지 않는다)
app/overrides/*.ts      ← 브라우저 대신 폰 기능을 쓰는 것. 같은 이름으로 위를 덮어쓴다
                          (listen.ts = 받아쓰기, speech.ts = 읽어주기)
app/src/shims.ts        ← 브라우저 전용 이름(localStorage, location, document, fetch('/api'))을 폰에서 채운다
app/src/screens, ui     ← 화면. 폰용으로 새로 썼다
```

가져오는 목록은 `scripts/sync-web.mjs` 의 `SHARED`. 화면(DOM)에 묶인 코드는 넣지 않는다.

## 만들기

```bash
npm install          # web/src 를 app/src/web 으로 가져온다
npm run typecheck
npm run test:logic   # 아래 참고
npm run android      # 폰을 USB 로 연결한 상태에서 (Android SDK 필요)
```

APK 는 `.github/workflows/android.yml` 이 만든다(`app/`, `shared/` 가 바뀐 푸시마다).
서버 주소는 빌드할 때 `EXPO_PUBLIC_SERVER_URL` 로 바꿀 수 있다(기본 `https://fran-g4j5.onrender.com`).

## 검증

`npm run test:logic` 은 `useChat`·`useCall` 이 폰의 호환 계층 위에서 **실제 서버**와 맞물려 도는지 노드에서
본다(접속 → 전송 → 번역 → 읽음 → 반응/수정 → 검색, 통화 걸기 → 응답 → 자막 번역 → 끊기).
서버가 `http://localhost:8840` 에 떠 있어야 하고(`FRAN_TEST_SERVER`), 가짜 번역 모델이 필요하다.

**폰에서 직접 확인하지 못한 것**: 화면 모양, 카메라·마이크·WebRTC 영상, 통화 중 받아쓰기, 폰 알림.
이것들은 실기기에서 써 봐야 안다.

## 푸시 알림 켜기 (FCM)

앱이 꺼져 있을 때 메시지·전화 알림을 받으려면 Firebase 프로젝트가 필요하다(무료).

1. <https://console.firebase.google.com> 에서 프로젝트를 만들고 안드로이드 앱을 추가한다.
   패키지 이름은 `com.youngduckcrab.fran`.
2. 내려받은 `google-services.json` 을 **GitHub 저장소 → Settings → Secrets → Actions** 에
   `GOOGLE_SERVICES_JSON` 으로 넣는다(파일 내용 통째로). 다음 빌드부터 앱에 들어간다.
3. Firebase → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" 으로 받은 JSON 을 **Render 대시보드의
   환경변수** `FIREBASE_SERVICE_ACCOUNT` 로 넣는다(JSON 통째로).
4. 앱 설정 → 알림을 켜고 "시험 알림" 을 눌러 본다.

> 두 파일 모두 채팅이나 저장소에 붙여 넣지 말 것. 특히 2번의 서비스 계정 키는 비밀이다.
> `google-services.json` 은 `.gitignore` 에 들어 있다.

없이 써도 된다. 알림이 없을 뿐, 앱이 켜져 있는 동안의 알림·진동은 된다.
