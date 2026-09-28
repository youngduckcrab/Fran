import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { config } from '../config.js';
import { listGlossary } from '../db.js';
import {
  buildExampleSystemPrompt,
  buildExampleUserPrompt,
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
  buildSystemPrompt,
  buildTranscriptionSystemPrompt,
  buildTranscriptionUserPrompt,
  buildUserPrompt,
  buildWordSystemPrompt,
  buildWordUserPrompt,
  buildCaptionSystemPrompt,
  buildCaptionUserPrompt,
} from './prompt.js';
import {
  EXAMPLE_SCHEMA,
  EXPLANATION_SCHEMA,
  OUTPUT_SCHEMA,
  TRANSCRIPT_SCHEMA,
  WORD_SCHEMA,
  CAPTION_SCHEMA,
  captionSchema,
  exampleSchema,
  explanationSchema,
  resultSchema,
  transcriptSchema,
  wordSchema,
  type ExampleResult,
  type ExplanationResult,
  type TranscriptResult,
  type TranslationResult,
  type WordResult,
} from './schema.js';
import { ClaudeProvider } from './providers/claude.js';
import { GeminiProvider, parseSafetyThreshold } from './providers/gemini.js';
import {
  TranslationError,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderUsage,
  type TranslationProvider,
} from './providers/types.js';

export { TranslationError } from './providers/types.js';
export type {
  ExampleResult,
  ExplanationResult,
  TranscriptResult,
  TranslationResult,
  WordResult,
} from './schema.js';

/* ------------------------------------------------------------------ */
/* provider 선택                                                       */
/* ------------------------------------------------------------------ */

let cached: TranslationProvider | null = null;

export function getProvider(): TranslationProvider {
  if (cached) return cached;

  const { provider, gemini, claude } = config.translation;
  if (provider === 'gemini') {
    if (!gemini.apiKey) {
      throw new TranslationError(
        'GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급하세요.',
        false,
        { code: 'noApiKey' },
      );
    }
    cached = new GeminiProvider({
      apiKey: gemini.apiKey,
      model: gemini.model,
      thinkingBudget: gemini.thinkingBudget,
      safetyThreshold: parseSafetyThreshold(gemini.safetyThreshold),
    });
  } else {
    if (!claude.apiKey && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new TranslationError(
        'ANTHROPIC_API_KEY 가 없습니다. https://console.anthropic.com 에서 발급하세요.',
        false,
        { code: 'noApiKey' },
      );
    }
    cached = new ClaudeProvider({ apiKey: claude.apiKey, model: claude.model, effort: claude.effort });
  }
  return cached;
}

/* ------------------------------------------------------------------ */
/* 사용량 기록                                                         */
/* ------------------------------------------------------------------ */

const totals = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, thinkingTokens: 0 };

export function usageTotals(): Readonly<typeof totals> {
  return totals;
}

function recordUsage(provider: TranslationProvider, usage: ProviderUsage, elapsedMs: number): void {
  totals.calls += 1;
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.cachedInputTokens += usage.cachedInputTokens ?? 0;
  totals.thinkingTokens += usage.thinkingTokens ?? 0;

  const parts = [
    `in=${usage.inputTokens ?? '?'}`,
    `out=${usage.outputTokens ?? '?'}`,
  ];
  if (usage.cachedInputTokens) parts.push(`cached=${usage.cachedInputTokens}`);
  if (usage.thinkingTokens) parts.push(`thinking=${usage.thinkingTokens}`);

  console.log(
    `[usage] ${provider.name}/${provider.model} ${parts.join(' ')} ${elapsedMs}ms` +
      ` | 누적 ${totals.calls}회 in=${totals.inputTokens} out=${totals.outputTokens}`,
  );
}

/* ------------------------------------------------------------------ */
/* 재시도                                                              */
/* ------------------------------------------------------------------ */

/** 모델 과부하는 흔하고 대개 몇 초면 풀린다. 사용자가 버튼을 누르기 전에 먼저 해본다. */
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function completeWithRetry(
  provider: TranslationProvider,
  request: ProviderRequest,
  /**
   * 기다렸다 다시 걸어 볼 간격.
   *
   * 메시지 번역은 늦게라도 제대로 오는 편이 낫다. 자막은 반대다 — 11초 뒤에
   * 도착한 자막은 이미 지나간 말이라, 맞아도 쓸모가 없고 엉뚱한 자리에 끼어든다.
   */
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<ProviderResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.complete(request);
    } catch (error) {
      if (!(error instanceof TranslationError) || !error.retryable) throw error;

      const limit = Math.min(error.retryLimit ?? delays.length, delays.length);
      const backoff = delays[attempt];
      if (attempt >= limit || backoff === undefined) throw error;

      // 서버가 "N초 뒤에 오라"고 했으면 그 말을 따른다. 그게 더 정확하다.
      // 서버가 더 오래 기다리라고 해도, 이 부름이 감당할 수 있는 만큼만 기다린다.
      const delay = Math.min(Math.max(backoff, error.retryAfterMs ?? 0), delays[delays.length - 1]!);

      console.warn(
        `[translate] 일시적 오류, ${delay}ms 뒤 재시도 (${attempt + 1}/${limit}): ${error.message}`,
      );
      await sleep(delay);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 번역                                                                */
/* ------------------------------------------------------------------ */

export interface TranslateArgs {
  message: ChatMessage;
  context: ChatMessage[];
  participants: UserProfile[];
  targetLangs: LangCode[];
}

export interface TranslateOutcome {
  result: TranslationResult;
  /** 실제로 번역한 모델 ID. 번역 레코드에 함께 저장된다. */
  model: string;
}

export async function translateMessage({
  message,
  context,
  participants,
  targetLangs,
}: TranslateArgs): Promise<TranslateOutcome> {
  const provider = getProvider();
  const nameOf = (userId: string) => participants.find((p) => p.id === userId)?.name ?? userId;

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildSystemPrompt(participants, await listGlossary()),
    userPrompt: buildUserPrompt(message, context, nameOf, targetLangs),
    schema: OUTPUT_SCHEMA,
  });
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 200)}`);
  }

  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranslationError(`모델 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }

  return { result: parsed.data, model: provider.model };
}

/* ------------------------------------------------------------------ */
/* 문장 설명                                                           */
/* ------------------------------------------------------------------ */

export interface ExplainArgs {
  /** 설명할 문장. 원문일 수도, 번역문일 수도 있다. */
  text: string;
  targetLang: LangCode;
  learner: UserProfile;
  context: ChatMessage[];
  participants: UserProfile[];
}

export interface ExplainOutcome {
  result: ExplanationResult;
  model: string;
}

export async function explainMessage({
  text,
  targetLang,
  learner,
  context,
  participants,
}: ExplainArgs): Promise<ExplainOutcome> {
  const provider = getProvider();
  const nameOf = (userId: string) => participants.find((p) => p.id === userId)?.name ?? userId;

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildExplanationSystemPrompt(learner, targetLang),
    userPrompt: buildExplanationUserPrompt(text, targetLang, context, nameOf),
    schema: EXPLANATION_SCHEMA,
  });
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 200)}`);
  }

  const parsed = explanationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranslationError(`설명 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return { result: parsed.data, model: provider.model };
}

/* ------------------------------------------------------------------ */
/* 음성 받아쓰기                                                       */
/* ------------------------------------------------------------------ */

export interface TranscribeArgs {
  audio: { bytes: Buffer; mime: string };
  durationMs?: number;
  /** 녹음한 사람. 어느 언어일지 짐작하는 데 쓴다. */
  speaker: UserProfile;
  participants: UserProfile[];
}

export interface TranscribeOutcome {
  result: TranscriptResult;
  model: string;
}

export async function transcribeAudio({
  audio,
  durationMs,
  speaker,
  participants,
}: TranscribeArgs): Promise<TranscribeOutcome> {
  const provider = getProvider();

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildTranscriptionSystemPrompt(participants, speaker),
    userPrompt: buildTranscriptionUserPrompt(durationMs),
    schema: TRANSCRIPT_SCHEMA,
    audio: { mime: audio.mime, base64: audio.bytes.toString('base64') },
  });
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 200)}`);
  }

  const parsed = transcriptSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranslationError(`받아쓰기 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return { result: parsed.data, model: provider.model };
}

/* ------------------------------------------------------------------ */
/* 단어장 예문                                                         */
/* ------------------------------------------------------------------ */

export interface ExampleArgs {
  term: string;
  meaning: string;
  note?: string;
  lang: LangCode;
  learner: UserProfile;
  /** 이미 만들어 둔 예문들. 같은 문장이 또 나오지 않도록 모델에 알려 준다. */
  existing?: string[];
}

export async function makeExample({
  term,
  meaning,
  note,
  lang,
  learner,
  existing = [],
}: ExampleArgs): Promise<{ result: ExampleResult; model: string }> {
  const provider = getProvider();

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildExampleSystemPrompt(learner, lang),
    userPrompt: buildExampleUserPrompt(term, meaning, note, existing),
    schema: EXAMPLE_SCHEMA,
  });
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 200)}`);
  }
  const parsed = exampleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranslationError(`예문 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return { result: parsed.data, model: provider.model };
}

/* ------------------------------------------------------------------ */
/* 단어 하나 풀어보기                                                  */
/* ------------------------------------------------------------------ */

export interface WordArgs {
  /** 누른 단어. 문장에서 잘라낸 그대로. */
  word: string;
  /** 그 단어가 들어 있는 문장. 문맥이 있어야 무슨 뜻으로 쓰였는지 말할 수 있다. */
  sentence: string;
  lang: LangCode;
  learner: UserProfile;
}

export async function lookUpWord({
  word,
  sentence,
  lang,
  learner,
}: WordArgs): Promise<{ result: WordResult; model: string }> {
  const provider = getProvider();

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildWordSystemPrompt(learner, lang),
    userPrompt: buildWordUserPrompt(word, sentence, lang),
    schema: WORD_SCHEMA,
  });
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 200)}`);
  }
  const parsed = wordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranslationError(`단어 풀이 응답이 스키마와 맞지 않습니다: ${parsed.error.message}`);
  }
  return { result: parsed.data, model: provider.model };
}

/* ------------------------------------------------------------------ */
/* 통화 자막                                                            */
/* ------------------------------------------------------------------ */

/**
 * 자막이 다시 걸어 보는 간격. 한 번, 그것도 곧바로.
 *
 * 이보다 늦게 오는 자막은 이미 대화가 지나가 버려서, 맞는 번역이어도 읽는
 * 사람을 헷갈리게 한다. 그럴 바엔 원문만 남기고 다음 말로 넘어가는 편이 낫다.
 */
const CAPTION_RETRY_MS = [400] as const;

export interface CaptionArgs {
  /** 받아쓴 말 한 줄. */
  text: string;
  speaker: UserProfile;
  participants: UserProfile[];
  targetLang: LangCode;
}

/**
 * 자막 한 줄을 옮긴다.
 *
 * 대화 번역과 달리 맥락을 넣지 않는다. 자막은 빨리 떠야 읽히고, 말은 이미
 * 지나가 버린 뒤라 몇 초를 더 들여 다듬을 값어치가 없다.
 */
export async function translateCaption({
  text,
  speaker,
  participants,
  targetLang,
}: CaptionArgs): Promise<string> {
  const provider = getProvider();

  const startedAt = Date.now();
  const response = await completeWithRetry(
    provider,
    {
      systemPrompt: buildCaptionSystemPrompt(participants, await listGlossary(), targetLang),
      userPrompt: buildCaptionUserPrompt(text, speaker),
      schema: CAPTION_SCHEMA,
    },
    CAPTION_RETRY_MS,
  );
  recordUsage(provider, response.usage, Date.now() - startedAt);

  let raw: unknown;
  try {
    raw = JSON.parse(response.json);
  } catch {
    throw new TranslationError(`모델이 JSON 이 아닌 응답을 돌려줬습니다: ${response.json.slice(0, 120)}`);
  }
  const parsed = captionSchema.safeParse(raw);
  if (!parsed.success) throw new TranslationError('자막 번역 응답이 스키마와 맞지 않습니다.');
  return parsed.data.text;
}
