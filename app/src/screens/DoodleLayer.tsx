import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { inkAlpha, inkFor, type Doodle } from '../web/doodle';

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
  const [size, setSize] = useState({ width: 1, height: 1 });
  /** 선이 서서히 스러지므로 손이 멈춰 있어도 화면은 바뀐다. 획이 있는 동안만 돈다. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (doodle.strokes.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(timer);
  }, [doodle.strokes.length]);

  // 손이 움직이는 동안 최신 값이 필요하다.
  const live = useRef({ doodle, size });
  live.current = { doodle, size };

  const responder = useMemo(() => {
    /** 화면 좌표를 0~1 로. 상대 화면 크기가 달라도 같은 자리에 그려지도록. */
    const at = (x: number, y: number) => {
      const { width, height } = live.current.size;
      return { x: Math.min(1, Math.max(0, x / width)), y: Math.min(1, Math.max(0, y / height)) };
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.doodle.drawing,
      onMoveShouldSetPanResponder: () => live.current.doodle.drawing,
      onPanResponderGrant: (event) => {
        const { x, y } = at(event.nativeEvent.locationX, event.nativeEvent.locationY);
        live.current.doodle.begin(x, y);
      },
      onPanResponderMove: (event) => {
        const { x, y } = at(event.nativeEvent.locationX, event.nativeEvent.locationY);
        live.current.doodle.extend(x, y);
      },
      onPanResponderRelease: () => live.current.doodle.end(),
      onPanResponderTerminate: () => live.current.doodle.end(),
    });
  }, []);

  const strokeWidth = Math.max(3, size.width * WIDTH_RATIO);

  return (
    <View
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      // 그리는 중이 아니면 손가락을 통과시켜 아래 단추와 작은 창이 눌리게 한다.
      pointerEvents={doodle.drawing ? 'auto' : 'none'}
      onLayout={(event) => setSize(event.nativeEvent.layout)}
      {...responder.panHandlers}
    >
      <Svg width={size.width} height={size.height} pointerEvents="none">
        {doodle.strokes.map((stroke) => {
          const opacity = inkAlpha(stroke, now);
          if (opacity <= 0 || stroke.points.length < 2) return null;
          let d = `M ${stroke.points[0]! * size.width} ${stroke.points[1]! * size.height}`;
          for (let i = 2; i < stroke.points.length; i += 2) {
            d += ` L ${stroke.points[i]! * size.width} ${stroke.points[i + 1]! * size.height}`;
          }
          // 점 하나만 찍은 경우에도 자국이 남게.
          if (stroke.points.length === 2) d += ` L ${stroke.points[0]! * size.width + 0.1} ${stroke.points[1]! * size.height}`;
          return (
            <Path
              key={stroke.id}
              d={d}
              stroke={inkFor(stroke.mine, myId, peerId)}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={opacity}
            />
          );
        })}
      </Svg>
    </View>
  );
}
