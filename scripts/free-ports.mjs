/**
 * 개발 서버를 띄우기 전에, 그 포트를 붙잡고 있는 프로세스를 정리한다.
 *
 * 이전 서버가 안 죽은 채로 다시 실행하면 서버만 조용히 실패하고 웹은 정상적으로
 * 떠서, 브라우저에는 "연결 실패"만 보이고 원인을 알기 어렵다. 매번 손으로
 * kill-port 를 치는 대신 여기서 알아서 치운다.
 *
 * lsof 같은 외부 명령에 기대지 않고 /proc 을 직접 읽는다. 리눅스(Codespaces,
 * 컨테이너)에서는 항상 있고, 없는 환경에서는 조용히 넘어간다.
 */
import fs from 'node:fs';

const PORTS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const LISTEN = '0A';

/** /proc/net/tcp{,6} 에서 해당 포트를 LISTEN 중인 소켓의 inode 를 모은다. */
function listeningInodes(port) {
  const wanted = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();

  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10 || parts[3] !== LISTEN) continue;
      if (!parts[1].endsWith(`:${wanted}`)) continue;
      inodes.add(parts[9]);
    }
  }
  return inodes;
}

/** 그 inode 를 열어둔 프로세스를 찾는다. */
function ownersOf(inodes) {
  if (inodes.size === 0) return [];
  const targets = new Set([...inodes].map((inode) => `socket:[${inode}]`));
  const pids = [];

  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let fds;
    try {
      fds = fs.readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue; // 권한이 없거나 그새 종료된 프로세스
    }
    for (const fd of fds) {
      try {
        if (targets.has(fs.readlinkSync(`/proc/${entry}/fd/${fd}`))) {
          pids.push(Number(entry));
          break;
        }
      } catch {
        // 링크가 사라졌으면 넘어간다
      }
    }
  }
  return pids;
}

for (const port of PORTS) {
  const pids = ownersOf(listeningInodes(port)).filter((pid) => pid !== process.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[ports] ${port} 번을 쓰던 프로세스 ${pid} 를 정리했습니다.`);
    } catch {
      console.warn(`[ports] ${port} 번을 쓰는 프로세스 ${pid} 를 정리하지 못했습니다.`);
    }
  }
}
