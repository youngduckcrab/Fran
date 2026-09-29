import { useEffect, useRef } from 'react';
import { inkAlpha, inkFor, type Doodle } from '../doodle';

interface Props {
  doodle: Doodle;
  myId: string;
  peerId: string;
}

/** 선 굵기(화면 너비 대비). 폰에서도 태블릿에서도 비슷한 굵기로 보이게. */
const WIDTH_RATIO = 0.011;

/**
 * 낙서가 그려지는 판.
 *
 * 그리는 중일 때만 손가락을 받는다. 평소에는 통째로 통과시켜서, 아래에 있는
 * 작은 창을 끌거나 단추를 누르는 데 걸리지 않게 한다.
 */
export default function DoodleLayer({ doodle, myId, peerId }: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  /**
   * 계속 다시 그린다.
   *
   * 선이 서서히 스러지므로 손이 멈춰 있어도 화면은 바뀐다. 획이 하나도 없을
   * 때는 돌지 않는다.
   */
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;

    const paint = () => {
      const ctx = element.getContext('2d');
      if (!ctx) return;

      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = width * ratio;
        element.height = height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const now = Date.now();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, width * WIDTH_RATIO);

      for (const stroke of doodle.strokes) {
        const alpha = inkAlpha(stroke, now);
        if (alpha <= 0 || stroke.points.length < 2) continue;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = inkFor(stroke.mine, myId, peerId);
        ctx.beginPath();
        ctx.moveTo(stroke.points[0]! * width, stroke.points[1]! * height);
        for (let i = 2; i < stroke.points.length; i += 2) {
          ctx.lineTo(stroke.points[i]! * width, stroke.points[i + 1]! * height);
        }
        // 점 하나만 찍은 경우에도 자국이 남게.
        if (stroke.points.length === 2) ctx.lineTo(stroke.points[0]! * width + 0.1, stroke.points[1]! * height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [doodle.strokes, myId, peerId]);

  /** 화면 좌표를 0~1 로. 상대 화면 크기가 달라도 같은 자리에 그려지도록. */
  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  return (
    <canvas
      ref={canvas}
      className={`doodle ${doodle.drawing ? 'is-drawing' : ''}`}
      onPointerDown={(event) => {
        if (!doodle.drawing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = at(event);
        doodle.begin(x, y);
      }}
      onPointerMove={(event) => {
        if (!doodle.drawing || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const { x, y } = at(event);
        doodle.extend(x, y);
      }}
      onPointerUp={() => doodle.end()}
      onPointerCancel={() => doodle.end()}
    />
  );
}
