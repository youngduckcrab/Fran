import crypto from 'node:crypto';
import pg from 'pg';
import {
  isLangCode,
  type Attachment,
  type AttachmentKind,
  type ChatMessage,
  type GlossaryDraft,
  type GlossaryEntry,
  type LangCode,
  type MessageExplanation,
  type SavedSentence,
  type SavedSentenceDraft,
  type Translation,
  type TranslationErrorCode,
  type TranslationNote,
  type TranslationStatus,
  type VocabDraft,
  type VocabEntry,
} from '@fran/shared';
import { config } from './config.js';

// pg 는 BIGINT 를 문자열로 돌려준다. 시각을 밀리초 숫자로 다루고 있으므로 숫자로 받는다.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // 클라우드 DB 는 TLS 를 요구한다. 자체 서명 인증서를 쓰는 곳이면 환경변수로 낮춘다.
  ssl: config.databaseSsl === 'off' ? false : config.databaseSsl === 'no-verify' ? { rejectUnauthorized: false } : true,
  max: 5,
});

pool.on('error', (error) => {
  console.error('[db] 유휴 연결에서 오류:', error.message);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id                 TEXT PRIMARY KEY,
    sender_id          TEXT   NOT NULL,
    source_text        TEXT   NOT NULL,
    source_lang        TEXT   NOT NULL,
    created_at         BIGINT NOT NULL,
    translation_status TEXT   NOT NULL DEFAULT 'pending',
    translation_error  TEXT,
    translation_error_code TEXT,
    translation_note   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);

  CREATE TABLE IF NOT EXISTS translations (
    message_id TEXT   NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    lang       TEXT   NOT NULL,
    text       TEXT   NOT NULL,
    notes      TEXT   NOT NULL DEFAULT '[]',
    model      TEXT   NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (message_id, lang)
  );

  CREATE TABLE IF NOT EXISTS explanations (
    message_id   TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    target_lang  TEXT NOT NULL,
    explain_lang TEXT NOT NULL,
    payload      TEXT NOT NULL,
    PRIMARY KEY (message_id, target_lang, explain_lang)
  );

  CREATE TABLE IF NOT EXISTS glossary (
    id           TEXT   PRIMARY KEY,
    term         TEXT   NOT NULL,
    translations TEXT   NOT NULL DEFAULT '{}',
    avoid        TEXT   NOT NULL DEFAULT '[]',
    note         TEXT,
    updated_at   BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id       TEXT PRIMARY KEY,
    native_lang   TEXT NOT NULL,
    display_langs TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT   PRIMARY KEY,
    kind        TEXT   NOT NULL,
    mime        TEXT   NOT NULL,
    bytes       BYTEA  NOT NULL,
    size        INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration_ms INTEGER,
    sender_id   TEXT   NOT NULL,
    message_id  TEXT,
    created_at  BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

  CREATE TABLE IF NOT EXISTS saved_sentences (
    id         TEXT   PRIMARY KEY,
    user_id    TEXT   NOT NULL,
    message_id TEXT   NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    lang       TEXT   NOT NULL,
    text       TEXT   NOT NULL,
    pair_lang  TEXT,
    pair_text  TEXT,
    note       TEXT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_sentences (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS vocab (
    id         TEXT   PRIMARY KEY,
    user_id    TEXT   NOT NULL,
    term       TEXT   NOT NULL,
    lang       TEXT   NOT NULL,
    reading    TEXT,
    meaning    TEXT   NOT NULL,
    note       TEXT,
    message_id TEXT,
    created_at BIGINT NOT NULL
  );

  -- 같은 단어를 두 번 담아도 줄이 늘지 않게 한다.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_unique ON vocab (user_id, lang, LOWER(term));

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT   PRIMARY KEY,
    user_id    TEXT   NOT NULL,
    p256dh     TEXT   NOT NULL,
    auth       TEXT   NOT NULL,
    created_at BIGINT NOT NULL
  );

  -- 서버가 스스로 만들어 두고두고 써야 하는 값(알림 서명 키 등).
  -- 환경변수로 받으면 사람이 한 번 더 손을 대야 하고, 재배포 때마다 새로 만들면
  -- 이미 등록된 알림이 전부 무효가 된다.
  CREATE TABLE IF NOT EXISTS app_secrets (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- CREATE TABLE IF NOT EXISTS 는 이미 있는 테이블에 컬럼을 더해 주지 않는다.
  -- 먼저 배포된 DB 에도 새 컬럼이 생기도록 따로 적어 둔다. 여러 번 돌려도 안전하다.
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS translation_error      TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS translation_error_code TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS translation_note       TEXT;
  ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS wallpaper TEXT;
`;

/** 서버가 요청을 받기 전에 한 번 부른다. 스키마가 없으면 만든다. */
export async function initDatabase(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

interface MessageRow {
  id: string;
  sender_id: string;
  source_text: string;
  source_lang: string;
  created_at: number;
  translation_status: string;
  translation_error: string | null;
  translation_error_code: string | null;
  translation_note: string | null;
}

interface TranslationRow {
  message_id: string;
  lang: string;
  text: string;
  notes: string;
  model: string;
  created_at: number;
}

interface AttachmentRow {
  id: string;
  kind: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  message_id: string | null;
  created_at: number;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    kind: row.kind as AttachmentKind,
    mime: row.mime,
    size: row.size,
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    ...(row.duration_ms ? { durationMs: row.duration_ms } : {}),
    createdAt: row.created_at,
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 메시지 여러 건의 번역을 한 번에 읽어 붙인다. 건마다 질의하면 왕복이 늘어난다. */
async function hydrate(rows: MessageRow[]): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];

  const { rows: translationRows } = await pool.query<TranslationRow>(
    `SELECT * FROM translations WHERE message_id = ANY($1::text[])`,
    [rows.map((row) => row.id)],
  );

  const { rows: attachmentRows } = await pool.query<AttachmentRow>(
    // bytes 는 빼고 읽는다. 목록을 그릴 때 사진 원본까지 들고 올 이유가 없다.
    `SELECT id, kind, mime, size, width, height, duration_ms, message_id, created_at
       FROM attachments WHERE message_id = ANY($1::text[])`,
    [rows.map((row) => row.id)],
  );
  const attachments = new Map<string, Attachment>();
  for (const row of attachmentRows) {
    if (row.message_id) attachments.set(row.message_id, toAttachment(row));
  }

  const byMessage = new Map<string, Partial<Record<LangCode, Translation>>>();
  for (const row of translationRows) {
    if (!isLangCode(row.lang)) continue;
    const bucket = byMessage.get(row.message_id) ?? {};
    bucket[row.lang] = {
      lang: row.lang,
      text: row.text,
      notes: parseJson<TranslationNote[]>(row.notes, []),
      model: row.model,
      createdAt: row.created_at,
    };
    byMessage.set(row.message_id, bucket);
  }

  return rows.map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    sourceText: row.source_text,
    sourceLang: isLangCode(row.source_lang) ? row.source_lang : 'ko',
    createdAt: row.created_at,
    translationStatus: row.translation_status as TranslationStatus,
    ...(row.translation_error ? { translationError: row.translation_error } : {}),
    ...(row.translation_error_code
      ? { translationErrorCode: row.translation_error_code as TranslationErrorCode }
      : {}),
    ...(row.translation_note ? { translationNote: row.translation_note } : {}),
    translations: byMessage.get(row.id) ?? {},
    ...(attachments.has(row.id) ? { attachment: attachments.get(row.id) as Attachment } : {}),
  }));
}

export async function insertMessage(message: {
  id: string;
  senderId: string;
  sourceText: string;
  sourceLang: LangCode;
  createdAt: number;
  translationNote?: string;
  attachment?: Attachment;
}): Promise<ChatMessage> {
  await pool.query(
    `INSERT INTO messages (id, sender_id, source_text, source_lang, created_at, translation_status, translation_note)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [
      message.id,
      message.senderId,
      message.sourceText,
      message.sourceLang,
      message.createdAt,
      message.translationNote ?? null,
    ],
  );
  return { ...message, translationStatus: 'pending', translations: {} };
}

/* ------------------------------ 첨부 ------------------------------ */

export async function insertAttachment(input: {
  kind: AttachmentKind;
  mime: string;
  bytes: Buffer;
  width?: number;
  height?: number;
  durationMs?: number;
  senderId: string;
}): Promise<Attachment> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await pool.query(
    `INSERT INTO attachments (id, kind, mime, bytes, size, width, height, duration_ms, sender_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.kind,
      input.mime,
      input.bytes,
      input.bytes.byteLength,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.senderId,
      createdAt,
    ],
  );
  return {
    id,
    kind: input.kind,
    mime: input.mime,
    size: input.bytes.byteLength,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.durationMs ? { durationMs: input.durationMs } : {}),
    createdAt,
  };
}

/**
 * 첨부를 메시지에 붙인다. 아직 아무 메시지에도 붙지 않았고 올린 사람이 같을 때만.
 * 남의 첨부 id 를 적어 보내서 남의 사진을 자기 메시지로 만드는 일을 막는다.
 */
export async function attachToMessage(
  attachmentId: string,
  messageId: string,
  senderId: string,
): Promise<Attachment | null> {
  const { rows } = await pool.query<AttachmentRow>(
    `UPDATE attachments SET message_id = $1
      WHERE id = $2 AND sender_id = $3 AND message_id IS NULL
      RETURNING id, kind, mime, size, width, height, duration_ms, message_id, created_at`,
    [messageId, attachmentId, senderId],
  );
  const row = rows[0];
  return row ? toAttachment(row) : null;
}

export async function getAttachmentBytes(
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const { rows } = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT mime, bytes FROM attachments WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** 대화방 사진첩. 메시지에 붙은 사진만, 최근 것부터. */
export async function listPhotos(limit = 200): Promise<Array<Attachment & { messageId: string; senderId: string }>> {
  const { rows } = await pool.query<AttachmentRow & { sender_id: string }>(
    `SELECT id, kind, mime, size, width, height, duration_ms, message_id, sender_id, created_at
       FROM attachments
      WHERE kind = 'image' AND message_id IS NOT NULL
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    ...toAttachment(row),
    messageId: row.message_id as string,
    senderId: row.sender_id,
  }));
}

/**
 * 메시지에 끝내 붙지 못한 첨부를 치운다. 사진을 고른 뒤 보내지 않고 나가면
 * 아무도 못 보는 데이터만 DB 에 남는다. 무료 DB 는 용량이 넉넉하지 않다.
 */
export async function purgeOrphanAttachments(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM attachments WHERE message_id IS NULL AND created_at < $1`,
    [Date.now() - olderThanMs],
  );
  return rowCount ?? 0;
}

export async function setTranslationNote(messageId: string, note: string | undefined): Promise<void> {
  await pool.query(`UPDATE messages SET translation_note = $1 WHERE id = $2`, [note ?? null, messageId]);
}

export async function getMessage(id: string): Promise<ChatMessage | null> {
  const { rows } = await pool.query<MessageRow>(`SELECT * FROM messages WHERE id = $1`, [id]);
  return (await hydrate(rows))[0] ?? null;
}

/** 오래된 것부터 정렬해 돌려준다(화면에 그리는 순서). */
export async function getRecentMessages(limit: number, before?: number): Promise<ChatMessage[]> {
  const { rows } = before === undefined
    ? await pool.query<MessageRow>(
        `SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT $1`,
        [limit],
      )
    : await pool.query<MessageRow>(
        `SELECT * FROM messages WHERE created_at < $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [before, limit],
      );
  return (await hydrate(rows)).reverse();
}

export async function saveTranslation(messageId: string, translation: Translation): Promise<void> {
  await pool.query(
    `INSERT INTO translations (message_id, lang, text, notes, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (message_id, lang) DO UPDATE SET
       text = EXCLUDED.text, notes = EXCLUDED.notes,
       model = EXCLUDED.model, created_at = EXCLUDED.created_at`,
    [
      messageId,
      translation.lang,
      translation.text,
      JSON.stringify(translation.notes),
      translation.model,
      translation.createdAt,
    ],
  );
}

export async function setTranslationStatus(
  messageId: string,
  status: TranslationStatus,
  failure?: { message: string; code: TranslationErrorCode },
): Promise<void> {
  await pool.query(
    `UPDATE messages SET translation_status = $1, translation_error = $2, translation_error_code = $3
      WHERE id = $4`,
    [status, failure?.message ?? null, failure?.code ?? null, messageId],
  );
}

/**
 * 번역을 기다리다 만 메시지들. 서버가 번역 도중 재시작되면(무료 호스팅은 자주 잠든다)
 * 그 메시지는 영원히 "번역하는 중…" 으로 남는다. 시작할 때 다시 큐에 넣기 위해 찾는다.
 */
export async function pendingMessageIds(limit = 50): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM messages WHERE translation_status = 'pending'
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.id);
}

export async function clearTranslations(messageId: string): Promise<void> {
  await pool.query(`DELETE FROM translations WHERE message_id = $1`, [messageId]);
}

/* ---------------------------- 사용자 설정 ---------------------------- */

interface SettingsRow {
  user_id: string;
  native_lang: string;
  display_langs: string;
  wallpaper: string | null;
}

async function settingsOf(userId: string): Promise<SettingsRow | null> {
  const { rows } = await pool.query<SettingsRow>(`SELECT * FROM user_settings WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function getDisplayLangs(userId: string, fallback: LangCode[]): Promise<LangCode[]> {
  const row = await settingsOf(userId);
  if (!row) return fallback;
  const langs = row.display_langs.split(',').filter(isLangCode);
  return langs.length > 0 ? langs : fallback;
}

export async function getNativeLang(userId: string, fallback: LangCode): Promise<LangCode> {
  const row = await settingsOf(userId);
  return row && isLangCode(row.native_lang) ? row.native_lang : fallback;
}

export async function saveSettings(
  userId: string,
  nativeLang: LangCode,
  displayLangs: LangCode[],
): Promise<void> {
  await pool.query(
    `INSERT INTO user_settings (user_id, native_lang, display_langs)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       native_lang = EXCLUDED.native_lang, display_langs = EXCLUDED.display_langs`,
    [userId, nativeLang, displayLangs.join(',')],
  );
}

/* ------------------------------ 용어집 ------------------------------ */

interface GlossaryRow {
  id: string;
  term: string;
  translations: string;
  avoid: string;
  note: string | null;
  updated_at: number;
}

function hydrateGlossary(row: GlossaryRow): GlossaryEntry {
  const translations = parseJson<Record<string, string>>(row.translations, {});
  const filtered: Partial<Record<LangCode, string>> = {};
  for (const [lang, value] of Object.entries(translations)) {
    if (isLangCode(lang) && value) filtered[lang] = value;
  }
  return {
    id: row.id,
    term: row.term,
    ...(Object.keys(filtered).length > 0 ? { translations: filtered } : {}),
    ...(row.note ? { note: row.note } : {}),
    avoid: parseJson<string[]>(row.avoid, []).filter((item) => typeof item === 'string' && item.trim()),
    updatedAt: row.updated_at,
  };
}

export async function listGlossary(): Promise<GlossaryEntry[]> {
  const { rows } = await pool.query<GlossaryRow>(`SELECT * FROM glossary ORDER BY LOWER(term)`);
  return rows.map(hydrateGlossary);
}

export async function saveGlossaryEntry(draft: GlossaryDraft, id?: string): Promise<GlossaryEntry> {
  const entry: GlossaryEntry = {
    id: id ?? crypto.randomUUID(),
    term: draft.term.trim(),
    ...(draft.translations ? { translations: draft.translations } : {}),
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
    avoid: (draft.avoid ?? []).map((item) => item.trim()).filter(Boolean),
    updatedAt: Date.now(),
  };

  await pool.query(
    `INSERT INTO glossary (id, term, translations, avoid, note, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       term = EXCLUDED.term, translations = EXCLUDED.translations,
       avoid = EXCLUDED.avoid, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
    [
      entry.id,
      entry.term,
      JSON.stringify(entry.translations ?? {}),
      JSON.stringify(entry.avoid ?? []),
      entry.note ?? null,
      entry.updatedAt,
    ],
  );
  return entry;
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  await pool.query(`DELETE FROM glossary WHERE id = $1`, [id]);
}

/** 처음 켰을 때만 glossary.json 의 내용을 옮겨 담는다. 이후로는 DB 가 원본이다. */
export async function seedGlossary(entries: GlossaryDraft[]): Promise<void> {
  const { rows } = await pool.query<{ count: number }>(`SELECT COUNT(*)::bigint AS count FROM glossary`);
  if ((rows[0]?.count ?? 0) > 0) return;
  for (const entry of entries) await saveGlossaryEntry(entry);
}

/* ---------------------------- 문장 설명 캐시 ---------------------------- */

/** 한 번 설명한 문장은 다시 모델에 묻지 않는다. 같은 메시지를 여러 번 열어보게 되므로. */
export async function getExplanation(
  messageId: string,
  targetLang: LangCode,
  explainLang: LangCode,
): Promise<MessageExplanation | null> {
  const { rows } = await pool.query<{ payload: string }>(
    `SELECT payload FROM explanations
      WHERE message_id = $1 AND target_lang = $2 AND explain_lang = $3`,
    [messageId, targetLang, explainLang],
  );
  const payload = rows[0]?.payload;
  return payload ? parseJson<MessageExplanation | null>(payload, null) : null;
}

export async function saveExplanation(messageId: string, explanation: MessageExplanation): Promise<void> {
  await pool.query(
    `INSERT INTO explanations (message_id, target_lang, explain_lang, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, target_lang, explain_lang) DO UPDATE SET payload = EXCLUDED.payload`,
    [messageId, explanation.targetLang, explanation.explainLang, JSON.stringify(explanation)],
  );
}

/* --------------------- 저장한 문장 (보관함) --------------------- */

interface SavedRow {
  id: string;
  user_id: string;
  message_id: string;
  lang: string;
  text: string;
  pair_lang: string | null;
  pair_text: string | null;
  note: string | null;
  created_at: number;
}

function toSaved(row: SavedRow): SavedSentence {
  return {
    id: row.id,
    userId: row.user_id,
    messageId: row.message_id,
    lang: isLangCode(row.lang) ? row.lang : 'ko',
    text: row.text,
    ...(row.pair_lang && isLangCode(row.pair_lang) ? { pairLang: row.pair_lang } : {}),
    ...(row.pair_text ? { pairText: row.pair_text } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

export async function listSaved(userId: string): Promise<SavedSentence[]> {
  const { rows } = await pool.query<SavedRow>(
    `SELECT * FROM saved_sentences WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toSaved);
}

export async function saveSentence(userId: string, draft: SavedSentenceDraft): Promise<SavedSentence> {
  const entry: SavedSentence = {
    id: crypto.randomUUID(),
    userId,
    messageId: draft.messageId,
    lang: draft.lang,
    text: draft.text,
    ...(draft.pairLang ? { pairLang: draft.pairLang } : {}),
    ...(draft.pairText ? { pairText: draft.pairText } : {}),
    ...(draft.note ? { note: draft.note } : {}),
    createdAt: Date.now(),
  };
  await pool.query(
    `INSERT INTO saved_sentences (id, user_id, message_id, lang, text, pair_lang, pair_text, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.id,
      userId,
      entry.messageId,
      entry.lang,
      entry.text,
      entry.pairLang ?? null,
      entry.pairText ?? null,
      entry.note ?? null,
      entry.createdAt,
    ],
  );
  return entry;
}

/** 자기 것만 지울 수 있다. */
export async function deleteSaved(userId: string, id: string): Promise<void> {
  await pool.query(`DELETE FROM saved_sentences WHERE id = $1 AND user_id = $2`, [id, userId]);
}

/** 이 메시지의 이 언어 문장을 이미 저장해 뒀는지. 화면에서 별을 채워 보여주려고. */
export async function savedKeysOf(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ message_id: string; lang: string }>(
    `SELECT message_id, lang FROM saved_sentences WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => `${row.message_id}:${row.lang}`);
}

/* ------------------------------ 단어장 ------------------------------ */

interface VocabRow {
  id: string;
  user_id: string;
  term: string;
  lang: string;
  reading: string | null;
  meaning: string;
  note: string | null;
  message_id: string | null;
  created_at: number;
}

function toVocab(row: VocabRow): VocabEntry {
  return {
    id: row.id,
    userId: row.user_id,
    term: row.term,
    lang: isLangCode(row.lang) ? row.lang : 'es',
    ...(row.reading ? { reading: row.reading } : {}),
    meaning: row.meaning,
    ...(row.note ? { note: row.note } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {}),
    createdAt: row.created_at,
  };
}

export async function listVocab(userId: string): Promise<VocabEntry[]> {
  const { rows } = await pool.query<VocabRow>(
    `SELECT * FROM vocab WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toVocab);
}

/**
 * 같은 단어를 또 담으면 새 줄을 만들지 않고 뜻만 최신으로 바꾼다.
 * 대화하다 보면 같은 단어를 여러 번 만나는데, 그때마다 줄이 늘면 단어장이 못 쓰게 된다.
 */
export async function saveVocab(userId: string, draft: VocabDraft): Promise<VocabEntry> {
  const { rows } = await pool.query<VocabRow>(
    `INSERT INTO vocab (id, user_id, term, lang, reading, meaning, note, message_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, lang, LOWER(term)) DO UPDATE SET
       reading = EXCLUDED.reading, meaning = EXCLUDED.meaning,
       note = EXCLUDED.note, message_id = EXCLUDED.message_id
     RETURNING *`,
    [
      crypto.randomUUID(),
      userId,
      draft.term.trim(),
      draft.lang,
      draft.reading?.trim() || null,
      draft.meaning.trim(),
      draft.note?.trim() || null,
      draft.messageId ?? null,
      Date.now(),
    ],
  );
  return toVocab(rows[0] as VocabRow);
}

export async function deleteVocab(userId: string, id: string): Promise<void> {
  await pool.query(`DELETE FROM vocab WHERE id = $1 AND user_id = $2`, [id, userId]);
}

/* ---------------------------- 배경화면 ---------------------------- */

export async function getWallpaper(userId: string): Promise<string | undefined> {
  const row = await settingsOf(userId);
  return row?.wallpaper ?? undefined;
}

export async function saveWallpaper(userId: string, wallpaper: string, fallback: {
  nativeLang: LangCode;
  displayLangs: LangCode[];
}): Promise<void> {
  // 설정 줄이 아직 없을 수도 있다(설정을 한 번도 저장하지 않은 사람).
  await pool.query(
    `INSERT INTO user_settings (user_id, native_lang, display_langs, wallpaper)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET wallpaper = EXCLUDED.wallpaper`,
    [userId, fallback.nativeLang, fallback.displayLangs.join(','), wallpaper],
  );
}

/* ------------------------------ 알림 ------------------------------ */

export interface PushSubscriptionRow {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
}

export async function savePushSubscription(sub: PushSubscriptionRow): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, sub.userId, sub.p256dh, sub.auth, Date.now()],
  );
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { rows } = await pool.query<{ endpoint: string; user_id: string; p256dh: string; auth: string }>(
    `SELECT endpoint, user_id, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => ({
    endpoint: row.endpoint,
    userId: row.user_id,
    p256dh: row.p256dh,
    auth: row.auth,
  }));
}

/* --------------------- 서버가 스스로 간직하는 값 --------------------- */

export async function getSecret(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(`SELECT value FROM app_secrets WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setSecret(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_secrets (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}
