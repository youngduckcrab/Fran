import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * 창이 열려 있는 동안 폰의 뒤로가기를 가로채서 그 창을 닫는다.
 * 안 그러면 뒤로가기가 앱을 통째로 꺼 버린다. 나중에 열린 창이 먼저 닫힌다.
 */
export function useBackClose(active: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current();
      return true;
    });
    return () => subscription.remove();
  }, [active]);
}
