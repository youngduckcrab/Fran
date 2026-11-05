import { useSyncExternalStore } from 'react';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

/**
 * 음성 메시지 재생기. 앱 전체에 하나만 둔다.
 *
 * 말풍선마다 재생기를 만들면 (1) 두 개를 누르면 둘이 겹쳐 나오고, (2) 대화방을 나가도 계속 나오며,
 * (3) 들은 메시지마다 디코더가 하나씩 남아 언젠가 폰이 더 만들어 주지 않는다. 그래서 하나를 두고
 * 다른 메시지를 누르면 앞의 것을 치운다.
 *
 * 안드로이드(ExoPlayer)는 끝난 뒤에도 "재생하려는 상태" 가 켜져 있어서, 처음으로 되감기만 하면
 * 다시 처음부터 나온다. 끝나면 먼저 멈추고 되감는다. 그러지 않으면 끝없이 되풀이된다.
 */
export type VoicePhase = 'idle' | 'loading' | 'playing' | 'failed';

interface State {
  id: string | null;
  phase: VoicePhase;
}

let state: State = { id: null, phase: 'idle' };
let player: AudioPlayer | null = null;
let subscription: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

function set(next: State): void {
  if (next.id === state.id && next.phase === state.phase) return;
  state = next;
  for (const listener of listeners) listener();
}

function dispose(): void {
  subscription?.remove();
  subscription = null;
  const old = player;
  player = null;
  if (!old) return;
  try {
    old.pause();
  } catch {
    // 이미 풀린 재생기.
  }
  try {
    old.remove();
  } catch {
    // 마찬가지.
  }
}

function onStatus(created: AudioPlayer, id: string, status: AudioStatus): void {
  if (player !== created) return;
  if (status.error) {
    // 서버가 늦게 답했거나, 망이 바뀌었거나, 파일을 못 읽었다. 이 재생기는 다시 준비되지 않으므로
    // 버리고, 다음에 누르면 새로 만든다.
    dispose();
    set({ id, phase: 'failed' });
    return;
  }
  if (status.didJustFinish) {
    created.pause();
    void created.seekTo(0).catch(() => {});
    set({ id, phase: 'idle' });
    return;
  }
  if (status.isBuffering) {
    // 사용자가 멈춘 뒤에 되감느라 잠깐 버퍼링하는 것은 "불러오는 중" 이 아니다.
    if (state.phase !== 'idle') set({ id, phase: 'loading' });
    return;
  }
  if (status.playing) {
    set({ id, phase: 'playing' });
    return;
  }
  // 다 받아 둔 채 멈췄다(멈춤을 눌렀거나, 전화가 와서 폰이 멈췄다). 받기 전의 잠깐은 넘긴다.
  if (status.playbackState === 'ready' || status.playbackState === 'ended') set({ id, phase: 'idle' });
}

/** 누른 음성 메시지를 재생하거나 멈춘다. 다른 것이 나오고 있었으면 그것은 멈춘다. */
export function toggleVoice(id: string, uri: string): void {
  if (player && state.id === id && state.phase !== 'failed') {
    if (state.phase === 'idle') {
      player.play();
      set({ id, phase: 'loading' });
    } else {
      player.pause();
      set({ id, phase: 'idle' });
    }
    return;
  }

  dispose();
  try {
    const created = createAudioPlayer({ uri });
    player = created;
    subscription = created.addListener('playbackStatusUpdate', (status) => onStatus(created, id, status));
    created.play();
    set({ id, phase: 'loading' });
  } catch {
    dispose();
    set({ id, phase: 'failed' });
  }
}

/** 대화방을 나가거나 통화를 시작할 때. */
export function stopVoice(): void {
  dispose();
  set({ id: null, phase: 'idle' });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 이 메시지의 재생 상태. 다른 메시지가 나오고 있으면 idle. */
export function useVoicePhase(id: string): VoicePhase {
  return useSyncExternalStore(subscribe, () => (state.id === id ? state.phase : 'idle'));
}
