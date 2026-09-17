import Anthropic from '@anthropic-ai/sdk';
import { OUTPUT_SCHEMA } from '../schema.js';
import { TranslationError, type ProviderRequest, type ProviderResponse, type TranslationProvider } from './types.js';

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'off';

export interface ClaudeOptions {
  apiKey?: string;
  model: string;
  effort: ClaudeEffort;
}

/**
 * effort 는 모든 모델이 받는 파라미터가 아니다. Haiku 계열에 넘기면 400 이 난다.
 * 명시적으로 off 로 두었거나 지원하지 않는 모델이면 빼고 보낸다.
 */
function effortFor(model: string, effort: ClaudeEffort): Exclude<ClaudeEffort, 'off'> | null {
  if (effort === 'off') return null;
  if (/haiku/i.test(model)) return null;
  return effort;
}

export class ClaudeProvider implements TranslationProvider {
  readonly name = 'claude';
  readonly model: string;

  private readonly client: Anthropic;
  private readonly effort: Exclude<ClaudeEffort, 'off'> | null;

  constructor(options: ClaudeOptions) {
    this.model = options.model;
    this.effort = effortFor(options.model, options.effort);
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete({ systemPrompt, userPrompt }: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          // 시스템 프롬프트는 요청마다 거의 같다. 캐시가 걸리면 입력 비용이 크게 준다.
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        ...(this.effort ? { effort: this.effort } : {}),
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (response.stop_reason === 'refusal') {
      throw new TranslationError(
        `모델이 이 메시지의 번역을 거절했습니다 (${response.stop_details?.category ?? 'unknown'}).`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new TranslationError('응답이 max_tokens 에서 잘렸습니다.');
    }

    const block = response.content.find((item) => item.type === 'text');
    if (!block || block.type !== 'text') {
      throw new TranslationError('모델 응답에 텍스트 블록이 없습니다.');
    }

    return {
      json: block.text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  }
}
