import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting,
} from '@google/genai';
import { TranslationError, type ProviderRequest, type ProviderResponse, type TranslationProvider } from './types.js';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** 0 = 사고 끄기(기본). -1 = 자동. 무료 티어에서는 꺼두는 편이 빠르고 할당량도 아낀다. */
  thinkingBudget: number;
  safetyThreshold: HarmBlockThreshold;
}

const HARM_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
];

export class GeminiProvider implements TranslationProvider {
  readonly name = 'gemini';
  readonly model: string;

  private readonly client: GoogleGenAI;
  private readonly safetySettings: SafetySetting[];
  private readonly thinkingBudget: number;

  constructor(options: GeminiOptions) {
    this.model = options.model;
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.thinkingBudget = options.thinkingBudget;
    // 연인끼리 주고받는 애정 표현이 안전 필터에 걸려 번역이 통째로 막히는 일을 막는다.
    this.safetySettings = HARM_CATEGORIES.map((category) => ({
      category,
      threshold: options.safetyThreshold,
    }));
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const { systemPrompt, userPrompt } = request;
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
          safetySettings: this.safetySettings,
          thinkingConfig: { thinkingBudget: this.thinkingBudget },
          maxOutputTokens: 4096,
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // 자주 만나는 실패에는 무엇을 해야 하는지까지 적어 준다.
      if (/API_KEY_INVALID|API key not valid/i.test(message)) {
        throw new TranslationError(
          'GEMINI_API_KEY 가 올바르지 않습니다. https://aistudio.google.com/apikey 에서 키를 다시 확인하고 ' +
            '.env 에 붙여 넣은 뒤 서버를 재시작하세요(.env 는 시작할 때 한 번만 읽습니다).',
        );
      }
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) throw quotaError(message);
      // 모델 과부하와 서버 오류는 잠시 뒤면 대개 풀린다.
      if (/\b(500|502|503|504)\b|UNAVAILABLE|INTERNAL|high demand|overloaded/i.test(message)) {
        throw new TranslationError('모델이 일시적으로 혼잡합니다. 잠시 뒤 다시 시도해 주세요.', true);
      }
      if (/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
        throw new TranslationError('네트워크 문제로 모델에 연결하지 못했습니다.', true);
      }
      if (/404|NOT_FOUND|not found/i.test(message)) {
        throw new TranslationError(
          `모델 "${this.model}" 을 찾을 수 없습니다. 'npm run models --workspace=server' 로 쓸 수 있는 모델을 확인하세요. (${message})`,
        );
      }
      throw new TranslationError(`Gemini 호출 실패: ${message}`);
    }

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (response.promptFeedback?.blockReason) {
      throw new TranslationError(`입력이 안전 필터에 막혔습니다 (${response.promptFeedback.blockReason}).`);
    }
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'BLOCKLIST') {
      throw new TranslationError(`모델이 안전 필터로 응답을 막았습니다 (${finishReason}).`);
    }
    if (finishReason === 'MAX_TOKENS') {
      throw new TranslationError('응답이 maxOutputTokens 에서 잘렸습니다.');
    }

    const text = response.text;
    if (!text) {
      throw new TranslationError(`빈 응답을 받았습니다 (finishReason: ${finishReason ?? 'unknown'}).`);
    }

    const usage = response.usageMetadata;
    return {
      json: text,
      usage: {
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        cachedInputTokens: usage?.cachedContentTokenCount,
        thinkingTokens: usage?.thoughtsTokenCount,
      },
    };
  }
}

/** 분당 한도를 넘었을 때 최대 이만큼까지는 기다렸다 다시 해본다. */
const MAX_QUOTA_WAIT_MS = 60_000;

/**
 * 429 는 두 종류다. 분당 한도는 1분이면 풀리지만 하루 한도는 날이 바뀌어야 한다.
 * Google 이 응답에 어느 쪽인지와 몇 초 뒤에 오라는지를 같이 주므로 그대로 쓴다.
 */
function quotaError(raw: string): TranslationError {
  const perDay = /PerDay|per day|daily/i.test(raw);
  const seconds = Number(/retryDelay[^0-9]*([0-9]+(?:\.[0-9]+)?)s/i.exec(raw)?.[1] ?? NaN);
  const waitMs = Number.isFinite(seconds) ? seconds * 1000 : undefined;

  if (perDay) {
    return new TranslationError(
      '오늘 쓸 수 있는 무료 요청을 다 썼습니다. 하루 한도는 태평양 시간 자정' +
        '(한국 시간 오후 4~5시쯤)에 초기화됩니다.',
    );
  }

  const hint = waitMs ? `${Math.ceil(waitMs / 1000)}초` : '잠시';
  const retryable = waitMs !== undefined && waitMs <= MAX_QUOTA_WAIT_MS;
  // 한도를 넘은 상태에서 여러 번 두드리면 한도만 더 깎는다. 한 번만 기다렸다 해본다.
  return new TranslationError(`분당 요청 한도를 넘었습니다. ${hint} 뒤 다시 시도해 주세요.`, retryable, {
    retryAfterMs: waitMs,
    retryLimit: 1,
  });
}

export function parseSafetyThreshold(value: string | undefined): HarmBlockThreshold {
  if (!value) return HarmBlockThreshold.BLOCK_NONE;
  const upper = value.trim().toUpperCase();
  const allowed = Object.values(HarmBlockThreshold) as string[];
  if (allowed.includes(upper)) return upper as HarmBlockThreshold;

  // 조절용 설정 하나 때문에 번역을 통째로 막지는 않는다.
  console.warn(
    `⚠️  환경변수 GEMINI_SAFETY_THRESHOLD 의 값 "${value}" 을 알아볼 수 없어 무시합니다. ` +
      `(가능한 값: ${allowed.join(', ')}) 기본값 BLOCK_NONE 으로 계속합니다.`,
  );
  return HarmBlockThreshold.BLOCK_NONE;
}
