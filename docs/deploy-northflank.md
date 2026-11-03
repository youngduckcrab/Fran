# Northflank 로 옮기기

Render 무료 등급은 15분 동안 아무도 안 들어오면 서버를 재운다. Northflank 의 무료 등급(Sandbox)은
**잠들지 않는다.** 서비스 2개, Postgres 1개를 무료로 주므로 서버와 DB 를 함께 옮기면 둘 다 깨어 있다.

코드는 고치지 않는다. 저장소의 `Dockerfile` 을 그대로 빌드해서 띄운다.

> 무료 등급의 조건(크기, 고를 수 있는 지역, 결제 수단 등록 여부)은 바뀔 수 있다.
> 가입 전에 <https://northflank.com/pricing> 을 한 번 볼 것. Northflank 스스로도 무료 등급을
> "취미·시험용, 가동률 보장 없음" 으로 적어 두었다.

> **2026-10-30 보안 사고.** Northflank 는 저장된 환경변수가 해독됐다고 보고 키를 모두 바꾸라고
> 공지했다(<https://status.northflank.com>). 11월 3일에는 가입 화면에 "Signup is currently disabled" 가
> 떴다. 이것이 사고 때문인지, 언제 다시 열리는지는 공식 발표가 없다. 그래도 쓴다면:
>
> - Gemini 열쇠는 **여기에만 쓰는 새 열쇠**를 만들어 넣는다(<https://aistudio.google.com/apikey>).
>   다시 사고가 나면 그 열쇠만 지우면 된다. 결제를 연결하지 않은 무료 열쇠면 돈이 나갈 일은 없다.
> - GitHub 앱에는 이 저장소 하나만 허락한다.
> - 다시 사고 소식이 들리면 Gemini 열쇠, Neon 비밀번호(새로 만들면 `DATABASE_URL` 도 바뀐다),
>   `AUTH_SECRET` 순으로 바꾼다. `AUTH_SECRET` 을 바꾸면 두 폰 모두 한 번 다시 로그인해야 한다.

## 0. 준비

**지금 Render 의 환경변수를 전부 적어 둔다.** Render 대시보드 → 서비스 → Environment.
값까지 그대로 옮겨야 한다. 특히 둘은 반드시 같은 값이어야 한다.

| 변수 | 왜 같아야 하나 |
| --- | --- |
| `AUTH_SECRET` | 바뀌면 지금 로그인된 폰·브라우저가 전부 로그아웃된다 |
| `DATABASE_URL` | 지금 DB 를 계속 쓰거나(2-A), 옮길 때 원본으로 쓴다(2-B) |

나머지(`USER_A_*`, `USER_B_*`, `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `CLOUDFLARE_TURN_*` 등)도
적어 둔다. 목록은 `.env.example` 에 있다.

**어느 브랜치를 올릴지 정한다.** Render 가 올리고 있는 브랜치와 같은 것을 고르면 된다.
통화 중 번역 읽어주기·통역 음성이 들어간 코드를 올리려면 그 브랜치를 먼저 합치거나, 그 브랜치를
골라 올린다.

## 1. 가입과 프로젝트

1. <https://app.northflank.com/signup> 에서 GitHub 계정으로 가입한다. 저장소에 접근을 허락하면
   `youngduckcrab/Fran` 을 고를 수 있게 된다. 결제 수단을 물으면 등록해야 할 수 있다.
2. **Create new → Project.** 이름은 `fran`.
   지역을 고를 수 있으면 한국과 칠레 사이인 **미국(서부)** 쪽이 무난하다. 메시지는 어느 지역이든
   빠르고, 영상·음성은 서버를 거치지 않고 폰끼리 간다.

## 2. 데이터베이스

둘 중 하나를 고른다.

### 2-A. 지금 DB 를 그대로 쓴다 (가장 쉬움)

Neon·Supabase 등에 둔 DB 를 그대로 쓰면 데이터를 옮길 일이 없다. 3단계에서 `DATABASE_URL` 에
지금 값을 그대로 넣으면 끝이다.

단, Neon 무료는 몇 분 동안 쓰지 않으면 DB 를 멈췄다가 첫 요청 때 깨운다. 서버는 깨어 있으니
화면은 바로 뜨고, 첫 메시지만 몇 초 늦을 수 있다.

### 2-B. DB 도 Northflank 로 옮긴다 (DB 도 잠들지 않음)

1. 프로젝트에서 **Create new → Addon → PostgreSQL.**
   - 버전은 **지금 DB 와 같거나 더 높게**(Neon 대시보드에 보인다). 낮으면 옮기다 실패할 수 있다.
   - **TLS 는 끈다.** 서버와 DB 가 같은 프로젝트 안에서만 이야기하므로 필요 없고, 끄면 설정이 단순하다.
   - 크기는 무료로 고를 수 있는 가장 작은 것.
2. 만들어지면 **Backups → Import backup → Connection string** 을 고르고 지금 DB 주소를 넣는다.
   Neon 이라면 대시보드의 연결 문자열 끝에 `?sslmode=require` 가 붙은 그대로.
   - 가져오기가 끝나면 백업 목록에 생긴 것을 골라 **Restore.**
   - 이 작업은 Northflank 쪽 DB 를 지우고 덮어쓴다. 처음 만든 빈 DB 라 상관없다.
3. **DB 이름을 확인한다.** 가져온 DB 는 **원래 이름 그대로** 들어온다(Neon 이면 보통 `neondb`).
   Northflank 가 처음 만든 기본 DB 는 비어 있는 채로 따로 남는다. 그래서 3단계에서 넣을
   연결 문자열의 **맨 끝 DB 이름을 가져온 이름으로 바꿔야 한다.**

   ```
   postgresql://사용자:비밀번호@호스트:5432/기본이름   ← Northflank 가 보여 주는 것
   postgresql://사용자:비밀번호@호스트:5432/neondb    ← 넣을 것
   ```

   연결 문자열은 Addon → **Connection details** 의 `POSTGRES_URI`(안쪽 주소).

> 웹 푸시용 서명 키, 바꾼 패스코드, 앱 알림 토큰도 DB 에 들어 있다. DB 를 통째로 옮기면 함께 온다.

## 3. 서버

1. 프로젝트에서 **Create new → Service → Combined service.**
   - Repository: `youngduckcrab/Fran`, Branch: 0단계에서 정한 브랜치.
   - Build type: **Dockerfile.** 경로 `/Dockerfile`, 빌드 위치 `/` (기본값 그대로).
   - Port: `8787` 이 저절로 잡힌다(`Dockerfile` 의 `EXPOSE`). **HTTP, Public** 인지 확인.
   - Resources: 무료로 고를 수 있는 것. 이 서버는 켜 둔 채 **100MB 남짓** 쓴다(직접 재 본 값).
     256MB 면 돌고, 고를 수 있으면 512MB 가 여유 있다.
2. **Environment variables** 에 0단계에서 적어 둔 것을 넣는다.

   | 변수 | 값 |
   | --- | --- |
   | `DATABASE_URL` | 2-A: 지금 값 그대로 / 2-B: 이름을 고친 `POSTGRES_URI` |
   | `DATABASE_SSL` | 2-A: 넣지 않음(기본 `on`) / 2-B: `off` (TLS 를 껐으므로) |
   | `AUTH_SECRET` | Render 와 **같은 값** |
   | `USER_A_*`, `USER_B_*` | Render 와 같은 값 |
   | `GEMINI_API_KEY` | 여기에만 쓰는 **새 열쇠**(위 보안 사고 참고) |
   | 나머지 | Render 와 같은 값 |

   `PORT` 는 넣지 않는다(이미지에 `8787` 로 들어 있다). JSON 을 통째로 넣는 `FIREBASE_SERVICE_ACCOUNT` 는
   값 칸에 그대로 붙여 넣으면 된다.
3. **Health checks → Add → Readiness, HTTP, 경로 `/healthz`, 포트 `8787`.**
   첫 확인까지 10초쯤 기다리게 둔다. 이게 있으면 새로 배포할 때 준비가 끝난 뒤에야 트래픽을 넘긴다.
4. **Create service.** 처음 빌드는 몇 분 걸린다.
5. 서비스 화면 위쪽에 주소가 생긴다. `https://p01--fran--xxxxxxxx.code.run` 같은 모양이다.
   열어서 로그인하고 지난 대화가 보이면 성공이다. `https://…/healthz` 가 `{"ok":true,"ready":true}` 면
   DB 까지 붙은 것이다.

이후로는 그 브랜치에 푸시할 때마다 Northflank 가 다시 빌드해서 올린다.

## 4. 폰 앱을 새 주소로

앱은 빌드할 때 서버 주소가 들어간다. 저장소 변수 하나로 바꾼다.

1. GitHub 저장소 → **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name: `SERVER_URL`
   - Value: 3단계에서 받은 주소. 끝에 `/` 를 붙이지 않는다.
2. **Actions → Android APK → Run workflow** 로 새로 빌드한다(10분쯤).
3. 두 폰 모두 <https://github.com/youngduckcrab/Fran/releases/tag/android-latest> 에서 받아 덮어 깐다.
   `AUTH_SECRET` 이 같으면 다시 로그인할 필요가 없다.

변수를 지우면 원래 주소(`https://fran-g4j5.onrender.com`)로 돌아간다.

## 5. 웹(브라우저)으로 쓰고 있었다면

주소가 바뀌므로 브라우저 입장에서는 다른 사이트다.

- 새 주소에서 **한 번 다시 로그인**한다.
- 홈 화면에 추가해 둔 아이콘은 옛 주소를 가리킨다. 지우고 **새 주소로 다시 추가**한다.
- **알림을 다시 허용**한다. 웹 알림은 주소마다 따로다.

## 6. 정리

며칠 써 보고 문제가 없으면:

- Render 서비스를 **Suspend** 한다(지우는 것은 그 뒤에). 옛 앱이 옛 서버에 붙어 대화가 갈라지는 일을 막는다.
- 2-B 로 옮겼다면 옛 DB 는 한동안 두었다가 지운다.
- 저장소 Variables 의 `APP_URL` 은 지운다. 서버를 깨우는 `Keep alive` 액션은 이제 필요 없다.
- 무료 통화 중계(TURN)·Gemini·Firebase 설정은 서버 환경변수로만 따라오므로 따로 할 일이 없다.

## 안 될 때

| 증상 | 볼 곳 |
| --- | --- |
| 빌드 실패 | 서비스 → Builds → 로그. 대개 브랜치를 잘못 골랐거나 저장소 접근 권한 |
| 배포는 됐는데 접속 안 됨 | Port 가 `8787`, HTTP, Public 인지 |
| `/healthz` 가 `"ready":false` 로 남음 | Runtime logs. `DATABASE_URL` 의 DB 이름(2-B 의 3번)과 `DATABASE_SSL` |
| 로그인이 안 됨 | `USER_*_PASSCODE` 와 `AUTH_SECRET`. 앱에서 패스코드를 바꿨다면 그건 DB 에 있으니 DB 를 옮겼는지 |
| 번역이 안 됨 | `GEMINI_API_KEY` |
| 앱이 여전히 옛 서버로 감 | `SERVER_URL` 변수를 넣은 **뒤에** APK 를 새로 빌드해서 깔았는지 |
