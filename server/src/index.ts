import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  isLangCode,
  type ChatMessage,
  type ClientEvent,
  type LangCode,
  type ServerEvent,
  type UserProfile,
} from '@fran/shared';
import { checkPasscode, issueToken, verifyToken } from './auth.js';
import { config, findUserById, peerOf } from './config.js';
import {
  clearTranslations,
  getDisplayLangs,
  getMessage,
  getNativeLang,
  getRecentMessages,
  insertMessage,
  saveSettings,
  saveTranslation,
  setTranslationStatus,
} from './db.js';
import { TranslationError, getProvider, translateMessage } from './translation/index.js';

const MAX_MESSAGE_LENGTH = 4000;

/** DB 에 저장된 설정을 얹은 현재 프로필. */
function profileOf(userId: string): UserProfile {
  const user = findUserById(userId);
  if (!user) throw new Error(`알 수 없는 사용자: ${userId}`);
  const nativeLang = getNativeLang(userId, user.profile.nativeLang);
  return {
    ...user.profile,
    nativeLang,
    displayLangs: getDisplayLangs(userId, user.profile.displayLangs),
  };
}

function bothProfiles(): UserProfile[] {
  return config.users.map((user) => profileOf(user.profile.id));
}

/* ------------------------------------------------------------------ */
/* 접속 관리                                                           */
/* ------------------------------------------------------------------ */

const sockets = new Map<WebSocket, string>();

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

function broadcast(event: ServerEvent, skip?: WebSocket): void {
  for (const socket of sockets.keys()) {
    if (socket !== skip) send(socket, event);
  }
}

function isOnline(userId: string): boolean {
  for (const id of sockets.values()) {
    if (id === userId) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 번역 파이프라인                                                     */
/* ------------------------------------------------------------------ */

/**
 * 번역은 순서대로 한 건씩 처리한다. 맥락을 읽는 번역이라 앞 메시지가
 * 먼저 정리돼 있어야 하고, 둘이 쓰는 앱이라 병렬화할 이유도 없다.
 */
let queue: Promise<void> = Promise.resolve();

function enqueueTranslation(messageId: string): void {
  queue = queue.then(() => runTranslation(messageId)).catch((error: unknown) => {
    console.error('[translate] 큐에서 처리하지 못한 오류:', error);
  });
}

/** 두 사람이 보고 싶어 하는 언어의 합집합에서 원문 언어를 뺀 것. */
function targetLangsFor(sourceLang: LangCode, participants: UserProfile[]): LangCode[] {
  const wanted = new Set<LangCode>();
  for (const participant of participants) {
    for (const lang of participant.displayLangs) wanted.add(lang);
  }
  wanted.delete(sourceLang);
  return [...wanted];
}

async function runTranslation(messageId: string): Promise<void> {
  const message = getMessage(messageId);
  if (!message) return;

  const participants = bothProfiles();
  const targetLangs = targetLangsFor(message.sourceLang, participants);

  if (targetLangs.length === 0) {
    setTranslationStatus(messageId, 'done');
    publishUpdate(messageId);
    return;
  }

  // 자기 자신은 빼고, 직전 대화를 맥락으로 넘긴다.
  const context = getRecentMessages(config.translation.contextSize + 1).filter((m) => m.id !== messageId);

  try {
    const { result, model } = await translateMessage({ message, context, participants, targetLangs });
    const now = Date.now();

    for (const item of result.translations) {
      if (item.lang === result.detected_lang) continue;
      saveTranslation(messageId, {
        lang: item.lang,
        text: item.text,
        notes: item.notes,
        model,
        createdAt: now,
      });
    }
    setTranslationStatus(messageId, 'done');
  } catch (error) {
    const reason = error instanceof TranslationError ? error.message : String(error);
    console.error(`[translate] ${messageId} 실패: ${reason}`);
    setTranslationStatus(messageId, 'failed');
  }

  publishUpdate(messageId);
}

function publishUpdate(messageId: string): void {
  const updated = getMessage(messageId);
  if (updated) broadcast({ type: 'message_updated', message: updated });
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const app = new Hono();
app.use('/api/*', cors());

app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const passcode = typeof body?.passcode === 'string' ? body.passcode : '';

  if (!checkPasscode(userId, passcode)) {
    return c.json({ error: '아이디 또는 패스코드가 올바르지 않습니다.' }, 401);
  }
  return c.json({ token: issueToken(userId), profile: profileOf(userId) });
});

/** 로그인 화면에 띄울 두 사람의 목록. 패스코드는 절대 내보내지 않는다. */
app.get('/api/users', (c) =>
  c.json(config.users.map((user) => ({ id: user.profile.id, name: user.profile.name }))),
);

function authenticate(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const header = c.req.header('authorization');
  return verifyToken(header?.replace(/^Bearer\s+/i, ''));
}

app.get('/api/messages', (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  return c.json({ messages: getRecentMessages(limit, Number.isFinite(before) ? before : undefined) });
});

app.put('/api/settings', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const nativeLang = isLangCode(body?.nativeLang) ? body.nativeLang : profileOf(userId).nativeLang;
  const displayLangs: LangCode[] = Array.isArray(body?.displayLangs)
    ? body.displayLangs.filter(isLangCode)
    : [];

  if (displayLangs.length === 0) {
    return c.json({ error: '표시 언어를 최소 하나는 골라야 합니다.' }, 400);
  }

  saveSettings(userId, nativeLang, displayLangs);
  const profile = profileOf(userId);
  broadcast({ type: 'presence', userId, online: true });
  return c.json({ profile });
});

// 빌드된 웹을 같은 프로세스에서 서빙한다(배포를 단순하게 유지).
if (fs.existsSync(config.webDist)) {
  app.use('/*', serveStatic({ root: config.webDist }));
  app.get('*', serveStatic({ path: path.join(config.webDist, 'index.html') }));
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

function handleClientEvent(userId: string, socket: WebSocket, event: ClientEvent): void {
  switch (event.type) {
    case 'send': {
      const text = event.text.trim();
      if (!text) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        send(socket, { type: 'error', message: `메시지가 너무 깁니다 (최대 ${MAX_MESSAGE_LENGTH}자).` });
        return;
      }

      const profile = profileOf(userId);
      const message = insertMessage({
        id: crypto.randomUUID(),
        senderId: userId,
        sourceText: text,
        sourceLang: isLangCode(event.sourceLang) ? event.sourceLang : profile.nativeLang,
        createdAt: Date.now(),
      });

      // 번역을 기다리지 않고 원문을 먼저 띄운다. 번역은 곧 update 로 따라붙는다.
      send(socket, { type: 'message', message, clientId: event.clientId });
      broadcast({ type: 'message', message }, socket);
      enqueueTranslation(message.id);
      return;
    }

    case 'retranslate': {
      const message = getMessage(event.messageId);
      if (!message) return;
      clearTranslations(message.id);
      setTranslationStatus(message.id, 'pending');
      publishUpdate(message.id);
      enqueueTranslation(message.id);
      return;
    }

    case 'typing':
      broadcast({ type: 'typing', userId, isTyping: event.isTyping }, socket);
      return;

    case 'read':
      return;
  }
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Fran 서버가 http://localhost:${info.port} 에서 실행 중입니다.`);
  // 번역 설정 문제는 첫 메시지가 아니라 지금 알려준다.
  try {
    const provider = getProvider();
    console.log(`번역: ${provider.name} / ${provider.model}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  번역을 쓸 수 없습니다: ${reason}`);
    console.warn('   메시지는 정상적으로 오가지만 번역만 실패합니다.');
  }
});

// 포트가 막혀 있는 건 흔한 일이다(앞서 띄운 서버가 안 죽었거나, 다른 앱이 쓰거나).
// 스택 트레이스 대신 무엇을 해야 하는지 알려준다.
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`\n✗ 포트 ${config.port} 가 이미 사용 중입니다.`);
  console.error('  앞서 띄운 서버가 아직 살아 있을 가능성이 큽니다. 정리한 뒤 다시 실행하세요:\n');
  console.error(`    npx kill-port ${config.port}\n`);
  console.error('  그래도 안 되면 터미널을 새로 열고:\n');
  console.error("    pkill -f 'src/index.ts'\n");
  process.exit(1);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const userId = verifyToken(url.searchParams.get('token'));
  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, userId);
  });
});

wss.on('connection', (socket: WebSocket, _request: unknown, userId: string) => {
  sockets.set(socket, userId);

  const me = profileOf(userId);
  const peer = profileOf(peerOf(userId).profile.id);
  const history: ChatMessage[] = getRecentMessages(50);

  send(socket, { type: 'hello', me, peer, messages: history });
  send(socket, { type: 'presence', userId: peer.id, online: isOnline(peer.id) });
  broadcast({ type: 'presence', userId, online: true }, socket);

  socket.on('message', (raw) => {
    let event: ClientEvent;
    try {
      event = JSON.parse(String(raw)) as ClientEvent;
    } catch {
      send(socket, { type: 'error', message: '잘못된 형식의 요청입니다.' });
      return;
    }
    try {
      handleClientEvent(userId, socket, event);
    } catch (error) {
      console.error('[ws] 이벤트 처리 실패:', error);
      send(socket, { type: 'error', message: '메시지를 처리하지 못했습니다.' });
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
    if (!isOnline(userId)) broadcast({ type: 'presence', userId, online: false });
  });
});
