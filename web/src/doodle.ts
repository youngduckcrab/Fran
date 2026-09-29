import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent } from '@fran/shared';

/**
 * 통화 화면에 긋는 낙서.
 *
 * 좌표는 화면 크기로 나눈 0~1 로 오간다. 두 사람 화면 크기가 달라도 같은 자리에
 * 그려진다. 다만 "같은 자리"는 화면 기준이지 얼굴 기준이 아니다 — 내 화면에서
 * 상대 얼굴에 그린 수염은, 상대 화면에서는 같은 화면 자리에 뜬다. 서로 장난치며
 * 긋는 데는 이게 맞고, 무엇을 가리키는 용도로는 맞지 않는다.
 */

/** 그은 뒤 이만큼은 그대로 두었다가 */
const HOLD_MS = 4000;
/** 이만큼에 걸쳐 스러진다. */
const FADE_MS = 2500;

/** 한 번에 모아 보내는 간격. 점 하나마다 보내면 소켓이 시끄럽다. */
const SEND_EVERY_MS = 60;

export interface Stroke {
  id: string;
  mine: boolean;
  /** [x, y, x, y, …] 0~1. */
  points: number[];
  /** 마지막으로 점이 붙은 때. 스러지는 시점을 이걸로 잰다. */
  at: number;
}

/**
 * 누구 색인지.
 *
 * 두 사람이 같은 사람을 같은 색으로 봐야 "이건 네가 그린 것" 이 통한다. id 를
 * 견주어 정하므로 양쪽이 같은 답을 낸다.
 */
export function inkFor(mine: boolean, myId: string, peerId: string): string {
  const first = myId < peerId;
  const own = first ? '#ff5d8f' : '#37c8d8';
  const other = first ? '#37c8d8' : '#ff5d8f';
  return mine ? own : other;
}

export function useDoodle(emit: (event: ClientEvent) => void, callId: string | null) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  /** 지금 긋고 있는 획. 손을 떼면 비운다. */
  const live = useRef<{ id: string; sent: number; pending: number[] } | null>(null);

  /** 다 스러진 획은 버린다. 그대로 두면 통화가 길어질수록 그릴 것만 쌓인다. */
  useEffect(() => {
    if (strokes.length === 0) return;
    const timer = setInterval(() => {
      const dead = Date.now() - (HOLD_MS + FADE_MS);
      setStrokes((previous) => {
        const alive = previous.filter((stroke) => stroke.at > dead);
        return alive.length === previous.length ? previous : alive;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [strokes.length]);

  const begin = useCallback((x: number, y: number) => {
    live.current = { id: crypto.randomUUID(), sent: 0, pending: [] };
    setStrokes((previous) => [
      ...previous,
      { id: live.current!.id, mine: true, points: [x, y], at: Date.now() },
    ]);
  }, []);

  const extend = useCallback(
    (x: number, y: number) => {
      const current = live.current;
      if (!current || !callId) return;
      current.pending.push(x, y);
      setStrokes((previous) =>
        previous.map((stroke) =>
          stroke.id === current.id
            ? { ...stroke, points: [...stroke.points, x, y], at: Date.now() }
            : stroke,
        ),
      );

      const now = Date.now();
      if (now - current.sent < SEND_EVERY_MS) return;
      current.sent = now;
      emit({ type: 'draw', callId, strokeId: current.id, points: current.pending });
      current.pending = [];
    },
    [callId, emit],
  );

  const end = useCallback(() => {
    const current = live.current;
    live.current = null;
    if (!current || !callId) return;
    // 남은 점들. 손을 떼는 순간의 마지막 조각이 빠지면 선이 중간에 끊긴다.
    if (current.pending.length > 0) {
      emit({ type: 'draw', callId, strokeId: current.id, points: current.pending });
    }
  }, [callId, emit]);

  const clear = useCallback(() => {
    setStrokes([]);
    if (callId) emit({ type: 'draw_clear', callId });
  }, [callId, emit]);

  /** 상대가 그은 것을 받는다. 같은 획 id 면 이어 붙인다. */
  const receive = useCallback((strokeId: string, points: number[]) => {
    setStrokes((previous) => {
      const at = previous.findIndex((stroke) => stroke.id === strokeId);
      if (at === -1) {
        return [...previous, { id: strokeId, mine: false, points, at: Date.now() }];
      }
      return previous.map((stroke, i) =>
        i === at ? { ...stroke, points: [...stroke.points, ...points], at: Date.now() } : stroke,
      );
    });
  }, []);

  const wipe = useCallback(() => setStrokes([]), []);

  return { strokes, drawing, setDrawing, begin, extend, end, clear, receive, wipe };
}

export type Doodle = ReturnType<typeof useDoodle>;

/** 이 획이 지금 얼마나 진한지. 1 이면 그대로, 0 이면 사라진 것. */
export function inkAlpha(stroke: Stroke, now: number): number {
  const age = now - stroke.at;
  if (age <= HOLD_MS) return 1;
  return Math.max(0, 1 - (age - HOLD_MS) / FADE_MS);
}
