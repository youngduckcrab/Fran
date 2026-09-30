/*
 * 웹 앱의 "화면이 아닌" 코드를 앱으로 가져온다.
 *
 * 서버와 주고받는 규칙(로그인, 소켓, 재연결, 캐시, 통화 신호, 번역 문구)은 웹과 앱이
 * 같아야 한다. 두 벌을 따로 관리하면 한쪽만 고쳐서 어긋나는 일이 반드시 생긴다.
 * 원본은 web/src 하나이고, 여기서 src/web/ 으로 복사한다(그 폴더는 git 에 올리지 않는다).
 *
 * 브라우저에만 있는 것(받아쓰기 같은)은 overrides/ 의 같은 이름 파일이 덮어쓴다.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const from = join(app, '..', 'web', 'src');
const to = join(app, 'src', 'web');

/** 화면(DOM)에 묶이지 않은 것만. 바뀌면 여기에 더한다. */
const SHARED = [
  'api.ts',
  'cache.ts',
  'call.ts',
  'collections.ts',
  'day.ts',
  'doodle.ts',
  'i18n.ts',
  'preview.ts',
  'search.ts',
  'speakable.ts',
  'text.ts',
  'theme.ts',
  'useChat.ts',
  'view.ts',
  'waking.ts',
  'words.ts',
];

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

for (const name of SHARED) {
  const source = join(from, name);
  if (!existsSync(source)) throw new Error(`web/src/${name} 이 없다. sync-web.mjs 의 목록을 고쳐야 한다.`);
  copyFileSync(source, join(to, name));
}

const overrides = join(app, 'overrides');
for (const name of readdirSync(overrides)) copyFileSync(join(overrides, name), join(to, name));

writeFileSync(
  join(to, 'README.md'),
  '이 폴더는 scripts/sync-web.mjs 가 만든다. 고치지 말 것 — web/src 나 overrides/ 를 고친다.\n',
);
console.log(`web/src 에서 ${SHARED.length}개, overrides/ 에서 ${readdirSync(overrides).length}개를 가져왔다.`);
