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
} from './prompt.js';
import {
  EXAMPLE_SCHEMA,
  EXPLANATION_SCHEMA,
  OUTPUT_SCHEMA,
  TRANSCRIPT_SCHEMA,
  exampleSchema,
  explanationSchema,
  resultSchema,
  transcriptSchema,
  type ExampleResult,
  type ExplanationResult,
  type TranscriptResult,
  type TranslationResult,
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
): Promise<ProviderResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.complete(request);
    } catch (error) {
      if (!(error instanceof TranslationError) || !error.retryable) throw error;

      const limit = Math.min(error.retryLimit ?? RETRY_DELAYS_MS.length, RETRY_DELAYS_MS.length);
      const backoff = RETRY_DELAYS_MS[attempt];
      if (attempt >= limit || backoff === undefined) throw error;

      // 서버가 "N초 뒤에 오라"고 했으면 그 말을 따른다. 그게 더 정확하다.
      const delay = Math.max(backoff, error.retryAfterMs ?? 0);

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
}

export async function makeExample({
  term,
  meaning,
  note,
  lang,
  learner,
}: ExampleArgs): Promise<{ result: ExampleResult; model: string }> {
  const provider = getProvider();

  const startedAt = Date.now();
  const response = await completeWithRetry(provider, {
    systemPrompt: buildExampleSystemPrompt(learner, lang),
    userPrompt: buildExampleUserPrompt(term, meaning, note),
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
