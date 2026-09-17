import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LANGUAGES, LANGUAGE_NAMES, type ChatMessage, type LangCode, type UserProfile } from '@fran/shared';
import { config } from './config.js';

const client = new Anthropic(
  config.anthropic.apiKey ? { apiKey: config.anthropic.apiKey } : {},
);

/* ------------------------------------------------------------------ */
/* 출력 스키마                                                         */
/* ------------------------------------------------------------------ */

const noteSchema = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    meaning: { type: 'string' },
  },
  required: ['term', 'meaning'],
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    detected_lang: { type: 'string', enum: [...LANGUAGES] },
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lang: { type: 'string', enum: [...LANGUAGES] },
          text: { type: 'string' },
          notes: { type: 'array', items: noteSchema },
        },
        required: ['lang', 'text', 'notes'],
        additionalProperties: false,
      },
    },
  },
  required: ['detected_lang', 'translations'],
  additionalProperties: false,
} as const;

const langEnum = z.enum(LANGUAGES);

const resultSchema = z.object({
  detected_lang: langEnum,
  translations: z.array(
    z.object({
      lang: langEnum,
      text: z.string(),
      notes: z.array(z.object({ term: z.string(), meaning: z.string() })).default([]),
    }),
  ),
});

export type TranslationResult = z.infer<typeof resultSchema>;

/* ------------------------------------------------------------------ */
/* 프롬프트                                                            */
/* ------------------------------------------------------------------ */

function describeUser(user: UserProfile): string {
  const learning = LANGUAGES.filter((l) => l !== user.nativeLang && user.displayLangs.includes(l));
  const studying = learning.length > 0 ? learning.map((l) => LANGUAGE_NAMES[l]).join(', ') : 'nothing in particular';
  return `- ${user.name} (id: ${user.id}) — writes mainly in ${LANGUAGE_NAMES[user.nativeLang]} (${user.nativeLang}); is studying ${studying}.`;
}

function renderGlossary(): string {
  if (config.glossary.length === 0) return 'No shared glossary is configured yet.';
  return config.glossary
    .map((entry) => {
      const mapped = entry.translations
        ? Object.entries(entry.translations)
            .map(([lang, value]) => `${lang}: ${value}`)
            .join(', ')
        : 'leave untranslated, exactly as written';
      return `- "${entry.term}" → ${mapped}${entry.note ? ` (${entry.note})` : ''}`;
    })
    .join('\n');
}

/**
 * 시스템 프롬프트는 두 사람의 프로필과 용어집만 바뀌므로 요청마다 거의 동일하다.
 * 프리픽스 캐시가 걸리도록 앞쪽에 고정 내용을 두고 cache_control 을 붙인다.
 */
function buildSystemPrompt(participants: UserProfile[]): string {
  return `You are the translation engine inside a private one-to-one messenger. Exactly two people use it: a couple in a long-distance relationship who do not share a first language. Your only job is to render each message into the languages the other person reads, so that it arrives sounding like the person who wrote it.

# The two people
${participants.map(describeUser).join('\n')}

# Shared glossary
Names, pet names and in-jokes. These override any other rule.
${renderGlossary()}

# How to translate
1. Translate ONLY the message under "MESSAGE TO TRANSLATE". Everything above it is context: read it, never translate it.
2. Keep the register. Casual stays casual, intimate stays intimate, distant stays distant. Never upgrade a chat message into polished prose.
3. Keep the texture: emoji, punctuation, ellipses, repeated letters, ALL CAPS, lowercase-only habits, laughter and playful misspellings. When a stylistic device has no direct equivalent, use the closest native one (ㅋㅋㅋ ↔ jajaja ↔ hahaha ↔ 哈哈哈).
4. Korean, Spanish and Chinese all drop subjects and objects freely. Use the context to work out who and what is meant, and make the target sentence unambiguous — but never add information the writer did not imply. If context genuinely cannot resolve it, stay as vague as the original rather than guessing.
5. Translate meaning, not words. Idioms, slang and cultural references become the closest natural expression in the target language; when none exists, paraphrase plainly instead of translating literally.
6. Carry over what the message is doing. A joke stays funny, a complaint stays a complaint, teasing stays teasing, sarcasm stays sarcastic.
7. If a message needs no translation — a URL, a number, a bare emoji, or text already in the target language — return it unchanged.
8. \`text\` is the message and nothing else. No greetings, no explanations, no disclaimers, no alternative renderings.
9. This is private correspondence between two consenting adults. Affectionate, intimate, teasing or profane language is translated faithfully and at the same intensity; softening it misrepresents what was said.

# Learner notes
Both of them are studying the other's language, so a translation may carry 0–2 short notes. Add one only when it teaches something a learner would actually want: an idiom that isn't literal, slang, a grammar point the sentence turns on, or a nuance you could not carry across. Write each note in the language of the translation it belongs to. Most messages are ordinary — for those, return an empty notes array.

# Output
Return one entry per requested target language, in the order requested. Skip a target language only when it is the same as the detected language of the message.`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16);
}

function buildUserTurn(
  message: ChatMessage,
  context: ChatMessage[],
  nameOf: (userId: string) => string,
  targetLangs: LangCode[],
): string {
  const transcript = context.length
    ? context
        .map((m) => `[${formatTime(m.createdAt)}] ${nameOf(m.senderId)} (${m.sourceLang}): ${m.sourceText}`)
        .join('\n')
    : '(no earlier messages — this is the start of the conversation)';

  return `## Recent conversation, oldest first
${transcript}

## MESSAGE TO TRANSLATE
From: ${nameOf(message.senderId)}
Declared language: ${message.sourceLang} — this is the sender's default, not a detection. If the message is actually in another language, say so in detected_lang.
Text:
"""
${message.sourceText}
"""

## Target languages
${targetLangs.join(', ')}`;
}

/* ------------------------------------------------------------------ */
/* 호출                                                                */
/* ------------------------------------------------------------------ */

export class TranslationError extends Error {}

function extractJson(response: Anthropic.Message): string {
  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  throw new TranslationError('모델 응답에 텍스트 블록이 없습니다.');
}

export interface TranslateArgs {
  message: ChatMessage;
  context: ChatMessage[];
  participants: UserProfile[];
  targetLangs: LangCode[];
}

export async function translateMessage({
  message,
  context,
  participants,
  targetLangs,
}: TranslateArgs): Promise<TranslationResult> {
  const nameOf = (userId: string) =>
    participants.find((p) => p.id === userId)?.name ?? userId;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(participants),
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      effort: config.anthropic.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: 'user', content: buildUserTurn(message, context, nameOf, targetLangs) }],
  });

  // 안전 분류기가 요청을 거절하면 200 과 함께 stop_reason 이 refusal 로 온다.
  // 원문은 이미 전달됐으므로 여기서는 번역만 실패로 처리한다.
  if (response.stop_reason === 'refusal') {
    throw new TranslationError(
      `모델이 이 메시지의 번역을 거절했습니다 (${response.stop_details?.category ?? 'unknown'}).`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new TranslationError('응답이 max_tokens 에서 잘렸습니다.');
  }

  const parsed = resultSchema.safeParse(JSON.parse(extractJson(response)));
  if (!parsed.success) {
    throw new TranslationError(`모델 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const translationModel = config.anthropic.model;
