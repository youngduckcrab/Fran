import { useMemo, useRef, useState } from 'react';
import { PanResponder, useWindowDimensions, type GestureResponderEvent } from 'react-native';

/**
 * 통화 화면에 얹히는 내 모습 창 — 앱 판 (웹 판: web/src/pip.ts).
 *
 * 끌어서 옮기고, 오므려서 키우고, 누르면 상대 화면과 자리가 바뀐다.
 * 자리와 크기는 화면 대비 비율로 기억해 둔다 — 가로로 돌리거나 다른 기기에서 열어도
 * 화면 밖으로 나가지 않는다.
 */

const KEY = 'fran.pip';
const MIN_W = 0.2;
const MAX_W = 0.62;
const DEFAULT_W = 0.32;
/** 가장자리에서 이만큼 띄운다. 모서리에 딱 붙으면 눌러도 잘 안 잡힌다. */
const EDGE = 12;
/** 이만큼 넘게 움직이면 끌었다고 본다. 누르다 손이 살짝 떨리는 것은 눌렀다고 본다. */
const TAP_SLOP = 8;

export interface PipBox {
  x: number;
  y: number;
  w: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function load(): PipBox {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<PipBox>;
      if (typeof saved.x === 'number' && typeof saved.y === 'number' && typeof saved.w === 'number') {
        return { x: saved.x, y: saved.y, w: clamp(saved.w, MIN_W, MAX_W) };
      }
    }
  } catch {
    // 못 읽으면 기본 자리로.
  }
  return { x: 1, y: 0, w: DEFAULT_W };
}

function spread(touches: GestureResponderEvent['nativeEvent']['touches']): number {
  const [a, b] = touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function usePip(onTap: () => void) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [box, setBox] = useState<PipBox>(load);
  const [dragging, setDragging] = useState(false);

  // 손이 움직이는 동안 최신 값이 필요해서 ref 에 거울을 둔다.
  const live = useRef({ box, screenW, screenH, onTap });
  live.current = { box, screenW, screenH, onTap };

  const gesture = useRef({ startX: 0, startY: 0, startBox: box, startSpread: 0, moved: false });

  /** 카메라 그림이 세로로 서 있으면 3:4, 화면을 눕히면 4:3. */
  const aspect = screenW < screenH ? 3 / 4 : 4 / 3;
  const width = screenW * box.w;
  const height = width / aspect;
  const roomX = Math.max(0, screenW - width - EDGE * 2);
  const roomY = Math.max(0, screenH - height - EDGE * 2);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const g = gesture.current;
          g.startX = event.nativeEvent.pageX;
          g.startY = event.nativeEvent.pageY;
          g.startBox = live.current.box;
          g.startSpread = 0;
          g.moved = false;
          setDragging(true);
        },
        onPanResponderMove: (event, state) => {
          const g = gesture.current;
          const { touches } = event.nativeEvent;
          const { screenW: w, screenH: h } = live.current;

          // 손가락 둘 — 크기를 바꾼다.
          if (touches.length >= 2) {
            const now = spread(touches);
            if (!g.startSpread) {
              g.startSpread = now;
              g.startBox = live.current.box;
            }
            g.moved = true;
            const ratio = now / (g.startSpread || 1);
            setBox((previous) => ({ ...previous, w: clamp(g.startBox.w * ratio, MIN_W, MAX_W) }));
            return;
          }
          g.startSpread = 0;

          // 손가락 하나 — 옮긴다.
          if (Math.hypot(state.dx, state.dy) > TAP_SLOP) g.moved = true;
          if (!g.moved) return;
          const pipW = w * g.startBox.w;
          const pipH = pipW / (w < h ? 3 / 4 : 4 / 3);
          const rx = Math.max(1, w - pipW - EDGE * 2);
          const ry = Math.max(1, h - pipH - EDGE * 2);
          const left = EDGE + rx * g.startBox.x + state.dx;
          const top = EDGE + ry * g.startBox.y + state.dy;
          setBox((previous) => ({
            ...previous,
            x: clamp((left - EDGE) / rx, 0, 1),
            y: clamp((top - EDGE) / ry, 0, 1),
          }));
        },
        onPanResponderRelease: () => {
          setDragging(false);
          // 움직이지 않았으면 누른 것이다. 자리를 바꾼다.
          if (!gesture.current.moved) live.current.onTap();
          try {
            localStorage.setItem(KEY, JSON.stringify(live.current.box));
          } catch {
            // 저장 못 해도 이번 통화에는 그대로 쓴다.
          }
        },
        onPanResponderTerminate: () => setDragging(false),
      }),
    [],
  );

  return {
    dragging,
    panHandlers: responder.panHandlers,
    style: {
      position: 'absolute' as const,
      left: EDGE + roomX * box.x,
      top: EDGE + roomY * box.y,
      width,
      height,
    },
  };
}
