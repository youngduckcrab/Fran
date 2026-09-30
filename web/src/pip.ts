import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 통화 화면에 얹히는 내 모습 창.
 *
 * 끌어서 옮기고, 오므려서 키우고, 누르면 상대 화면과 자리가 바뀐다.
 * 자리와 크기는 기억해 둔다 — 통화할 때마다 다시 옮기게 하면 성가시다.
 */

const KEY = 'fran.pip';

/** 창 너비의 한계(화면 너비 대비). 너무 작으면 얼굴이 안 보이고 크면 상대를 가린다. */
const MIN_W = 0.2;
const MAX_W = 0.62;
const DEFAULT_W = 0.32;

/**
 * 창의 가로:세로. 카메라가 주는 그림의 비율을 따라간다.
 *
 * 값을 박아 두면 안 된다. 카메라는 보통 가로로 긴 그림(4:3)을 주는데 창을 세로로
 * 길게 잡아 두면, object-fit: cover 가 양옆을 크게 잘라내서 얼굴이 화면을 꽉 채운
 * 것처럼 보인다. 그림이 도착하면 그 비율로 맞춘다.
 */
const DEFAULT_ASPECT = 4 / 3;

/** 가장자리에서 이만큼 띄운다. 모서리에 딱 붙으면 눌러도 잘 안 잡힌다. */
const EDGE = 12;

export interface PipBox {
  /** 화면 대비 0~1. 창의 왼쪽 위 모서리. */
  x: number;
  y: number;
  /** 화면 너비 대비 0~1. */
  w: number;
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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

interface Point {
  x: number;
  y: number;
}

function spread(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 손가락을 따라다니는 창.
 *
 * 화면 크기가 기기마다 다르므로 자리와 크기를 비율로 들고 있다가 그릴 때만 px 로
 * 바꾼다. 그래야 가로로 돌리거나 다른 기기에서 열어도 화면 밖으로 나가지 않는다.
 */
export function usePip(onTap: () => void, aspect = DEFAULT_ASPECT) {
  const [box, setBox] = useState<PipBox>(load);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  /** 지금 화면에 닿아 있는 손가락들. 둘이면 크기를 바꾸는 중이다. */
  const touches = useRef(new Map<number, Point>());
  /** 누른 자리와 창의 자리 차이. 이걸 빼야 창이 손가락으로 순간이동하지 않는다. */
  const grab = useRef<Point>({ x: 0, y: 0 });
  const started = useRef<{ spread: number; w: number } | null>(null);
  /** 끌었는지 눌렀는지. 조금이라도 움직였으면 누른 것으로 치지 않는다. */
  const moved = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(box));
    } catch {
      // 저장 못 해도 이번 통화에는 그대로 쓴다.
    }
  }, [box]);

  const size = useCallback(() => {
    const width = window.innerWidth * box.w;
    // 비율이 아직 안 왔거나 이상하면 기본값으로. 0 으로 나누는 일은 없어야 한다.
    const safe = aspect > 0.2 && aspect < 5 ? aspect : DEFAULT_ASPECT;
    return { width, height: width / safe };
  }, [aspect, box.w]);

  const down = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (touches.current.size === 1) {
        const rect = event.currentTarget.getBoundingClientRect();
        grab.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        moved.current = false;
        setDragging(true);
      } else if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        if (a && b) started.current = { spread: spread(a, b), w: box.w };
        moved.current = true;
      }
    },
    [box.w],
  );

  const move = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!touches.current.has(event.pointerId)) return;
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // 손가락 둘 — 크기를 바꾼다.
      if (touches.current.size >= 2 && started.current) {
        const [a, b] = [...touches.current.values()];
        if (!a || !b) return;
        const ratio = spread(a, b) / (started.current.spread || 1);
        setBox((previous) => ({
          ...previous,
          w: clamp(started.current!.w * ratio, MIN_W, MAX_W),
        }));
        return;
      }

      // 손가락 하나 — 옮긴다.
      const { width, height } = size();
      const left = event.clientX - grab.current.x;
      const top = event.clientY - grab.current.y;
      if (Math.abs(left + grab.current.x - event.clientX) > 0) moved.current = true;

      const roomX = Math.max(1, window.innerWidth - width - EDGE * 2);
      const roomY = Math.max(1, window.innerHeight - height - EDGE * 2);
      setBox((previous) => ({
        ...previous,
        x: clamp((left - EDGE) / roomX, 0, 1),
        y: clamp((top - EDGE) / roomY, 0, 1),
      }));
      moved.current = true;
    },
    [size],
  );

  const up = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      touches.current.delete(event.pointerId);
      if (touches.current.size < 2) started.current = null;
      if (touches.current.size === 0) {
        setDragging(false);
        // 움직이지 않았으면 누른 것이다. 자리를 바꾼다.
        if (!moved.current) onTap();
      }
    },
    [onTap],
  );

  /** 그릴 때 쓰는 실제 자리. 화면이 바뀌어도 늘 안쪽에 들어온다. */
  const style = (() => {
    const { width, height } = size();
    const roomX = Math.max(0, window.innerWidth - width - EDGE * 2);
    const roomY = Math.max(0, window.innerHeight - height - EDGE * 2);
    return {
      left: `${EDGE + roomX * box.x}px`,
      top: `${EDGE + roomY * box.y}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  })();

  return { ref, style, dragging, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } };
}
