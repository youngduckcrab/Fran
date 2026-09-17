# Fran

둘만 쓰는 메신저. 각자 자기 언어로 쓰면, Claude가 **앞뒤 대화를 읽고** 상대의 언어로 옮겨 준다.

한국어로 보낸 `"오늘 좀 그랬어… ㅠㅠ"` 가 스페인어 쪽에 `"Hoy fue un día raro… buaa"` 로 도착하는 것이 목표다.
사전적으로 맞는 번역이 아니라, **그 사람이 그 언어로 말했다면 했을 법한 문장**을 만드는 데 초점을 둔다.

기본 설정은 **Gemini 무료 티어**라 돈을 내지 않고 시작할 수 있다.

- 한국어 ↔ 스페인어가 기본, 공부 중인 **영어·중국어**도 함께 받아볼 수 있다
- 원문은 절대 덮어쓰지 않는다. 말풍선을 누르면 원문과 다른 언어 번역이 함께 펼쳐진다
- 번역에 **학습용 메모**(관용구·슬랭·놓친 뉘앙스)가 0~2개 붙는다
- 말풍선을 **길게 누르면 설명** — 단어별 뜻, 문법, 이렇게 답하면 된다는 예시까지
- **용어집**에 애칭을 미리 정해둔다. "`애기`는 `bebe` 로, `amor` 로는 쓰지 말 것"
- 이번 메시지만 다르게 옮기고 싶으면 **✎ 로 지시**를 붙인다. 상대에게는 보이지 않는다
- 계정은 두 개뿐. 회원가입도 친구 추가도 없다

## 빠르게 실행하기

```bash
git clone https://github.com/youngduckcrab/Fran.git
cd Fran
npm install                 # shared 패키지까지 자동으로 빌드된다

cp .env.example .env        # 아래 설명대로 채운다
npm run dev                 # 서버 :8787 + 웹 :5173
```

브라우저에서 <http://localhost:5173> 를 열고, `.env` 에 적어둔 패스코드로 로그인한다.

> `.env` 는 **저장소 루트**에 둔다. 서버가 자기 위치를 기준으로 찾으므로 어느 디렉터리에서
> 실행하든 상관없다.

### 혼자서 두 사람 몫을 테스트하려면

로그인 토큰이 브라우저의 `localStorage` 에 저장되기 때문에, 같은 브라우저의 탭 두 개로는
두 사람을 동시에 로그인시킬 수 없다. **일반 창 + 시크릿 창**(또는 다른 브라우저)을 쓰면
양쪽에서 메시지가 오가는 걸 바로 볼 수 있다.

### 폰에서 열어보기

개발 서버와 빌드본 모두 모든 네트워크 인터페이스에 바인딩하므로, **같은 와이파이에 있는
폰이면 컴퓨터 IP로 바로 접속된다.**

```bash
# 컴퓨터 IP 확인
ipconfig getifaddr en0        # macOS
hostname -I                   # Linux
ipconfig                      # Windows (IPv4 주소)
```

| 실행 방식 | 폰에서 열 주소 |
| --- | --- |
| `npm run dev` | `http://<컴퓨터IP>:5173` |
| `npm run build && npm start` | `http://<컴퓨터IP>:8787` |

`npm run dev` 로 띄우면 Vite 가 터미널에 `Network:` 주소를 직접 알려준다.

안 열리면 대개 컴퓨터 방화벽이다. macOS는 시스템 설정 → 네트워크 → 방화벽,
Windows는 첫 실행 때 뜨는 "네트워크 액세스 허용" 대화상자를 확인할 것.

**홈 화면에 추가**해서 앱처럼 쓰는 것까지는 이 상태로도 된다. 다만 서비스 워커
(오프라인 캐시)는 HTTPS 에서만 동작하므로, PWA 를 제대로 확인하려면 아래 터널이 필요하다.

### 컴퓨터가 없다면

폰만 있어도 된다. 두 가지 길이 있다.

**1. GitHub Codespaces — 지금 당장 보고 싶을 때**

저장소 페이지에서 `Code` → `Codespaces` → `Create codespace`. 클라우드에 개발 환경이
뜨고 폰 브라우저에서 그대로 쓸 수 있다. `.devcontainer/` 설정이 있어서 `npm install` 까지
자동으로 돌아간다.

```bash
# Codespaces 터미널에서
cp .env.example .env     # 편집기로 GEMINI_API_KEY, AUTH_SECRET, 패스코드 채우기
npm run dev
```

포트 5173 이 자동으로 https 주소로 열린다. 그 주소를 폰 브라우저에서 열면 끝이다.
https 라서 PWA(홈 화면에 추가, 오프라인 캐시)도 제대로 동작한다.
Fran 에게도 보여주려면 포트 가시성을 Public 으로 바꾼다.

끄면 사라지는 임시 환경이고 무료 사용 시간에 한도가 있으니, 계속 쓸 거라면 아래 배포로.

**2. 배포 — 계속 쓸 때**

`Dockerfile` 이 들어 있어서 컨테이너를 돌릴 수 있는 곳이면 어디든 올라간다.
Docker 를 쓰지 않는 호스트라면 이 두 줄만 설정하면 된다.

| 설정 | 값 |
| --- | --- |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check | `/healthz` |

환경변수는 `.env.example` 의 항목을 호스트의 환경변수 설정에 그대로 넣는다.
`PORT` 는 호스트가 지정해 주면 그대로 따른다.

> **SQLite 파일은 영구 디스크에 두어야 한다.** 볼륨을 붙이고
> `DATABASE_PATH=/data/fran.sqlite` 로 지정할 것. 이걸 빠뜨리면 재배포할 때마다
> 대화 기록이 사라진다. Dockerfile 은 `/data` 를 볼륨으로 잡아두었다.

### 상대와 함께 테스트하기 (다른 나라)

로컬 주소로는 접속할 수 없으니 둘 중 하나가 필요하다.

- **터널링** — ngrok, cloudflared 같은 도구로 로컬 서버에 임시 https 주소를 붙인다.
  개발 서버에 붙일 때는 Vite 가 낯선 도메인을 막으므로 도메인을 알려줘야 한다:

  ```bash
  VITE_ALLOWED_HOSTS=abc-123.ngrok-free.app npm run dev
  ```

- **배포** — `npm run build` 후 `npm start` 하나면 API·WebSocket·웹이 전부 한 프로세스에서
  서빙된다. Node 가 도는 곳이면 어디든 올릴 수 있다. HTTPS 뒤에 두면 PWA 설치도 정상 동작한다.

### .env 채우기

| 항목 | 설명 |
| --- | --- |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 에서 발급. **무료 티어로 시작한다** |
| `AUTH_SECRET` | 로그인 토큰 서명용. `openssl rand -hex 32` 로 만들면 된다 |
| `USER_A_*`, `USER_B_*` | 두 사람의 이름·기본 언어·패스코드. 패스코드는 서로 다르게 |
| `GEMINI_MODEL` | 기본 `gemini-flash-lite-latest` (무료 한도가 가장 넉넉) |
| `TRANSLATION_CONTEXT_SIZE` | 번역할 때 참고할 직전 메시지 수. 기본 12 |

키가 없어도 서버는 뜬다. 메시지는 정상적으로 오가고 번역만 실패한다.

**모델 이름이 맞는지 확인하려면:**

```bash
npm run models --workspace=server     # 내 키로 쓸 수 있는 모델 목록
```

무료 티어에서 쓸 수 있는 모델과 한도는 수시로 바뀌므로, `GEMINI_MODEL` 을 정하기 전에
한 번 돌려보는 편이 확실하다. 현재 한도는 [AI Studio](https://aistudio.google.com) 에서 확인할 것.

**키를 넣은 직후에는 이것부터:**

```bash
npm run try-translate --workspace=server
```

채팅을 띄우지 않고 번역 한 건만 돌려본다. 맥락이 있어야만 풀리는 문장("걔"가 누구인지
앞 대화에만 있다)을 넣어두었으므로, 결과가 제대로 나오면 맥락 번역이 동작하는 것이다.
실패하면 무엇을 해야 하는지까지 화면에 찍힌다.

> 실패했을 때 마지막에 붙는 `npm error ...` 블록은 npm 이 덧붙이는 것이니 무시하고,
> 그 위의 `✗` 로 시작하는 줄을 보면 된다.

### 번역 provider 바꾸기

번역기는 provider 어댑터로 분리돼 있다. `.env` 의 `TRANSLATION_PROVIDER` 한 줄로 갈아끼운다.

| provider | 비용 | 비고 |
| --- | --- | --- |
| `gemini` (기본) | 무료 티어 | 한도가 있고, 무료 티어는 보통 입력 데이터가 모델 개선에 쓰인다 |
| `claude` | 유료 (API 크레딧) | Claude 구독(Pro/Max)과는 **별개로 과금된다** |

> ⚠️ **사적인 대화라는 점을 한 번 생각해볼 것.** 무료 티어는 대개 입력 데이터를 서비스 개선에
> 활용할 수 있다는 조건이 붙는다. 가입할 때 데이터 정책을 직접 확인하고, 마음에 걸리면
> 유료 티어나 `claude` provider로 바꾸면 된다.

### 배포

```bash
npm run build     # shared → server → web 순서로 빌드
npm start         # :8787 하나로 API + WebSocket + 웹까지 전부 서빙
```

`server/dist/index.js` 는 `web/dist` 가 있으면 그것도 같이 정적 서빙한다. 즉 배포는 **프로세스 하나**면 된다.
HTTPS 뒤에 두면 폰에서 브라우저 메뉴의 "홈 화면에 추가"로 앱처럼 설치된다(PWA).

> 둘만 쓰는 앱이라 인증은 사람당 패스코드 하나 + 서명 토큰으로 끝낸다.
> 공개 인터넷에 올린다면 HTTPS는 필수이고, 패스코드는 길고 추측하기 어려운 것으로 잡을 것.

## 구조

```
shared/   두 쪽이 공유하는 타입과 WebSocket 프로토콜
server/   Hono + ws + SQLite + 번역 파이프라인 (Gemini / Claude)
web/      React + Vite PWA
```

| 문서 | 내용 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 메시지가 오가는 경로, 데이터 모델, 설계할 때 정한 것들 |
| [docs/translation.md](docs/translation.md) | 번역 프롬프트 설계, 비용, 품질을 손보는 방법 |
| [docs/roadmap.md](docs/roadmap.md) | 다음에 붙이면 좋을 것들 |

## 명령어

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 서버와 웹을 동시에 개발 모드로 |
| `npm run dev:server` / `npm run dev:web` | 하나씩 따로 |
| `npm run typecheck` | 전 워크스페이스 타입 검사 |
| `npm run build` | 전체 빌드 |
| `npm start` | 빌드 결과로 실행 |
| `npm run models --workspace=server` | 내 Gemini 키로 쓸 수 있는 모델 목록 |
| `npm run try-translate --workspace=server` | 채팅을 띄우지 않고 번역만 한 번 시험 |

`shared/` 를 고쳤다면 `npm run build --workspace=shared` 를 한 번 돌려야 서버·웹에 반영된다.

## 라이선스

MIT
