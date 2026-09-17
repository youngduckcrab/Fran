/*
 * 앱 아이콘을 다시 만든다. 모양을 고치고 싶을 때만 돌리면 된다.
 *   npx playwright@1 install chromium   (한 번)
 *   node scripts/make-icons.mjs
 * 결과는 web/public/ 에 바로 씌어진다.
 */
import { chromium } from 'playwright';

/**
 * 앱 아이콘. 배경은 앱의 분홍-라벤더 그라디언트, 가운데에 말풍선 두 개가 겹쳐
 * 하트를 이룬다. 둘이 주고받는 말이 곧 마음이라는 뜻.
 */
const icon = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff9ec0"/>
      <stop offset="55%" stop-color="#e79ad6"/>
      <stop offset="100%" stop-color="#a98bff"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#6b3b7a" flood-opacity="0.22"/>
    </filter>
  </defs>

  <rect width="512" height="512" rx="112" fill="url(#bg)"/>

  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)" filter="url(#soft)">
    <!-- 뒤쪽 말풍선 (조금 투명하게) -->
    <g fill="#ffffff" opacity="0.62">
      <rect x="214" y="206" width="186" height="164" rx="46"/>
      <path d="M368 356c6 20 14 33 26 40-22 3-41-3-57-18Z"/>
    </g>
    <!-- 앞쪽 말풍선 -->
    <g fill="#ffffff">
      <rect x="112" y="122" width="212" height="184" rx="52"/>
      <path d="M156 292c-6 22-15 37-28 45 24 4 45-3 63-20Z"/>
    </g>
    <!-- 겹치는 자리에 하트 -->
    <path d="M218 286c-36-24-60-43-60-68a30 30 0 0 1 60-11 30 30 0 0 1 60 11c0 25-24 44-60 68Z"
          fill="#ff7fa8"/>
  </g>
</svg>`;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

for (const [file, size, scale] of [
  ['icon-512.png', 512, 1],
  ['icon-192.png', 192, 1],
  ['apple-touch-icon.png', 180, 1],
  // 안드로이드는 아이콘을 동그랗게 잘라낸다. 잘려도 되는 여백을 두고 작게 그린다.
  ['icon-maskable-512.png', 512, 0.72],
]) {
  await page.setContent(
    `<body style="margin:0">${icon(scale)}</body>`,
    { waitUntil: 'load' },
  );
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate((s) => {
    const svg = document.querySelector('svg');
    svg.setAttribute('width', String(s));
    svg.setAttribute('height', String(s));
  }, size);
  await page.screenshot({ path: `web/public/${file}`, omitBackground: true });
  console.log(file, size);
}
await b.close();
