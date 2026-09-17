/** 번역 한 건에 대한 provider 공통 요청/응답. */

export interface ProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  /** 이 요청의 출력 형식(JSON Schema). 번역과 설명이 서로 다른 모양을 쓴다. */
  schema: object;
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
export class TranslationError extends Error {
  /**
   * 잠시 뒤 다시 해보면 될 종류인지. 모델 과부하(503)나 일시적 네트워크 장애가
   * 여기 해당한다. 키가 틀렸거나 모델 이름이 없는 것은 몇 번을 해도 같다.
   */
  readonly retryable: boolean;
  /** 서버가 "N초 뒤에 다시 오라"고 알려준 경우 그 값. 백오프보다 이걸 따른다. */
  readonly retryAfterMs?: number;
  /**
   * 이 오류에 한해 재시도 횟수를 줄인다. 할당량 초과처럼 재시도 자체가 한도를
   * 더 깎는 경우에 쓴다. 생략하면 기본 횟수를 그대로 쓴다.
   */
  readonly retryLimit?: number;

  constructor(
    message: string,
    retryable = false,
    options: { retryAfterMs?: number; retryLimit?: number } = {},
  ) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.retryLimit = options.retryLimit;
  }
}
