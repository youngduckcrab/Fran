# 구조

## 메시지 한 통이 지나가는 길

```
승윤(ko)                     서버                          Fran(es)
   │                          │                               │
   │ ─ send "오늘 어땠어?" ──▶ │                               │
   │                          │ messages 테이블에 원문 저장     │
   │ ◀── message (원문) ────── │ ──── message (원문) ─────────▶ │   ← 즉시. 기다리지 않는다
   │                          │                               │
   │                          │ 번역 큐에 넣음                  │
   │                          │   └ 직전 12개 + 이 메시지        │
   │                          │     → LLM 한 번 호출             │
   │                          │     → translations 테이블 저장   │
   │                          │                               │
   │ ◀ message_updated ────── │ ─ message_updated ──────────▶ │   ← 1~3초 뒤
```

핵심은 **원문 전달과 번역을 분리**한 것이다. 번역이 몇 초 걸리더라도 메시지 자체는 바로 도착하고,
번역문은 같은 말풍선에 나중에 채워진다. 번역이 실패해도 대화는 끊기지 않는다 — 원문이 그대로 남고,
말풍선에 "다시 시도" 버튼이 붙는다.

## 왜 이렇게 했나

**번역 provider는 갈아끼울 수 있다.**
프롬프트와 출력 스키마는 하나로 두고, 모델 호출만 `TranslationProvider` 인터페이스 뒤로
숨겼다. 무료(Gemini)로 쓰다가 품질이 아쉬우면 env 한 줄로 유료(Claude)로 옮길 수 있고,
그때 프롬프트를 다시 쓸 필요가 없다.

**번역은 한 메시지당 API 호출 한 번.**
필요한 언어가 두 개든 네 개든 한 번의 호출에서 전부 받는다. 같은 맥락을 여러 번 보내지 않으니
싸고, 언어끼리 해석이 어긋나지도 않는다.

**번역 큐는 직렬.**
맥락을 읽는 번역이라 앞 메시지가 먼저 정리돼 있어야 한다. 사용자가 둘뿐이라 병렬화할 이유도 없다.

**원문은 불변.**
`messages.source_text` 는 한 번 쓰이면 절대 바뀌지 않는다. 번역은 전부 `translations` 테이블의
파생 데이터라, 모델을 바꾸거나 용어집을 고친 뒤 통째로 다시 돌려도 대화 기록은 멀쩡하다.

**번역 결과는 캐시가 아니라 저장.**
한 번 번역한 메시지는 다시 번역하지 않는다. 대화를 다시 열어도 API 비용이 들지 않는다.
다시 번역하고 싶으면 `retranslate` 이벤트로 명시적으로 요청한다.

**회원가입 없음.**
두 사람은 `.env` 에 고정돼 있다. 로그인은 사람당 패스코드 하나이고, 성공하면 90일짜리 HMAC
서명 토큰을 준다. 세션 저장소도, 비밀번호 재설정 흐름도 없다 — 둘만 쓰는 앱에 필요한 만큼만.

## 데이터 모델

```sql
messages (
  id, sender_id, source_text, source_lang, created_at,
  translation_status   -- pending | done | failed
)

translations (
  message_id, lang, text, notes, model, created_at,
  PRIMARY KEY (message_id, lang)
)

user_settings (
  user_id, native_lang, display_langs   -- 'ko,en' 처럼 콤마로
)
```

`display_langs` 의 **첫 번째가 주 언어**다. 말풍선에 크게 보이는 번역이 그 언어이고,
나머지는 말풍선을 눌렀을 때 함께 펼쳐진다. 공부 중인 언어를 여기 넣어두면 같은 문장을
여러 언어로 나란히 보게 된다.

번역할 언어는 서버가 정한다: **두 사람이 보고 싶어 하는 언어의 합집합 − 원문 언어**.
그래서 내가 보낸 한국어 메시지도 내가 영어를 켜두었다면 영어 번역이 함께 붙는다.

## 파일

| 경로 | 역할 |
| --- | --- |
| `shared/src/index.ts` | 언어 코드, 메시지/번역 타입, WebSocket 프로토콜 |
| `server/src/config.ts` | `.env` 파싱, 두 사용자 정의, 용어집 로드 |
| `server/src/auth.ts` | 패스코드 확인, HMAC 토큰 발급/검증 |
| `server/src/db.ts` | SQLite 스키마와 질의 |
| `server/src/translation/` | 프롬프트 조립, provider 어댑터(Gemini/Claude), 사용량 기록 |
| `server/src/index.ts` | HTTP 라우트, WebSocket 허브, 번역 큐 |
| `server/glossary.json` | 애칭·고유명사·둘만 아는 표현 |
| `web/src/useChat.ts` | WebSocket 연결과 재연결, 클라이언트 상태 |
| `web/src/components/` | 로그인 / 채팅방 / 말풍선 / 설정 |

## WebSocket 프로토콜

클라이언트 → 서버

| 이벤트 | 뜻 |
| --- | --- |
| `send` | 메시지 전송 |
| `typing` | 입력 중 표시 |
| `retranslate` | 이 메시지 번역을 버리고 다시 |
| `read` | 읽음 (현재는 서버가 받기만 한다) |

서버 → 클라이언트

| 이벤트 | 뜻 |
| --- | --- |
| `hello` | 접속 직후 1회. 내 프로필, 상대 프로필, 최근 50개 |
| `message` | 새 메시지 (원문만) |
| `message_updated` | 번역이 붙었거나 상태가 바뀜 |
| `typing` / `presence` | 상대 상태 |
| `error` | 처리 실패 |

연결이 끊기면 클라이언트가 2초 뒤 자동 재연결한다. 단, `hello` 를 한 번도 못 받고 끊겼다면
토큰이 만료된 것으로 보고 로그인 화면으로 돌려보낸다.
