import { z } from 'zod';
import { LANGUAGES } from '@fran/shared';

/**
 * 모델에 강제할 출력 형식. 표준 JSON Schema 로 써서 provider 마다
 * 각자의 구조화 출력 기능에 그대로 넘긴다.
 */
const noteSchema = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    meaning: { type: 'string' },
  },
  required: ['term', 'meaning'],
  additionalProperties: false,
} as const;

export const OUTPUT_SCHEMA = {
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

/** 스키마를 강제해도 모델 출력은 결국 남의 데이터다. 쓰기 전에 한 번 더 검증한다. */
export const resultSchema = z.object({
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
