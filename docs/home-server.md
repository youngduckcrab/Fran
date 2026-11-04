# 집 컴퓨터(Windows)를 서버로

집에 늘 켜 두는 Windows 컴퓨터에서 Fran 서버를 돌린다. 돈이 들지 않고 잠들지도 않는다.

```
폰·브라우저 ──https──▶ Tailscale Funnel (fran.<이름>.ts.net)
                              │  공유기 포트를 열지 않는다. 집 IP 도 드러나지 않는다.
                              ▼
                     집 컴퓨터 ─ Docker Desktop
                       ├ tailscale  인터넷 주소
                       ├ fran       서버(API·WebSocket·웹)
                       └ updater    새 판이 나오면 2분 안에 바꿔 띄움
                              │
                              ▼
                     Neon(DB) — 지금 쓰던 그대로. 대화를 옮길 일이 없다.
```

서버 이미지는 GitHub Actions(`Server image`)가 만들어 `ghcr.io/youngduckcrab/fran` 에 올린다. 집 컴퓨터는
그걸 받아서 돌리기만 하므로 코드를 내려받거나 빌드할 일이 없다.

**알아 둘 것**

- 컴퓨터가 꺼지거나 잠들면 서버도 멈춘다. 다시 켜지면 저절로 돌아온다.
- Docker Desktop 은 Windows 에 **로그인해야** 켜진다. 업데이트로 재부팅되면 누군가 로그인할 때까지
  서버가 멈춘다. 1단계의 자동 로그인을 해 두면 이 문제가 없다.
- Tailscale Funnel 은 무료이고 아직 베타다. 속도 제한이 있는데(공개된 수치는 없다), 메시지·사진·통역
  음성에는 충분하다. 영상·음성 통화는 Funnel 을 거치지 않고 폰끼리 직접 간다.

## 1. 컴퓨터가 잠들지 않게

1. **설정 → 시스템 → 전원(및 배터리) → 화면 및 절전**에서 "전원 연결 시 … 절전 모드로 전환"을 **안 함**.
2. 노트북이면 **제어판 → 전원 옵션 → 덮개를 닫으면 수행되는 작업**을 전원 연결 시 **아무 것도 안 함**.
3. (권장) **자동 로그인.** 재부팅 뒤에도 서버가 저절로 켜지게 한다.
   1. 설정 → 계정 → 로그인 옵션 → "보안 강화를 위해 … Windows Hello 로그인만 허용" 을 **끔**.
   2. `Win + R` → `netplwiz` → "사용자 이름과 암호를 입력해야 이 컴퓨터를 사용할 수 있음" **체크 해제** → 확인 → 암호 입력.
   3. 이 칸이 보이지 않으면 건너뛴다. 대신 재부팅되면 한 번 로그인만 해 주면 된다.

## 2. Docker Desktop

1. <https://www.docker.com/products/docker-desktop/> 에서 Windows 용을 받아 설치한다.
   "Use WSL 2" 는 켠 채로 둔다. 재부팅하라고 하면 한다. 개인 사용은 무료다.
2. 처음 켤 때 나오는 로그인·설문은 **Skip** 해도 된다.
3. **Settings(톱니) → General → Start Docker Desktop when you sign in to your computer** 를 켠다.

## 3. Tailscale (브라우저에서만)

1. <https://login.tailscale.com/start> 에서 가입한다(Google 계정 등, 무료 Personal).
   기기에 Tailscale 을 설치하라는 안내가 나오면 **건너뛴다** — 서버는 Docker 안의 Tailscale 을 쓴다.
2. **DNS** 탭: MagicDNS 가 켜져 있는지 보고, 아래쪽 **HTTPS Certificates → Enable** 을 누른다.
3. **Access controls** 탭: 정책 파일에 `funnel` 이 있는지 찾는다. 없으면 맨 바깥 `{ }` 안에 이 덩어리를
   넣고 **Save**:

   ```json
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ],
   ```

   이미 `"nodeAttrs"` 가 있으면 그 목록 안에 `{ … "funnel" … }` 한 줄만 더한다.
4. **Settings → Keys → Generate auth key…** 를 기본값 그대로 만들고, 나온 `tskey-auth-…` 를 복사해 둔다.
   처음 한 번 로그인할 때만 쓰인다.

## 4. 서버 파일 놓기

1. `C:\fran` 폴더를 만든다.
2. 시작 메뉴에서 **PowerShell** 을 열고 한 줄씩:

   ```powershell
   cd C:\fran
   iwr https://raw.githubusercontent.com/youngduckcrab/Fran/HEAD/deploy/home/compose.yml -OutFile compose.yml
   iwr https://raw.githubusercontent.com/youngduckcrab/Fran/HEAD/deploy/home/.env.example -OutFile .env
   notepad .env
   ```

   > 아직 기본 브랜치에 합치지 않았다면 주소의 `HEAD` 를 브랜치 이름으로 바꾼다.
3. 메모장에서 `.env` 를 채우고 저장한다.
   - `TS_AUTHKEY` — 3단계에서 복사한 키
   - 나머지 — Render 의 Environment 에 있던 이름과 값 **그대로**
   - 아직 합치지 않은 브랜치를 쓴다면 `FRAN_TAG` 의 `#` 을 지우고 브랜치 이름을 적는다(`/` 는 `-` 로).

## 5. 켜기

```powershell
cd C:\fran
docker compose up -d
```

처음에는 이미지를 받느라 몇 분 걸린다. 그다음:

1. `docker compose ps` 에서 `fran` 이 **healthy** 가 될 때까지 기다린다(1분쯤).
2. Tailscale 관리 화면 **Machines** 에 `fran` 이 생긴다. 이름 아래 주소가 `fran.<이름>.ts.net` 이다.
3. 그 줄 오른쪽 **⋯ → Disable key expiry.** 안 하면 180일 뒤에 저절로 끊긴다.
4. 브라우저에서 `https://fran.<이름>.ts.net/healthz` 를 연다. `{"ok":true,"ready":true}` 면 성공이다.
   처음 한 번은 인증서를 받느라 수십 초 걸릴 수 있다.
5. `https://fran.<이름>.ts.net` 에서 로그인해 지난 대화가 보이는지 본다.

## 6. 폰 앱을 새 주소로

1. GitHub 저장소 → **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name `SERVER_URL`, Value `https://fran.<이름>.ts.net` (끝에 `/` 없이)
2. **Actions → Android APK → Run workflow.** 10분쯤 뒤 새 APK 가 나온다.
3. 두 폰 모두 <https://github.com/youngduckcrab/Fran/releases/tag/android-latest> 에서 받아 덮어 깐다.
   `AUTH_SECRET` 이 같으면 다시 로그인할 필요가 없다.

## 7. 정리

- 브라우저로 쓰던 사람은 새 주소에서 다시 로그인하고, 홈 화면 아이콘과 알림을 새로 만든다(웹은 주소마다 따로다).
- 두 사람 모두 새 앱으로 바꾼 뒤 Render 서비스를 **Suspend** 한다. 옛 서버와 새 서버에 한 사람씩 붙어 있으면
  메시지가 실시간으로 오가지 않는다.
- 저장소 Variables 의 `APP_URL` 은 지운다(Render 를 깨우던 것).

## 평소에

| 하고 싶은 것 | PowerShell (`cd C:\fran` 뒤에) |
| --- | --- |
| 상태 보기 | `docker compose ps` |
| 서버 기록 보기 | `docker compose logs -f fran` (끝내려면 `Ctrl+C`) |
| 지금 바로 새 판으로 | `docker compose pull fran; docker compose up -d` |
| 끄기 / 다시 켜기 | `docker compose down` / `docker compose up -d` |
| `.env` 를 고친 뒤 | `docker compose up -d` |

새 판은 updater 가 2분마다 확인해서 저절로 바꿔 띄운다. 주소로 서버가 안 보이면 다시 켜서 되살리기도 한다. 코드가 바뀌어 GitHub Actions 의 `Server image` 가
끝나면 곧 반영된다.

## 안 될 때

| 증상 | 볼 곳 |
| --- | --- |
| `docker compose up` 이 `TS_AUTHKEY` 를 찾음 | `.env` 가 `C:\fran\.env` 에 있는지, 이름이 `.env.txt` 가 아닌지(메모장 저장) |
| 이미지를 못 받음(`denied`, `unauthorized`) | GitHub → 내 프로필 → **Packages → fran → Package settings → Change visibility → Public** |
| `fran` 이 healthy 가 안 됨 | `docker compose logs fran`. 대개 `.env` 의 이름 오타나 `DATABASE_URL` |
| Machines 에 `fran` 이 안 생김 | `docker compose logs tailscale`. 키가 틀렸거나 만료됐으면 새 키를 넣고 `docker compose up -d` |
| 주소로 안 열림 | 3단계의 HTTPS Certificates 와 `funnel` 정책. `docker compose logs tailscale` 에 Funnel 관련 오류가 보인다 |
| 재부팅 뒤 안 켜짐 | Windows 에 로그인했는지, Docker Desktop 의 "Start … when you sign in" |
