/**
 * 지금 내 API 키로 쓸 수 있는 Gemini 모델을 출력한다.
 *
 *   npm run models --workspace=server
 *
 * 무료 티어에서 쓸 수 있는 모델 이름은 수시로 바뀐다. GEMINI_MODEL 을 정하기 전에
 * 이걸 한 번 돌려서 실제로 존재하는 이름인지 확인하는 편이 빠르다.
 */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급해 .env 에 넣으세요.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const rows: string[] = [];
for await (const model of await ai.models.list({ config: { queryBase: true } })) {
  if (!model.supportedActions?.includes('generateContent')) continue;
  const id = (model.name ?? '').replace(/^models\//, '');
  const limit = model.inputTokenLimit ? `${Math.round(model.inputTokenLimit / 1000)}k` : '?';
  rows.push(`${id.padEnd(40)} ${limit.padStart(6)}  ${model.displayName ?? ''}`);
}

if (rows.length === 0) {
  console.log('generateContent 를 지원하는 모델이 없습니다. API 키를 확인하세요.');
} else {
  console.log(`${'MODEL'.padEnd(40)} ${'INPUT'.padStart(6)}  NAME`);
  for (const row of rows.sort()) console.log(row);
  console.log(`\n총 ${rows.length}개. .env 의 GEMINI_MODEL 에 위 이름 중 하나를 넣으세요.`);
}
