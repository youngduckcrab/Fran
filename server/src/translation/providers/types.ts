/** 번역 한 건에 대한 provider 공통 요청/응답. */

export interface ProviderRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** 캐시에서 읽은 입력 토큰. 지원하지 않는 provider 는 비워둔다. */
  cachedInputTokens?: number;
  /** 사고(thinking) 토큰. 지원하지 않는 provider 는 비워둔다. */
  thinkingTokens?: number;
}

export interface ProviderResponse {
  /** 모델이 돌려준 JSON 문자열. 파싱과 검증은 호출한 쪽에서 한다. */
  json: string;
  usage: ProviderUsage;
}

export interface TranslationProvider {
  /** 로그에 찍히는 이름. */
  readonly name: string;
  /** 실제로 호출한 모델 ID. 번역 레코드에 함께 저장된다. */
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

/** 번역이 실패한 이유를 사람이 읽을 수 있게 담는다. */
export class TranslationError extends Error {}
