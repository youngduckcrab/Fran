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

test('앱 로직: 통화 신호 — 걸기 → 응답 → 연결 → 자막(번역)', async () => {
  // WebRTC 는 노드에 없다. 신호가 오가는 모양만 보려고 최소한의 가짜를 둔다.
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

  // 프란이 말한다 → 서버가 번역해서 돌려준다 → 앱 자막에 뜬다.
  other.send({ type: 'caption', callId, id: 'c1', text: 'Hoy fui a la playa', final: true });
  const line = await until('자막 번역', () => call.captions.find((c) => c.id === 'c1' && c.translated));
  assert.equal(line.translated, '오늘 바닷가에 갔어');
  assert.equal(line.mine, false);

  // 끊으면 프란에게도 알려진다.
  await act(async () => {
    call.hangup();
  });
  await until('프란에게 끝 알림', () => other.seen.find((e) => e.type === 'call_end'));
  await until('끝난 화면', () => call.phase === 'ended' || call.phase === 'idle');

  other.close();
  await act(async () => {
    root.unmount();
  });
});
