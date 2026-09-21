import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  cleanTerm,
  isGender,
  isLangCode,
  sameSentence,
  isThemeId,
  isWallpaperId,
  messageText,
  type Attachment,
  type AttachmentKind,
  type ChatMessage,
  type ClientEvent,
  type LangCode,
  type MessageExplanation,
  type ServerEvent,
  type UserProfile,
  type WordLookup,
} from '@fran/shared';
import {
  MAX_PASSCODE_LENGTH,
  MIN_PASSCODE_LENGTH,
  changePasscode,
  checkPasscode,
  hasOwnPasscode,
  initAuth,
  issueToken,
  verifyToken,
} from './auth.js';
import { config, findUserById, peerOf } from './config.js';
import {
  attachToMessage,
  clearTranslations,
  claimNotify,
  countUnread,
  deleteSaved,
  deleteVocab,
  editMessage,
  getAttachmentBytes,
  getAudioForTranscription,
  getReadState,
  getVocab,
  initDatabase,
  insertAttachment,
  listPhotos,
  listSaved,
  listVocab,
  markRead,
  purgeOrphanAttachments,
  saveSentence,
  saveVocab,
  saveTheme,
  saveWallpaper,
  addVocabExample,
  setVocabLearned,
  toggleReaction,
  retryTranscript,
  setSourceLang,
  setTranscript,
  deleteGlossaryEntry,
  getExplanation,
  getProfileSettings,
  getWordLookup,
  saveWordLookup,
  listGlossary,
  pendingMessageIds,
  saveExplanation,
  saveGlossaryEntry,
  seedGlossary,
  setTranslationNote,
  getMessage,
  getMessagesAfter,
  getMessagesAround,
  getRecentMessages,
  insertMessage,
  saveSettings,
  saveTranslation,
  searchMessages,
  setTranslationStatus,
} from './db.js';
import {
  TranslationError,
  explainMessage,
  getProvider,
  lookUpWord,
  makeExample,
  transcribeAudio,
  translateMessage,
} from './translation/index.js';
import { toModelAudio } from './audio.js';
import { initPush, kindLabel, notify, publicKey, subscribe, unsubscribe } from './push.js';

const MAX_MESSAGE_LENGTH = 4000;
/** 사는 곳. "Santiago, Chile" 정도면 충분하다. 주소를 적는 칸이 아니다. */
const MAX_REGION_LENGTH = 60;
const MAX_NOTE_LENGTH = 500;
/** 첨부 한 건의 최대 크기. 사진은 화면에서 미리 줄여서 올라온다. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;


// 주소를 공개로 열어두면 패스코드가 유일한 자물쇠다. 예시 값 그대로면 잠그지 않은 것과 같다.
function warnAboutDefaultPasscodes(): void {
  for (const user of config.users) {
    // 앱에서 직접 바꿨다면 .env 값은 더 이상 쓰이지 않는다.
    if (hasOwnPasscode(user.profile.id)) continue;
    if (!/^change-me/i.test(user.passcode)) continue;

    console.warn(
      `⚠️  ${user.profile.name} 의 패스코드가 예시 값(${user.passcode}) 그대로입니다. ` +
        '저장소에 공개된 값이므로 아는 사람은 누구나 들어올 수 있습니다.',
    );
    console.warn('   앱의 설정 → 비밀번호 바꾸기 에서 바꾸면 됩니다.');
  }
}

/** DB 에 저장된 설정을 얹은 현재 프로필. */
async function profileOf(userId: string): Promise<UserProfile> {
  const user = findUserById(userId);
  if (!user) throw new Error(`알 수 없는 사용자: ${userId}`);
  // 설정은 한 줄에 다 들어 있다. 한 번만 읽는다.
  const saved = await getProfileSettings(userId, user.profile);
  // 앱에서 고른 것이 .env 의 기본값을 이긴다.
  return { ...user.profile, ...saved };
}

function bothProfiles(): Promise<UserProfile[]> {
  return Promise.all(config.users.map((user) => profileOf(user.profile.id)));
}

/* ------------------------------------------------------------------ */
/* 접속 관리                                                           */
/* ------------------------------------------------------------------ */

const sockets = new Map<WebSocket, string>();
/**
 * 지금 앱을 보고 있는 소켓들.
 *
 * 연결돼 있다고 보고 있는 것은 아니다. 홈 화면에 두고 다른 앱을 보는 동안에도 연결은
 * 한동안 살아 있다. 보고 있는 사람에게는 앱 안에서 알리고, 그렇지 않으면 폰 알림을 보낸다.
 */
const watching = new Map<WebSocket, number>();

/**
 * "보고 있다"는 말을 믿어 주는 기간.
 *
 * 폰이 잠기거나 지하철에 들어가면 연결은 한동안 살아 있는 것처럼 보인다. 그동안
 * "보고 있는 사람"으로 남아 있으면 폰 알림이 막혀서, 메시지가 와도 아무 일도
 * 일어나지 않는다. 화면을 보고 있는 앱은 주기적으로 다시 알려 오므로, 그 소식이
 * 끊기면 더는 보고 있지 않다고 본다.
 */
const WATCH_TTL_MS = 45_000;

/** 죽은 연결을 걸러내는 주기. 답이 없으면 끊는다. */
const HEARTBEAT_MS = 20_000;

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

/**
 * 이 사람이 지금 앱을 보고 있는지(화면이 켜져 있고 앱이 앞에 있는지).
 *
 * 마지막으로 그렇게 말한 지 오래됐으면 아니라고 본다. 폰이 얼어붙거나 네트워크가
 * 끊기면 "보고 있다"고 한 채로 연결만 남는데, 그걸 믿으면 알림이 영영 가지 않는다.
 */
function isWatching(userId: string): boolean {
  const fresh = Date.now() - WATCH_TTL_MS;
  for (const [socket, id] of sockets.entries()) {
    if (id === userId && (watching.get(socket) ?? 0) > fresh) return true;
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

/**
 * 음성을 글로 옮긴다. 번역보다 먼저 해야 한다 — 옮긴 글이 곧 번역할 원문이기 때문이다.
 * 실패해도 메시지 자체는 멀쩡하다(소리는 들을 수 있다). 상태만 남기고 넘어간다.
 */
async function runTranscription(message: ChatMessage): Promise<void> {
  const attachment = message.attachment;
  if (!attachment || attachment.kind !== 'audio') return;
  if (attachment.transcript || attachment.transcriptStatus === 'failed') return;

  const file = await getAudioForTranscription(attachment.id);
  if (!file) return;

  try {
    const participants = await bothProfiles();
    const speaker = participants.find((p) => p.id === message.senderId) ?? participants[0];
    if (!speaker) return;

    // 폰이 만든 형식 그대로는 모델이 받아주지 않는다. 알아듣는 형식으로 맞춰 보낸다.
    const audio = await toModelAudio(file.bytes, file.mime);
    const { result } = await transcribeAudio({
      audio,
      ...(attachment.durationMs ? { durationMs: attachment.durationMs } : {}),
      speaker,
      participants,
    });

    const text = result.text.trim();
    await setTranscript(attachment.id, text ? { text, lang: result.lang } : null);

    // 공부 삼아 다른 언어로 말했을 수도 있다. 들린 언어를 원문 언어로 삼는다.
    if (text && result.lang !== message.sourceLang) {
      console.log(`[transcribe] ${message.id}: ${message.sourceLang} 로 알고 있었으나 ${result.lang} 로 들림`);
      await setSourceLang(message.id, result.lang);
    }
  } catch (error) {
    const reason = error instanceof TranslationError ? error.message : String(error);
    console.error(`[transcribe] ${message.id} 실패: ${reason}`);
    await setTranscript(attachment.id, null);
  }

  // 번역을 기다리지 않고 받아쓴 글부터 띄운다.
  await publishUpdate(message.id);
}

async function runTranslation(messageId: string): Promise<void> {
  let message = await getMessage(messageId);
  if (!message) return;

  if (message.attachment?.kind === 'audio' && message.attachment.transcriptStatus === 'pending') {
    await runTranscription(message);
    message = (await getMessage(messageId)) ?? message;
  }

  const participants = await bothProfiles();
  const targetLangs = targetLangsFor(message.sourceLang, participants);

  // 번역할 게 없는 경우: 글이 없는 사진이거나, 둘 다 같은 언어로 읽을 때.
  if (targetLangs.length === 0 || !messageText(message)) {
    await setTranslationStatus(messageId, 'done');
    await publishUpdate(messageId);
    await notifyNewMessage(messageId);
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
  await notifyNewMessage(messageId);
}

async function publishUpdate(messageId: string): Promise<void> {
  const updated = await getMessage(messageId);
  if (updated) broadcastMessage('message_updated', updated);
}

/* ------------------------------------------------------------------ */
/* 알림                                                                */
/* ------------------------------------------------------------------ */

/**
 * 번역을 기다려 주는 한계.
 *
 * 알림은 번역이 끝난 뒤에 보낸다. 받자마자 보내면 상대가 못 읽는 언어로 된 알림이
 * 가기 때문이다. 그런데 모델이 붐비거나 서버가 막 깨어난 참이면 한참 걸리고, 그동안
 * 상대는 메시지가 온 줄도 모른다. 이만큼 지나면 있는 그대로라도 보낸다 —
 * 늦게 제대로 아는 것보다 지금 대충 아는 편이 낫다.
 */
const NOTIFY_DEADLINE_MS = 8_000;

/**
 * 폰 알림을 보낸다. 한 메시지에 한 번만.
 *
 * "이미 보냈는지"는 DB 에 적는다(messages.notified_at). 예전에는 메모리에 들고 있어서
 * 번역 도중 서버가 꺼지면 그 메시지는 영영 알림이 가지 않았다. 다시 번역을 돌릴 때
 * 알림이 또 가지 않는 것도 같은 표시가 막아 준다.
 */
async function notifyNewMessage(messageId: string): Promise<void> {
  if (!(await claimNotify(messageId))) return;

  const message = await getMessage(messageId);
  if (!message) return;

  const recipient = peerOf(message.senderId).profile.id;
  // 지금 앱을 보고 있으면 화면 안에서 알려 준다. 폰 알림까지 겹치면 두 번 울린다.
  // 연결만 살아 있고 다른 앱을 보고 있는 경우에는 폰 알림이 가야 한다.
  if (isWatching(recipient)) return;

  const [sender, receiver] = await Promise.all([profileOf(message.senderId), profileOf(recipient)]);
  const readingLang = receiver.displayLangs[0] ?? receiver.nativeLang;

  // 받는 사람이 읽는 언어로 적는다. 아직 번역이 없으면 원문이라도 보낸다.
  const translated = message.translations[readingLang]?.text;
  const own = messageText(message);
  const text = message.sourceLang === readingLang ? own : (translated ?? own);
  const label = message.attachment ? kindLabel(readingLang, message.attachment.kind) : '';
  const body = [label, text].filter(Boolean).join('  ').trim();

  // 폰 아이콘에 붙일 숫자. 알림이 여러 통 쌓였을 때 몇 통인지 보이게 한다.
  const readState = await getReadState();
  const unread = await countUnread(recipient, readState[recipient] ?? 0);

  await notify(recipient, {
    title: sender.name,
    body: body || '…',
    url: `/?u=${encodeURIComponent(recipient)}`,
    messageId: message.id,
    unread,
  });
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

/**
 * 헤더 대신 주소의 ?t= 로도 토큰을 받는다.
 * <img src> 나 <audio src> 에는 헤더를 붙일 방법이 없어서, 사진·음성을 내려줄 때만 쓴다.
 */
function authenticateMedia(c: Context): string | null {
  return authenticate(c) ?? verifyToken(c.req.query('t'));
}

app.get('/api/messages', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  // since 가 있으면 그보다 새로운 쪽을 준다. 찾아간 자리에서 아래로 내려올 때.
  const sinceRaw = c.req.query('since');
  const since = sinceRaw ? Number.parseInt(sinceRaw, 10) : undefined;
  const messages =
    since !== undefined && Number.isFinite(since)
      ? await getMessagesAfter(since, c.req.query('sinceId') ?? '', limit)
      : await getRecentMessages(limit, Number.isFinite(before) ? before : undefined);

  // 보낸 사람만 볼 수 있는 번역 지시를 떼고 내보낸다. WebSocket 쪽과 같은 규칙이다.
  return c.json({ messages: messages.map((message) => messageFor(userId, message)) });
});

/** 한 번에 돌려주는 검색 결과 수. 더 보고 싶으면 이어서 받아간다. */
const SEARCH_PAGE = 30;
/** 찾는 말의 최대 길이. 문장을 통째로 붙여 넣어도 여기까지만 본다. */
const MAX_QUERY_LENGTH = 100;

/**
 * 대화에서 찾기.
 *
 * 원문·번역문·받아쓴 글을 함께 본다. 한국어로 친 말을 스페인어로 기억하고 있을 수도 있고,
 * 음성 메시지는 아예 받아쓴 글에만 있기 때문이다.
 */
app.get('/api/search', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const query = (c.req.query('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  // 한 글자로는 거의 모든 말이 걸린다. 찾았다고 하기 어렵다.
  if (query.length < 2) return c.json({ messages: [], hasMore: false });

  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;

  // 한 통 더 달라고 해서 더 있는지까지 알아낸다.
  const found = await searchMessages(
    query,
    SEARCH_PAGE + 1,
    Number.isFinite(before) ? before : undefined,
  );
  const messages = found.slice(0, SEARCH_PAGE);
  return c.json({
    messages: messages.map((message) => messageFor(userId, message)),
    hasMore: found.length > SEARCH_PAGE,
  });
});

/**
 * 이 메시지와 그 둘레.
 *
 * 보관함에서 "대화에서 보기" 를 누르면 몇 달 전 자리일 수 있다. 거기까지 거슬러
 * 올라가며 수천 통을 끌어오는 대신 그 둘레만 잘라서 준다 — 몇 통이 쌓여 있든 한 번이면
 * 되고, 화면에도 그만큼만 그린다.
 */
app.get('/api/messages/:id/around', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const span = Math.min(Math.max(Number.parseInt(c.req.query('span') ?? '25', 10) || 25, 5), 100);
  const window = await getMessagesAround(c.req.param('id'), span, span);
  if (!window) return c.json({ error: '메시지를 찾을 수 없습니다.' }, 404);

  return c.json({
    messages: window.messages.map((message) => messageFor(userId, message)),
    hasOlder: window.hasOlder,
    hasNewer: window.hasNewer,
  });
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

  // 번역이 쓰는 나에 대한 정보. 안 보내면 지금 값을 그대로 둔다.
  const gender = isGender(body?.gender) ? body.gender : current.gender;
  const region =
    typeof body?.region === 'string' ? body.region.trim().slice(0, MAX_REGION_LENGTH) : current.region;

  await saveSettings(userId, nativeLang, displayLangs, {
    ...(gender ? { gender } : {}),
    ...(region ? { region } : {}),
  });
  const profile = await profileOf(userId);
  broadcast({ type: 'presence', userId, online: true });
  return c.json({ profile });
});

/** 대화방 배경. 기본 배경 id 이거나 `photo:<첨부 id>`. */
app.put('/api/wallpaper', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as { wallpaper?: unknown } | null;
  const value = typeof body?.wallpaper === 'string' ? body.wallpaper.trim() : '';
  const isPhoto = /^photo:[0-9a-f-]{36}$/i.test(value);
  if (!isWallpaperId(value) && !isPhoto) {
    return c.json({ error: '알 수 없는 배경입니다.' }, 400);
  }

  const current = await profileOf(userId);
  await saveWallpaper(userId, value, {
    nativeLang: current.nativeLang,
    displayLangs: current.displayLangs,
  });
  return c.json({ profile: await profileOf(userId) });
});

/**
 * 비밀번호 바꾸기.
 *
 * 바꾸고 나면 예전 비밀번호로 받아 둔 토큰은 전부 무효가 된다. 바꾸는 이유가 대개
 * "누가 아는 것 같다"인데 이미 들어와 있는 쪽이 남으면 바꾼 의미가 없다.
 * 대신 바꾼 사람에게는 새 토큰을 바로 돌려줘서 그 기기만 로그인이 유지된다.
 */
app.post('/api/passcode', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const current = typeof body?.current === 'string' ? body.current.trim() : '';
  const next = typeof body?.next === 'string' ? body.next.trim() : '';

  if (!checkPasscode(userId, current)) {
    return c.json({ error: '지금 비밀번호가 맞지 않습니다.', code: 'wrongCurrent' }, 403);
  }
  if (next.length < MIN_PASSCODE_LENGTH || next.length > MAX_PASSCODE_LENGTH) {
    return c.json({ error: `비밀번호는 ${MIN_PASSCODE_LENGTH}자 이상이어야 합니다.`, code: 'tooShort' }, 400);
  }
  if (next === current) {
    return c.json({ error: '지금 쓰는 것과 같은 비밀번호입니다.', code: 'same' }, 400);
  }

  await changePasscode(userId, next);
  console.log(`${userId} 의 비밀번호가 바뀌었습니다. 예전 토큰은 모두 무효가 됩니다.`);

  // 바꾼 기기는 그대로 쓸 수 있도록 새 토큰을 준다.
  return c.json({ token: issueToken(userId) });
});

/** 앱 색. 사람마다 따로 고른다. */
app.put('/api/theme', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as { theme?: unknown } | null;
  const theme = body?.theme;
  if (!isThemeId(theme)) return c.json({ error: '알 수 없는 색입니다.' }, 400);

  const current = await profileOf(userId);
  await saveTheme(userId, theme, {
    nativeLang: current.nativeLang,
    displayLangs: current.displayLangs,
  });
  return c.json({ profile: await profileOf(userId) });
});

/* --------------------------- 사진·음성 --------------------------- */

const MIME_BY_KIND: Record<AttachmentKind, RegExp> = {
  image: /^image\/(jpeg|png|webp|gif)$/,
  audio: /^audio\/(webm|ogg|mp4|mpeg|aac|wav)(;.*)?$/,
};

/**
 * 파일을 먼저 올리고, 그 id 를 실어 메시지를 보낸다.
 * 사진을 WebSocket 으로 실어 보내면 그 사이 다른 메시지가 전부 밀린다.
 */
app.post('/api/attachments', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const kind = c.req.query('kind') === 'audio' ? 'audio' : 'image';
  const mime = (c.req.header('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!MIME_BY_KIND[kind].test(mime)) {
    return c.json({ error: `보낼 수 없는 형식입니다 (${mime || '알 수 없음'}).` }, 415);
  }

  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: '빈 파일입니다.' }, 400);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: `파일이 너무 큽니다 (최대 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB).` }, 413);
  }

  const number = (name: string): number | undefined => {
    const raw = Number.parseInt(c.req.query(name) ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  };

  const attachment = await insertAttachment({
    kind,
    mime,
    bytes,
    senderId: userId,
    ...(number('width') ? { width: number('width') as number } : {}),
    ...(number('height') ? { height: number('height') as number } : {}),
    ...(number('duration') ? { durationMs: number('duration') as number } : {}),
  });
  return c.json({ attachment });
});

app.get('/api/attachments/:id', async (c) => {
  if (!authenticateMedia(c)) return c.json({ error: 'unauthorized' }, 401);

  const file = await getAttachmentBytes(c.req.param('id'));
  if (!file) return c.json({ error: '파일을 찾을 수 없습니다.' }, 404);

  return c.body(new Uint8Array(file.bytes), 200, {
    'content-type': file.mime,
    // 내용이 바뀌지 않는 파일이다. 한 번 받은 폰은 다시 받지 않는다.
    'cache-control': 'private, max-age=31536000, immutable',
  });
});

/** 대화방 사진첩. 주고받은 사진만 최근 것부터. */
app.get('/api/photos', async (c) => {
  if (!authenticate(c)) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ photos: await listPhotos() });
});

/* ------------------------ 저장한 문장 / 단어장 ------------------------ */

app.get('/api/saved', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ items: await listSaved(userId) });
});

app.post('/api/saved', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const lang = isLangCode(body?.lang) ? body.lang : null;
  if (!text || !lang) return c.json({ error: '저장할 문장이 없습니다.' }, 400);

  // 대화의 말풍선에서 온 것이면 메시지가, 단어장 예문에서 온 것이면 그 단어가 붙는다.
  const item = await saveSentence(userId, {
    ...(typeof body?.messageId === 'string' && body.messageId
      ? { messageId: body.messageId }
      : {}),
    ...(typeof body?.vocabTerm === 'string' && body.vocabTerm.trim()
      ? { vocabTerm: body.vocabTerm.trim() }
      : {}),
    lang,
    text,
    ...(isLangCode(body?.pairLang) ? { pairLang: body.pairLang } : {}),
    ...(typeof body?.pairText === 'string' && body.pairText.trim()
      ? { pairText: body.pairText.trim() }
      : {}),
    ...(typeof body?.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
  });
  return c.json({ item });
});

app.delete('/api/saved/:id', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  await deleteSaved(userId, c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/vocab', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ entries: await listVocab(userId) });
});

app.post('/api/vocab', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  // 설명은 문장을 잘라서 주기 때문에 조각 끝에 물음표·쉼표가 붙어 온다. 떼고 담는다.
  const term = cleanTerm(typeof body?.term === 'string' ? body.term : '');
  const meaning = typeof body?.meaning === 'string' ? body.meaning.trim() : '';
  const lang = isLangCode(body?.lang) ? body.lang : null;
  if (!term || !meaning || !lang) return c.json({ error: '단어와 뜻이 필요합니다.' }, 400);

  const entry = await saveVocab(userId, {
    term,
    lang,
    meaning,
    ...(typeof body?.reading === 'string' && body.reading.trim()
      ? { reading: body.reading.trim() }
      : {}),
    ...(typeof body?.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
    ...(typeof body?.messageId === 'string' ? { messageId: body.messageId } : {}),
  });
  return c.json({ entry });
});

/** 외웠다 / 아직이다. */
app.patch('/api/vocab/:id', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as { learned?: unknown } | null;
  const entry = await setVocabLearned(userId, c.req.param('id'), body?.learned === true);
  return entry ? c.json({ entry }) : c.json({ error: '단어를 찾을 수 없습니다.' }, 404);
});

/**
 * 이 단어가 쓰인 예문을 하나 더 만든다.
 *
 * 앞의 것을 지우지 않고 쌓는다 — 같은 단어가 여러 상황에서 어떻게 쓰이는지가 배울 거리다.
 * 이미 있는 문장은 모델에 알려 주고 다른 것을 부탁하지만, 그래도 같은 말이 나오면
 * 몇 번 더 물어본다. 계속 겹치면 그냥 겹친다고 알려 준다(무료 한도를 갉아먹을 이유가 없다).
 */
const EXAMPLE_TRIES = 3;

app.post('/api/vocab/:id/example', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const entry = await getVocab(userId, c.req.param('id'));
  if (!entry) return c.json({ error: '단어를 찾을 수 없습니다.' }, 404);

  const learner = await profileOf(userId);
  const existing = entry.examples.map((example) => example.sentence);

  try {
    for (let attempt = 0; attempt < EXAMPLE_TRIES; attempt += 1) {
      const { result } = await makeExample({
        term: entry.term,
        meaning: entry.meaning,
        ...(entry.note ? { note: entry.note } : {}),
        lang: entry.lang,
        learner,
        existing,
      });

      if (existing.some((sentence) => sameSentence(sentence, result.sentence))) {
        console.log(`[example] ${entry.term}: 같은 문장이 나와 다시 물어봅니다 (${attempt + 1}/${EXAMPLE_TRIES})`);
        continue;
      }

      const updated = await addVocabExample(userId, entry.id, result);
      return c.json({ entry: updated ?? entry });
    }
    return c.json({ entry, duplicate: true });
  } catch (error) {
    const reason = error instanceof TranslationError ? error.message : String(error);
    console.error(`[example] ${entry.term} 실패: ${reason}`);
    return c.json({ error: reason }, 502);
  }
});

app.delete('/api/vocab/:id', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  await deleteVocab(userId, c.req.param('id'));
  return c.json({ ok: true });
});

/* ------------------------------ 알림 ------------------------------ */

app.get('/api/push/key', (c) => {
  const key = publicKey();
  return key ? c.json({ key }) : c.json({ error: '알림을 쓸 수 없습니다.' }, 503);
});

app.post('/api/push/subscribe', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const body = (await c.req.json().catch(() => null)) as { subscription?: unknown } | null;
  const ok = await subscribe(userId, (body?.subscription ?? {}) as never);
  return ok ? c.json({ ok: true }) : c.json({ error: '알림 등록 정보가 올바르지 않습니다.' }, 400);
});

/**
 * 지금 이 사람의 폰으로 시험 알림을 한 통 보낸다.
 *
 * "알림이 안 와요" 는 원인이 여럿이다 — 허용을 안 했거나, 홈 화면에 설치하지 않았거나,
 * 등록이 만료됐거나. 눌러서 직접 확인할 수 있으면 어디가 막혔는지 바로 안다.
 * 돌려주는 숫자는 실제로 보낸 기기 수다. 0 이면 이 사람의 등록이 하나도 없다는 뜻이다.
 */
app.post('/api/push/test', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const me = await profileOf(userId);
  const lang = me.displayLangs[0] ?? me.nativeLang;
  const sent = await notify(userId, {
    title: 'Fran',
    body: TEST_BODY[lang] ?? TEST_BODY.en,
    url: `/?u=${encodeURIComponent(userId)}`,
    messageId: 'test',
  });
  return c.json({ sent });
});

/** 시험 알림 문구. 받는 사람이 읽는 언어로. */
const TEST_BODY: Record<LangCode, string> = {
  ko: '알림이 잘 오고 있어요 ✅',
  es: 'Los avisos funcionan ✅',
  en: 'Notifications are working ✅',
  zh: '通知正常 ✅',
};

app.post('/api/push/unsubscribe', async (c) => {
  if (!authenticate(c)) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint === 'string') await unsubscribe(body.endpoint);
  return c.json({ ok: true });
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
    targetLang === message.sourceLang ? messageText(message) : message.translations[targetLang]?.text;
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

/* --------------------------- 단어 풀이 --------------------------- */

/** 눌러서 풀어볼 수 있는 단어의 최대 길이. 문장을 통째로 보내는 걸 막는다. */
const MAX_WORD_LENGTH = 40;

/**
 * 문장에서 단어 하나만 눌렀을 때.
 *
 * 문장 전체 설명과 달리 문맥 전체를 모델에 보내지 않는다. 그 문장과 그 단어면 충분하고,
 * 짧게 묻는 만큼 빨리 돌아온다. 같은 문장의 같은 단어는 캐시에서 꺼낸다.
 */
app.post('/api/messages/:id/word', async (c) => {
  const userId = authenticate(c);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);

  const message = await getMessage(c.req.param('id'));
  if (!message) return c.json({ error: '메시지를 찾을 수 없습니다.' }, 404);

  const body = (await c.req.json().catch(() => null)) as
    | { targetLang?: unknown; word?: unknown }
    | null;
  const targetLang = isLangCode(body?.targetLang) ? body.targetLang : message.sourceLang;
  const word = typeof body?.word === 'string' ? body.word.trim() : '';
  if (!word || word.length > MAX_WORD_LENGTH) {
    return c.json({ error: '단어를 찾을 수 없습니다.' }, 400);
  }

  const sentence =
    targetLang === message.sourceLang ? messageText(message) : message.translations[targetLang]?.text;
  if (!sentence) return c.json({ error: '그 언어의 문장이 아직 없습니다.' }, 400);
  // 그 문장에 없는 말이면 물어볼 이유가 없다. 문장을 열쇠 삼은 캐시도 어긋난다.
  if (!sentence.includes(word)) return c.json({ error: '문장에 없는 단어입니다.' }, 400);

  const learner = await profileOf(userId);
  const explainLang = learner.displayLangs[0] ?? learner.nativeLang;

  const cached = await getWordLookup(message.id, targetLang, explainLang, word);
  if (cached) return c.json({ lookup: cached });

  try {
    const { result } = await lookUpWord({ word, sentence, lang: targetLang, learner });
    const lookup: WordLookup = {
      word,
      base: result.base,
      lang: targetLang,
      ...(result.reading ? { reading: result.reading } : {}),
      ...(result.pos ? { pos: result.pos } : {}),
      meaning: result.meaning,
      inSentence: result.in_sentence,
      ...(result.note ? { note: result.note } : {}),
    };
    await saveWordLookup(message.id, explainLang, lookup);
    return c.json({ lookup });
  } catch (error) {
    const reason = error instanceof TranslationError ? error.message : String(error);
    console.error(`[word] ${word} 실패: ${reason}`);
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

/* --------------------------- 앱 설치 --------------------------- */

/**
 * 홈 화면에 추가할 때 쓰는 매니페스트. 사람마다 다르게 준다.
 *
 * 하나로 두면 두 사람이 같은 이름·같은 시작 주소로 설치돼서, 설치한 앱을 열어도
 * 자기 화면이 아니라 선택 화면이 뜬다. ?u= 를 보고 시작 주소를 그 사람 것으로 잡고,
 * 이름은 상대의 이름으로 둔다 — 한 사람하고만 쓰는 메신저이기 때문이다.
 */
app.get('/manifest.webmanifest', async (c) => {
  const requested = c.req.query('u');
  const profiles = await bothProfiles();
  const viewer = profiles.find((profile) => profile.id === requested);
  const peer = viewer ? profiles.find((profile) => profile.id !== viewer.id) : undefined;

  const startUrl = viewer ? `/?u=${encodeURIComponent(viewer.id)}` : '/';
  const name = peer?.name ?? 'Fran';

  return c.json(
    {
      name,
      short_name: name,
      description: '둘만 쓰는 번역 메신저',
      lang: viewer?.displayLangs[0] ?? 'ko',
      start_url: startUrl,
      /*
       * 이 앱이 누구인지. 적지 않으면 start_url 이 그 역할을 하는데, 나중에 start_url 을
       * 건드리면 크롬이 다른 앱으로 보고 설치된 것을 버린다. 지금 값과 똑같이 적어 두어
       * (지금은 아무것도 달라지지 않는다) 그런 일이 생기지 않게 못 박는다.
       */
      id: startUrl,
      scope: '/',
      display: 'standalone',
      background_color: '#17121f',
      theme_color: '#17121f',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        // 안드로이드는 아이콘을 동그랗게 잘라낸다. 잘려도 되는 여백을 둔 것을 따로 준다.
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    200,
    { 'content-type': 'application/manifest+json' },
  );
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
      // 사진이나 음성만 보낼 수도 있다. 둘 다 없으면 보낼 게 없는 것이다.
      if (!text && !event.attachmentId) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        send(socket, { type: 'error', message: `메시지가 너무 깁니다 (최대 ${MAX_MESSAGE_LENGTH}자).` });
        return;
      }
      if ((event.translationNote?.length ?? 0) > MAX_NOTE_LENGTH) {
        send(socket, { type: 'error', message: `번역 지시가 너무 깁니다 (최대 ${MAX_NOTE_LENGTH}자).` });
        return;
      }

      const profile = await profileOf(userId);
      const messageId = crypto.randomUUID();

      // 첨부는 이미 올라와 있다. 올린 사람이 같고 아직 어디에도 붙지 않았을 때만 붙는다.
      let attachment: Attachment | null = null;
      if (event.attachmentId) {
        attachment = await attachToMessage(event.attachmentId, messageId, userId);
        if (!attachment) {
          send(socket, { type: 'error', message: '첨부한 파일을 찾지 못했습니다.' });
          return;
        }
      }

      // 없는 메시지에 답하는 것처럼 보이지 않도록 실제로 있는지 확인한다.
      const replyTo = event.replyTo && (await getMessage(event.replyTo)) ? event.replyTo : undefined;

      const message = await insertMessage({
        id: messageId,
        senderId: userId,
        sourceText: text,
        sourceLang: isLangCode(event.sourceLang) ? event.sourceLang : profile.nativeLang,
        createdAt: Date.now(),
        ...(event.translationNote?.trim() ? { translationNote: event.translationNote.trim() } : {}),
        ...(attachment ? { attachment } : {}),
        ...(replyTo ? { replyTo } : {}),
      });

      // 번역을 기다리지 않고 원문을 먼저 띄운다. 번역은 곧 update 로 따라붙는다.
      broadcastMessage('message', message, { socket, clientId: event.clientId });
      enqueueTranslation(message.id);
      // 번역이 늦어져도 알림은 간다. 둘 중 먼저 닿는 쪽이 보내고 나머지는 지나간다.
      setTimeout(() => {
        void notifyNewMessage(message.id).catch((error: unknown) => {
          console.error('[push] 알림 실패:', error);
        });
      }, NOTIFY_DEADLINE_MS).unref();
      return;
    }

    case 'retranslate': {
      const message = await getMessage(event.messageId);
      if (!message) return;
      // 받아쓰기가 실패한 음성이면 그것부터 다시 해본다. 원문이 없으면 번역할 것도 없다.
      if (message.attachment?.kind === 'audio' && message.attachment.transcriptStatus === 'failed') {
        await retryTranscript(message.attachment.id);
      }
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

    case 'edit': {
      const text = event.text.trim();
      if (!text) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        send(socket, { type: 'error', message: `메시지가 너무 깁니다 (최대 ${MAX_MESSAGE_LENGTH}자).` });
        return;
      }

      // 내가 보낸 것만, 실제로 달라졌을 때만. 같은 글로 다시 번역을 돌릴 이유가 없다.
      if (!(await editMessage(event.messageId, userId, text))) return;

      // 고친 순간부터 옛 번역은 틀린 말이다. 먼저 비우고, 새 원문과 함께 보낸다.
      await clearTranslations(event.messageId);
      await setTranslationStatus(event.messageId, 'pending');
      await publishUpdate(event.messageId);
      enqueueTranslation(event.messageId);
      return;
    }

    case 'react': {
      const emoji = typeof event.emoji === 'string' ? event.emoji.slice(0, 8) : null;
      const target = await getMessage(event.messageId);
      if (!target) return;
      await toggleReaction(target.id, userId, emoji);
      await publishUpdate(target.id);
      return;
    }

    case 'attention':
      // 화면을 보고 있는 동안 앱이 주기적으로 다시 알려 온다. 그 시각을 적어 둔다.
      if (event.visible) watching.set(socket, Date.now());
      else watching.delete(socket);
      return;

    case 'typing':
      broadcast({ type: 'typing', userId, isTyping: event.isTyping }, socket);
      return;

    case 'read': {
      if (typeof event.at !== 'number' || !Number.isFinite(event.at)) return;
      const at = await markRead(userId, event.at);
      // 상대 화면의 "읽음"을 바로 켜 준다.
      broadcast({ type: 'read', userId, at });
      return;
    }
  }
}

// DB 가 준비되기 전에 요청을 받으면 첫 메시지가 통째로 실패한다. 먼저 연결하고 연다.
try {
  await initDatabase();
  // 파일로 관리하던 용어집을 DB 로 옮긴다. 비어 있을 때 한 번만 옮겨 담는다.
  await seedGlossary(config.glossary);

  // 앱에서 바꾼 비밀번호를 읽어 둔다. 없으면 .env 값을 그대로 쓴다.
  await initAuth();
  warnAboutDefaultPasscodes();

  // 알림 서명 키. 없으면 이때 한 번 만들어 DB 에 넣는다.
  await initPush();

  // 고르기만 하고 보내지 않은 사진·음성. 아무도 못 보는 데이터라 치운다.
  const orphans = await purgeOrphanAttachments();
  if (orphans > 0) console.log(`보내지 않은 첨부 ${orphans}건을 정리했습니다.`);

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

/**
 * 살아 있다고 답한 연결들.
 *
 * TCP 는 상대가 사라져도 한참 동안 알려주지 않는다. 지하철에 들어가거나 폰이 꺼지면
 * 서버 쪽에는 멀쩡한 연결이 남아서, 그 사람을 "접속 중"으로 보이게 하고 알림도 막는다.
 * 주기적으로 찔러 보고 답이 없으면 끊는다.
 */
const alive = new Set<WebSocket>();

setInterval(() => {
  for (const socket of sockets.keys()) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, HEARTBEAT_MS).unref();

wss.on('connection', (socket: WebSocket, _request: unknown, userId: string) => {
  sockets.set(socket, userId);
  // 방금 연결했다면 보고 있는 것이다. 화면이 가려지면 곧 attention 이 와서 빠진다.
  watching.set(socket, Date.now());
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));

  void (async () => {
    const [me, peer, recent, glossary, readAt] = await Promise.all([
      profileOf(userId),
      profileOf(peerOf(userId).profile.id),
      getRecentMessages(50),
      listGlossary(),
      getReadState(),
    ]);
    if (socket.readyState !== socket.OPEN) return;

    send(socket, {
      type: 'hello',
      me,
      peer,
      messages: recent.map((message) => messageFor(userId, message)),
      readAt,
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
    watching.delete(socket);
    alive.delete(socket);
    if (!isOnline(userId)) broadcast({ type: 'presence', userId, online: false });
  });
});
