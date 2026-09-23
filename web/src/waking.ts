import { useEffect, useState } from "react";
import type { ConnectionState } from "./useChat";

/**
 * 이만큼 넘게 못 붙으면 서버가 자고 있다고 본다.
 *
 * 무료 호스팅은 한동안 아무도 안 들어오면 서버를 재우고, 다시 깨우는 데 수십 초가
 * 걸린다. 그동안 "연결 중…" 만 떠 있으면 앱이 고장 난 것처럼 보인다. 기다리면
 * 된다는 걸 알려 주는 것만으로도 체감이 달라진다.
 *
 * 깨어 있는 서버는 1초 안에 붙으므로, 이 문구가 평소에 뜰 일은 없다.
 */
const WAKING_AFTER_MS = 4000;

export function useWaking(connection: ConnectionState): boolean {
  const [waking, setWaking] = useState(false);
  const open = connection === "open";

  useEffect(() => {
    if (open) {
      setWaking(false);
      return;
    }
    // 'connecting' 과 'closed' 사이를 오가며 다시 시도하는 동안에도 시계는 이어서 간다.
    // connection 자체를 보고 있으면 재시도할 때마다 처음부터 다시 세게 된다.
    const timer = setTimeout(() => setWaking(true), WAKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open]);

  return waking;
}
