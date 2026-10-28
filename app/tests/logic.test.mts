/**
 * 앱이 웹에서 가져다 쓰는 로직(useChat·useCall)이 폰의 호환 계층(shimCore) 위에서
 * 실제 서버와 맞물려 도는지 노드에서 확인한다.
 *
 * 서버가 http://localhost:8840 에 떠 있어야 한다 (FRAN_TEST_SERVER 로 바꿀 수 있다).
 * 폰이 아니라서 화면·WebRTC 는 확인하지 못한다 — 신호의 오가는 모양과 상태 흐름만 본다.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ClientEvent, ServerEvent } from '@fran/shared';
import { createStorage, installGlobals } from '../src/shimCore';

const SERVER = process.env.FRAN_TEST_SERVER ?? 'http://localhost:8840';
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { storage } = createStorage(() => {});
const shim = installGlobals({ serverUrl: SERVER, storage, visible: true });

// 설치 뒤에 불러와야 한다 — 모듈이 불릴 때 전역을 읽는 것들이 있다.
const { login, setActiveUser, setToken, searchMessages, fetchMessages } = await import('../src/web/api');
const { useChat } = await import('../src/web/useChat');
const { useCall } = await import('../src/web/call');

/** 로그아웃 콜백은 렌더마다 새로 만들면 안 된다 — 연결 effect 가 이걸 보고 다시 붙는다. */
let loggedOut = 0;
const onUnauthorized = () => {
  loggedOut += 1;
};

/** 실행할 때마다 다른 말. 서버 DB 에 지난 실행의 메시지가 남아 있어도 서로 섞이지 않게. */
const stamp = Date.now().toString(36);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, read: () => T | false | undefined | null, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`기다리던 것이 오지 않았다: ${what}`);
    await act(async () => {
      await sleep(40);
    });
  }
}

/** 프란 쪽. 앱 코드를 쓰지 않는 날것의 소켓이라, 서버가 실제로 무엇을 주고받는지 그대로 본다. */
async function fran() {
  const response = await fetch(`${SERVER}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'fran', passcode: 'bbbb' }),
  });
  const { token } = (await response.json()) as { token: string };
  const socket = new WebSocket(`${SERVER.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  const seen: ServerEvent[] = [];
  socket.onmessage = (raw) => seen.push(JSON.parse(String(raw.data)) as ServerEvent);
  await new Promise<void>((resolve) => (socket.onopen = () => resolve()));
  return { seen, send: (event: ClientEvent) => socket.send(JSON.stringify(event)), close: () => socket.close() };
}

const mine = `테스트 ${stamp}`;
const theirs = `Hola ${stamp}`;

test('앱 로직: 로그인 → 접속 → 보내기 → 번역 → 읽음 → 검색', async () => {
  setActiveUser('me');
  const token = await login('me', 'aaaa');
  assert.ok(token, '토큰을 받았다');
  // 앱의 Root 가 로그인 뒤에 하는 일. 이후 API 호출이 이 토큰을 쓴다.
  setToken(token, 'me');

  let chat!: ReturnType<typeof useChat>;
  const Probe = () => {
    chat = useChat(token, onUnauthorized);
    return null;
  };
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(React.createElement(Probe));
  });

  await until('hello', () => chat.connection === 'open' && chat.me);
  assert.equal(chat.me?.id, 'me');
  assert.equal(chat.peer?.id, 'fran');

  // 프란이 들어오면 접속 중으로 보인다.
  const other = await fran();
  await until('상대 접속 표시', () => chat.peerOnline);

  // 보내면 원문이 먼저, 번역이 뒤따라 온다.
  await act(async () => {
    chat.sendMessage(mine);
  });
  const sent = await until('내 메시지', () => chat.messages.findLast((m) => m.sourceText === mine));
  assert.equal(sent.senderId, 'me');
  const translated = await until('번역', () => chat.messages.findLast((m) => m.sourceText === mine)?.translations.es);
  assert.equal(translated.text, `«${mine}»`);
  assert.ok(other.seen.some((e) => e.type === 'message'), '프란에게도 갔다');

  // 프란이 읽으면 읽음 표시가 움직인다.
  const at = chat.messages[chat.messages.length - 1]!.createdAt;
  other.send({ type: 'read', at });
  await until('읽음', () => (chat.readAt.fran ?? 0) >= at);

  // 프란이 쓴 글도 받는다.
  other.send({ type: 'send', clientId: 'x1', text: theirs });
  await until('프란의 메시지', () => chat.messages.findLast((m) => m.sourceText === theirs));
  const ko = await until('프란 글의 번역', () => chat.messages.findLast((m) => m.sourceText === theirs)?.translations.ko);
  assert.equal(ko.text, `«${theirs}»`);

  // 반응과 수정.
  await act(async () => {
    chat.react(sent.id, '❤️');
    chat.editMessage(sent.id, `${mine} 수정`);
  });
  await until('반응', () => chat.messages.findLast((m) => m.id === sent.id)?.reactions?.me === '❤️');
  await until('수정', () => chat.messages.findLast((m) => m.id === sent.id)?.editedAt);

  // 서버 검색·페이지 API 가 shim(URLSearchParams·fetch 주소)을 거쳐 돈다.
  const found = await searchMessages(theirs);
  assert.ok(found.messages.length >= 1, '검색이 된다');
  const page = await fetchMessages(undefined, 50);
  assert.ok(page.length >= 2);

  // 앱이 뒤로 갔다 오면 다시 알린다(예외 없이).
  await act(async () => {
    shim.setVisible(false);
    await sleep(50);
    shim.setVisible(true);
  });

  assert.equal(loggedOut, 0, '로그아웃되지 않았다');
  other.close();
  await act(async () => {
    root.unmount();
  });
});

/** WebRTC 는 노드에 없다. 신호가 오가는 모양만 보려고 최소한의 가짜를 둔다. 붙은 설명을 log 에 적는다. */
function fakeWebRTC(): string[] {
  const log: string[] = [];
  class FakePeer {
    connectionState = 'new';
    localDescription: { type: string; sdp: string } | null = null;
    onconnectionstatechange: (() => void) | null = null;
    onicecandidate: ((e: unknown) => void) | null = null;
    ontrack: ((e: unknown) => void) | null = null;
    addTrack() {}
    getSenders() {
      return [];
    }
    async createOffer() {
      return { type: 'offer', sdp: 'fake-offer' };
    }
    async createAnswer() {
      return { type: 'answer', sdp: 'fake-answer' };
    }
    async setLocalDescription(d: { type: string; sdp: string }) {
      this.localDescription = d;
    }
    async setRemoteDescription(d: { type: string }) {
      log.push(`remote:${d.type}`);
      // 상대 응답을 받으면 연결된 것으로 친다.
      this.connectionState = 'connected';
      queueMicrotask(() => this.onconnectionstatechange?.());
    }
    async addIceCandidate() {}
    close() {}
  }
  const track = { kind: 'audio', enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
  const g = globalThis as unknown as Record<string, unknown>;
  g.RTCPeerConnection = FakePeer;
  g.MediaStream = class {
    constructor() {
      return stream as never;
    }
  };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia: async () => stream }, configurable: true });
  return log;
}

/** 내 쪽(앱 로직)과 프란 쪽(날것의 소켓)을 붙여 통화를 연결해 둔다. */
async function connectedCall() {
  const log = fakeWebRTC();
  setActiveUser('me');
  const token = await login('me', 'aaaa');
  let call!: ReturnType<typeof useCall>;
  const Probe = () => {
    const chat = useChat(token, onUnauthorized);
    call = useCall(chat.emit, chat.onCallEvent, 'ko', 'me');
    return null;
  };
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(React.createElement(Probe));
  });
  await until('연결', () => true);
  await sleep(600);

  const other = await fran();
  await sleep(300);

  await act(async () => {
    await call.start(false);
  });
  const ring = await until('프란에게 전화가 옴', () => other.seen.find((e) => e.type === 'call'));
  assert.equal(ring.type, 'call');
  assert.equal(call.phase, 'calling');
  const callId = (ring as Extract<ServerEvent, { type: 'call' }>).callId;

  // 프란이 받는다.
  other.send({ type: 'call_answer', callId, answer: JSON.stringify({ type: 'answer', sdp: 'x' }) });
  await until('연결됨', () => call.phase === 'connected');
  assert.ok(log.includes('remote:answer'));

  return {
    call: () => call,
    other,
    callId,
    /** 끊고 정리한다. */
    async close() {
      await act(async () => {
        call.hangup();
      });
      await until('프란에게 끝 알림', () => other.seen.find((e) => e.type === 'call_end'));
      await until('끝난 화면', () => call.phase === 'ended' || call.phase === 'idle');
      other.close();
      await act(async () => {
        root.unmount();
      });
    },
  };
}

test('앱 로직: 통화 신호 — 걸기 → 응답 → 연결 → 자막(번역)', async () => {
  const { call: current, other, callId, close } = await connectedCall();

  // 프란이 말한다 → 서버가 번역해서 돌려준다 → 앱 자막에 뜬다.
  other.send({ type: 'caption', callId, id: 'c1', text: 'Hoy fui a la playa', final: true });
  const line = await until('자막 번역', () => current().captions.find((c) => c.id === 'c1' && c.translated));
  assert.equal(line.translated, '오늘 바닷가에 갔어');
  assert.equal(line.mine, false);

  // 끊으면 프란에게도 알려진다.
  await close();
});

test('앱 로직: 번역 읽어주기 — 읽는 동안 상대 목소리를 줄이고 받아쓰기는 쉰다', async () => {
  const { spoken } = (await import('expo-speech')) as unknown as { spoken: { text: string; language?: string }[] };
  const { recognition } = (await import('expo-speech-recognition')) as unknown as {
    recognition: { starts: number; aborts: number };
  };
  const { call, other, callId, close } = await connectedCall();

  await act(async () => {
    call().setVoice('read');
  });
  assert.equal(call().voice, 'read');
  assert.equal(storage.getItem('fran.callVoice'), 'read', '다음 통화에도 가도록 적어 둔다');
  await until('받아쓰기가 켜짐', () => recognition.starts > 0);
  const aborts = recognition.aborts;

  // 프란이 말한다 → 번역이 오면 내 언어 목소리로 읽는다.
  other.send({ type: 'caption', callId, id: 'r1', text: 'Hoy fui a la playa', final: true });
  const said = await until('읽어 줌', () => spoken.find((s) => s.text === '오늘 바닷가에 갔어'));
  assert.equal(said.language, 'ko-KR');
  await until('읽는 중', () => call().speaking);
  assert.equal(call().peerVolume, 0.2, '읽는 동안 상대 목소리를 줄인다');
  await until('받아쓰기가 쉰다', () => recognition.aborts > aborts);
  const starts = recognition.starts;

  // 다 읽으면 원래대로.
  await until('다 읽음', () => !call().speaking);
  assert.equal(call().peerVolume, 1);
  await until('받아쓰기 다시 켜짐', () => recognition.starts > starts);

  // 끄면 더 읽지 않는다. 자막은 그대로 뜬다.
  await act(async () => {
    call().setVoice('off');
  });
  other.send({ type: 'caption', callId, id: 'r2', text: 'Te quiero mucho', final: true });
  await until('자막은 뜸', () => call().captions.find((c) => c.id === 'r2' && c.translated));
  await act(async () => {
    await sleep(300);
  });
  assert.ok(!spoken.some((s) => s.text === '«Te quiero mucho»'), '끈 뒤에는 읽지 않는다');

  await close();
});

/** 가짜 통역 모듈(tests/stubs/expo.mjs)이 들여다보게 열어 둔 것. */
interface FakeAudio {
  tapping: boolean;
  played: { pcm: string; rate: number }[];
  emit: (pcm: string, level: number) => void;
}

/** 100ms 짜리 16kHz 소리. 값은 아무래도 된다 — 가짜 모델은 받은 만큼 되돌려 줄 뿐이다. */
const MIC_CHUNK = Buffer.from(new Int16Array(1600).fill(1000).buffer).toString('base64');

/** 옮겨 온 소리의 첫 표본. 가짜 모델은 목표 언어의 첫 글자를 표본 값으로 새겨 보낸다. */
const firstSample = (pcm: string) => Buffer.from(pcm, 'base64').readInt16LE(0);

const FAKE_GEMINI = process.env.FAKE_GEMINI ?? 'http://localhost:8841';

test('앱 로직: 통역 음성 — 내가 들을 때. 상대 말소리가 Gemini 를 거쳐 내 말로 온다', async () => {
  const audio = (globalThis as unknown as { __franAudio: FakeAudio }).__franAudio;
  const { call, other, callId, close } = await connectedCall();

  await act(async () => {
    call().setVoice('live');
  });
  // 서버가 프란 폰에게 "마이크 소리를 보내 달라" 고 전한다.
  const asked = await until('프란에게 요청', () =>
    other.seen.find((e) => e.type === 'call_interpret' && e.on && e.callId === callId),
  );
  assert.equal((asked as Extract<ServerEvent, { type: 'call_interpret' }>).from, 'me');
  await until('기다리는 중', () => call().liveStatus === 'waiting');

  // 프란이 말한다(소리 세 토막과 끝).
  const before = audio.played.length;
  for (let i = 0; i < 3; i += 1) other.send({ type: 'call_mic', callId, pcm: MIC_CHUNK });
  other.send({ type: 'call_mic', callId, pcm: '', end: true });

  await until('옮긴 소리가 옴', () => audio.played.length >= before + 3);
  const voice = audio.played[before]!;
  assert.equal(voice.rate, 24000);
  assert.equal(firstSample(voice.pcm), 'k'.charCodeAt(0), '내 말(ko)로 옮겼다');
  await until('통역 중', () => call().liveStatus === 'live');
  assert.equal(call().peerVolume, 0.2, '트는 동안 상대 목소리를 줄인다');

  // 서버가 Gemini 에 연 세션의 설정.
  const live = (await (await fetch(`${FAKE_GEMINI}/__live`)).json()) as {
    setups: { model: string; generationConfig?: { responseModalities?: string[]; translationConfig?: unknown } }[];
    ends: number;
  };
  const setup = live.setups.at(-1)!;
  assert.equal(setup.model, 'models/gemini-3.5-live-translate-preview');
  assert.deepEqual(setup.generationConfig?.responseModalities, ['AUDIO']);
  assert.deepEqual(setup.generationConfig?.translationConfig, { targetLanguageCode: 'ko', echoTargetLanguage: false });
  assert.ok(live.ends >= 1, '말이 끊긴 것도 전했다');

  // 끄면 프란 폰에도 알린다.
  await act(async () => {
    call().setVoice('off');
  });
  await until('프란에게 그만', () =>
    other.seen.find((e) => e.type === 'call_interpret' && !e.on && e.callId === callId),
  );
  assert.equal(call().liveStatus, 'off');
  await until('다 틀고 나면 원래 크기', () => call().peerVolume === 1);

  await close();
});

test('앱 로직: 통역 음성 — 상대가 들을 때. 내가 말할 때만 마이크 소리를 보낸다', async () => {
  const audio = (globalThis as unknown as { __franAudio: FakeAudio }).__franAudio;
  const { call, other, callId, close } = await connectedCall();

  // 프란이 내 말을 통역으로 듣겠다고 한다.
  other.send({ type: 'call_interpret', callId, on: true });
  await until('내가 소리를 떼어 냄', () => call().peerListening && audio.tapping);
  const voicesBefore = other.seen.filter((e) => e.type === 'call_voice').length;

  // 조용한 동안은 보내지 않는다.
  await act(async () => {
    for (let i = 0; i < 5; i += 1) audio.emit(MIC_CHUNK, 0.001);
    await sleep(300);
  });
  assert.equal(other.seen.filter((e) => e.type === 'call_voice').length, voicesBefore, '조용할 때는 안 보냄');

  // 말하면 보낸다. 말 직전의 조용한 토막도 함께(첫 음절이 잘리지 않게).
  await act(async () => {
    audio.emit(MIC_CHUNK, 0.2);
    audio.emit(MIC_CHUNK, 0.2);
  });
  const first = (await until('프란에게 옮긴 소리', () =>
    other.seen.filter((e) => e.type === 'call_voice')[voicesBefore],
  )) as Extract<ServerEvent, { type: 'call_voice' }>;
  assert.equal(first.from, 'me');
  assert.equal(firstSample(first.pcm), 'e'.charCodeAt(0), '프란의 말(es)로 옮겼다');
  await until('말 직전 소리까지 다섯 토막', () =>
    other.seen.filter((e) => e.type === 'call_voice').length - voicesBefore >= 5,
  );

  // 숨 고르는 틈을 넘겨 조용하면 끊는다.
  const endsBefore = ((await (await fetch(`${FAKE_GEMINI}/__live`)).json()) as { ends: number }).ends;
  await act(async () => {
    for (let i = 0; i < 9; i += 1) audio.emit(MIC_CHUNK, 0.001);
  });
  let ends = endsBefore;
  for (let tries = 0; tries < 50 && ends <= endsBefore; tries += 1) {
    await act(async () => {
      await sleep(40);
    });
    ends = ((await (await fetch(`${FAKE_GEMINI}/__live`)).json()) as { ends: number }).ends;
  }
  assert.ok(ends > endsBefore, '말이 끝났다고 모델에 알렸다');

  // 음소거 중에는 말해도 보내지 않는다.
  await act(async () => {
    call().toggleMute();
  });
  const sentBefore = other.seen.filter((e) => e.type === 'call_voice').length;
  await act(async () => {
    for (let i = 0; i < 3; i += 1) audio.emit(MIC_CHUNK, 0.3);
    await sleep(300);
  });
  assert.equal(other.seen.filter((e) => e.type === 'call_voice').length, sentBefore, '음소거면 안 보냄');

  // 프란이 그만 들으면 떼어 내기를 멈춘다.
  other.send({ type: 'call_interpret', callId, on: false });
  await until('떼어 내기 멈춤', () => !call().peerListening && !audio.tapping);

  await close();
});
