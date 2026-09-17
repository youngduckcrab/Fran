/**
 * 지금 내 API 키로 쓸 수 있는 Gemini 모델을 출력한다.
 *
 *   npm run models --workspace=server
 *
 * 무료 티어에서 쓸 수 있는 모델 이름은 수시로 바뀐다. GEMINI_MODEL 을 정하기 전에
 * 이걸 한 번 돌려서 실제로 존재하는 이름인지 확인하는 편이 빠르다.
 *
 * 모델별 요청 한도는 API 가 알려주지 않으므로 여기서는 보여줄 수 없다.
 * 대체로 lite < flash < pro 순으로 한도가 줄고 품질이 오른다.
 */
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급해 .env 에 넣으세요.');
  process.exit(1);
}

const current = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
const ai = new GoogleGenAI({ apiKey });

interface Row {
  id: string;
  limit: string;
  name: string;
}

const rows: Row[] = [];
for await (const model of await ai.models.list({ config: { queryBase: true } })) {
  if (!model.supportedActions?.includes('generateContent')) continue;
  rows.push({
    id: (model.name ?? '').replace(/^models\//, ''),
    limit: model.inputTokenLimit ? `${Math.round(model.inputTokenLimit / 1000)}k` : '?',
    name: model.displayName ?? '',
  });
}

if (rows.length === 0) {
  console.log('generateContent 를 지원하는 모델이 없습니다. API 키를 확인하세요.');
  process.exit(0);
}

/** 한도가 넉넉한 쪽(lite)을 위로 올려 고르기 쉽게 한다. */
function rank(id: string): number {
  if (/lite/.test(id)) return 0;
  if (/flash/.test(id)) return 1;
  if (/pro/.test(id)) return 2;
  return 3;
}

rows.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));

console.log(`${''.padEnd(2)}${'MODEL'.padEnd(42)} ${'INPUT'.padStart(6)}  NAME`);
for (const row of rows) {
  const mark = row.id === current ? '→' : ' ';
  console.log(`${mark} ${row.id.padEnd(42)} ${row.limit.padStart(6)}  ${row.name}`);
}

console.log(`\n→ 표시가 지금 .env 에 설정된 모델입니다 (GEMINI_MODEL=${current}).`);
console.log('위쪽(lite)일수록 무료 요청 한도가 넉넉하고, 아래쪽일수록 번역 품질이 좋습니다.');
console.log('정확한 한도는 https://aistudio.google.com 에서 확인하세요.');
