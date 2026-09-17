import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  isLangCode,
  type ChatMessage,
  type LangCode,
  type Translation,
  type TranslationNote,
  type TranslationStatus,
} from '@fran/shared';
import { config } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id                 TEXT PRIMARY KEY,
    sender_id          TEXT NOT NULL,
    source_text        TEXT NOT NULL,
    source_lang        TEXT NOT NULL,
    created_at         INTEGER NOT NULL,
    translation_status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);

  CREATE TABLE IF NOT EXISTS translations (
    message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    lang       TEXT NOT NULL,
    text       TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '[]',
    model      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, lang)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id       TEXT PRIMARY KEY,
    native_lang   TEXT NOT NULL,
    display_langs TEXT NOT NULL
  );
`);

// 이미 만들어진 DB 에도 새 컬럼을 더한다. SQLite 는 IF NOT EXISTS 를 지원하지 않는다.
{
  const columns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'translation_error')) {
    db.exec(`ALTER TABLE messages ADD COLUMN translation_error TEXT`);
  }
}

interface MessageRow {
  id: string;
  sender_id: string;
  source_text: string;
  source_lang: string;
  created_at: number;
  translation_status: string;
  translation_error: string | null;
}

interface TranslationRow {
  message_id: string;
  lang: string;
  text: string;
  notes: string;
  model: string;
  created_at: number;
}

const statements = {
  insertMessage: db.prepare(
    `INSERT INTO messages (id, sender_id, source_text, source_lang, created_at, translation_status)
     VALUES (@id, @sender_id, @source_text, @source_lang, @created_at, @translation_status)`,
  ),
  selectMessage: db.prepare<[string], MessageRow>(`SELECT * FROM messages WHERE id = ?`),
  selectRecent: db.prepare<[number], MessageRow>(
    `SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT ?`,
  ),
  selectBefore: db.prepare<[number, number], MessageRow>(
    `SELECT * FROM messages WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  ),
  updateStatus: db.prepare(
    `UPDATE messages SET translation_status = ?, translation_error = ? WHERE id = ?`,
  ),
  upsertTranslation: db.prepare(
    `INSERT INTO translations (message_id, lang, text, notes, model, created_at)
     VALUES (@message_id, @lang, @text, @notes, @model, @created_at)
     ON CONFLICT (message_id, lang) DO UPDATE SET
       text = excluded.text, notes = excluded.notes,
       model = excluded.model, created_at = excluded.created_at`,
  ),
  selectTranslations: db.prepare<[string], TranslationRow>(
    `SELECT * FROM translations WHERE message_id = ?`,
  ),
  deleteTranslations: db.prepare(`DELETE FROM translations WHERE message_id = ?`),
  selectSettings: db.prepare<[string], { user_id: string; native_lang: string; display_langs: string }>(
    `SELECT * FROM user_settings WHERE user_id = ?`,
  ),
  upsertSettings: db.prepare(
    `INSERT INTO user_settings (user_id, native_lang, display_langs)
     VALUES (@user_id, @native_lang, @display_langs)
     ON CONFLICT (user_id) DO UPDATE SET
       native_lang = excluded.native_lang, display_langs = excluded.display_langs`,
  ),
};

function parseNotes(raw: string): TranslationNote[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TranslationNote[]) : [];
  } catch {
    return [];
  }
}

function hydrate(row: MessageRow): ChatMessage {
  const translations: Partial<Record<LangCode, Translation>> = {};
  for (const t of statements.selectTranslations.all(row.id)) {
    if (!isLangCode(t.lang)) continue;
    translations[t.lang] = {
      lang: t.lang,
      text: t.text,
      notes: parseNotes(t.notes),
      model: t.model,
      createdAt: t.created_at,
    };
  }
  return {
    id: row.id,
    senderId: row.sender_id,
    sourceText: row.source_text,
    sourceLang: isLangCode(row.source_lang) ? row.source_lang : 'ko',
    createdAt: row.created_at,
    translationStatus: row.translation_status as TranslationStatus,
    ...(row.translation_error ? { translationError: row.translation_error } : {}),
    translations,
  };
}

export function insertMessage(message: {
  id: string;
  senderId: string;
  sourceText: string;
  sourceLang: LangCode;
  createdAt: number;
}): ChatMessage {
  statements.insertMessage.run({
    id: message.id,
    sender_id: message.senderId,
    source_text: message.sourceText,
    source_lang: message.sourceLang,
    created_at: message.createdAt,
    translation_status: 'pending',
  });
  return { ...message, translationStatus: 'pending', translations: {} };
}

export function getMessage(id: string): ChatMessage | null {
  const row = statements.selectMessage.get(id);
  return row ? hydrate(row) : null;
}

/** 오래된 것부터 정렬해 돌려준다(화면에 그리는 순서). */
export function getRecentMessages(limit: number, before?: number): ChatMessage[] {
  const rows = before === undefined
    ? statements.selectRecent.all(limit)
    : statements.selectBefore.all(before, limit);
  return rows.reverse().map(hydrate);
}

export function saveTranslation(messageId: string, translation: Translation): void {
  statements.upsertTranslation.run({
    message_id: messageId,
    lang: translation.lang,
    text: translation.text,
    notes: JSON.stringify(translation.notes),
    model: translation.model,
    created_at: translation.createdAt,
  });
}

export function setTranslationStatus(
  messageId: string,
  status: TranslationStatus,
  error?: string,
): void {
  statements.updateStatus.run(status, error ?? null, messageId);
}

export function clearTranslations(messageId: string): void {
  statements.deleteTranslations.run(messageId);
}

export function getDisplayLangs(userId: string, fallback: LangCode[]): LangCode[] {
  const row = statements.selectSettings.get(userId);
  if (!row) return fallback;
  const langs = String(row.display_langs).split(',').filter(isLangCode);
  return langs.length > 0 ? langs : fallback;
}

export function getNativeLang(userId: string, fallback: LangCode): LangCode {
  const row = statements.selectSettings.get(userId);
  return row && isLangCode(row.native_lang) ? row.native_lang : fallback;
}

export function saveSettings(userId: string, nativeLang: LangCode, displayLangs: LangCode[]): void {
  statements.upsertSettings.run({
    user_id: userId,
    native_lang: nativeLang,
    display_langs: displayLangs.join(','),
  });
}
