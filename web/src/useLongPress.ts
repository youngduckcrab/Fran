import { useCallback, useRef } from 'react';

const HOLD_MS = 450;
/** 이만큼 움직이면 스크롤로 본다. */
const MOVE_TOLERANCE_PX = 10;

/**
 * 길게 누르기. 터치와 마우스를 함께 다루고, 손가락이 움직이면(스크롤) 취소한다.
 * 길게 눌러 열렸을 때는 뒤따르는 click 을 한 번 삼켜서 탭 동작과 겹치지 않게 한다.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, HOLD_MS);
    },
    [onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!origin.current) return;
      const moved =
        Math.abs(event.clientX - origin.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - origin.current.y) > MOVE_TOLERANCE_PX;
      if (moved) clear();
    },
    [clear],
  );

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // 데스크톱 우클릭과 모바일의 기본 길게누르기 메뉴를 대신한다.
      event.preventDefault();
      clear();
      fired.current = true;
      onLongPress();
    },
    [clear, onLongPress],
  );

  /** 길게 눌러 이미 처리했다면 true. 이어지는 click 을 무시하는 데 쓴다. */
  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu,
    },
    consumeClick,
  };
}
