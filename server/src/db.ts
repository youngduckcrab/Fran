import crypto from 'node:crypto';
import pg from 'pg';
import {
  isLangCode,
  type ChatMessage,
  type GlossaryDraft,
  type GlossaryEntry,
  type LangCode,
  type MessageExplanation,
  type Translation,
  type TranslationNote,
  type TranslationStatus,
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
    ...(row.translation_note ? { translationNote: row.translation_note } : {}),
    translations: byMessage.get(row.id) ?? {},
  }));
}

export async function insertMessage(message: {
  id: string;
  senderId: string;
  sourceText: string;
  sourceLang: LangCode;
  createdAt: number;
  translationNote?: string;
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
  error?: string,
): Promise<void> {
  await pool.query(`UPDATE messages SET translation_status = $1, translation_error = $2 WHERE id = $3`, [
    status,
    error ?? null,
    messageId,
  ]);
}

export async function clearTranslations(messageId: string): Promise<void> {
  await pool.query(`DELETE FROM translations WHERE message_id = $1`, [messageId]);
}

/* ---------------------------- 사용자 설정 ---------------------------- */

interface SettingsRow {
  user_id: string;
  native_lang: string;
  display_langs: string;
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
