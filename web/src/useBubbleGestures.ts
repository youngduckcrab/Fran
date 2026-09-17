import { useCallback, useRef, useState } from 'react';

const HOLD_MS = 450;
/** 이만큼 움직이면 누르고 있는 게 아니라 끄는 것으로 본다. */
const MOVE_TOLERANCE_PX = 10;
/** 여기까지 밀면 답장이 걸린다. */
const REPLY_THRESHOLD_PX = 56;
/** 아무리 밀어도 이 이상은 따라가지 않는다. */
const MAX_DRAG_PX = 84;

/**
 * 말풍선 하나에 붙는 손가락 동작.
 *
 * - 길게 누르기 → 메뉴
 * - 오른쪽으로 밀기 → 그 메시지에 답장
 *
 * 둘 다 같은 pointerdown 에서 시작하므로 한곳에서 다뤄야 서로 방해하지 않는다.
 * 세로로 움직이면 스크롤이므로 둘 다 취소한다.
 */
export function useBubbleGestures(onLongPress: () => void, onSwipeReply?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const dragging = useRef(false);
  const [offset, setOffset] = useState(0);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    origin.current = null;
    dragging.current = false;
    setOffset(0);
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      fired.current = false;
      dragging.current = false;
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
      const start = origin.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (!dragging.current) {
        if (Math.abs(dy) > MOVE_TOLERANCE_PX && Math.abs(dy) > Math.abs(dx)) {
          // 세로로 움직였다 = 스크롤. 우리 차례가 아니다.
          reset();
          return;
        }
        if (!onSwipeReply || dx <= MOVE_TOLERANCE_PX) return;
        dragging.current = true;
        clearTimer();
      }

      // 끝으로 갈수록 덜 따라와서, 더 밀어도 소용없다는 게 손끝으로 느껴진다.
      const pulled = Math.min(dx, MAX_DRAG_PX + (dx - MAX_DRAG_PX) * 0.2);
      setOffset(Math.max(0, pulled));
    },
    [clearTimer, onSwipeReply, reset],
  );

  const onPointerUp = useCallback(() => {
    if (dragging.current && offset >= REPLY_THRESHOLD_PX) {
      fired.current = true; // 뒤따라오는 click 을 삼킨다
      onSwipeReply?.();
    }
    reset();
  }, [offset, onSwipeReply, reset]);

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // 데스크톱 우클릭과 모바일의 기본 길게누르기 메뉴를 대신한다.
      event.preventDefault();
      reset();
      fired.current = true;
      onLongPress();
    },
    [onLongPress, reset],
  );

  /** 길게 눌렀거나 밀어서 이미 처리했다면 true. 이어지는 click 을 무시하는 데 쓴다. */
  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
      onPointerLeave: reset,
      onContextMenu,
    },
    /** 지금 얼마나 밀려 있는지(px). 말풍선을 그만큼 옮겨 그린다. */
    offset,
    /** 놓으면 답장이 걸릴 만큼 밀렸는지. */
    armed: offset >= REPLY_THRESHOLD_PX,
    consumeClick,
  };
}
