import crypto from 'node:crypto';
import pg from 'pg';
import {
  isGender,
  isLangCode,
  isThemeId,
  type Attachment,
  type AttachmentKind,
  type ChatMessage,
  type Gender,
  type GlossaryDraft,
  type GlossaryEntry,
  type LangCode,
  type MessageExplanation,
  type SavedSentence,
  type SavedSentenceDraft,
  type Translation,
  type TranslationErrorCode,
  type TranslationNote,
  type ThemeId,
  type TranslationStatus,
  type VocabDraft,
  type VocabEntry,
  type VocabExample,
  type WordLookup,
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
    translation_note   TEXT,
    reply_to           TEXT
  );

  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT   NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    user_id    TEXT   NOT NULL,
    emoji      TEXT   NOT NULL,
    created_at BIGINT NOT NULL,
    -- 한 사람이 한 메시지에 남기는 반응은 하나다. 새로 누르면 바뀐다.
    PRIMARY KEY (message_id, user_id)
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

  CREATE TABLE IF NOT EXISTS word_lookups (
    message_id   TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    target_lang  TEXT NOT NULL,
    explain_lang TEXT NOT NULL,
    word         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    PRIMARY KEY (message_id, target_lang, explain_lang, word)
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
    transcript      TEXT,
    transcript_lang TEXT,
    transcript_status TEXT,
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
  -- 각자 어디까지 읽었는지. 메시지마다 남기면 줄이 무한정 늘어난다.
  CREATE TABLE IF NOT EXISTS read_state (
    user_id      TEXT   PRIMARY KEY,
    last_read_at BIGINT NOT NULL
  );

  -- 앱에서 바꾼 로그인 비밀번호. 바꾸기 전에는 줄이 없고, 그때는 .env 값을 쓴다.
  CREATE TABLE IF NOT EXISTS credentials (
    user_id       TEXT    PRIMARY KEY,
    passcode_hash TEXT    NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    updated_at    BIGINT  NOT NULL
  );

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
  ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme     TEXT;
  -- 스페인어는 말하는 사람과 듣는 사람의 성에 따라 말이 달라진다. 사는 곳도 말을 가른다.
  ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gender    TEXT;
  ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS region    TEXT;
  -- 보낸 뒤 고친 메시지. 상대에게 "수정됨" 으로 보인다.
  ALTER TABLE messages      ADD COLUMN IF NOT EXISTS edited_at BIGINT;
  ALTER TABLE attachments   ADD COLUMN IF NOT EXISTS transcript        TEXT;
  ALTER TABLE attachments   ADD COLUMN IF NOT EXISTS transcript_lang   TEXT;
  ALTER TABLE attachments   ADD COLUMN IF NOT EXISTS transcript_status TEXT;
  ALTER TABLE messages      ADD COLUMN IF NOT EXISTS reply_to TEXT;
  ALTER TABLE vocab         ADD COLUMN IF NOT EXISTS learned BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE vocab         ADD COLUMN IF NOT EXISTS example TEXT;
  ALTER TABLE vocab         ADD COLUMN IF NOT EXISTS example_translation TEXT;
  ALTER TABLE vocab         ADD COLUMN IF NOT EXISTS examples TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE saved_sentences ADD COLUMN IF NOT EXISTS vocab_term TEXT;
  -- 단어장 예문처럼 대화에 없는 문장도 보관한다. 메시지가 없을 수 있다.
  ALTER TABLE saved_sentences ALTER COLUMN message_id DROP NOT NULL;

  -- 예문을 하나만 두던 때 만들어 둔 것을 목록으로 옮긴다. 한 번만 움직이고 그 뒤로는
  -- 조건에 걸리지 않는다.
  UPDATE vocab
     SET examples = json_build_array(
           json_build_object(
             'sentence', example,
             'translation', COALESCE(example_translation, ''),
             'createdAt', created_at
           )
         )::text
   WHERE example IS NOT NULL AND (examples IS NULL OR examples = '[]');
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
  reply_to: string | null;
  edited_at: number | null;
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
  transcript: string | null;
  transcript_lang: string | null;
  transcript_status: string | null;
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
    ...(row.transcript ? { transcript: row.transcript } : {}),
    ...(row.transcript_lang && isLangCode(row.transcript_lang)
      ? { transcriptLang: row.transcript_lang }
      : {}),
    ...(row.transcript_status
      ? { transcriptStatus: row.transcript_status as TranslationStatus }
      : {}),
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
    `SELECT id, kind, mime, size, width, height, duration_ms,
            transcript, transcript_lang, transcript_status, message_id, created_at
       FROM attachments WHERE message_id = ANY($1::text[])`,
    [rows.map((row) => row.id)],
  );
  const attachments = new Map<string, Attachment>();
  for (const row of attachmentRows) {
    if (row.message_id) attachments.set(row.message_id, toAttachment(row));
  }

  const { rows: reactionRows } = await pool.query<{ message_id: string; user_id: string; emoji: string }>(
    `SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ANY($1::text[])`,
    [rows.map((row) => row.id)],
  );
  const reactions = new Map<string, Record<string, string>>();
  for (const row of reactionRows) {
    const bucket = reactions.get(row.message_id) ?? {};
    bucket[row.user_id] = row.emoji;
    reactions.set(row.message_id, bucket);
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
    ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    ...(reactions.has(row.id) ? { reactions: reactions.get(row.id) } : {}),
    ...(row.edited_at ? { editedAt: Number(row.edited_at) } : {}),
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
  replyTo?: string;
}): Promise<ChatMessage> {
  await pool.query(
    `INSERT INTO messages
       (id, sender_id, source_text, source_lang, created_at, translation_status, translation_note, reply_to)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [
      message.id,
      message.senderId,
      message.sourceText,
      message.sourceLang,
      message.createdAt,
      message.translationNote ?? null,
      message.replyTo ?? null,
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
    `INSERT INTO attachments
       (id, kind, mime, bytes, size, width, height, duration_ms, transcript_status, sender_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.kind,
      input.mime,
      input.bytes,
      input.bytes.byteLength,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      // 음성은 보내는 즉시 받아쓰기 차례를 기다린다.
      input.kind === 'audio' ? 'pending' : null,
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
    ...(input.kind === 'audio' ? { transcriptStatus: 'pending' as TranslationStatus } : {}),
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
      RETURNING id, kind, mime, size, width, height, duration_ms,
                transcript, transcript_lang, transcript_status, message_id, created_at`,
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
    `SELECT id, kind, mime, size, width, height, duration_ms,
            transcript, transcript_lang, transcript_status, message_id, sender_id, created_at
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
    // 배경화면으로 쓰는 사진은 메시지에 붙지 않는다. 치우면 배경이 깨진다.
    `DELETE FROM attachments
      WHERE message_id IS NULL AND created_at < $1
        AND id NOT IN (
          SELECT substring(wallpaper FROM 7) FROM user_settings
           WHERE wallpaper LIKE 'photo:%'
        )`,
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

/**
 * 보낸 글을 고친다. 자기가 보낸 것만, 내용이 실제로 달라졌을 때만.
 *
 * 고친 글이 원문이 되므로 번역은 여기서 손대지 않고 부르는 쪽에서 비운다 —
 * 원문과 번역이 어긋난 채 잠깐이라도 남으면 상대가 그 사이에 엉뚱한 말을 읽는다.
 * 돌려주는 값은 실제로 고쳤는지다.
 */
export async function editMessage(messageId: string, userId: string, text: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE messages SET source_text = $1, edited_at = $2
      WHERE id = $3 AND sender_id = $4 AND source_text <> $1`,
    [text, Date.now(), messageId, userId],
  );
  return (rowCount ?? 0) > 0;
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
  theme: string | null;
  gender: string | null;
  region: string | null;
}

async function settingsOf(userId: string): Promise<SettingsRow | null> {
  const { rows } = await pool.query<SettingsRow>(`SELECT * FROM user_settings WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

/**
 * 한 사람의 설정을 한 번에 읽는다.
 *
 * 예전에는 쓰는 곳마다 따로 물어봤다. 프로필 하나를 만드는 데 같은 줄을 다섯 번 읽었고,
 * 접속할 때마다 두 사람 것이니 열 번이었다. 로컬 DB 에서는 티가 안 나지만 멀리 있는
 * DB 에서는 그대로 기다리는 시간이 되고, 연결 풀도 그만큼 잡아먹는다.
 */
export async function getProfileSettings(
  userId: string,
  fallback: { nativeLang: LangCode; displayLangs: LangCode[] },
): Promise<{
  nativeLang: LangCode;
  displayLangs: LangCode[];
  wallpaper?: string;
  theme?: ThemeId;
  gender?: Gender;
  region?: string;
}> {
  const row = await settingsOf(userId);
  const langs = row?.display_langs.split(',').filter(isLangCode) ?? [];
  return {
    nativeLang: row && isLangCode(row.native_lang) ? row.native_lang : fallback.nativeLang,
    displayLangs: langs.length > 0 ? langs : fallback.displayLangs,
    ...(row?.wallpaper ? { wallpaper: row.wallpaper } : {}),
    ...(isThemeId(row?.theme) ? { theme: row.theme } : {}),
    ...(isGender(row?.gender) ? { gender: row.gender } : {}),
    ...(row?.region?.trim() ? { region: row.region.trim() } : {}),
  };
}

export async function saveSettings(
  userId: string,
  nativeLang: LangCode,
  displayLangs: LangCode[],
  identity: { gender?: Gender; region?: string } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO user_settings (user_id, native_lang, display_langs, gender, region)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       native_lang = EXCLUDED.native_lang,
       display_langs = EXCLUDED.display_langs,
       gender = EXCLUDED.gender,
       region = EXCLUDED.region`,
    [userId, nativeLang, displayLangs.join(','), identity.gender ?? null, identity.region ?? null],
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

/* ---------------------------- 단어 풀이 캐시 ---------------------------- */

/**
 * 같은 문장의 같은 단어는 한 번만 묻는다.
 *
 * 단어를 눌러 보는 건 읽다가 걸릴 때마다 하는 일이라 금방 쌓인다. 문장이 달라지면
 * 뜻도 달라질 수 있으니 메시지와 언어까지 함께 열쇠로 삼는다.
 */
export async function getWordLookup(
  messageId: string,
  targetLang: LangCode,
  explainLang: LangCode,
  word: string,
): Promise<WordLookup | null> {
  const { rows } = await pool.query<{ payload: string }>(
    `SELECT payload FROM word_lookups
      WHERE message_id = $1 AND target_lang = $2 AND explain_lang = $3 AND word = $4`,
    [messageId, targetLang, explainLang, word],
  );
  const payload = rows[0]?.payload;
  return payload ? parseJson<WordLookup | null>(payload, null) : null;
}

export async function saveWordLookup(
  messageId: string,
  explainLang: LangCode,
  lookup: WordLookup,
): Promise<void> {
  await pool.query(
    `INSERT INTO word_lookups (message_id, target_lang, explain_lang, word, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (message_id, target_lang, explain_lang, word)
       DO UPDATE SET payload = EXCLUDED.payload`,
    [messageId, lookup.lang, explainLang, lookup.word, JSON.stringify(lookup)],
  );
}

/* --------------------- 저장한 문장 (보관함) --------------------- */

interface SavedRow {
  id: string;
  user_id: string;
  message_id: string | null;
  vocab_term: string | null;
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
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.vocab_term ? { vocabTerm: row.vocab_term } : {}),
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
    ...(draft.messageId ? { messageId: draft.messageId } : {}),
    ...(draft.vocabTerm ? { vocabTerm: draft.vocabTerm } : {}),
    lang: draft.lang,
    text: draft.text,
    ...(draft.pairLang ? { pairLang: draft.pairLang } : {}),
    ...(draft.pairText ? { pairText: draft.pairText } : {}),
    ...(draft.note ? { note: draft.note } : {}),
    createdAt: Date.now(),
  };
  await pool.query(
    `INSERT INTO saved_sentences
       (id, user_id, message_id, vocab_term, lang, text, pair_lang, pair_text, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.id,
      userId,
      entry.messageId ?? null,
      entry.vocabTerm ?? null,
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

/* ------------------------------ 단어장 ------------------------------ */

interface VocabRow {
  id: string;
  user_id: string;
  term: string;
  lang: string;
  reading: string | null;
  meaning: string;
  note: string | null;
  learned: boolean;
  examples: string;
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
    learned: row.learned,
    examples: parseJson<VocabExample[]>(row.examples ?? '[]', []).filter(
      (item) => typeof item?.sentence === 'string' && item.sentence.trim(),
    ),
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
     -- 같은 단어를 다시 담아도 외운 표시와 예문은 건드리지 않는다.
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

export async function saveTheme(
  userId: string,
  theme: ThemeId,
  fallback: { nativeLang: LangCode; displayLangs: LangCode[] },
): Promise<void> {
  await pool.query(
    `INSERT INTO user_settings (user_id, native_lang, display_langs, theme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET theme = EXCLUDED.theme`,
    [userId, fallback.nativeLang, fallback.displayLangs.join(','), theme],
  );
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

/** 받아쓰기 결과를 적어 둔다. 실패하면 사유 대신 상태만 남긴다(다시 시도할 수 있게). */
export async function setTranscript(
  attachmentId: string,
  result: { text: string; lang: LangCode } | null,
): Promise<void> {
  await pool.query(
    `UPDATE attachments
        SET transcript = $1, transcript_lang = $2, transcript_status = $3
      WHERE id = $4`,
    [result?.text ?? null, result?.lang ?? null, result ? 'done' : 'failed', attachmentId],
  );
}

/** 받아쓸 음성 원본. */
export async function getAudioForTranscription(
  attachmentId: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const { rows } = await pool.query<{ mime: string; bytes: Buffer }>(
    `SELECT mime, bytes FROM attachments WHERE id = $1 AND kind = 'audio'`,
    [attachmentId],
  );
  return rows[0] ?? null;
}

/** 받아쓴 언어가 보낸 사람의 모국어와 다를 때. 번역은 이 언어를 원문으로 본다. */
export async function setSourceLang(messageId: string, lang: LangCode): Promise<void> {
  await pool.query(`UPDATE messages SET source_lang = $1 WHERE id = $2`, [lang, messageId]);
}

/** 받아쓰기를 다시 시도할 수 있게 되돌린다. */
export async function retryTranscript(attachmentId: string): Promise<void> {
  await pool.query(
    `UPDATE attachments SET transcript_status = 'pending' WHERE id = $1 AND kind = 'audio'`,
    [attachmentId],
  );
}

/* --------------------------- 이모지 반응 --------------------------- */

/** 같은 이모지를 다시 누르면 지운다. 다른 이모지면 바꾼다. */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string | null,
): Promise<void> {
  if (emoji === null) {
    await pool.query(`DELETE FROM reactions WHERE message_id = $1 AND user_id = $2`, [messageId, userId]);
    return;
  }
  const { rows } = await pool.query<{ emoji: string }>(
    `SELECT emoji FROM reactions WHERE message_id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  if (rows[0]?.emoji === emoji) {
    await pool.query(`DELETE FROM reactions WHERE message_id = $1 AND user_id = $2`, [messageId, userId]);
    return;
  }
  await pool.query(
    `INSERT INTO reactions (message_id, user_id, emoji, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = EXCLUDED.created_at`,
    [messageId, userId, emoji, Date.now()],
  );
}

/* --------------------------- 단어장 (더) --------------------------- */

export async function setVocabLearned(
  userId: string,
  id: string,
  learned: boolean,
): Promise<VocabEntry | null> {
  const { rows } = await pool.query<VocabRow>(
    `UPDATE vocab SET learned = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [learned, id, userId],
  );
  return rows[0] ? toVocab(rows[0]) : null;
}

export async function getVocab(userId: string, id: string): Promise<VocabEntry | null> {
  const { rows } = await pool.query<VocabRow>(`SELECT * FROM vocab WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] ? toVocab(rows[0]) : null;
}

/** 예문을 하나 더 쌓는다. 앞의 것은 그대로 둔다. */
export async function addVocabExample(
  userId: string,
  id: string,
  example: { sentence: string; translation: string },
): Promise<VocabEntry | null> {
  const current = await getVocab(userId, id);
  if (!current) return null;

  const next: VocabExample[] = [
    ...current.examples,
    { sentence: example.sentence, translation: example.translation, createdAt: Date.now() },
  ];
  const { rows } = await pool.query<VocabRow>(
    `UPDATE vocab SET examples = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [JSON.stringify(next), id, userId],
  );
  return rows[0] ? toVocab(rows[0]) : null;
}

/* --------------------------- 로그인 비밀번호 --------------------------- */

export interface Credential {
  /** scrypt 로 만든 저장용 값. 원문 비밀번호는 어디에도 남기지 않는다. */
  hash: string;
  /**
   * 발급한 토큰의 세대. 비밀번호를 바꾸면 하나 올린다.
   * 그러면 예전 비밀번호로 받아 둔 토큰은 전부 무효가 된다 — 비밀번호를 바꾸는 이유가
   * 대개 "누가 아는 것 같다"인데, 이미 들어와 있는 쪽이 그대로 남으면 바꾼 의미가 없다.
   */
  tokenVersion: number;
}

export async function loadCredentials(): Promise<Map<string, Credential>> {
  const { rows } = await pool.query<{ user_id: string; passcode_hash: string; token_version: number }>(
    `SELECT user_id, passcode_hash, token_version FROM credentials`,
  );
  return new Map(
    rows.map((row) => [row.user_id, { hash: row.passcode_hash, tokenVersion: row.token_version }]),
  );
}

export async function saveCredential(userId: string, hash: string): Promise<Credential> {
  const { rows } = await pool.query<{ token_version: number }>(
    `INSERT INTO credentials (user_id, passcode_hash, token_version, updated_at)
     VALUES ($1, $2, 2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       passcode_hash = EXCLUDED.passcode_hash,
       token_version = credentials.token_version + 1,
       updated_at = EXCLUDED.updated_at
     RETURNING token_version`,
    [userId, hash, Date.now()],
  );
  return { hash, tokenVersion: rows[0]?.token_version ?? 2 };
}

/* ----------------------------- 읽음 표시 ----------------------------- */

/** 사람 id -> 어디까지 읽었는지(시각). */
export async function getReadState(): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ user_id: string; last_read_at: number }>(
    `SELECT user_id, last_read_at FROM read_state`,
  );
  return Object.fromEntries(rows.map((row) => [row.user_id, row.last_read_at]));
}

/**
 * 여기까지 읽었다고 적는다.
 *
 * 뒤로는 가지 않는다(GREATEST). 지난 대화를 보려고 위로 올라갔다가 내려온 것뿐인데
 * 읽은 표시가 되돌아가면 상대 화면에서 읽음이 사라진다.
 */
export async function markRead(userId: string, at: number): Promise<number> {
  const { rows } = await pool.query<{ last_read_at: number }>(
    `INSERT INTO read_state (user_id, last_read_at) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET last_read_at = GREATEST(read_state.last_read_at, EXCLUDED.last_read_at)
     RETURNING last_read_at`,
    [userId, at],
  );
  return rows[0]?.last_read_at ?? at;
}

/** 이 사람이 아직 안 읽은, 상대가 보낸 메시지 수. */
export async function countUnread(userId: string, since: number): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM messages WHERE sender_id <> $1 AND created_at > $2`,
    [userId, since],
  );
  return rows[0]?.count ?? 0;
}
