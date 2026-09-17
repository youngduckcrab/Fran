/**
 * 화면에 쓰는 그림들.
 *
 * 이모지(🖼 🎤 ⭐)를 쓰면 기기마다 다른 그림이 나오고, 색과 두께가 제각각이라
 * 앱 안에서 겉돈다. 같은 굵기·같은 둥근 끝으로 그린 선 그림을 쓰면 글자 색을
 * 그대로 따라가고, 어느 기기에서나 같아 보인다.
 */
export type IconName =
  | 'chat'
  | 'bookmark'
  | 'book'
  | 'image'
  | 'mic'
  | 'pencil'
  | 'plus'
  | 'close'
  | 'send'
  | 'play'
  | 'stop'
  | 'back'
  | 'heart'
  | 'sparkle'
  | 'check'
  | 'checks'
  | 'download';

interface Props {
  name: IconName;
  /** 선 그림의 크기(px). 글자 크기에 맞춰 준다. */
  size?: number;
  className?: string;
}

const PATHS: Record<IconName, JSX.Element> = {
  chat: (
    <path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H9l-4.2 3.1a.5.5 0 0 1-.8-.4V18.4A7.5 7.5 0 0 1 9 4h4.5A7.5 7.5 0 0 1 21 11.5Z" />
  ),
  bookmark: <path d="M7 4.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V5.5a1 1 0 0 1 1-1Z" />,
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a3 3 0 0 1 2 5.2V20a3 3 0 0 0-2-.8H5.5A1.5 1.5 0 0 1 4 17.7V5.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a3 3 0 0 0-2 5.2V20a3 3 0 0 1 2-.8h4.5a1.5 1.5 0 0 0 1.5-1.5V5.5Z" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17.5 9 13l3 2.8L15.5 12l4 4.5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20.5 4.8 17a2 2 0 0 1 .5-1L15.6 5.7a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L9 19.7a2 2 0 0 1-1 .5l-3.5.8a.4.4 0 0 1-.5-.5Z" />
      <path d="M14.5 7 17 9.5" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6.5 6.5l11 11m0-11-11 11" />,
  send: <path d="M4.3 11.2 19.4 4.6a.6.6 0 0 1 .8.8l-6.6 15.1a.6.6 0 0 1-1.1 0L10 14 4.3 12.3a.6.6 0 0 1 0-1.1Z" />,
  play: <path d="M8.5 5.6a.7.7 0 0 1 1-.6l8.2 6a.7.7 0 0 1 0 1.2l-8.2 6a.7.7 0 0 1-1-.6V5.6Z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />,
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  heart: (
    <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.6 12 20 12 20Z" />
  ),
  sparkle: (
    <>
      <path d="M12 4c.6 3.4 1.6 4.4 5 5-3.4.6-4.4 1.6-5 5-.6-3.4-1.6-4.4-5-5 3.4-.6 4.4-1.6 5-5Z" />
      <path d="M18.5 15c.3 1.6.8 2.1 2.4 2.4-1.6.3-2.1.8-2.4 2.4-.3-1.6-.8-2.1-2.4-2.4 1.6-.3 2.1-.8 2.4-2.4Z" />
    </>
  ),
  check: <path d="M5.5 12.5 10 17l8.5-9" />,
  download: (
    <>
      <path d="M12 3.5v11m0 0 4-4m-4 4-4-4" />
      <path d="M4.5 16.5v1.5a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-1.5" />
    </>
  ),
  // 두 번 겹친 체크 = 상대가 읽었다.
  checks: (
    <>
      <path d="M2.5 12.5 7 17l8.5-9" />
      <path d="M11 14.5 12.5 16l8-8.5" />
    </>
  ),
};

/** 속이 찬 그림들. 선만 그리면 너무 가늘어 보이는 것들이다. */
const FILLED: IconName[] = ['play', 'send', 'bookmark', 'heart', 'sparkle', 'stop'];

export default function Icon({ name, size = 20, className }: Props) {
  const filled = FILLED.includes(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
