import { useCallback, useRef, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import type { Attachment, AttachmentKind } from '@fran/shared';
import { getToken } from './web/api';
import { SERVER_URL } from './shims';
import { stopVoice } from './voicePlayer';

/** 사진의 긴 변을 이 정도로 줄여서 올린다. 폰 화면에서 보기에 충분하다. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * 폰 사진은 한 장에 5MB 가 넘는다. 그대로 올리면 무료 DB 용량이 금방 차고,
 * 상대는 데이터를 써 가며 받아야 한다. 올리기 전에 줄인다.
 */
export async function prepareImage(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; width: number; height: number }> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize(target);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** 파일 하나를 서버에 올린다. 보낼 때는 그 id 만 실어 보낸다. */
export async function uploadFile(
  uri: string,
  kind: AttachmentKind,
  mime: string,
  meta: { width?: number; height?: number; durationMs?: number } = {},
): Promise<Attachment> {
  const params = new URLSearchParams({ kind });
  if (meta.width) params.set('width', String(meta.width));
  if (meta.height) params.set('height', String(meta.height));
  if (meta.durationMs) params.set('duration', String(Math.round(meta.durationMs)));

  const file = await (await fetch(uri)).blob();
  const response = await fetch(`/api/attachments?${params.toString()}`, {
    method: 'POST',
    headers: { 'content-type': mime, authorization: `Bearer ${getToken() ?? ''}` },
    body: file,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? '파일을 올리지 못했습니다.');
  }
  return ((await response.json()) as { attachment: Attachment }).attachment;
}

/** 사진·음성을 내려받는 주소. 헤더를 붙일 수 없는 곳에서 쓰므로 토큰을 주소에 싣는다. */
export function attachmentUrl(id: string): string {
  return `${SERVER_URL}/api/attachments/${id}?t=${encodeURIComponent(getToken() ?? '')}`;
}

/** 0:07 처럼. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface VoiceRecorder {
  recording: boolean;
  /** 녹음 시작. 마이크 권한이 없으면 false. */
  start: () => Promise<boolean>;
  /** 끝내고 파일을 돌려준다. */
  stop: () => Promise<{ uri: string; durationMs: number } | null>;
  cancel: () => Promise<void>;
  startedAt: number;
}

/** 음성 메시지 녹음. */
export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const startedAt = useRef(0);
  /** 녹음 중인지. 화면 상태(recording)는 다음 그림에서야 바뀌므로, 빨리 두 번 누른 것은 이걸로 막는다. */
  const live = useRef(false);

  const start = useCallback(async () => {
    if (live.current) return true;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return false;
    // 듣던 음성 메시지가 녹음에 같이 들어가지 않게.
    stopVoice();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (cause) {
      // 다른 앱이나 전화가 마이크를 쥐고 있으면 여기서 실패한다. 그대로 두면 녹음기가 "준비됨" 에
      // 걸려서, 다음에 누를 때마다 "이미 준비됐다" 오류만 난다. 멈춰서 처음 상태로 돌려 둔다.
      await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      throw cause;
    }
    live.current = true;
    startedAt.current = Date.now();
    setRecording(true);
    return true;
  }, [recorder]);

  const finish = useCallback(async () => {
    live.current = false;
    setRecording(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [recorder]);

  const stop = useCallback(async () => {
    if (!live.current) return null;
    // 길이는 녹음기가 센 것을 쓴다. 앱이 뒤로 가 있던 동안 녹음기는 멈추는데, 시계는 계속 간다.
    let durationMs = Date.now() - startedAt.current;
    try {
      const measured = recorder.getStatus().durationMillis;
      if (measured > 0) durationMs = measured;
    } catch {
      // 시계 값으로 둔다.
    }
    await finish();
    return recorder.uri ? { uri: recorder.uri, durationMs } : null;
  }, [finish, recorder]);

  const cancel = useCallback(async () => {
    if (live.current) await finish().catch(() => {});
  }, [finish]);

  return { recording, start, stop, cancel, get startedAt() { return startedAt.current; } };
}
