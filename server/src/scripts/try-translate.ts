/**
 * 번역만 한 번 시험해본다. 채팅을 띄우지 않고 provider 설정이 맞는지 확인하는 용도.
 *
 *   npm run try-translate --workspace=server
 *   npm run try-translate --workspace=server -- "오늘 좀 그랬어 ㅠㅠ"
 *
 * 채팅으로 테스트하면 실패했을 때 서버 로그를 뒤져야 하는데, 이건 결과나 실패
 * 이유를 바로 화면에 찍는다. API 키를 넣은 직후 제일 먼저 돌려보면 된다.
 */
import type { ChatMessage, LangCode, UserProfile } from '@fran/shared';
import { config } from '../config.js';
import { getProvider, translateMessage, usageTotals } from '../translation/index.js';

const [me, peer] = config.users.map((user) => user.profile) as [UserProfile, UserProfile];

/** 맥락 없이는 번역이 안 되는 문장을 일부러 넣었다. "걔"가 누구인지 앞 대화에만 있다. */
const FIXTURE: Array<{ from: UserProfile; text: string; lang: LangCode }> = [
  { from: me, text: '오늘 뭐 했어?', lang: me.nativeLang },
  { from: peer, text: 'Fui al mercado con mi hermana, compró como diez paltas', lang: peer.nativeLang },
];

const target = process.argv[2] ?? '헐 걔 진짜 그렇게 많이 샀어? ㅋㅋㅋ';

function message(from: UserProfile, text: string, lang: LangCode, offsetMin: number): ChatMessage {
  return {
    id: `fixture-${offsetMin}`,
    senderId: from.id,
    sourceText: text,
    sourceLang: lang,
    createdAt: Date.now() - offsetMin * 60_000,
    translationStatus: 'pending',
    translations: {},
  };
}

const context = FIXTURE.map((entry, index) =>
  message(entry.from, entry.text, entry.lang, FIXTURE.length - index + 1),
);
const subject = message(me, target, me.nativeLang, 0);

let provider;
try {
  provider = getProvider();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log(`provider : ${provider.name} / ${provider.model}`);
console.log('\n--- 맥락으로 넘기는 앞 대화 ---');
for (const entry of context) {
  const name = entry.senderId === me.id ? me.name : peer.name;
  console.log(`  ${name} (${entry.sourceLang}): ${entry.sourceText}`);
}
console.log(`\n--- 번역할 문장 ---\n  ${me.name} (${subject.sourceLang}): ${subject.sourceText}`);

const targetLangs = [peer.nativeLang, ...process.argv.slice(3)].filter(
  (lang, index, all): lang is LangCode => all.indexOf(lang) === index,
);

console.log(`\n번역 중... (→ ${targetLangs.join(', ')})\n`);

try {
  const { result, model } = await translateMessage({
    message: subject,
    context,
    participants: [me, peer],
    targetLangs,
  });

  console.log(`감지된 원문 언어: ${result.detected_lang}`);
  for (const item of result.translations) {
    console.log(`\n[${item.lang}] ${item.text}`);
    for (const note of item.notes) {
      console.log(`    · ${note.term} — ${note.meaning}`);
    }
  }

  const totals = usageTotals();
  console.log(`\n✓ 성공 (${model}) — 입력 ${totals.inputTokens} / 출력 ${totals.outputTokens} 토큰`);
  console.log('\n"걔"가 누구인지 제대로 옮겨졌다면 맥락 번역이 동작하는 것이다.');
} catch (error) {
  console.error(`\n✗ 번역 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
