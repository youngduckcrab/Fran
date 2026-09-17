/**
 * Codespaces 에서 실행 중이면 웹 포트를 공개로 바꾸고 접속 주소를 찍는다.
 *
 * 포트가 Private 이면 GitHub 에 로그인되지 않은 브라우저(대개 폰)는 404 를 받는다.
 * 증상만 봐서는 서버가 죽은 것과 구분되지 않아 원인을 찾기 어렵다. 포트 탭을
 * 손으로 만지는 대신 여기서 처리한다.
 *
 * Codespaces 가 아니면 아무것도 하지 않는다.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PORT = Number(process.argv[2] ?? 5173);
const name = process.env.CODESPACE_NAME;
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? 'app.github.dev';

if (!name) process.exit(0); // 로컬이면 할 일이 없다

const url = `https://${name}-${PORT}.${domain}`;

try {
  await run('gh', ['codespace', 'ports', 'visibility', `${PORT}:public`, '-c', name]);
  console.log(`[share] 포트 ${PORT} 을 공개로 열었습니다.`);
  console.log(`[share] 폰이나 상대방은 이 주소로 접속하세요:\n\n    ${url}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
  console.warn(`[share] 포트 ${PORT} 을 자동으로 공개하지 못했습니다. (${detail})`);
  console.warn('[share] VS Code 의 "포트" 탭에서 5173 행을 길게 눌러');
  console.warn('[share] 포트 표시 유형 → Public 으로 바꿔 주세요.');
  console.warn(`[share] 주소: ${url}`);
}
