import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * 새 버전이 나왔는지 살피고, 언제 갈아탈지 정한다.
 *
 * 홈 화면에 설치한 앱은 껐다 켜도 페이지를 새로 불러오지 않는다. 되살아나기만
 * 하므로, 가만히 두면 몇 번을 껐다 켜도 옛 코드를 그대로 쓴다. 그래서
 * **앱이 다시 보일 때마다** 새 버전이 있는지 직접 물어본다.
 *
 * 찾았다고 바로 갈아타지는 않는다. 통화 중에 새로고침하면 전화가 끊긴다.
 * 알려만 주고 갈아타는 순간은 사람이 고른다.
 */

/** 앱을 계속 켜 둔 채 쓰는 경우를 위해 이만큼마다도 한 번씩 물어본다. */
const ASK_EVERY_MS = 30 * 60 * 1000;

export function useUpdate() {
  const [ready, setReady] = useState(false);
  /** 실제로 갈아타는 일을 하는 함수. 등록이 끝나야 생긴다. */
  const [apply, setApply] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let check: (() => Promise<void>) | undefined;

    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setReady(true);
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        check = async () => {
          try {
            await registration.update();
          } catch {
            // 망이 끊겨 있으면 다음 기회에. 알릴 일은 아니다.
          }
        };
      },
    });

    setApply(() => async () => {
      // true 를 주면 새 워커로 넘어간 뒤 화면을 새로 불러온다.
      await update(true);
    });

    const ask = () => {
      if (document.visibilityState === 'visible') void check?.();
    };
    document.addEventListener('visibilitychange', ask);
    const timer = setInterval(ask, ASK_EVERY_MS);

    return () => {
      document.removeEventListener('visibilitychange', ask);
      clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(() => {
    void apply?.();
  }, [apply]);

  return { ready, refresh };
}

/** 이 빌드가 만들어진 때. 설정에 적어 두어 어느 버전인지 눈으로 가린다. */
export const builtAt = __BUILT_AT__;
