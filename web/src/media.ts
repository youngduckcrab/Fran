import type { Attachment, AttachmentKind } from '@fran/shared';
import { getToken } from './api';

/** 사진의 긴 변을 이 정도로 줄여서 올린다. 폰 화면에서 보기에 충분하다. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * 폰 사진은 한 장에 5MB 가 넘는다. 그대로 올리면 무료 DB 용량이 금방 차고,
 * 상대는 데이터를 써 가며 받아야 한다. 올리기 전에 화면에서 줄인다.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진을 처리할 수 없습니다.');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('사진을 처리할 수 없습니다.');
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('사진을 열 수 없습니다.'));
    image.src = url;
  });
}

/* ------------------------------ 녹음 ------------------------------ */

/** 기기가 만들어 줄 수 있는 형식. 안드로이드는 webm/opus, 아이폰은 mp4 를 준다. */
function pickAudioType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    // getUserMedia 는 https 나 localhost 에서만 있다. 없으면 버튼을 띄우지 않는다.
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export interface Recorder {
  /** 녹음을 끝내고 결과를 준다. */
  stop: () => Promise<{ blob: Blob; durationMs: number }>;
  /** 버리고 마이크를 끈다. */
  cancel: () => void;
  startedAt: number;
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = pickAudioType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  const startedAt = Date.now();

  // 마이크를 켜 둔 채로 두면 폰 상단에 녹음 표시가 계속 남는다. 끝나면 반드시 끈다.
  const release = () => stream.getTracks().forEach((track) => track.stop());

  return {
    startedAt,
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } finally {
        release();
      }
    },
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }),
            durationMs: Date.now() - startedAt,
          });
        };
        if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'));
        else recorder.stop();
      }),
  };
}

/* ------------------------------ 올리기 ------------------------------ */

export async function uploadAttachment(
  blob: Blob,
  kind: AttachmentKind,
  meta: { width?: number; height?: number; durationMs?: number } = {},
): Promise<Attachment> {
  const params = new URLSearchParams({ kind });
  if (meta.width) params.set('width', String(meta.width));
  if (meta.height) params.set('height', String(meta.height));
  if (meta.durationMs) params.set('duration', String(Math.round(meta.durationMs)));

  const response = await fetch(`/api/attachments?${params.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': blob.type || (kind === 'image' ? 'image/jpeg' : 'audio/webm'),
      authorization: `Bearer ${getToken() ?? ''}`,
    },
    body: blob,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? '파일을 올리지 못했습니다.');
  }
  return ((await response.json()) as { attachment: Attachment }).attachment;
}

/** 사진·음성을 내려받는 주소. 헤더를 붙일 수 없는 태그에서 쓰므로 토큰을 주소에 싣는다. */
export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}?t=${encodeURIComponent(getToken() ?? '')}`;
}

/** 0:07 처럼. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 사진을 폰에 저장한다.
 *
 * 폰에서는 "다운로드 폴더"보다 공유 시트(사진 앱에 저장)가 자연스럽고, 아이폰은 사실상
 * 그 길밖에 없다. 공유가 안 되는 곳(데스크톱 브라우저 등)에서는 그냥 내려받는다.
 *
 * 파일은 미리 받아 둔 것을 넘긴다 — 누른 뒤에 받아오면 그 사이에 "사용자가 누른 순간"이
 * 풀려서 아이폰이 공유 시트를 거부한다.
 */
export function savePhoto(file: File): void {
  const sharer = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[] }) => Promise<void>;
  };

  if (sharer.canShare?.({ files: [file] }) && sharer.share) {
    void sharer.share({ files: [file] }).catch(() => download(file));
    return;
  }
  download(file);
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 바로 지우면 내려받기가 시작되기 전에 주소가 사라지는 브라우저가 있다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 크게 보기에서 미리 받아 두는 사진 파일. 저장 버튼이 기다림 없이 동작하도록. */
export async function fetchPhotoFile(attachmentId: string): Promise<File> {
  const response = await fetch(attachmentUrl(attachmentId));
  if (!response.ok) throw new Error('사진을 받아오지 못했습니다.');
  const blob = await response.blob();
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `fran-${attachmentId.slice(0, 8)}.${extension}`, {
    type: blob.type || 'image/jpeg',
  });
}
