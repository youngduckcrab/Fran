import { useEffect, useRef } from 'react';

/**
 * 폰의 뒤로가기 버튼으로 화면과 창을 닫는다.
 *
 * 홈 화면에 설치한 웹앱은 방문 기록이 하나뿐이라, 뒤로가기를 누르면 "앞 페이지"가 없어서
 * 앱이 그대로 꺼진다. 열려 있는 화면·창의 수만큼 기록을 밀어 넣어 두고, 뒤로가기가 오면
 * 맨 위에 열린 것을 닫는다.
 *
 * 밀어 넣고 빼는 일은 한 박자 미뤄서 한다. 메뉴를 닫으면서 다른 창을 여는 경우(길게 누른
 * 메뉴 → 저장할 문장 고르기)처럼 같은 순간에 둘이 오가면, 그때그때 기록을 건드리다가
 * 방금 연 창의 기록 칸을 도로 지워 버린다.
 */
interface Entry {
  id: number;
  close: () => void;
}

const entries: Entry[] = [];
/** 우리가 밀어 넣어 둔 기록 칸 수. 목표는 언제나 entries.length 와 같아지는 것. */
let pushed = 0;
let nextId = 1;
let scheduled = false;

function sync(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    while (entries.length > pushed) {
      history.pushState({ fran: ++nextId }, '');
      pushed += 1;
    }
    // 한 칸씩만 되돌린다. 남았으면 popstate 가 온 뒤에 다시 맞춘다.
    if (entries.length < pushed) history.back();
  });
}

function onPopState(): void {
  if (pushed > 0) pushed -= 1;

  // 칸이 줄었는데 열린 것이 더 많다 = 사용자가 뒤로가기를 눌렀다. 맨 위를 닫는다.
  // 수가 맞으면 우리가 부른 history.back() 이 돌아온 것이므로 아무것도 닫지 않는다.
  if (entries.length > pushed) {
    const top = entries.pop();
    top?.close();
  }
  sync();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', onPopState);
}

/**
 * `active` 인 동안 뒤로가기를 이 닫기 동작에 연결한다.
 * 여러 개가 겹쳐 있으면 가장 나중에 열린 것부터 닫힌다.
 */
export function useBackClose(active: boolean, onClose: () => void): void {
  // 닫기 함수는 매 렌더 새로 만들어진다. 그때마다 기록을 다시 밀어 넣지 않도록 참조로 둔다.
  const handler = useRef(onClose);
  handler.current = onClose;

  useEffect(() => {
    if (!active) return;
    const id = nextId++;
    entries.push({ id, close: () => handler.current() });
    sync();

    return () => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index !== -1) entries.splice(index, 1);
      sync();
    };
  }, [active]);
}
