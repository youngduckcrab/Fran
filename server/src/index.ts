import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  isLangCode,
  type ChatMessage,
  type ClientEvent,
  type LangCode,
  type MessageExplanation,
  type ServerEvent,
  type UserProfile,
} from '@fran/shared';
import { checkPasscode, issueToken, verifyToken } from './auth.js';
import { config, findUserById, peerOf } from './config.js';
import {
  clearTranslations,
  initDatabase,
  deleteGlossaryEntry,
  getDisplayLangs,
  getExplanation,
  listGlossary,
  pendingMessageIds,
  saveExplanation,
  saveGlossaryEntry,
  seedGlossary,
  setTranslationNote,
  getMessage,
  getNativeLang,
  getRecentMessages,
  insertMessage,
  saveSettings,
  saveTranslation,
  setTranslationStatus,
} from './db.js';
import { TranslationError, explainMessage, getProvider, translateMessage } from './translation/index.js';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_NOTE_LENGTH = 500;


// 주소를 공개로 열어두면 패스코드가 유일한 자물쇠다. 예시 값 그대로면 잠그지 않은 것과 같다.
for (const user of config.users) {
  if (/^change-me/i.test(user.passcode)) {
    console.warn(
      `⚠️  ${user.profile.name} 의 패스코드가 예시 값(${user.passcode}) 그대로입니다. ` +
        '저장소에 공개된 값이므로 아는 사람은 누구나 들어올 수 있습니다.',
    );
    console.warn(
      `   바꾸려면: sed -i 's/^USER_${config.users[0] === user ? 'A' : 'B'}_PASSCODE=.*/USER_` +
        `${config.users[0] === user ? 'A' : 'B'}_PASSCODE=원하는값/' .env  (뒤에 서버 재시작)`,
    );
  }
}

/** DB 에 저장된 설정을 얹은 현재 프로필. */
async function profileOf(userId: string): Promise<UserProfile> {
  const user = findUserById(userId);
  if (!user) throw new Error(`알 수 없는 사용자: ${userId}`);
  const [nativeLang, displayLangs] = await Promise.all([
    getNativeLang(userId, user.profile.nativeLang),
    getDisplayLangs(userId, user.profile.displayLangs),
  ]);
  return { ...user.profile, nativeLang, displayLangs };
}

function bothProfiles(): Promise<UserProfile[]> {
  return Promise.all(config.users.map((user) => profileOf(user.profile.id)));
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

/**
 * 번역 지시는 보낸 사람만 본다. 상대에게 나가는 payload 에서는 지워 버린다.
 * 화면에서 숨기는 것으로는 부족하다 — 아예 전송하지 않아야 한다.
 */
function messageFor(viewerId: string, message: ChatMessage): ChatMessage {
  if (message.senderId === viewerId || message.translationNote === undefined) return message;
  const { translationNote: _hidden, ...rest } = message;
  return rest;
}

/** 메시지 이벤트는 받는 사람마다 내용이 다르므로 소켓별로 따로 만든다. */
function broadcastMessage(
  type: 'message' | 'message_updated',
  message: ChatMessage,
  clientIdFor?: { socket: WebSocket; clientId: string },
): void {
  for (const [socket, viewerId] of sockets.entries()) {
    const payload = messageFor(viewerId, message);
    if (type === 'message') {
      const clientId = clientIdFor?.socket === socket ? clientIdFor.clientId : undefined;
      send(socket, { type: 'message', message: payload, ...(clientId ? { clientId } : {}) });
    } else {
      send(socket, { type: 'message_updated', message: payload });
    }
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
  const message = await getMessage(messageId);
  if (!message) return;

  const participants = await bothProfiles();
  const targetLangs = targetLangsFor(message.sourceLang, participants);

  if (targetLangs.length === 0) {
    await setTranslationStatus(messageId, 'done');
    await publishUpdate(messageId);
    return;
  }

  // 자기 자신은 빼고, 직전 대화를 맥락으로 넘긴다.
  const recent = await getRecentMessages(config.translation.contextSize + 1);
  const context = recent.filter((m) => m.id !== messageId);

  try {
    const { result, model } = await translateMessage({ message, context, participants, targetLangs });
    const now = Date.now();

    for (const item of result.translations) {
      if (item.lang === result.detected_lang) continue;
      await saveTranslation(messageId, {
        lang: item.lang,
        text: item.text,
        notes: item.notes,
        model,
        createdAt: now,
      });
    }
    await setTranslationStatus(messageId, 'done');
  } catch (error) {
    const failure =
      error instanceof TranslationError
        ? { message: error.message, code: error.code }
        : { message: String(error), code: 'unknown' as const };
    console.error(`[translate] ${messageId} 실패: ${failure.message}`);
    await setTranslationStatus(messageId, 'failed', failure);
  }

  await publishUpdate(messageId);
}

async function publishUpdate(messageId: string): Promise<void> {
  const updated = await getMessage(messageId);
  if (updated) broadcastMessage('message_updated', updated);
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
  return c.json({ token: issueToken(userId), profile: await profileOf(userId) });
});

/** 로그인 화면에 띄울 두 사람의 목록. 패스코드는 절대 내보내지 않는다. */
/** 로그인 화면용 공개 정보. 화면 문구를 각자의 언어로 띄우려면 언어가 필요하다. */
app.get('/api/users', async (c) => {
  const profiles = await bothProfiles();
  return c.json(
    profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      uiLang: profile.displayLangs[0] ?? profile.nativeLang,
    })),
  );
});

function authenticate(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const header = c.req.header('authorization');
  return verifyToken(header?.replace(/^Bearer\s+/i, ''));
}

app.get('/api/messages', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  const messages = await getRecentMessages(limit, Number.isFinite(before) ? before : undefined);
  return c.json({ messages });
});

app.put('/api/settings', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  const current = await profileOf(userId);
  const nativeLang = isLangCode(body?.nativeLang) ? body.nativeLang : current.nativeLang;
  const displayLangs: LangCode[] = Array.isArray(body?.displayLangs)
    ? body.displayLangs.filter(isLangCode)
    : [];

  if (displayLangs.length === 0) {
    return c.json({ error: '표시 언어를 최소 하나는 골라야 합니다.' }, 400);
  }

  await saveSettings(userId, nativeLang, displayLangs);
  const profile = await profileOf(userId);
  broadcast({ type: 'presence', userId, online: true });
  return c.json({ profile });
});

/* --------------------------- 문장 설명 --------------------------- */

app.post('/api/messages/:id/explain', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const message = await getMessage(c.req.param('id'));
  if (!message) return c.json({ error: '메시지를 찾을 수 없습니다.' }, 404);

  const body = (await c.req.json().catch(() => null)) as { targetLang?: unknown } | null;
  const targetLang = isLangCode(body?.targetLang) ? body.targetLang : message.sourceLang;

  // 설명 대상 문장 고르기: 원문이거나, 그 언어로 번역된 문장.
  const text =
    targetLang === message.sourceLang ? message.sourceText : message.translations[targetLang]?.text;
  if (!text) {
    return c.json({ error: '그 언어의 문장이 아직 없습니다.' }, 400);
  }

  const learner = await profileOf(userId);
  const explainLang = learner.displayLangs[0] ?? learner.nativeLang;

  const cached = await getExplanation(message.id, targetLang, explainLang);
  if (cached) return c.json({ explanation: cached });

  try {
    const recent = await getRecentMessages(config.translation.contextSize + 1);
    const context = recent.filter((m) => m.createdAt < message.createdAt);
    const { result, model } = await explainMessage({
      text,
      targetLang,
      learner,
      context,
      participants: await bothProfiles(),
    });

    const explanation: MessageExplanation = {
      targetLang,
      explainLang,
      text,
      ...result,
      model,
      createdAt: Date.now(),
    };
    await saveExplanation(message.id, explanation);
    return c.json({ explanation });
  } catch (error) {
    const reason = error instanceof TranslationError ? error.message : String(error);
    console.error(`[explain] ${message.id} 실패: ${reason}`);
    return c.json({ error: reason }, 502);
  }
});

/* ---------------------------- 용어집 ---------------------------- */

function parseDraft(body: unknown): { term: string; translations: Partial<Record<LangCode, string>>; avoid: string[]; note?: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const input = body as Record<string, unknown>;
  const term = typeof input.term === 'string' ? input.term.trim() : '';
  if (!term) return null;

  const translations: Partial<Record<LangCode, string>> = {};
  if (typeof input.translations === 'object' && input.translations !== null) {
    for (const [lang, value] of Object.entries(input.translations)) {
      if (isLangCode(lang) && typeof value === 'string' && value.trim()) translations[lang] = value.trim();
    }
  }

  const avoid = Array.isArray(input.avoid)
    ? input.avoid.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return {
    term,
    translations,
    avoid,
    ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim() } : {}),
  };
}

app.get('/api/glossary', async (c) => {
  if (!authenticate(c)) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ entries: await listGlossary() });
});

async function upsertGlossary(c: Context, id?: string) {
  if (!authenticate(c)) return c.json({ error: 'unauthorized' }, 401);

  const draft = parseDraft(await c.req.json().catch(() => null));
  if (!draft) return c.json({ error: '표현은 비워둘 수 없습니다.' }, 400);

  const entry = await saveGlossaryEntry(draft, id);
  broadcast({ type: 'glossary', entries: await listGlossary() });
  return c.json({ entry });
}

// 생성과 수정을 나눈다. 하나의 선택적 파라미터 라우트로 두면 끝 슬래시가 붙은
// 요청(/api/glossary/)이 매칭되지 않아 404 가 난다.
app.post('/api/glossary', (c) => upsertGlossary(c));
app.put('/api/glossary/:id', (c) => upsertGlossary(c, c.req.param('id')));

app.delete('/api/glossary/:id', async (c) => {
  if (!authenticate(c)) return c.json({ error: 'unauthorized' }, 401);
  await deleteGlossaryEntry(c.req.param('id'));
  broadcast({ type: 'glossary', entries: await listGlossary() });
  return c.json({ ok: true });
});

// 빌드된 웹을 같은 프로세스에서 서빙한다(배포를 단순하게 유지).
if (fs.existsSync(config.webDist)) {
  app.use('/*', serveStatic({ root: config.webDist }));
  app.get('*', serveStatic({ path: path.join(config.webDist, 'index.html') }));
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

async function handleClientEvent(userId: string, socket: WebSocket, event: ClientEvent): Promise<void> {
  switch (event.type) {
    case 'send': {
      const text = event.text.trim();
      if (!text) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        send(socket, { type: 'error', message: `메시지가 너무 깁니다 (최대 ${MAX_MESSAGE_LENGTH}자).` });
        return;
      }
      if ((event.translationNote?.length ?? 0) > MAX_NOTE_LENGTH) {
        send(socket, { type: 'error', message: `번역 지시가 너무 깁니다 (최대 ${MAX_NOTE_LENGTH}자).` });
        return;
      }

      const profile = await profileOf(userId);
      const message = await insertMessage({
        id: crypto.randomUUID(),
        senderId: userId,
        sourceText: text,
        sourceLang: isLangCode(event.sourceLang) ? event.sourceLang : profile.nativeLang,
        createdAt: Date.now(),
        ...(event.translationNote?.trim() ? { translationNote: event.translationNote.trim() } : {}),
      });

      // 번역을 기다리지 않고 원문을 먼저 띄운다. 번역은 곧 update 로 따라붙는다.
      broadcastMessage('message', message, { socket, clientId: event.clientId });
      enqueueTranslation(message.id);
      return;
    }

    case 'retranslate': {
      const message = await getMessage(event.messageId);
      if (!message) return;
      // 지시를 바꿔 다시 번역할 수 있다. 자기가 보낸 메시지에 대해서만.
      if (event.translationNote !== undefined && message.senderId === userId) {
        await setTranslationNote(message.id, event.translationNote.trim() || undefined);
      }
      await clearTranslations(message.id);
      await setTranslationStatus(message.id, 'pending');
      await publishUpdate(message.id);
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

// DB 가 준비되기 전에 요청을 받으면 첫 메시지가 통째로 실패한다. 먼저 연결하고 연다.
try {
  await initDatabase();
  // 파일로 관리하던 용어집을 DB 로 옮긴다. 비어 있을 때 한 번만 옮겨 담는다.
  await seedGlossary(config.glossary);

  // 번역 도중 서버가 꺼졌던 메시지들. 그냥 두면 영원히 "번역하는 중…" 으로 남는다.
  const stuck = await pendingMessageIds();
  if (stuck.length > 0) {
    console.log(`번역이 끊겼던 메시지 ${stuck.length}건을 다시 시도합니다.`);
    for (const id of stuck) enqueueTranslation(id);
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`\n✗ 데이터베이스에 연결하지 못했습니다: ${reason}`);
  console.error('  DATABASE_URL 을 확인해 주세요. 예: postgresql://user:pass@host/db\n');
  process.exit(1);
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

  void (async () => {
    const [me, peer, recent, glossary] = await Promise.all([
      profileOf(userId),
      profileOf(peerOf(userId).profile.id),
      getRecentMessages(50),
      listGlossary(),
    ]);
    if (socket.readyState !== socket.OPEN) return;

    send(socket, {
      type: 'hello',
      me,
      peer,
      messages: recent.map((message) => messageFor(userId, message)),
    });
    send(socket, { type: 'glossary', entries: glossary });
    send(socket, { type: 'presence', userId: peer.id, online: isOnline(peer.id) });
    broadcast({ type: 'presence', userId, online: true }, socket);
  })().catch((error: unknown) => {
    console.error('[ws] 접속 처리 실패:', error);
    send(socket, { type: 'error', message: '대화를 불러오지 못했습니다.' });
  });

  socket.on('message', (raw) => {
    let event: ClientEvent;
    try {
      event = JSON.parse(String(raw)) as ClientEvent;
    } catch {
      send(socket, { type: 'error', message: '잘못된 형식의 요청입니다.' });
      return;
    }
    handleClientEvent(userId, socket, event).catch((error: unknown) => {
      console.error('[ws] 이벤트 처리 실패:', error);
      send(socket, { type: 'error', message: '메시지를 처리하지 못했습니다.' });
    });
  });

  socket.on('close', () => {
    sockets.delete(socket);
    if (!isOnline(userId)) broadcast({ type: 'presence', userId, online: false });
  });
});
