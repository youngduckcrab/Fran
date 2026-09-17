import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { config } from '../config.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { resultSchema, type TranslationResult } from './schema.js';
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
export type { TranslationResult } from './schema.js';

/* ------------------------------------------------------------------ */
/* provider 선택                                                       */
/* ------------------------------------------------------------------ */

let cached: TranslationProvider | null = null;

export function getProvider(): TranslationProvider {
  if (cached) return cached;

  const { provider, gemini, claude } = config.translation;
  if (provider === 'gemini') {
    if (!gemini.apiKey) {
      throw new TranslationError('GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급하세요.');
    }
    cached = new GeminiProvider({
      apiKey: gemini.apiKey,
      model: gemini.model,
      thinkingBudget: gemini.thinkingBudget,
      safetyThreshold: parseSafetyThreshold(gemini.safetyThreshold),
    });
  } else {
    if (!claude.apiKey && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new TranslationError('ANTHROPIC_API_KEY 가 없습니다. https://console.anthropic.com 에서 발급하세요.');
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
      const retryable = error instanceof TranslationError && error.retryable;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined) throw error;

      console.warn(
        `[translate] 일시적 오류, ${delay}ms 뒤 재시도 ` +
          `(${attempt + 1}/${RETRY_DELAYS_MS.length}): ${(error as Error).message}`,
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
    systemPrompt: buildSystemPrompt(participants, config.glossary),
    userPrompt: buildUserPrompt(message, context, nameOf, targetLangs),
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
